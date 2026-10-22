-- Segunda auditoría · grupo cuentas · P3-4 (Privé, P3). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción.
--
-- Problema: prive_sweep solo revisaba has_table_privilege('auth.sessions'). Si la tabla se lee pero
-- falla una columna (cambio de esquema de GoTrue, o sin privilegio de columna sobre deleted_at,
-- banned_until o not_after), prive_auth_session_alive captura el error y responde false para TODAS
-- las sesiones, y el barrido las cerraba en masa ("auth_session_gone": 3/3 en aud2_sweep.sql).
--
-- Corrección:
--   * La consulta de la sesión de Auth vive en una sola función, prive_auth_session_lookup, que NO
--     captura errores. prive_auth_session_alive la llama y, ante un error, niega (fail closed, igual
--     que antes: ningún acceso Privé sin sesión de Auth comprobada).
--   * prive_auth_sessions_checkable() ejecuta esa misma consulta completa una vez (con un id que no
--     existe): si falla, el barrido NO cierra sesiones por "auth_session_gone" (las demás limpiezas
--     siguen) y devuelve auth_check='skipped_auth_unreadable'. prive_require sigue negando el acceso.
--
-- Prueba: supabase/tests/prive/aud2_sweep.sql (del auditor, convertido en OK/FALLA).

-- Consulta de la sesión de Auth (sin capturar errores). Misma regla que 20261024010000.
CREATE OR REPLACE FUNCTION public.prive_auth_session_lookup(_user uuid, _sid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v boolean;
BEGIN
  -- Dinámico: si GoTrue cambia el esquema, el error sale al ejecutar (no al compilar).
  EXECUTE 'SELECT EXISTS (
             SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
              WHERE s.id = $1 AND s.user_id = $2
                AND (s.not_after IS NULL OR s.not_after > now())
                AND u.deleted_at IS NULL
                AND (u.banned_until IS NULL OR u.banned_until <= now()))'
    INTO v USING _sid, _user;
  RETURN coalesce(v, false);
END $$;
REVOKE ALL ON FUNCTION public.prive_auth_session_lookup(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_auth_session_alive(_user uuid, _sid text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _sid IS NULL
     OR _sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  BEGIN
    RETURN public.prive_auth_session_lookup(_user, _sid::uuid);
  EXCEPTION WHEN OTHERS THEN
    -- Sin poder comprobar la sesión de Auth no hay acceso sensible (fail closed). Solo el SQLSTATE.
    RAISE WARNING 'prive_auth_session_alive: no se pudo verificar la sesión de Auth (SQLSTATE %); se niega', SQLSTATE;
    RETURN false;
  END;
END $$;
REVOKE ALL ON FUNCTION public.prive_auth_session_alive(uuid, text) FROM PUBLIC, anon, authenticated;

-- ¿La consulta completa de la sesión de Auth se puede ejecutar ahora? (tabla, columnas, permisos)
CREATE OR REPLACE FUNCTION public.prive_auth_sessions_checkable()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.prive_auth_session_lookup('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'prive_sweep: la consulta de sesiones de Auth falla (SQLSTATE %); no se cierran sesiones por auth_session_gone', SQLSTATE;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.prive_auth_sessions_checkable() FROM PUBLIC, anon, authenticated;

-- Barrido: igual que 20261024030000 salvo la prueba previa de la consulta de Auth (P3-4).
CREATE OR REPLACE FUNCTION public.prive_sweep()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired int; v_idle int; v_stale int; v_not_entitled int := 0; v_inv int; v_att int; v_res int; v_ip int; v_old int;
  v_withdrawn int := 0; v_auth_dead int := 0; v_auth_check text := 'ok';
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
  -- Solo si la consulta COMPLETA de la sesión de Auth funciona (tabla, columnas y permisos): si no,
  -- prive_require ya niega todo (falla cerrado para la consulta), y no conviene cerrar en masa por un
  -- problema de esquema o de permisos que se corrige (las sesiones volverían a servir).
  -- P3-4 (segunda auditoría): antes solo se revisaba el permiso de la tabla; con una columna faltante
  -- (deleted_at, banned_until, not_after) prive_auth_session_alive daba false para todas y el barrido
  -- cerraba TODAS las sesiones como auth_session_gone. Ahora se prueba la consulta real primero.
  IF public.prive_auth_sessions_checkable() THEN
    BEGIN
      UPDATE public.prive_sessions s SET revoked_at = now(), revoke_reason = 'auth_session_gone'
       WHERE s.revoked_at IS NULL AND NOT public.prive_auth_session_alive(s.user_id, s.auth_session_id);
      GET DIAGNOSTICS v_auth_dead = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN
      v_auth_dead := 0;
    END;
  ELSE
    v_auth_check := 'skipped_auth_unreadable';
  END IF;
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
    'sessions_not_entitled', v_not_entitled, 'sessions_auth_gone', v_auth_dead, 'auth_check', v_auth_check,
    'invitations_expired', v_inv,
    'invitations_withdrawn', v_withdrawn, 'attempts_purged', v_att,
    'resets_purged', v_res, 'ip_blocks_purged', v_ip, 'old_sessions_deleted', v_old);
END $$;
REVOKE ALL ON FUNCTION public.prive_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_sweep() TO service_role;
