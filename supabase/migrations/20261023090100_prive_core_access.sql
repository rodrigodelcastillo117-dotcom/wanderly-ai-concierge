-- IATOS Privé (grupo core) · 2/4: antigüedad, concesiones, derecho de acceso, estado, invitaciones
-- y operaciones de administrador. Contrato §0 y §2. Idempotente.
--
-- Regla del dueño (§0), verificada en el SERVIDOR en cada operación sensible:
--   sesión de IATOS + PRO vigente (is_pro) + ≥ 90 días PAGADOS (o concesión de admin vigente)
--   + membresía activada + sesión Privé (contraseña individual) ligada a la cuenta y a la sesión de Auth.
-- Todas las funciones son SECURITY DEFINER con search_path fijo. Solo prive_require y prive_status
-- se otorgan a authenticated; el resto es de service_role (funciones de Edge) o interno.

-- ===================================================================== utilidades internas
CREATE OR REPLACE FUNCTION public.prive_sha256_hex(_t text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path = public AS $$
  SELECT encode(extensions.digest(convert_to(_t, 'UTF8'), 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION public.prive_sha256_hex(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_sha256_hex(text) TO service_role;

-- 32 bytes aleatorios en base64url sin relleno (43 caracteres).
CREATE OR REPLACE FUNCTION public.prive_random_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;
REVOKE ALL ON FUNCTION public.prive_random_token() FROM PUBLIC, anon, authenticated;

-- Código público de la tarjeta: IP-XXXX-XXXX con 32 símbolos sin I, O, 0 ni 1 (256 es múltiplo de
-- 32, así que byte % 32 no tiene sesgo). Reintenta si choca con uno existente.
CREATE OR REPLACE FUNCTION public.prive_new_member_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i int;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(8);
    v_code := 'IP-';
    FOR i IN 0..7 LOOP
      IF i = 4 THEN v_code := v_code || '-'; END IF;
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.prive_memberships WHERE member_code = v_code);
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.prive_new_member_code() FROM PUBLIC, anon, authenticated;

-- Bitácora (auditoría). Nunca recibe secretos: quien llama pasa solo ids, motivos y conteos.
CREATE OR REPLACE FUNCTION public.prive_audit(_user uuid, _event text, _actor text, _details jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.prive_membership_events (user_id, event, actor, details)
  VALUES (_user, _event, coalesce(_actor, 'system'), coalesce(_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.prive_audit(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Métricas (contrato §1): inserta en prive_events con las columnas de §7. Si el evento no está en la
-- lista permitida por la CHECK (la define el grupo catalog), no falla: devuelve false. Así un evento
-- de ciclo de vida nunca rompe un flujo de acceso; la bitácora de membresía queda siempre.
CREATE OR REPLACE FUNCTION public.prive_log_event(_user uuid, _event text, _props jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p jsonb := coalesce(_props, '{}'::jsonb);
  uuid_or_null text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, trip_id, surface, plan)
  VALUES (
    _user, _event,
    CASE WHEN p->>'experience_id' ~ uuid_or_null THEN (p->>'experience_id')::uuid END,
    CASE WHEN p->>'destination_id' ~ uuid_or_null THEN (p->>'destination_id')::uuid END,
    CASE WHEN p->>'trip_id' ~ uuid_or_null THEN (p->>'trip_id')::uuid END,
    nullif(p->>'surface', ''),
    nullif(p->>'plan', '')
  );
  RETURN true;
EXCEPTION WHEN check_violation OR foreign_key_violation OR not_null_violation THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.prive_log_event(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_log_event(uuid, text, jsonb) TO service_role;

-- Primer nombre para el saludo (perfil o metadatos de Auth). Se escapa al ponerlo en HTML.
CREATE OR REPLACE FUNCTION public.prive_first_name(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(left(split_part(btrim(coalesce(
           (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = _user),
           (SELECT nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '')
              FROM auth.users u WHERE u.id = _user),
           '')), ' ', 1), 40), '');
$$;
REVOKE ALL ON FUNCTION public.prive_first_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_first_name(uuid) TO service_role;

-- ===================================================================== antigüedad y derecho
-- Días PAGADOS acumulados (D2): unión de periodos pagados (sin contar dos veces lo encimado),
-- recortados a "ahora" (solo días ya transcurridos), sin reembolsados ni en disputa.
CREATE OR REPLACE FUNCTION public.prive_tenure_days(_user uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(floor(extract(epoch FROM (
           SELECT sum(upper(r) - lower(r))
             FROM unnest((SELECT range_agg(p.period * tstzrange(NULL, now(), '[)'))
                            FROM public.pro_paid_periods p
                           WHERE p.user_id = _user AND p.status IN ('paid', 'partially_refunded'))) AS r
         )) / 86400)::int, 0);
$$;
REVOKE ALL ON FUNCTION public.prive_tenure_days(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_tenure_days(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prive_has_grant(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.prive_grants g
     WHERE g.user_id = _user AND g.revoked_at IS NULL
       AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
  );
$$;
REVOKE ALL ON FUNCTION public.prive_has_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_has_grant(uuid) TO service_role;

-- Elegible = ≥ 90 días pagados o concesión vigente (no incluye PRO ni membresía).
CREATE OR REPLACE FUNCTION public.prive_is_eligible(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.prive_has_grant(_user) OR public.prive_tenure_days(_user) >= 90;
$$;
REVOKE ALL ON FUNCTION public.prive_is_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_is_eligible(uuid) TO service_role;

-- Motivo por el que la cuenta NO tiene derecho hoy (NULL = sí lo tiene). Orden fijo: PRO, revocada,
-- elegibilidad, activación. Lo usan prive_require, prive_entitled, prive_unlock y el barrido.
CREATE OR REPLACE FUNCTION public.prive_access_code(_user uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF _user IS NULL THEN RETURN 'PRIVE_NO_SESSION'; END IF;
  IF NOT public.is_pro(_user) THEN RETURN 'PRIVE_NOT_PRO'; END IF;
  SELECT m.status INTO v_status FROM public.prive_memberships m WHERE m.user_id = _user;
  IF v_status = 'revoked' THEN RETURN 'PRIVE_REVOKED'; END IF;
  IF NOT public.prive_is_eligible(_user) THEN RETURN 'PRIVE_NOT_ELIGIBLE'; END IF;
  IF v_status IS DISTINCT FROM 'active' THEN RETURN 'PRIVE_NOT_ACTIVATED'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.prive_access_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_access_code(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prive_entitled(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.prive_access_code(_user) IS NULL;
$$;
REVOKE ALL ON FUNCTION public.prive_entitled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_entitled(uuid) TO service_role;

-- ¿Sigue viva la sesión de Auth? (cerrar sesión en IATOS borra su fila de auth.sessions). Solo existe
-- en Supabase; si la tabla no existe o no se puede leer, decide la coincidencia del claim session_id.
CREATE OR REPLACE FUNCTION public.prive_auth_session_alive(_user uuid, _sid text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v boolean;
BEGIN
  IF _sid IS NULL OR to_regclass('auth.sessions') IS NULL THEN RETURN true; END IF;
  BEGIN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id::text = $1 AND s.user_id = $2
               AND (s.not_after IS NULL OR s.not_after > now()))' INTO v USING _sid, _user;
  EXCEPTION WHEN insufficient_privilege OR undefined_column OR invalid_text_representation THEN
    RETURN true;
  END;
  RETURN coalesce(v, false);
END $$;
REVOKE ALL ON FUNCTION public.prive_auth_session_alive(uuid, text) FROM PUBLIC, anon, authenticated;

-- ===================================================================== prive_require (authenticated)
-- TODA RPC de contenido Privé empieza con: v_uid := public.prive_require(_ps);
-- Errores: SQLSTATE P0001 y MESSAGE exactamente uno de los códigos PRIVE_* del contrato.
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
  -- Ligada a la sesión de Auth donde se desbloqueó: otro dispositivo u otro inicio de sesión
  -- (session_id distinto) debe desbloquear de nuevo.
  IF v_s.auth_session_id IS NOT NULL THEN
    IF v_jwt_sid IS NULL OR v_jwt_sid <> v_s.auth_session_id
       OR NOT public.prive_auth_session_alive(v_uid, v_s.auth_session_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_SESSION_INVALID';
    END IF;
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

-- ===================================================================== prive_status (authenticated)
-- Solo datos propios y nunca secretos (ni hashes, ni tokens, ni correos). Una cuenta gratis recibe
-- is_pro=false y antigüedad 0.
CREATE OR REPLACE FUNCTION public.prive_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pro boolean;
  v_tenure int := 0;
  v_grant boolean := false;
  m public.prive_memberships%ROWTYPE;
  c public.prive_credentials%ROWTYPE;
  v_has_m boolean;
  v_eligible boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRIVE_NO_SESSION';
  END IF;
  v_pro := public.is_pro(v_uid);
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = v_uid;
  v_has_m := FOUND;
  SELECT * INTO c FROM public.prive_credentials WHERE user_id = v_uid;
  IF v_pro THEN
    v_tenure := public.prive_tenure_days(v_uid);
    v_grant := public.prive_has_grant(v_uid);
    v_eligible := (v_tenure >= 90 OR v_grant) AND (NOT v_has_m OR m.status <> 'revoked');
  END IF;
  RETURN jsonb_build_object(
    'is_pro', v_pro,
    'tenure_days', v_tenure,
    'required_days', 90,
    'eligible', v_eligible,
    'basis', CASE WHEN v_has_m THEN m.basis WHEN v_eligible THEN CASE WHEN v_tenure >= 90 THEN 'tenure' ELSE 'grant' END END,
    'membership_status', CASE WHEN v_has_m THEN m.status ELSE 'none' END,
    'has_password', c.user_id IS NOT NULL,
    'password_status', CASE WHEN c.user_id IS NULL THEN 'none' WHEN c.hard_locked THEN 'hard_locked' ELSE c.status END,
    'locked_until', CASE WHEN c.locked_until > now() THEN c.locked_until END,
    'activated_at', m.activated_at,
    'member_code', CASE WHEN m.status = 'active' THEN m.member_code END,
    'first_name', public.prive_first_name(v_uid),
    'welcome_version_seen', coalesce(m.welcome_version_seen, 0),
    'onboarding', coalesce(m.onboarding, '{}'::jsonb),
    'invitation_pending', coalesce(m.status = 'invited', false),
    'members_requires_prive', public.app_flag('members_requires_prive')
  );
END $$;
REVOKE ALL ON FUNCTION public.prive_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_status() TO authenticated, service_role;

-- ===================================================================== invitaciones
-- Crea la membresía 'invited' + la invitación + el aviso en la app, una sola vez por persona.
-- ON CONFLICT en la llave de la membresía: dos corridas simultáneas no duplican nada.
CREATE OR REPLACE FUNCTION public.prive_invite_user(_user uuid, _basis text, _actor text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted uuid;
  v_inv uuid;
BEGIN
  INSERT INTO public.prive_memberships (user_id, status, basis, eligible_at, invited_at, member_code)
  VALUES (_user, 'invited', _basis, now(), now(), public.prive_new_member_code())
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_inserted;
  IF v_inserted IS NULL THEN RETURN 'already_member'; END IF;
  INSERT INTO public.prive_invitations (user_id, token_hash)
  VALUES (_user, public.prive_sha256_hex(public.prive_random_token()))  -- se reemplaza al enviar el correo
  RETURNING id INTO v_inv;
  PERFORM public.notify_once(_user, 'prive', 'Tu invitación a IATOS Privé está lista',
    CASE WHEN _basis = 'tenure'
      THEN 'Después de 90 días como miembro de IATOS PRO, tu acceso personal a IATOS Privé está listo. Ábrelo desde Privé.'
      ELSE 'Tu acceso personal a IATOS Privé está listo. Ábrelo desde Privé.' END,
    NULL, 'prive_invite:' || _user::text);
  PERFORM public.prive_audit(_user, 'invited', _actor, jsonb_build_object('basis', _basis, 'invitation_id', v_inv));
  RETURN 'invited';
END $$;
REVOKE ALL ON FUNCTION public.prive_invite_user(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Cron: busca quién cumple (PRO + ≥ 90 días pagados o concesión) y aún no tiene membresía.
-- Idempotente: volver a correrlo no crea otra invitación, ni otro aviso, ni otro correo.
CREATE OR REPLACE FUNCTION public.prive_evaluate_eligibility(_limit int)
RETURNS TABLE (user_id uuid, action text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.uid FROM (
      SELECT DISTINCT p.user_id AS uid FROM public.pro_paid_periods p WHERE p.status IN ('paid', 'partially_refunded')
      UNION
      SELECT g.user_id FROM public.prive_grants g WHERE g.user_id IS NOT NULL AND g.revoked_at IS NULL
    ) c
    WHERE NOT EXISTS (SELECT 1 FROM public.prive_memberships m WHERE m.user_id = c.uid)
      AND public.is_pro(c.uid) AND public.prive_is_eligible(c.uid)
    ORDER BY c.uid
    LIMIT greatest(coalesce(_limit, 100), 0)
  LOOP
    user_id := r.uid;
    action := public.prive_invite_user(r.uid,
      CASE WHEN public.prive_tenure_days(r.uid) >= 90 THEN 'tenure' ELSE 'grant' END, 'system');
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.prive_evaluate_eligibility(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_evaluate_eligibility(int) TO service_role;

CREATE OR REPLACE FUNCTION public.prive_record_attempt(_user uuid, _ip_hash text, _kind text, _success boolean, _reason text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.prive_auth_attempts (user_id, ip_hash, kind, success, reason)
  VALUES (_user, CASE WHEN _ip_hash ~ '^[0-9a-f]{16}$' THEN _ip_hash END, _kind, _success, _reason);
$$;
REVOKE ALL ON FUNCTION public.prive_record_attempt(uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;

-- Aceptar la invitación. El token es un puntero de conveniencia, no una autoridad (D6): quien acepta
-- siempre es la cuenta con sesión, y debe ser la dueña de la invitación. Sin token (desde el aviso en
-- la app) basta con tener la membresía 'invited' y el derecho vigente.
CREATE OR REPLACE FUNCTION public.prive_accept_invitation(_user uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.prive_invitations%ROWTYPE;
  m public.prive_memberships%ROWTYPE;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'prive_accept_invitation: falta el usuario'; END IF;
  IF _token_hash IS NOT NULL THEN
    SELECT * INTO inv FROM public.prive_invitations WHERE token_hash = lower(_token_hash);
    IF NOT FOUND THEN
      PERFORM public.prive_record_attempt(_user, NULL, 'accept', false, 'unknown_token');
      RETURN jsonb_build_object('ok', false, 'code', 'NO_INVITATION');
    END IF;
    IF inv.user_id <> _user THEN
      -- Invitación reenviada a otra persona: no se acepta, se registra en ambas cuentas.
      PERFORM public.prive_record_attempt(_user, NULL, 'accept', false, 'other_account');
      PERFORM public.prive_audit(inv.user_id, 'invitation_used_by_other_account', 'system',
        jsonb_build_object('invitation_id', inv.id, 'attempted_by', _user));
      RETURN jsonb_build_object('ok', false, 'code', 'INVITATION_OTHER_ACCOUNT');
    END IF;
    IF inv.accepted_at IS NULL AND (inv.revoked_at IS NOT NULL OR inv.expires_at <= now()) THEN
      PERFORM public.prive_record_attempt(_user, NULL, 'accept', false, 'expired_token');
      RETURN jsonb_build_object('ok', false, 'code', 'INVITATION_EXPIRED');
    END IF;
  END IF;

  IF NOT public.is_pro(_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_PRO'); END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user FOR UPDATE;
  IF FOUND AND m.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'code', 'PRIVE_REVOKED'); END IF;
  IF NOT public.prive_is_eligible(_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE'); END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_INVITATION'); END IF;
  IF m.status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'member_code', m.member_code, 'activated_at', m.activated_at);
  END IF;

  UPDATE public.prive_memberships SET status = 'active', activated_at = now(), updated_at = now()
   WHERE user_id = _user RETURNING * INTO m;
  UPDATE public.prive_invitations SET accepted_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE user_id = _user AND accepted_at IS NULL AND revoked_at IS NULL;
  PERFORM public.prive_record_attempt(_user, NULL, 'accept', true, CASE WHEN _token_hash IS NULL THEN 'in_app' ELSE 'link' END);
  PERFORM public.prive_audit(_user, 'activated', 'user', jsonb_build_object('via', CASE WHEN _token_hash IS NULL THEN 'in_app' ELSE 'link' END));
  RETURN jsonb_build_object('ok', true, 'member_code', m.member_code, 'activated_at', m.activated_at,
                            'first_name', public.prive_first_name(_user));
END $$;
REVOKE ALL ON FUNCTION public.prive_accept_invitation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_accept_invitation(uuid, text) TO service_role;

-- Reenviar la invitación (no llegó, se borró o caducó). Revoca la anterior: su enlace deja de servir.
-- Máximo 3 por día por persona.
CREATE OR REPLACE FUNCTION public.prive_resend_invitation(_user uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.prive_memberships%ROWTYPE;
  v_inv uuid;
BEGIN
  IF NOT public.is_pro(_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_PRO'); END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN public.prive_is_eligible(_user) THEN 'NO_INVITATION' ELSE 'NOT_ELIGIBLE' END);
  END IF;
  IF m.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'code', 'PRIVE_REVOKED'); END IF;
  IF m.status = 'active' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF NOT public.prive_is_eligible(_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE'); END IF;
  IF (SELECT count(*) FROM public.prive_invitations i WHERE i.user_id = _user AND i.created_at > now() - interval '24 hours') >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  UPDATE public.prive_invitations SET revoked_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE user_id = _user AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.prive_invitations (user_id, token_hash)
  VALUES (_user, public.prive_sha256_hex(public.prive_random_token()))
  RETURNING id INTO v_inv;
  PERFORM public.prive_audit(_user, 'invitation_resent', 'user', jsonb_build_object('invitation_id', v_inv));
  RETURN jsonb_build_object('ok', true, 'invitation_id', v_inv);
END $$;
REVOKE ALL ON FUNCTION public.prive_resend_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_resend_invitation(uuid) TO service_role;

-- Correo de invitación: reclama las que tocan (FOR UPDATE SKIP LOCKED: dos corridas no reciben la
-- misma), genera un token NUEVO (solo se guarda su hash) y lo devuelve una sola vez para el enlace.
-- email_next_attempt_at queda 10 min adelante mientras se envía (si la corrida muere, se reintenta).
CREATE OR REPLACE FUNCTION public.prive_claim_invitation_emails(_limit int, _only_user uuid DEFAULT NULL)
RETURNS TABLE (invitation_id uuid, user_id uuid, email text, first_name text, token text, attempt int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_token text;
  v_email text;
BEGIN
  FOR r IN
    SELECT i.id, i.user_id, i.email_attempts FROM public.prive_invitations i
      JOIN public.prive_memberships m ON m.user_id = i.user_id AND m.status = 'invited'
     WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       AND i.email_status IN ('pending', 'failed') AND i.email_attempts < 5
       AND coalesce(i.email_next_attempt_at, now()) <= now()
       AND (_only_user IS NULL OR i.user_id = _only_user)
     ORDER BY i.email_next_attempt_at NULLS FIRST, i.created_at
     LIMIT greatest(coalesce(_limit, 50), 0)
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    IF NOT (public.is_pro(r.user_id) AND public.prive_is_eligible(r.user_id)) THEN
      CONTINUE;  -- se queda pendiente: si vuelve a cumplir, se envía entonces
    END IF;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = r.user_id;
    IF v_email IS NULL OR v_email NOT LIKE '%@%' THEN
      UPDATE public.prive_invitations SET email_status = 'skipped', email_last_error = 'sin_correo' WHERE id = r.id;
      CONTINUE;
    END IF;
    v_token := public.prive_random_token();
    UPDATE public.prive_invitations
       SET token_hash = public.prive_sha256_hex(v_token), email_attempts = email_attempts + 1,
           email_next_attempt_at = now() + interval '10 minutes'
     WHERE id = r.id;
    invitation_id := r.id; user_id := r.user_id; email := v_email;
    first_name := public.prive_first_name(r.user_id); token := v_token; attempt := r.email_attempts + 1;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.prive_claim_invitation_emails(int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_claim_invitation_emails(int, uuid) TO service_role;

-- Resultado del envío. Fallo → reintento a los 15 min, 1 h, 6 h y 24 h; al quinto se deja de intentar.
CREATE OR REPLACE FUNCTION public.prive_mark_invitation_email(_invitation_id uuid, _ok boolean, _provider_id text, _error text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts int;
  v_user uuid;
BEGIN
  IF _ok THEN
    UPDATE public.prive_invitations SET email_status = 'sent', email_sent_at = now(), provider_message_id = left(_provider_id, 200),
           email_next_attempt_at = NULL, email_last_error = NULL
     WHERE id = _invitation_id AND email_status IN ('pending', 'failed')
    RETURNING email_attempts, user_id INTO v_attempts, v_user;
    IF v_user IS NOT NULL THEN
      PERFORM public.prive_audit(v_user, 'invitation_email_sent', 'system', jsonb_build_object('invitation_id', _invitation_id, 'attempt', v_attempts));
    END IF;
    RETURN jsonb_build_object('ok', v_user IS NOT NULL, 'status', 'sent');
  END IF;
  UPDATE public.prive_invitations SET email_status = 'failed', email_last_error = left(coalesce(_error, 'error'), 200),
         email_next_attempt_at = now() + CASE email_attempts WHEN 1 THEN interval '15 minutes' WHEN 2 THEN interval '1 hour'
                                                             WHEN 3 THEN interval '6 hours' WHEN 4 THEN interval '24 hours' END
   WHERE id = _invitation_id AND email_status IN ('pending', 'failed')
  RETURNING email_attempts INTO v_attempts;
  RETURN jsonb_build_object('ok', v_attempts IS NOT NULL, 'status', 'failed', 'attempts', v_attempts, 'gave_up', coalesce(v_attempts >= 5, false));
END $$;
REVOKE ALL ON FUNCTION public.prive_mark_invitation_email(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_mark_invitation_email(uuid, boolean, text, text) TO service_role;

-- ===================================================================== concesiones por correo
-- Igual que comp_grants: al registrarse o cambiar (y confirmar) el correo, la concesión pendiente de
-- ese correo se liga a la cuenta. Nunca bloquea un registro. Una concesión ya ligada a otra cuenta
-- no se mueve.
CREATE OR REPLACE FUNCTION public.apply_prive_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
BEGIN
  IF NEW.email IS NOT NULL THEN
    UPDATE public.prive_grants SET user_id = NEW.id
     WHERE email = lower(NEW.email) AND user_id IS NULL AND revoked_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      PERFORM public.prive_audit(NEW.id, 'grant_linked', 'system', jsonb_build_object('grants', v_n, 'via', TG_OP));
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_prive_grant: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_prive_grant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_prive_grant ON auth.users;
CREATE TRIGGER on_auth_user_prive_grant
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_prive_grant();

-- ===================================================================== administración (service_role)
-- Se usan desde el SQL editor (docs/iatos/IATOS_PRIVE_INVITATIONS.md). Todo queda en la bitácora.
CREATE OR REPLACE FUNCTION public.admin_grant_prive(_email text, _reason text, _valid_until timestamptz, _granted_by text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(btrim(coalesce(_email, '')));
  v_user uuid;
  v_grant public.prive_grants%ROWTYPE;
  v_action text := 'pending_pro';
  v_dup boolean := false;
BEGIN
  IF v_email NOT LIKE '%_@_%' THEN RAISE EXCEPTION 'admin_grant_prive: correo inválido'; END IF;
  IF length(btrim(coalesce(_reason, ''))) < 3 THEN RAISE EXCEPTION 'admin_grant_prive: falta el motivo'; END IF;
  IF length(btrim(coalesce(_granted_by, ''))) < 3 THEN RAISE EXCEPTION 'admin_grant_prive: falta quién concede'; END IF;
  IF _valid_until IS NOT NULL AND _valid_until <= now() THEN RAISE EXCEPTION 'admin_grant_prive: la vigencia ya pasó'; END IF;
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email ORDER BY u.created_at LIMIT 1;

  SELECT * INTO v_grant FROM public.prive_grants g
   WHERE g.email = v_email AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until > now())
   ORDER BY g.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_dup := true;
    UPDATE public.prive_grants SET valid_until = _valid_until, reason = btrim(_reason), user_id = coalesce(user_id, v_user)
     WHERE id = v_grant.id RETURNING * INTO v_grant;
  ELSE
    INSERT INTO public.prive_grants (email, user_id, reason, valid_until, granted_by)
    VALUES (v_email, v_user, btrim(_reason), _valid_until, btrim(_granted_by))
    RETURNING * INTO v_grant;
  END IF;
  PERFORM public.prive_audit(v_grant.user_id, CASE WHEN v_dup THEN 'grant_updated' ELSE 'grant_created' END,
    'admin:' || btrim(_granted_by), jsonb_build_object('grant_id', v_grant.id, 'valid_until', _valid_until, 'reason', btrim(_reason)));

  IF v_grant.user_id IS NULL THEN
    v_action := 'pending_signup';
  ELSIF EXISTS (SELECT 1 FROM public.prive_memberships m WHERE m.user_id = v_grant.user_id AND m.status = 'revoked') THEN
    v_action := 'membership_revoked_use_admin_restore_prive';
  ELSIF public.is_pro(v_grant.user_id) THEN
    v_action := public.prive_invite_user(v_grant.user_id, 'grant', 'admin:' || btrim(_granted_by));
  END IF;
  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant.id, 'user_id', v_grant.user_id, 'updated', v_dup, 'action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.admin_grant_prive(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_prive(text, text, timestamptz, text) TO service_role;

-- Quitar una concesión. Si con eso la persona deja de tener derecho, sus sesiones Privé se cierran.
CREATE OR REPLACE FUNCTION public.admin_revoke_prive_grant(_grant_id uuid, _reason text, _actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_closed int := 0;
BEGIN
  IF length(btrim(coalesce(_reason, ''))) < 3 OR length(btrim(coalesce(_actor, ''))) < 3 THEN
    RAISE EXCEPTION 'admin_revoke_prive_grant: falta motivo o responsable';
  END IF;
  UPDATE public.prive_grants SET revoked_at = now(), revoked_by = btrim(_actor), revoke_reason = btrim(_reason)
   WHERE id = _grant_id AND revoked_at IS NULL RETURNING user_id INTO v_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_already_revoked'); END IF;
  IF v_user IS NOT NULL AND NOT public.prive_entitled(v_user) THEN
    v_closed := public.prive_revoke_sessions(v_user, 'grant_revoked');
  END IF;
  PERFORM public.prive_audit(v_user, 'grant_revoked', 'admin:' || btrim(_actor), jsonb_build_object('grant_id', _grant_id, 'reason', btrim(_reason)));
  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'sessions_closed', v_closed);
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_prive_grant(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_prive_grant(uuid, text, text) TO service_role;

-- Revocar la membresía (fraude u otra causa documentada). Bloquea reactivaciones: el cron nunca
-- vuelve a invitar a una membresía revocada. Si aún no había membresía, se crea ya revocada.
CREATE OR REPLACE FUNCTION public.admin_revoke_prive(_user uuid, _kind text, _reason text, _actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
  v_closed int;
BEGIN
  IF _kind NOT IN ('fraud', 'admin', 'other') THEN RAISE EXCEPTION 'admin_revoke_prive: tipo inválido (fraud|admin|other)'; END IF;
  IF length(btrim(coalesce(_reason, ''))) < 3 OR length(btrim(coalesce(_actor, ''))) < 3 THEN
    RAISE EXCEPTION 'admin_revoke_prive: falta motivo o responsable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RAISE EXCEPTION 'admin_revoke_prive: la cuenta no existe'; END IF;
  SELECT status INTO v_prev FROM public.prive_memberships WHERE user_id = _user FOR UPDATE;
  IF v_prev IS NULL THEN
    INSERT INTO public.prive_memberships (user_id, status, basis, revoked_at, revoke_kind, revoke_reason)
    VALUES (_user, 'revoked', CASE WHEN public.prive_has_grant(_user) THEN 'grant' ELSE 'tenure' END, now(), _kind, btrim(_reason));
  ELSE
    UPDATE public.prive_memberships SET status = 'revoked', revoked_at = now(), revoke_kind = _kind,
           revoke_reason = btrim(_reason), updated_at = now()
     WHERE user_id = _user;
  END IF;
  UPDATE public.prive_invitations SET revoked_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE user_id = _user AND accepted_at IS NULL AND revoked_at IS NULL;
  v_closed := public.prive_revoke_sessions(_user, 'membership_revoked');
  PERFORM public.prive_audit(_user, 'revoked', 'admin:' || btrim(_actor),
    jsonb_build_object('kind', _kind, 'reason', btrim(_reason), 'previous_status', v_prev, 'sessions_closed', v_closed));
  RETURN jsonb_build_object('ok', true, 'previous_status', coalesce(v_prev, 'none'), 'sessions_closed', v_closed);
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_prive(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_prive(uuid, text, text, text) TO service_role;

-- Restaurar una membresía revocada (por ejemplo, tras revisar un caso). Vuelve a 'active' si ya
-- estaba activada; si no, a 'invited' con una invitación nueva.
CREATE OR REPLACE FUNCTION public.admin_restore_prive(_user uuid, _reason text, _actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.prive_memberships%ROWTYPE;
  v_new text;
BEGIN
  IF length(btrim(coalesce(_reason, ''))) < 3 OR length(btrim(coalesce(_actor, ''))) < 3 THEN
    RAISE EXCEPTION 'admin_restore_prive: falta motivo o responsable';
  END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND OR m.status <> 'revoked' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_revoked'); END IF;
  v_new := CASE WHEN m.activated_at IS NOT NULL THEN 'active' ELSE 'invited' END;
  UPDATE public.prive_memberships SET status = v_new, revoked_at = NULL, revoke_kind = NULL, revoke_reason = NULL,
         invited_at = coalesce(invited_at, now()), eligible_at = coalesce(eligible_at, now()),
         member_code = coalesce(member_code, public.prive_new_member_code()), updated_at = now()
   WHERE user_id = _user;
  IF v_new = 'invited' THEN
    INSERT INTO public.prive_invitations (user_id, token_hash)
    VALUES (_user, public.prive_sha256_hex(public.prive_random_token()))
    ON CONFLICT DO NOTHING;
  END IF;
  PERFORM public.prive_audit(_user, 'restored', 'admin:' || btrim(_actor),
    jsonb_build_object('reason', btrim(_reason), 'previous_kind', m.revoke_kind, 'new_status', v_new));
  RETURN jsonb_build_object('ok', true, 'status', v_new);
END $$;
REVOKE ALL ON FUNCTION public.admin_restore_prive(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_prive(uuid, text, text) TO service_role;
