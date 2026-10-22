-- Cierre de auditoría · grupo prive. Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.
-- Va después de 20261024010000 y 20261024020000. Aplicar ANTES de desplegar prive-access (la función
-- de Edge nueva llama prive_remember_session; la vieja sigue funcionando con esta migración).
--
-- "Mantener mi sesión en este dispositivo (30 días)" (pedido del dueño). Opcional, se elige al escribir
-- la contraseña Privé. La sesión recordada:
--   * vence a los 30 días de abrirse (no 12 h) y por inactividad a los 7 días (no 2 h);
--   * sigue sujeta a TODO lo de prive_require en cada llamada: PRO vigente, 90 días o concesión,
--     membresía activa, versión de la contraseña, y la sesión de Auth donde se abrió (cerrar sesión en
--     IATOS, suspender o borrar la cuenta la invalida al instante — AUD-01);
--   * se cierra con "Cerrar todas mis sesiones" (Membresía), al cambiar/restablecer la contraseña, al
--     reportarla comprometida, con el bloqueo total y en el barrido si se pierde el derecho;
--   * solo se puede pedir para una sesión recién abierta (5 min) de la misma cuenta, por service_role;
--   * deja aviso en la app y en la bitácora (session_remembered).

ALTER TABLE public.prive_sessions ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.prive_session_idle_limit(_remember boolean)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN coalesce(_remember, false) THEN interval '7 days' ELSE interval '2 hours' END;
$$;
REVOKE ALL ON FUNCTION public.prive_session_idle_limit(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_session_idle_limit(boolean) TO service_role;

-- Convierte la sesión recién abierta en recordada. {ok, expires_at} o {ok:false, code}.
CREATE OR REPLACE FUNCTION public.prive_remember_session(_user uuid, _session_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.prive_access_code(_user);
  s public.prive_sessions%ROWTYPE;
BEGIN
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_code); END IF;
  SELECT * INTO s FROM public.prive_sessions
   WHERE id = _session_id AND user_id = _user FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.expires_at <= now() OR s.created_at < now() - interval '5 minutes'
     OR NOT public.prive_auth_session_alive(_user, s.auth_session_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PRIVE_SESSION_INVALID');
  END IF;
  IF s.remember THEN RETURN jsonb_build_object('ok', true, 'expires_at', s.expires_at, 'already', true); END IF;
  UPDATE public.prive_sessions SET remember = true, expires_at = s.created_at + interval '30 days'
   WHERE id = s.id RETURNING * INTO s;
  PERFORM public.notify_once(_user, 'prive', 'Privé quedará abierto en este dispositivo',
    'Elegiste mantener tu sesión Privé en este dispositivo hasta 30 días. Si no fuiste tú, ciérrala desde Privé › Membresía › Cerrar todas mis sesiones.',
    NULL, 'prive_remember:' || s.id::text);
  PERFORM public.prive_audit(_user, 'session_remembered', 'user', jsonb_build_object('session_id', s.id, 'expires_at', s.expires_at));
  RETURN jsonb_build_object('ok', true, 'expires_at', s.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.prive_remember_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_remember_session(uuid, uuid) TO service_role;

-- prive_require: igual que 20261024010000 salvo la inactividad según la sesión.
CREATE OR REPLACE FUNCTION public.prive_require(_ps text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_s public.prive_sessions%ROWTYPE;
  v_ver int;
  v_jwt_sid text := nullif(auth.jwt()->>'session_id', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_NO_SESSION';
  END IF;
  -- Primero el derecho (PRO, revocación, 90 días, activación): sin derecho, la contraseña y la sesión
  -- Privé no sirven de nada.
  v_code := public.prive_access_code(v_uid);
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_code;
  END IF;
  IF _ps IS NULL OR length(_ps) < 32 OR length(_ps) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_NO_SESSION';
  END IF;
  SELECT * INTO v_s FROM public.prive_sessions s
   WHERE s.token_hash = public.prive_sha256_hex(_ps) AND s.user_id = v_uid;
  IF NOT FOUND THEN
    -- Token inexistente o de OTRA cuenta: nunca autoriza.
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_SESSION_INVALID';
  END IF;
  IF v_s.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = CASE WHEN v_s.revoke_reason IN ('expired', 'idle') THEN 'PRIVE_SESSION_EXPIRED' ELSE 'PRIVE_SESSION_INVALID' END;
  END IF;
  -- Inactividad: 2 h; 7 días si la persona eligió "mantener mi sesión en este dispositivo".
  IF v_s.expires_at <= now() OR v_s.last_seen_at < now() - public.prive_session_idle_limit(v_s.remember) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_SESSION_EXPIRED';
  END IF;
  SELECT c.version INTO v_ver FROM public.prive_credentials c
   WHERE c.user_id = v_uid AND c.status = 'active' AND NOT c.hard_locked;
  IF v_ver IS NULL OR v_ver <> v_s.credential_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_SESSION_INVALID';
  END IF;
  -- Ligada SIEMPRE a la sesión de Auth donde se desbloqueó (AUD-01): una sesión Privé sin ligar, un
  -- JWT sin session_id o de otro inicio de sesión, o una sesión de Auth que ya no se puede comprobar
  -- (cerrada, vencida, cuenta suspendida o borrada, o auth.sessions ilegible) no autorizan.
  IF v_s.auth_session_id IS NULL OR v_jwt_sid IS NULL OR v_jwt_sid <> v_s.auth_session_id
     OR NOT public.prive_auth_session_alive(v_uid, v_s.auth_session_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_SESSION_INVALID';
  END IF;
  -- Inactividad: se toca como mucho una vez por minuto. En una transacción de solo lectura
  -- (RPC STABLE vía GET) no se puede escribir; no es motivo para negar el acceso.
  IF v_s.last_seen_at < now() - interval '1 minute' THEN
    BEGIN
      UPDATE public.prive_sessions SET last_seen_at = now() WHERE id = v_s.id;
    EXCEPTION WHEN read_only_sql_transaction OR feature_not_supported THEN
      NULL;
    END;
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.prive_require(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_require(text) TO authenticated, service_role;

-- Barrido: igual que 20261024020000 salvo la inactividad según la sesión.
CREATE OR REPLACE FUNCTION public.prive_sweep()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired int; v_idle int; v_stale int; v_not_entitled int := 0; v_inv int; v_att int; v_res int; v_ip int; v_old int;
  v_withdrawn int := 0; v_auth_dead int := 0;
  r record;
BEGIN
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'expired'
   WHERE revoked_at IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'idle'
   WHERE revoked_at IS NULL AND last_seen_at < now() - public.prive_session_idle_limit(remember);
  GET DIAGNOSTICS v_idle = ROW_COUNT;
  UPDATE public.prive_sessions s SET revoked_at = now(), revoke_reason = 'stale_credential'
   WHERE s.revoked_at IS NULL AND NOT EXISTS (
     SELECT 1 FROM public.prive_credentials c
      WHERE c.user_id = s.user_id AND c.version = s.credential_version AND c.status = 'active' AND NOT c.hard_locked);
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  FOR r IN SELECT DISTINCT s.user_id FROM public.prive_sessions s WHERE s.revoked_at IS NULL LOOP
    IF public.prive_access_code(r.user_id) IS NOT NULL THEN
      v_not_entitled := v_not_entitled + public.prive_revoke_sessions(r.user_id, 'not_entitled');
    END IF;
  END LOOP;
  -- Solo si auth.sessions se puede leer: si no, prive_require ya niega todo, y no conviene cerrar en
  -- masa por un problema de permisos que se corrige (las sesiones volverían a servir).
  BEGIN
    IF to_regclass('auth.sessions') IS NOT NULL AND has_table_privilege('auth.sessions', 'SELECT') THEN
      UPDATE public.prive_sessions s SET revoked_at = now(), revoke_reason = 'auth_session_gone'
       WHERE s.revoked_at IS NULL AND NOT public.prive_auth_session_alive(s.user_id, s.auth_session_id);
      GET DIAGNOSTICS v_auth_dead = ROW_COUNT;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_auth_dead := 0;
  END;
  UPDATE public.prive_invitations SET revoked_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_inv = ROW_COUNT;
  FOR r IN SELECT m.user_id FROM public.prive_memberships m WHERE m.status = 'invited' AND m.activated_at IS NULL LOOP
    IF public.prive_withdraw_invitation(r.user_id, 'system', 'not_eligible') THEN v_withdrawn := v_withdrawn + 1; END IF;
  END LOOP;
  DELETE FROM public.prive_auth_attempts WHERE at < now() - interval '30 days';
  GET DIAGNOSTICS v_att = ROW_COUNT;
  DELETE FROM public.prive_password_resets WHERE created_at < now() - interval '2 days';
  GET DIAGNOSTICS v_res = ROW_COUNT;
  DELETE FROM public.prive_ip_blocks WHERE blocked_until < now();
  GET DIAGNOSTICS v_ip = ROW_COUNT;
  DELETE FROM public.prive_sessions WHERE revoked_at < now() - interval '30 days';
  GET DIAGNOSTICS v_old = ROW_COUNT;
  RETURN jsonb_build_object('sessions_expired', v_expired, 'sessions_idle', v_idle, 'sessions_stale', v_stale,
    'sessions_not_entitled', v_not_entitled, 'sessions_auth_gone', v_auth_dead, 'invitations_expired', v_inv,
    'invitations_withdrawn', v_withdrawn, 'attempts_purged', v_att,
    'resets_purged', v_res, 'ip_blocks_purged', v_ip, 'old_sessions_deleted', v_old);
END $$;
REVOKE ALL ON FUNCTION public.prive_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_sweep() TO service_role;
