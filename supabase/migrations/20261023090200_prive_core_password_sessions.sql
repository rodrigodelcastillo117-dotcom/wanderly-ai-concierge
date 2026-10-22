-- IATOS Privé (grupo core) · 3/4: contraseña Privé, desbloqueo, sesiones, restablecimiento,
-- bloqueos por fuerza bruta y barrido. Contrato §0, §2, D5, D7 y D8. Idempotente.
--
-- Seguridad:
--   * La contraseña se guarda solo como bcrypt (pgcrypto crypt + gen_salt('bf', 12)); nunca en claro,
--     nunca en bitácoras. bcrypt usa solo los primeros 72 bytes: por eso se rechaza lo que pase de 72.
--   * Los bloqueos se revisan ANTES de comparar el hash (un atacante bloqueado no gasta bcrypt).
--   * Escalera por fallos consecutivos de la cuenta: 5 → 1 min, 8 → 5 min, 10 → 15 min, 12 → 60 min,
--     15 → bloqueo total (solo lo quita el restablecimiento por correo; se avisa a la persona).
--     Si pasan 24 h sin fallos, el contador vuelve a 0 (salvo el bloqueo total).
--   * Por ip_hash: más de 30 fallos en una hora (entre todas las cuentas) → esa ip_hash 60 min fuera.
--   * El token de sesión Privé se genera aquí (gen_random_bytes), se devuelve UNA vez y se guarda su SHA-256.

