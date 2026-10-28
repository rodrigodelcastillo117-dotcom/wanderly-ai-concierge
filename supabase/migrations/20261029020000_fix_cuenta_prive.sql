-- Auditoría de Privé en producción (28-oct-2026), P1-1: una cuenta con PRO de cortesía veía
-- "Llevas 0 de 90 días de PRO pagado … cuando llegues a 90 te enviaremos tu invitación", un camino que
-- nunca iba a avanzar (la cortesía no suma días). prive_status() no decía de dónde viene el PRO.
--
-- Dos cambios, los dos sin tocar quién puede qué:
--   1. prive_status() agrega 'pro_basis' (abajo).
--   2. edition_admin_require() responde 403 (SQLSTATE 42501) en vez de 400 (al final del archivo).
--
-- 1. prive_status() agrega el campo 'pro_basis' (de dónde viene el PRO vigente):
--   'paid'   → suscripción de Stripe activa o con pago pendiente (sus periodos pagados sí suman días)
--   'trial'  → prueba gratuita (no suma días hasta que se cobre el primer mes)
--   'comped' → PRO de cortesía (no suma días para Privé)
--   null     → sin PRO vigente
-- El resto de la respuesta es idéntico (mismas llaves, mismo cálculo, mismos permisos). No cambia quién
-- es elegible ni quién entra: eso sigue en prive_is_eligible / prive_require.
-- Idempotente: CREATE OR REPLACE con la misma firma; los GRANT/REVOKE se repiten sin efecto.

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
  v_sub_status text;
  v_pro_basis text;
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
    -- Una fila por persona (subscriptions_user_id_key). Solo se lee el estado; is_pro ya decidió si
    -- es vigente.
    SELECT s.status INTO v_sub_status FROM public.subscriptions s WHERE s.user_id = v_uid;
    v_pro_basis := CASE
      WHEN v_sub_status = 'comped' THEN 'comped'
      WHEN v_sub_status = 'trialing' THEN 'trial'
      WHEN v_sub_status IN ('active', 'past_due') THEN 'paid'
    END;
  END IF;
  RETURN jsonb_build_object(
    'is_pro', v_pro,
    'pro_basis', v_pro_basis,
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

-- ───────────────────────────── Panel editorial: 403 en vez de 400 ─────────────────────────────
-- Auditoría técnica 28-oct (#8): para quien no es admin, edition_admin_overview / edition_admin_preview
-- (y el resto del panel, que pasa por edition_admin_require) respondían HTTP 400: edition_raise usa
-- SQLSTATE P0001, que PostgREST traduce a 400. Es un "no tienes permiso": SQLSTATE 42501 → HTTP 403.
-- El MESSAGE sigue siendo EDITION_NOT_ADMIN (la app y las pruebas leen ese código), así que nada más
-- cambia. Misma firma, mismos permisos (REVOKE se repite sin efecto). Idempotente.
CREATE OR REPLACE FUNCTION public.edition_admin_require()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EDITION_NOT_ADMIN', DETAIL = '';
  END IF;
  RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.edition_admin_require() FROM PUBLIC, anon, authenticated;
