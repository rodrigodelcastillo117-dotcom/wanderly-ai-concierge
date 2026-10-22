-- Cierre de auditoría · grupo prive. Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.
--
-- AUD-01 (P1) · prive_auth_session_alive aceptaba la sesión cuando no podía verificarla: si
--   auth.sessions no existía, si la lectura fallaba (sin privilegios, columna cambiada) o si la sesión
--   Privé no estaba ligada a una sesión de Auth (auth_session_id NULL: prive_require se saltaba la
--   revisión). Tampoco miraba si la cuenta estaba suspendida (banned_until) o borrada (deleted_at).
--   Ahora falla cerrado: sin una sesión de Auth comprobada (fila en auth.sessions con el session_id del
--   JWT, de esta cuenta, sin vencer, y cuenta no suspendida ni borrada) no hay acceso Privé, ni se
--   emite una sesión Privé nueva. Las sesiones legítimas no cambian: Supabase pone session_id en cada
--   JWT de usuario y su fila vive en auth.sessions hasta cerrar sesión o vencer.
--   El barrido que cierra las sesiones Privé cuya sesión de Auth ya no existe está en 20261024020000.
--
-- Prueba: supabase/tests/prive/aud_session.sql (corre con supabase/tests/prive/run.sh).

-- ===================================================================== AUD-01
CREATE OR REPLACE FUNCTION public.prive_auth_session_alive(_user uuid, _sid text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v boolean;
BEGIN
  IF _user IS NULL OR _sid IS NULL
     OR _sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  BEGIN
    -- Dinámico: si GoTrue cambia el esquema, el error cae aquí (y se niega), no al compilar.
    EXECUTE 'SELECT EXISTS (
               SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
                WHERE s.id = $1::uuid AND s.user_id = $2
                  AND (s.not_after IS NULL OR s.not_after > now())
                  AND u.deleted_at IS NULL
                  AND (u.banned_until IS NULL OR u.banned_until <= now()))'
      INTO v USING _sid, _user;
  EXCEPTION WHEN OTHERS THEN
    -- Sin poder comprobar la sesión de Auth no hay acceso sensible (fail closed). Solo el SQLSTATE:
    -- nunca ids ni tokens en el registro.
    RAISE WARNING 'prive_auth_session_alive: no se pudo verificar la sesión de Auth (SQLSTATE %); se niega', SQLSTATE;
    RETURN false;
  END;
  RETURN coalesce(v, false);
END $$;
REVOKE ALL ON FUNCTION public.prive_auth_session_alive(uuid, text) FROM PUBLIC, anon, authenticated;

-- TODA RPC de contenido Privé empieza con: v_uid := public.prive_require(_ps).
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
  IF v_s.expires_at <= now() OR v_s.last_seen_at < now() - interval '2 hours' THEN
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

-- Desbloqueo: devuelve {ok, token, expires_at, session_id} o {ok:false, reason, locked_until?}.
-- AUD-01: sin una sesión de Auth comprobada no se emite sesión Privé (reason AUTH_SESSION_INVALID; la
-- función de Edge lo traduce a 401 "vuelve a iniciar sesión"). Se revisa antes de comparar la
-- contraseña: no gasta bcrypt ni cuenta como fallo.
CREATE OR REPLACE FUNCTION public.prive_unlock(_user uuid, _password text, _ip_hash text, _auth_session_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  c public.prive_credentials%ROWTYPE;
  v_pre jsonb;
  v_prev int;
  v_token text;
  v_sid uuid;
  v_exp timestamptz;
  v_notice text;
  v_auth_sid text := nullif(left(_auth_session_id, 100), '');
BEGIN
  v_code := public.prive_access_code(_user);
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', v_code); END IF;
  IF NOT public.prive_auth_session_alive(_user, v_auth_sid) THEN
    PERFORM public.prive_record_attempt(_user, _ip_hash, 'unlock', false, 'auth_session_invalid');
    RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_SESSION_INVALID');
  END IF;
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_PASSWORD'); END IF;
  v_pre := public.prive_precheck(c, _ip_hash, 'unlock');
  IF v_pre IS NOT NULL THEN RETURN v_pre; END IF;

  IF NOT public.prive_password_matches(_password, c.password_hash) THEN
    RETURN public.prive_register_failure(_user, _ip_hash, 'unlock');
  END IF;

  v_prev := CASE WHEN c.last_failed_at < now() - interval '24 hours' THEN 0 ELSE c.failed_count END;
  UPDATE public.prive_credentials SET failed_count = 0, locked_until = NULL WHERE user_id = _user;
  v_token := public.prive_random_token();
  INSERT INTO public.prive_sessions (user_id, token_hash, auth_session_id, credential_version, created_at, expires_at, last_seen_at)
  VALUES (_user, public.prive_sha256_hex(v_token), v_auth_sid, c.version,
          clock_timestamp(), now() + interval '12 hours', now())
  RETURNING id, expires_at INTO v_sid, v_exp;
  -- Máximo 5 sesiones vivas: se cierran las más viejas.
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'session_limit'
   WHERE id IN (SELECT s.id FROM public.prive_sessions s
                 WHERE s.user_id = _user AND s.revoked_at IS NULL AND s.expires_at > now()
                 ORDER BY s.created_at DESC, s.id OFFSET 5);
  PERFORM public.prive_record_attempt(_user, _ip_hash, 'unlock', true, NULL);
  IF v_prev >= 5 THEN
    v_notice := 'new_access';
    PERFORM public.notify_once(_user, 'prive', 'Nuevo acceso a IATOS Privé',
      'Se abrió tu Privé después de varios intentos fallidos. Si no fuiste tú, cambia tu contraseña Privé y cierra todas las sesiones.',
      NULL, 'prive_new_access:' || v_sid::text);
  END IF;
  PERFORM public.prive_audit(_user, 'unlocked', 'user', jsonb_build_object('session_id', v_sid, 'after_failures', v_prev));
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp, 'session_id', v_sid, 'notice', v_notice);
END $$;
REVOKE ALL ON FUNCTION public.prive_unlock(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_unlock(uuid, text, text, text) TO service_role;

-- Las sesiones Privé que ya existan sin ligar (emitidas con un JWT sin session_id) no vuelven a servir:
-- se cierran ya, en lugar de esperar a que venzan (12 h).
UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'unbound_auth_session'
 WHERE revoked_at IS NULL AND auth_session_id IS NULL;

-- ===================================================================== comprobación al aplicar
-- En Supabase el dueño de las funciones (quien aplica la migración, normalmente postgres) debe poder
-- leer auth.sessions y auth.users. Si no puede, Privé quedará cerrado para todos (fail closed): se
-- avisa aquí para no descubrirlo en producción. En la base de pruebas local auth.sessions es un stub.
DO $$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE WARNING 'AUD-01: auth.sessions no existe en esta base: prive_require negará toda sesión Privé';
  ELSIF NOT has_table_privilege(current_user, 'auth.sessions', 'SELECT')
        OR NOT has_column_privilege(current_user, 'auth.users', 'banned_until', 'SELECT')
        OR NOT has_column_privilege(current_user, 'auth.users', 'deleted_at', 'SELECT') THEN
    RAISE WARNING 'AUD-01: % no puede leer auth.sessions / auth.users(banned_until, deleted_at): prive_require negará toda sesión Privé', current_user;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AUD-01: no se pudo comprobar el acceso a auth.sessions (SQLSTATE %)', SQLSTATE;
END $$;
