-- Cierre de auditoría · grupo prive. Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.
-- Va después de 20261024010000 (AUD-01).
--
-- NEW-01 · admin_revoke_prive_grant dejaba la invitación pendiente viva y la membresía en 'invited'.
--   Si la persona ya no cumple (sin otra concesión vigente ni 90 días pagados), la invitación se revoca
--   y la membresía no activada se retira (queda en la bitácora). El barrido hace lo mismo cuando la
--   concesión vence sola. Si sigue cumpliendo por antigüedad, la invitación se conserva.
--   El barrido además cierra (AUD-01) las sesiones Privé cuya sesión de Auth ya no se puede comprobar.
--
-- Prueba: supabase/tests/prive/aud_session.sql (N01–N04; corre con supabase/tests/prive/run.sh).

-- ===================================================================== NEW-01
-- Retira la invitación de quien ya no cumple: membresía 'invited' (nunca activada) + sin concesión
-- vigente ni 90 días pagados → se revocan sus invitaciones pendientes, se quita el aviso "tu invitación
-- está lista" y se borra la membresía no activada (así, si vuelve a cumplir, el cron lo invita de nuevo
-- con un enlace nuevo y la base correcta). Idempotente; devuelve true si retiró algo.
CREATE OR REPLACE FUNCTION public.prive_withdraw_invitation(_user uuid, _actor text, _reason text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.prive_memberships%ROWTYPE;
  v_inv int;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND OR m.status <> 'invited' OR m.activated_at IS NOT NULL OR public.prive_is_eligible(_user) THEN
    RETURN false;
  END IF;
  UPDATE public.prive_invitations SET revoked_at = now(),
         email_status = CASE WHEN email_status IN ('pending', 'failed') THEN 'skipped' ELSE email_status END
   WHERE user_id = _user AND accepted_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS v_inv = ROW_COUNT;
  DELETE FROM public.notifications WHERE user_id = _user AND dedup_key = 'prive_invite:' || _user::text;
  DELETE FROM public.prive_memberships WHERE user_id = _user AND status = 'invited';
  PERFORM public.prive_audit(_user, 'invitation_withdrawn', coalesce(_actor, 'system'),
    jsonb_build_object('reason', left(coalesce(_reason, 'not_eligible'), 120), 'basis', m.basis, 'invitations_revoked', v_inv));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.prive_withdraw_invitation(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_withdraw_invitation(uuid, text, text) TO service_role;

-- Quitar una concesión. Si con eso la persona deja de tener derecho, sus sesiones Privé se cierran y,
-- si aún no activaba, su invitación se retira (NEW-01).
CREATE OR REPLACE FUNCTION public.admin_revoke_prive_grant(_grant_id uuid, _reason text, _actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_closed int := 0;
  v_withdrawn boolean := false;
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
  IF v_user IS NOT NULL THEN
    v_withdrawn := public.prive_withdraw_invitation(v_user, 'admin:' || btrim(_actor), 'grant_revoked');
    -- Sigue invitado porque cumple por antigüedad: la base de la invitación ya no es la concesión.
    UPDATE public.prive_memberships SET basis = 'tenure', updated_at = now()
     WHERE user_id = v_user AND status = 'invited' AND basis = 'grant'
       AND NOT public.prive_has_grant(v_user) AND public.prive_tenure_days(v_user) >= 90;
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'sessions_closed', v_closed, 'invitation_withdrawn', v_withdrawn);
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_prive_grant(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_prive_grant(uuid, text, text) TO service_role;

-- Barrido: igual que antes + retira invitaciones de quien dejó de cumplir sin activar (concesión
-- vencida, reembolso que baja de 90 días) y cuenta las sesiones cerradas por no poder comprobar su
-- sesión de Auth (cerrada, vencida, cuenta suspendida o borrada).
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
