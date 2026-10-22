-- Segunda auditoría · grupo cuentas · D-P3-1 / N-06 (P3). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción (y desplegar stripe-webhook, que ahora transmite pause_collection).
--
-- Problemas:
--   X01: is_pro daba PRO a cualquier suscripción de Stripe 'active', de cualquier precio o moneda (un
--        cambio a USD 1.00 desde el panel seguía siendo PRO de $99 MXN).
--   X02: una fila 'active' con current_period_end NULL daba PRO sin fecha de fin.
--   X13: la antigüedad de Privé (90 días pagados) contaba facturas de cualquier monto o moneda.
--
-- Regla nueva:
--   * 'comped' (cortesía) sigue siendo PRO sin vencimiento: no cambia.
--   * 'active' y 'trialing' solo son PRO con fecha de fin futura (nunca NULL).
--   * Si la fila es de Stripe (stripe_subscription_id no nulo), además debe ser el precio de PRO:
--     moneda MXN y, si el dueño registró precios en public.stripe_pro_prices, uno de esos price_id.
--     Con la tabla vacía basta la moneda (MXN). Las filas sin Stripe (prueba sin tarjeta) no cambian.
--   * Antigüedad: solo cuentan periodos en MXN de al menos $99.00 (9900 centavos, la oferta con IVA).
--     Un mes con cupón por debajo de $99 no suma días (decisión documentada en cierre2/CUENTAS.md).
--
-- Impacto revisado:
--   * Cortesías (comped): ninguno.
--   * Filas 'active' SIN Stripe y SIN fecha de fin (PRO dado a mano por SQL): se convierten aquí en
--     'comped' para que conserven su acceso (la regla nueva ya no da PRO a 'active' sin fecha). Se
--     cuentan en un NOTICE. Las que tienen Stripe y no tienen fecha dejan de ser PRO (las corrige el
--     siguiente evento de Stripe, que trae el periodo).
--   * Cuenta sintética de prueba de Stripe (B, modo prueba): Adaptive Pricing la cobró en USD, así que
--     su fila tiene currency='USD' y deja de ser PRO. Es lo correcto: no pagó la oferta de $99 MXN.
--     Sus pruebas que necesiten PRO deben usar una suscripción nueva en MXN (el checkout ya fuerza mxn).
--
-- Prueba: supabase/tests/payments/aud2_pagos_adversarial.sql (X01, X02, X13) y r2_cuentas.sql (RC20–RC27).

-- Precios de Stripe que son IATOS PRO (los llena el dueño; vacío = solo se exige MXN).
CREATE TABLE IF NOT EXISTS public.stripe_pro_prices (
  price_id text PRIMARY KEY CHECK (price_id LIKE 'price\_%'),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_pro_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_pro_prices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_pro_prices TO service_role;

CREATE OR REPLACE FUNCTION public.pro_price_ok(_price_id text, _currency text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT upper(coalesce(_currency, '')) = 'MXN'
     AND (NOT EXISTS (SELECT 1 FROM public.stripe_pro_prices)
          OR EXISTS (SELECT 1 FROM public.stripe_pro_prices p WHERE p.price_id = _price_id));
$$;
REVOKE ALL ON FUNCTION public.pro_price_ok(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_price_ok(text, text) TO service_role;

-- PRO dado a mano ('active' sin Stripe ni fecha de fin): se conserva como cortesía explícita.
DO $$
DECLARE v_n int;
BEGIN
  UPDATE public.subscriptions
     SET status = 'comped', plan = 'pro', cancel_at_period_end = false, updated_at = now()
   WHERE status = 'active' AND stripe_subscription_id IS NULL AND current_period_end IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'r2_cuentas D-P3-1: % fila(s) active sin Stripe ni fecha de fin pasan a comped (conservan PRO)', v_n;
END $$;

CREATE OR REPLACE FUNCTION public.is_pro(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND (
        s.status = 'comped'
        OR (s.status IN ('active', 'trialing')
            AND s.current_period_end IS NOT NULL AND s.current_period_end > now()
            AND (s.stripe_subscription_id IS NULL OR public.pro_price_ok(s.price_id, s.currency)))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_pro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pro(uuid) TO service_role;

-- Antigüedad de Privé: solo periodos pagados de la oferta (MXN, ≥ $99.00).
CREATE OR REPLACE FUNCTION public.prive_tenure_days(_user uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(floor(extract(epoch FROM (
           SELECT sum(upper(r) - lower(r))
             FROM unnest((SELECT range_agg(p.period * tstzrange(NULL, now(), '[)'))
                            FROM public.pro_paid_periods p
                           WHERE p.user_id = _user AND p.status IN ('paid', 'partially_refunded')
                             AND upper(coalesce(p.currency, '')) = 'MXN' AND p.amount_paid >= 9900)) AS r
         )) / 86400)::int, 0);
$$;
REVOKE ALL ON FUNCTION public.prive_tenure_days(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_tenure_days(uuid) TO service_role;