-- ===================================================================== utilidades
-- NULL si la contraseña sirve; si no, el código. 12–72 bytes y al menos 5 caracteres distintos.
CREATE OR REPLACE FUNCTION public.prive_password_problem(_pw text, _breach_check text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _breach_check = 'breached' THEN 'PASSWORD_BREACHED'
    WHEN _pw IS NULL OR octet_length(_pw) < 12 OR octet_length(_pw) > 72 THEN 'PASSWORD_WEAK'
    WHEN (SELECT count(DISTINCT ch) FROM regexp_split_to_table(_pw, '') AS ch) < 5 THEN 'PASSWORD_WEAK'
    WHEN _breach_check IS NULL OR _breach_check NOT IN ('ok', 'unavailable', 'generated') THEN 'PASSWORD_WEAK'
  END;
$$;
REVOKE ALL ON FUNCTION public.prive_password_problem(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_hash_password(_pw text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT extensions.crypt(_pw, extensions.gen_salt('bf', 12));
$$;
REVOKE ALL ON FUNCTION public.prive_hash_password(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_password_matches(_pw text, _hash text)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT _pw IS NOT NULL AND _hash IS NOT NULL AND octet_length(_pw) BETWEEN 1 AND 72
     AND extensions.crypt(_pw, _hash) = _hash;
$$;
REVOKE ALL ON FUNCTION public.prive_password_matches(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prive_clean_ip(_ip_hash text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _ip_hash ~ '^[0-9a-f]{16}$' THEN _ip_hash END;
$$;
REVOKE ALL ON FUNCTION public.prive_clean_ip(text) FROM PUBLIC, anon, authenticated;

-- Cierra sesiones Privé vivas. Con _reason = 'user_revoke_all' además avisa a la persona.
CREATE OR REPLACE FUNCTION public.prive_revoke_sessions(_user uuid, _reason text)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = left(coalesce(_reason, 'revoked'), 60)
   WHERE user_id = _user AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF _reason = 'user_revoke_all' THEN
    PERFORM public.notify_once(_user, 'prive', 'Cerraste todas tus sesiones de IATOS Privé',
      'Para volver a entrar a Privé tendrás que escribir tu contraseña Privé en cada dispositivo.',
      NULL, 'prive_revoke_all:' || _user::text || ':' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint);
    PERFORM public.prive_audit(_user, 'sessions_revoked_all', 'user', jsonb_build_object('sessions_closed', v_n));
  END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.prive_revoke_sessions(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_revoke_sessions(uuid, text) TO service_role;

-- Registra un fallo de contraseña de la cuenta (la fila de credenciales ya está bloqueada FOR UPDATE
-- por quien llama) y aplica la escalera de bloqueos y el límite por ip_hash.
CREATE OR REPLACE FUNCTION public.prive_register_failure(_user uuid, _ip_hash text, _kind text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.prive_credentials%ROWTYPE;
  v_ip text := public.prive_clean_ip(_ip_hash);
  v_n int;
  v_lock interval;
  v_hard boolean;
BEGIN
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = _user;
  v_n := CASE WHEN c.last_failed_at < now() - interval '24 hours' THEN 0 ELSE c.failed_count END + 1;
  v_lock := CASE v_n WHEN 5 THEN interval '1 minute' WHEN 8 THEN interval '5 minutes'
                     WHEN 10 THEN interval '15 minutes' WHEN 12 THEN interval '60 minutes' END;
  v_hard := v_n >= 15;
  UPDATE public.prive_credentials
     SET failed_count = v_n, last_failed_at = now(), hard_locked = hard_locked OR v_hard,
         locked_until = CASE WHEN v_lock IS NOT NULL THEN now() + v_lock ELSE locked_until END
   WHERE user_id = _user;
  PERFORM public.prive_record_attempt(_user, v_ip, _kind, false, 'wrong_password');

  IF v_ip IS NOT NULL AND (SELECT count(*) FROM public.prive_auth_attempts a
                            WHERE a.ip_hash = v_ip AND NOT a.success AND a.reason IN ('wrong_password', 'reset_invalid')
                              AND a.at > now() - interval '1 hour') > 30 THEN
    INSERT INTO public.prive_ip_blocks (ip_hash, blocked_until) VALUES (v_ip, now() + interval '60 minutes')
    ON CONFLICT (ip_hash) DO UPDATE SET blocked_until = EXCLUDED.blocked_until;
  END IF;

  IF v_hard THEN
    PERFORM public.prive_revoke_sessions(_user, 'hard_lock');
    PERFORM public.notify_once(_user, 'prive', 'Bloqueamos tu contraseña Privé',
      'Hubo demasiados intentos fallidos. Para volver a entrar, restablece tu contraseña Privé desde el correo de tu cuenta.',
      NULL, 'prive_hardlock:' || _user::text || ':' || c.version::text || ':' || (extract(epoch FROM now()))::bigint);
    PERFORM public.prive_audit(_user, 'hard_locked', 'system', jsonb_build_object('failed_count', v_n, 'kind', _kind));
    RETURN jsonb_build_object('ok', false, 'reason', 'HARD_LOCKED', 'notice', 'hard_lock');
  END IF;
  IF v_lock IS NOT NULL THEN
    PERFORM public.prive_audit(_user, 'locked', 'system', jsonb_build_object('failed_count', v_n, 'minutes', extract(epoch FROM v_lock) / 60));
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED', 'locked_until', now() + v_lock);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_PASSWORD');
END $$;
REVOKE ALL ON FUNCTION public.prive_register_failure(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Revisiones previas a comparar un hash (ip bloqueada, bloqueo total, restablecimiento pendiente,
-- bloqueo temporal). NULL = se puede comparar.
CREATE OR REPLACE FUNCTION public.prive_precheck(_c public.prive_credentials, _ip_hash text, _kind text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ip text := public.prive_clean_ip(_ip_hash);
  v_block timestamptz;
BEGIN
  IF v_ip IS NOT NULL THEN
    SELECT b.blocked_until INTO v_block FROM public.prive_ip_blocks b WHERE b.ip_hash = v_ip AND b.blocked_until > now();
    IF FOUND THEN
      PERFORM public.prive_record_attempt(_c.user_id, v_ip, _kind, false, 'ip_blocked');
      RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED', 'locked_until', v_block);
    END IF;
  END IF;
  IF _c.hard_locked THEN
    PERFORM public.prive_record_attempt(_c.user_id, v_ip, _kind, false, 'hard_locked');
    RETURN jsonb_build_object('ok', false, 'reason', 'HARD_LOCKED');
  END IF;
  IF _c.status = 'must_reset' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MUST_RESET');
  END IF;
  IF _c.locked_until > now() THEN
    PERFORM public.prive_record_attempt(_c.user_id, v_ip, _kind, false, 'locked');
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED', 'locked_until', _c.locked_until);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.prive_precheck(public.prive_credentials, text, text) FROM PUBLIC, anon, authenticated;

-- ===================================================================== contraseña
-- Primera contraseña (después de aceptar la invitación). La revisión en HaveIBeenPwned la hace la
-- función de Edge y llega en _breach_check ('ok' | 'unavailable' | 'generated' | 'breached').
CREATE OR REPLACE FUNCTION public.prive_set_password(_user uuid, _password text, _breach_check text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.prive_access_code(_user);
  c public.prive_credentials%ROWTYPE;
  v_problem text;
  v_ins uuid;
BEGIN
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_code); END IF;
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = _user FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN c.status = 'must_reset' OR c.hard_locked THEN 'MUST_RESET' ELSE 'PASSWORD_ALREADY_SET' END);
  END IF;
  IF (SELECT count(*) FROM public.prive_auth_attempts a WHERE a.user_id = _user AND a.kind = 'set' AND a.at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  v_problem := public.prive_password_problem(_password, _breach_check);
  IF v_problem IS NOT NULL THEN
    PERFORM public.prive_record_attempt(_user, NULL, 'set', false, lower(v_problem));
    RETURN jsonb_build_object('ok', false, 'code', v_problem);
  END IF;
  INSERT INTO public.prive_credentials (user_id, password_hash, breach_check)
  VALUES (_user, public.prive_hash_password(_password), _breach_check)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_ins;
  IF v_ins IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'PASSWORD_ALREADY_SET'); END IF;
  PERFORM public.prive_record_attempt(_user, NULL, 'set', true, NULL);
  PERFORM public.notify_once(_user, 'prive', 'Creaste tu contraseña Privé',
    'Tu contraseña Privé quedó lista. Si no fuiste tú, restablécela desde Privé › Membresía.',
    NULL, 'prive_pw_set:' || _user::text);
  PERFORM public.prive_audit(_user, 'password_set', 'user', jsonb_build_object('breach_check', _breach_check));
  RETURN jsonb_build_object('ok', true, 'notice', 'password_set');
END $$;
REVOKE ALL ON FUNCTION public.prive_set_password(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_set_password(uuid, text, text) TO service_role;

-- Desbloqueo: devuelve {ok, token, expires_at, session_id} o {ok:false, reason, locked_until?}.
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
BEGIN
  v_code := public.prive_access_code(_user);
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', v_code); END IF;
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
  VALUES (_user, public.prive_sha256_hex(v_token), nullif(left(_auth_session_id, 100), ''), c.version,
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

-- Bloquear (cerrar) la sesión Privé de este dispositivo.
CREATE OR REPLACE FUNCTION public.prive_lock_session(_user uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'lock'
   WHERE user_id = _user AND token_hash = lower(_token_hash) AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'closed', v_n > 0);
END $$;
REVOKE ALL ON FUNCTION public.prive_lock_session(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_lock_session(uuid, text) TO service_role;

-- Cambiar la contraseña (pide la anterior; los fallos cuentan para la escalera). Sube la versión:
-- todas las sesiones anteriores dejan de valer.
CREATE OR REPLACE FUNCTION public.prive_change_password(_user uuid, _old text, _new text, _breach_check text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.prive_access_code(_user);
  c public.prive_credentials%ROWTYPE;
  v_pre jsonb;
  v_problem text;
  v_ver int;
BEGIN
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_code); END IF;
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_PASSWORD'); END IF;
  v_pre := public.prive_precheck(c, NULL, 'change');
  IF v_pre IS NOT NULL THEN RETURN v_pre || jsonb_build_object('code', v_pre->>'reason'); END IF;
  IF NOT public.prive_password_matches(_old, c.password_hash) THEN
    v_pre := public.prive_register_failure(_user, NULL, 'change');
    RETURN v_pre || jsonb_build_object('code', v_pre->>'reason');
  END IF;
  v_problem := public.prive_password_problem(_new, _breach_check);
  IF v_problem IS NULL AND _new = _old THEN v_problem := 'PASSWORD_WEAK'; END IF;
  IF v_problem IS NOT NULL THEN
    UPDATE public.prive_credentials SET failed_count = 0, locked_until = NULL WHERE user_id = _user;
    PERFORM public.prive_record_attempt(_user, NULL, 'change', false, lower(v_problem));
    RETURN jsonb_build_object('ok', false, 'code', v_problem);
  END IF;
  UPDATE public.prive_credentials
     SET password_hash = public.prive_hash_password(_new), version = version + 1, changed_at = now(),
         breach_check = _breach_check, failed_count = 0, locked_until = NULL
   WHERE user_id = _user RETURNING version INTO v_ver;
  PERFORM public.prive_revoke_sessions(_user, 'password_changed');
  PERFORM public.prive_record_attempt(_user, NULL, 'change', true, NULL);
  PERFORM public.notify_once(_user, 'prive', 'Cambiaste tu contraseña Privé',
    'Tu contraseña Privé cambió y cerramos las demás sesiones. Si no fuiste tú, restablécela de inmediato.',
    NULL, 'prive_pw_changed:' || _user::text || ':' || v_ver::text);
  PERFORM public.prive_audit(_user, 'password_changed', 'user', jsonb_build_object('version', v_ver, 'breach_check', _breach_check));
  RETURN jsonb_build_object('ok', true, 'notice', 'password_changed');
END $$;
REVOKE ALL ON FUNCTION public.prive_change_password(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_change_password(uuid, text, text, text) TO service_role;

-- Pedir un restablecimiento: devuelve el token (para el enlace del correo) UNA vez. Invalida los
-- anteriores. Máximo 3 por hora. Errores (P0001): NO_PASSWORD, RATE_LIMITED.
CREATE OR REPLACE FUNCTION public.prive_request_reset(_user uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.prive_credentials WHERE user_id = _user) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_PASSWORD';
  END IF;
  IF (SELECT count(*) FROM public.prive_password_resets r WHERE r.user_id = _user AND r.created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
  END IF;
  UPDATE public.prive_password_resets SET expires_at = least(expires_at, now())
   WHERE user_id = _user AND used_at IS NULL AND expires_at > now();
  v_token := public.prive_random_token();
  INSERT INTO public.prive_password_resets (user_id, token_hash) VALUES (_user, public.prive_sha256_hex(v_token));
  PERFORM public.prive_audit(_user, 'reset_requested', 'user', '{}'::jsonb);
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.prive_request_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_request_reset(uuid) TO service_role;

-- Completar el restablecimiento: token de un solo uso, 30 minutos, de ESTA cuenta. Limpia el bloqueo
-- total y el "debe restablecer", sube la versión y cierra todas las sesiones.
CREATE OR REPLACE FUNCTION public.prive_complete_reset(_user uuid, _token text, _new text, _breach_check text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.prive_password_resets%ROWTYPE;
  v_problem text;
  v_ver int;
BEGIN
  IF (SELECT count(*) FROM public.prive_auth_attempts a
       WHERE a.user_id = _user AND a.kind = 'reset' AND NOT a.success AND a.reason = 'reset_invalid'
         AND a.at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  -- La contraseña nueva se valida antes de gastar el token.
  v_problem := public.prive_password_problem(_new, _breach_check);
  IF v_problem IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_problem); END IF;
  SELECT * INTO r FROM public.prive_password_resets
   WHERE token_hash = public.prive_sha256_hex(coalesce(_token, '')) FOR UPDATE;
  IF NOT FOUND OR r.user_id <> _user OR r.used_at IS NOT NULL OR r.expires_at <= now() THEN
    PERFORM public.prive_record_attempt(_user, NULL, 'reset', false, 'reset_invalid');
    RETURN jsonb_build_object('ok', false, 'code', 'RESET_INVALID');
  END IF;
  UPDATE public.prive_password_resets SET used_at = now() WHERE id = r.id;
  UPDATE public.prive_password_resets SET expires_at = least(expires_at, now())
   WHERE user_id = _user AND used_at IS NULL AND id <> r.id;
  INSERT INTO public.prive_credentials (user_id, password_hash, breach_check)
  VALUES (_user, public.prive_hash_password(_new), _breach_check)
  ON CONFLICT (user_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, version = prive_credentials.version + 1, status = 'active',
        hard_locked = false, failed_count = 0, locked_until = NULL, changed_at = now(), breach_check = EXCLUDED.breach_check
  RETURNING version INTO v_ver;
  PERFORM public.prive_revoke_sessions(_user, 'password_reset');
  PERFORM public.prive_record_attempt(_user, NULL, 'reset', true, NULL);
  PERFORM public.notify_once(_user, 'prive', 'Restableciste tu contraseña Privé',
    'Tu nueva contraseña Privé quedó lista y cerramos todas las sesiones anteriores.',
    NULL, 'prive_pw_reset:' || r.id::text);
  PERFORM public.prive_audit(_user, 'password_reset', 'user', jsonb_build_object('version', v_ver));
  RETURN jsonb_build_object('ok', true, 'notice', 'password_reset');
END $$;
REVOKE ALL ON FUNCTION public.prive_complete_reset(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_complete_reset(uuid, text, text, text) TO service_role;

-- "Creo que alguien conoce mi contraseña": exige restablecer por correo y cierra todo.
CREATE OR REPLACE FUNCTION public.prive_report_compromised(_user uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ver int;
  v_n int;
BEGIN
  UPDATE public.prive_credentials SET status = 'must_reset', version = version + 1, changed_at = now()
   WHERE user_id = _user RETURNING version INTO v_ver;
  IF v_ver IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_PASSWORD'); END IF;
  v_n := public.prive_revoke_sessions(_user, 'compromised');
  PERFORM public.notify_once(_user, 'prive', 'Protegimos tu IATOS Privé',
    'Cerramos todas las sesiones Privé. Para volver a entrar, restablece tu contraseña Privé con el enlace que te enviamos por correo.',
    NULL, 'prive_compromised:' || _user::text || ':' || v_ver::text);
  PERFORM public.prive_audit(_user, 'reported_compromised', 'user', jsonb_build_object('sessions_closed', v_n));
  RETURN jsonb_build_object('ok', true, 'notice', 'compromised', 'sessions_closed', v_n);
END $$;
REVOKE ALL ON FUNCTION public.prive_report_compromised(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_report_compromised(uuid) TO service_role;

-- Progreso de la bienvenida y el onboarding. Solo claves conocidas (version, step, completed_at,
-- skipped_at) y valores cortos: nada de texto libre.
CREATE OR REPLACE FUNCTION public.prive_save_progress(_user uuid, _welcome_version int, _onboarding jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.prive_access_code(_user);
  v_clean jsonb := '{}'::jsonb;
  v_ts text;
  m public.prive_memberships%ROWTYPE;
BEGIN
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_code); END IF;
  IF _welcome_version IS NOT NULL AND (_welcome_version < 0 OR _welcome_version > 1000) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;
  IF _onboarding IS NOT NULL THEN
    IF jsonb_typeof(_onboarding) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
    IF _onboarding ? 'version' THEN
      IF jsonb_typeof(_onboarding->'version') <> 'number' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
      v_clean := v_clean || jsonb_build_object('version', least(greatest((_onboarding->>'version')::numeric::int, 0), 1000));
    END IF;
    IF _onboarding ? 'step' THEN
      IF jsonb_typeof(_onboarding->'step') NOT IN ('number', 'string') OR length(_onboarding->>'step') > 40
         OR (_onboarding->>'step') !~ '^[A-Za-z0-9_.-]+$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
      END IF;
      v_clean := v_clean || jsonb_build_object('step', _onboarding->'step');
    END IF;
    FOREACH v_ts IN ARRAY ARRAY['completed_at', 'skipped_at'] LOOP
      IF _onboarding ? v_ts THEN
        IF jsonb_typeof(_onboarding->v_ts) = 'null' THEN
          v_clean := v_clean || jsonb_build_object(v_ts, NULL);
        ELSE
          BEGIN
            v_clean := v_clean || jsonb_build_object(v_ts,
              to_char((_onboarding->>v_ts)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
          EXCEPTION WHEN others THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
          END;
        END IF;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.prive_memberships
     SET welcome_version_seen = greatest(welcome_version_seen, coalesce(_welcome_version, 0)),
         onboarding = onboarding || v_clean, updated_at = now()
   WHERE user_id = _user RETURNING * INTO m;
  RETURN jsonb_build_object('ok', true, 'welcome_version_seen', m.welcome_version_seen, 'onboarding', m.onboarding);
END $$;
REVOKE ALL ON FUNCTION public.prive_save_progress(uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_save_progress(uuid, int, jsonb) TO service_role;

-- ===================================================================== barrido (cron)
-- Cierra sesiones vencidas, inactivas, de una versión vieja de la contraseña o de cuentas que ya no
-- tienen derecho (PRO terminó, reembolso, concesión vencida, revocación); revoca invitaciones
-- caducadas y purga intentos (30 días), restablecimientos viejos y bloqueos de IP vencidos.
CREATE OR REPLACE FUNCTION public.prive_sweep()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired int; v_idle int; v_stale int; v_not_entitled int := 0; v_inv int; v_att int; v_res int; v_ip int; v_old int;
  r record;
BEGIN
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'expired'
   WHERE revoked_at IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  UPDATE public.prive_sessions SET revoked_at = now(), revoke_reason = 'idle'
   WHERE revoked_at IS NULL AND last_seen_at < now() - interval '2 hours';
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
  UPDATE public.prive_invitations SET revoked_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now();
  GET DIAGNOSTICS v_inv = ROW_COUNT;
  DELETE FROM public.prive_auth_attempts WHERE at < now() - interval '30 days';
  GET DIAGNOSTICS v_att = ROW_COUNT;
  DELETE FROM public.prive_password_resets WHERE created_at < now() - interval '2 days';
  GET DIAGNOSTICS v_res = ROW_COUNT;
  DELETE FROM public.prive_ip_blocks WHERE blocked_until < now();
  GET DIAGNOSTICS v_ip = ROW_COUNT;
  DELETE FROM public.prive_sessions WHERE revoked_at < now() - interval '30 days';
  GET DIAGNOSTICS v_old = ROW_COUNT;
  RETURN jsonb_build_object('sessions_expired', v_expired, 'sessions_idle', v_idle, 'sessions_stale', v_stale,
    'sessions_not_entitled', v_not_entitled, 'invitations_expired', v_inv, 'attempts_purged', v_att,
    'resets_purged', v_res, 'ip_blocks_purged', v_ip, 'old_sessions_deleted', v_old);
END $$;
REVOKE ALL ON FUNCTION public.prive_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_sweep() TO service_role;
