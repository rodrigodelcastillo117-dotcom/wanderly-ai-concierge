-- Segunda auditoría · grupo cuentas · D-P2-2 (P2). Idempotente. REQUIERE AUTORIZACIÓN para aplicarse
-- en producción (y desplegar stripe-checkout y stripe-webhook).
--
-- Problema: la prueba de 30 días con tarjeta (Stripe Checkout, trial_period_days) solo revisaba la
-- fila y el cliente de Stripe de ESA cuenta. Una cuenta nueva (con autoconfirm, con un correo
-- inventado) y la misma tarjeta recibía otra prueba de 30 días, sin fin.
--
-- Cómo funciona con Stripe Checkout (la tarjeta no se conoce al crear la sesión):
--   1. stripe-checkout, cuando da prueba, crea la sesión con payment_method_collection='always',
--      solo tarjeta (payment_method_types=['card'], así siempre hay card.fingerprint) y la marca
--      subscription_data.metadata.iatos_trial='card'.
--   2. stripe-webhook, al recibir checkout.session.completed / customer.subscription.created|updated
--      de una suscripción 'trialing' con esa marca, lee la huella de la tarjeta guardada
--      (default_payment_method → payment_method.card.fingerprint) y la reclama aquí.
--   3. Si esa huella ya tuvo una prueba en OTRA suscripción, el webhook termina la prueba en Stripe
--      (subscriptions.update trial_end='now'): Stripe cobra el primer mes en ese momento y la
--      suscripción pasa a 'active' (o 'incomplete'/'past_due' si el cobro falla, sin PRO).
-- La huella es un identificador opaco de Stripe (por cuenta de Stripe), no el número de la tarjeta.
-- No se guarda a qué cuenta de IATOS pertenece: solo la suscripción y el cliente de Stripe.
--
-- Prueba: supabase/tests/payments/r2_cuentas.sql (RC10–RC13) y src/test/stripeTrialFingerprint.test.ts.

CREATE TABLE IF NOT EXISTS public.stripe_trial_fingerprints (
  fingerprint text PRIMARY KEY CHECK (length(fingerprint) BETWEEN 8 AND 64),
  subscription_id text NOT NULL,
  customer_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_trial_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_trial_fingerprints FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_trial_fingerprints TO service_role;

-- Reclama la prueba para una huella. first=true: es la primera suscripción con esa tarjeta (o la misma
-- suscripción que la reclamó antes: el webhook se reintenta). first=false: la tarjeta ya tuvo prueba.
CREATE OR REPLACE FUNCTION public.claim_trial_fingerprint(_fingerprint text, _subscription_id text, _customer_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.stripe_trial_fingerprints%ROWTYPE;
BEGIN
  IF _fingerprint IS NULL OR length(_fingerprint) NOT BETWEEN 8 AND 64 OR _subscription_id IS NULL OR _subscription_id = '' THEN
    RAISE EXCEPTION 'claim_trial_fingerprint: huella o suscripción inválida';
  END IF;
  INSERT INTO public.stripe_trial_fingerprints (fingerprint, subscription_id, customer_id)
  VALUES (_fingerprint, _subscription_id, _customer_id)
  ON CONFLICT (fingerprint) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('first', true, 'reason', 'new_card'); END IF;
  SELECT * INTO v FROM public.stripe_trial_fingerprints WHERE fingerprint = _fingerprint;
  IF v.subscription_id = _subscription_id THEN
    RETURN jsonb_build_object('first', true, 'reason', 'same_subscription');
  END IF;
  RETURN jsonb_build_object('first', false, 'reason', 'card_already_had_trial',
                            'first_seen_at', v.first_seen_at);
END $$;
REVOKE ALL ON FUNCTION public.claim_trial_fingerprint(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_trial_fingerprint(text, text, text) TO service_role;
