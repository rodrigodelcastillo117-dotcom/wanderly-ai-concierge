-- Segunda auditoría · grupo cuentas · N-02 / P2-1 (P2). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción. Depende de 20261026210000_r2_cuentas_comp_grant_email_proof.sql
-- (tabla auth_email_changes y su trigger).
--
-- Problema (INFORME_prive.md, P2-1):
--   1. apply_prive_grant ligaba una concesión Privé pendiente (pending_signup) a quien registrara ese
--      correo o cambiara su correo a ese, sin mirar email_confirmed_at.
--   2. prive_accept_invitation aceptaba la invitación desde la app sin el token del correo: nunca se
--      comprobaba que la persona controla el buzón de la invitada. Con mailer_autoconfirm=true
--      (producción hoy) email_confirmed_at no prueba nada.
--
-- Corrección (el diff propuesto por el auditor, con dos ajustes para no romper a nadie):
--   1. La concesión se liga solo con el correo confirmado y nunca en el UPDATE que cambia el correo
--      (la confirmación de esa fila es la del correo anterior); tampoco si el correo cambió después de
--      confirmarse. El trigger corre también AFTER UPDATE OF email_confirmed_at: al confirmar con el
--      enlace, la concesión se liga en ese momento.
--   2. Una membresía 'invited' con basis='grant' solo se acepta con el token del correo de invitación
--      (código INVITATION_LINK_REQUIRED sin token). Excepción: si la persona ya cumple por antigüedad
--      pagada (≥ 90 días), la concesión no es lo que le abre la puerta y basta la app, como siempre.
--
-- Lo que NO cambia:
--   * Membresías ya activas (el dueño, su hermana y cualquier invitación ya aceptada): aceptar de nuevo
--     responde 'already' antes de mirar el token, y prive_require/prive_access_code no se tocan.
--   * Invitaciones por antigüedad (basis='tenure'): se siguen aceptando desde la app.
--   * Quien tiene una invitación por concesión pendiente (p. ej. 'invited' en producción) la abre con
--     el enlace del correo que ya recibió; si venció o lo perdió, "Enviarme una nueva" manda otro.
--
-- Prueba: supabase/tests/prive/aud2_prive.sql (N02-A, N02-B, N02-C) y r2_cuentas_prive.sql.

CREATE OR REPLACE FUNCTION public.apply_prive_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
  v_changed timestamptz;
BEGIN
  -- El cambio de correo nunca liga: la confirmación de la fila es la del correo anterior.
  IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.email, '')) IS DISTINCT FROM lower(coalesce(NEW.email, '')) THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  SELECT c.changed_at INTO v_changed FROM public.auth_email_changes c WHERE c.user_id = NEW.id;
  IF v_changed IS NOT NULL AND NEW.email_confirmed_at <= v_changed THEN RETURN NEW; END IF;

  UPDATE public.prive_grants SET user_id = NEW.id
   WHERE email = lower(NEW.email) AND user_id IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.prive_audit(NEW.id, 'grant_linked', 'system', jsonb_build_object('grants', v_n, 'via', TG_OP));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_prive_grant: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_prive_grant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_prive_grant ON auth.users;
CREATE TRIGGER on_auth_user_prive_grant
  AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_prive_grant();

-- Aceptar la invitación. Igual que 20261023090100 salvo el bloque "INVITATION_LINK_REQUIRED".
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
  -- N-02: la concesión se dio a un CORREO. Sin el token que llegó a ese buzón no se comprueba que quien
  -- acepta lo controla (con autoconfirm, cualquiera pudo registrar ese correo). Si ya cumple por
  -- antigüedad pagada, la concesión no es lo que decide y se acepta desde la app como siempre.
  IF _token_hash IS NULL AND m.basis = 'grant' AND public.prive_tenure_days(_user) < 90 THEN
    PERFORM public.prive_record_attempt(_user, NULL, 'accept', false, 'link_required');
    RETURN jsonb_build_object('ok', false, 'code', 'INVITATION_LINK_REQUIRED');
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
