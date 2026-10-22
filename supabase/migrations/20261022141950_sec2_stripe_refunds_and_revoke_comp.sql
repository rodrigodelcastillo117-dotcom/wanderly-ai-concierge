-- A-14 (IATOS-049) y A-18 (IATOS-055): reembolsos/disputas de Stripe y revocar una cortesía.
-- Idempotente.

-- 1) Registro de reembolsos y disputas que recibe stripe-webhook (charge.refunded,
--    charge.dispute.created). Solo el servidor escribe y lee. Sin datos personales: ids de Stripe,
--    montos y lo que hizo el webhook. event_id como llave: un reintento de Stripe no duplica.
CREATE TABLE IF NOT EXISTS public.stripe_payment_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  charge_id text,
  invoice_id text,
  subscription_id text,
  customer_id text,
  amount bigint,
  amount_refunded bigint,
  currency text,
  dispute_reason text,
  dispute_status text,
  action text NOT NULL,
  event_created timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_payment_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_payment_events TO service_role;

-- 2) Reembolso total de la última factura: la suscripción ya no se renueva. Solo pone
--    cancel_at_period_end = true en la fila de ESA suscripción; nunca cambia status, nunca crea una
--    fila y nunca toca una cortesía, así que un evento de reembolso o disputa no puede dar PRO.
--    (El webhook además pide a Stripe cancel_at_period_end y el customer.subscription.updated que
--    Stripe manda después sincroniza el estado completo por la vía normal.)
CREATE OR REPLACE FUNCTION public.mark_subscription_cancel_at_period_end(_subscription_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF _subscription_id IS NULL THEN
    RAISE EXCEPTION 'mark_subscription_cancel_at_period_end: falta subscription_id';
  END IF;
  WITH upd AS (
    UPDATE public.subscriptions
       SET cancel_at_period_end = true, updated_at = now()
     WHERE stripe_subscription_id = _subscription_id AND status IS DISTINCT FROM 'comped'
    RETURNING user_id
  )
  SELECT (array_agg(user_id))[1] INTO v_user FROM upd;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'sin_fila');
  END IF;
  RETURN jsonb_build_object('applied', true, 'reason', 'cancel_at_period_end', 'user_id', v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_subscription_cancel_at_period_end(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_cancel_at_period_end(text) TO service_role;

-- 3) Revocar una cortesía (A-18). Antes, quitar el correo de comp_grants no quitaba el PRO: la
--    fila 'comped' no vence. Solo para operación (docs/ops/LEEME.md); nada la llama sola.
--    - borra el correo de comp_grants (ya no se vuelve a aplicar al registrarse);
--    - las cuentas con ese correo en 'comped' pasan a 'canceled' desde ahora (sin PRO).
--    No toca suscripciones pagadas: si esa persona además paga en Stripe, el siguiente evento de
--    Stripe vuelve a escribir su estado real.
CREATE OR REPLACE FUNCTION public.revoke_comp(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_grants int;
  v_accounts int;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'revoke_comp: falta el correo';
  END IF;
  DELETE FROM public.comp_grants WHERE email = v_email;
  GET DIAGNOSTICS v_grants = ROW_COUNT;
  UPDATE public.subscriptions s
     SET status = 'canceled', current_period_end = now(), cancel_at_period_end = false, updated_at = now()
    FROM auth.users u
   WHERE u.id = s.user_id AND lower(u.email) = v_email AND s.status = 'comped';
  GET DIAGNOSTICS v_accounts = ROW_COUNT;
  RETURN jsonb_build_object('email', v_email, 'grant_removed', v_grants > 0, 'accounts_revoked', v_accounts);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_comp(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_comp(text) TO service_role;
