-- IATOS Privé · contraseña de 8 caracteres y sesión que dura "siempre" (pedido explícito del dueño).
-- Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción. Aplicar ANTES de desplegar
-- prive-access (la función nueva pide recordar TODA sesión; con la función vieja esta migración también
-- funciona: solo cambian los plazos).
--
-- Redefine SOLO lo necesario, partiendo de la versión vigente más reciente de cada función:
--   * prive_password_problem (20261023090200): mínimo 8 bytes (antes 12); máximo 72 (bcrypt), al menos
--     5 caracteres distintos y la revisión HIBP siguen igual.
--   * prive_session_idle_limit (20261024030000): la sesión recordada se cierra a los 365 días SIN USO
--     (antes 7 días); la no recordada sigue en 2 h.
--   * prive_remember_session (20261024030000): vence a los 365 días (antes 30 desde que se abrió) y el
--     aviso en la app sale UNA vez por persona (antes uno en cada inicio de sesión, que ahora es lo normal).
--   * prive_require (20261024030000): vigencia deslizante; cada uso de una sesión recordada corre su
--     vencimiento a 365 días desde ese uso. TODO lo demás sigue igual en cada llamada: PRO vigente,
--     90 días o concesión, membresía activa, revocación, versión de la contraseña (cambiarla,
--     restablecerla, reportarla comprometida o el bloqueo total la cierran) y la sesión de Auth donde se
--     abrió (cerrar sesión en IATOS la invalida al instante — AUD-01).
-- prive_sweep (20261026260000) no se toca: ya usa prive_session_idle_limit(remember) y expires_at.

-- ===================================================================== contraseña: 8–72 bytes
-- NULL si la contraseña sirve; si no, el código. 8–72 bytes y al menos 5 caracteres distintos.
CREATE OR REPLACE FUNCTION public.prive_password_problem(_pw text, _breach_check text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _breach_check = 'breached' THEN 'PASSWORD_BREACHED'
    WHEN _pw IS NULL OR octet_length(_pw) < 8 OR octet_length(_pw) > 72 THEN 'PASSWORD_WEAK'
    WHEN (SELECT count(DISTINCT ch) FROM regexp_split_to_table(_pw, '') AS ch) < 5 THEN 'PASSWORD_WEAK'
    WHEN _breach_check IS NULL OR _breach_check NOT IN ('ok', 'unavailable', 'generated') THEN 'PASSWORD_WEAK'
  END;
$$;
REVOKE ALL ON FUNCTION public.prive_password_problem(text, text) FROM PUBLIC, anon, authenticated;

-- ===================================================================== sesión recordada: 365 días sin uso
CREATE OR REPLACE FUNCTION public.prive_session_idle_limit(_remember boolean)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN coalesce(_remember, false) THEN interval '365 days' ELSE interval '2 hours' END;
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
  UPDATE public.prive_sessions SET remember = true, expires_at = now() + public.prive_session_idle_limit(true)
   WHERE id = s.id RETURNING * INTO s;
  -- Una sola vez por persona (no en cada inicio de sesión): recordar es ahora lo normal.
  PERFORM public.notify_once(_user, 'prive', 'Privé queda abierto en tus dispositivos',
    'Ya no te pediremos tu contraseña Privé cada vez. Tu sesión se cierra si cierras sesión en IATOS, si cambias tu contraseña Privé o desde Privé › Membresía › Cerrar todas mis sesiones.',
    NULL, 'prive_remember:' || _user::text);
  PERFORM public.prive_audit(_user, 'session_remembered', 'user', jsonb_build_object('session_id', s.id, 'expires_at', s.expires_at));
  RETURN jsonb_build_object('ok', true, 'expires_at', s.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.prive_remember_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_remember_session(uuid, uuid) TO service_role;

-- prive_require: igual que 20261024030000 salvo la vigencia deslizante de la sesión recordada.
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
  -- Inactividad: 2 h; 365 días si la sesión es recordada (lo normal desde 20261027130000).
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
  -- Inactividad: se toca como mucho una vez por minuto. La sesión recordada corre además su vencimiento
  -- a 365 días desde este uso (vigencia deslizante; nunca lo acorta). En una transacción de solo
  -- lectura (RPC STABLE vía GET) no se puede escribir; no es motivo para negar el acceso.
  IF v_s.last_seen_at < now() - interval '1 minute' THEN
    BEGIN
      UPDATE public.prive_sessions SET last_seen_at = now(),
             expires_at = CASE WHEN remember THEN greatest(expires_at, now() + public.prive_session_idle_limit(true)) ELSE expires_at END
       WHERE id = v_s.id;
    EXCEPTION WHEN read_only_sql_transaction OR feature_not_supported THEN
      NULL;
    END;
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.prive_require(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_require(text) TO authenticated, service_role;

-- ===================================================================== sesiones ya abiertas
-- Las que hoy siguen sirviendo (no revocadas, sin vencer, sin pasar su límite de inactividad y con su
-- sesión de Auth viva) pasan a recordadas con la nueva vigencia: 365 días desde su último uso. Nada
-- revocado, vencido o inactivo revive. Volver a aplicar no cambia nada (mismo resultado).
UPDATE public.prive_sessions s
   SET remember = true,
       expires_at = greatest(s.expires_at, s.last_seen_at + public.prive_session_idle_limit(true))
 WHERE s.revoked_at IS NULL
   AND s.expires_at > now()
   AND s.last_seen_at >= now() - public.prive_session_idle_limit(s.remember)
   AND (NOT s.remember OR s.expires_at < s.last_seen_at + public.prive_session_idle_limit(true))
   AND public.prive_auth_session_alive(s.user_id, s.auth_session_id);
