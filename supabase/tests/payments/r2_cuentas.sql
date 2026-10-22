-- Ronda r2 (grupo cuentas): pruebas de regresión de la segunda auditoría que no cubre
-- aud2_pagos_adversarial.sql. Imprime "OK RCnn" o "FALLA RCnn". Corre con run.sh sobre una base desechable.
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;
DROP SCHEMA IF EXISTS rc CASCADE;
CREATE SCHEMA rc;
CREATE FUNCTION rc.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION rc.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '') END $$;
CREATE FUNCTION rc.st(n int) RETURNS text LANGUAGE sql AS $$ SELECT coalesce((SELECT status FROM public.subscriptions WHERE user_id = rc.u(n)), '-') $$;

-- ===================================================================== N-01 / D-P2-1 cortesía con correo comprobado
INSERT INTO public.comp_grants (email) VALUES ('rc-link@example.test'), ('rc-oauth@example.test'), ('rc-auto@example.test'),
  ('rc-cambio@example.test'), ('rc-viejo@example.test'), ('rc-tarde@example.test') ON CONFLICT DO NOTHING;
-- RC1: registro con "Confirm email" encendido: la fila nace sin confirmar y la persona abre el enlace después.
INSERT INTO auth.users (id, email, created_at) VALUES (rc.u(1), 'rc-link@example.test', now() - interval '5 minutes');
SELECT rc.ok('RC1a sin confirmar el correo no hay cortesía', rc.st(1) = '-', rc.st(1));
UPDATE auth.users SET email_confirmed_at = now() WHERE id = rc.u(1);
SELECT rc.ok('RC1b al confirmar con el enlace (trigger AFTER UPDATE OF email_confirmed_at) se aplica la cortesía',
  rc.st(1) = 'comped' AND public.is_pro(rc.u(1)) AND public.has_comp_grant(rc.u(1)), rc.st(1));
-- RC2: registro con Google (el proveedor entrega el correo verificado en el mismo instante).
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data)
VALUES (rc.u(2), 'rc-oauth@example.test', now(), '{"provider":"google","providers":["google"]}');
SELECT rc.ok('RC2 registro con OAuth (correo verificado por el proveedor) recibe la cortesía', rc.st(2) = 'comped', rc.st(2));
-- RC3: autoconfirm (correo y contraseña, confirmado en el mismo instante): no se comprobó el buzón.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data)
VALUES (rc.u(3), 'rc-auto@example.test', now(), '{"provider":"email","providers":["email"]}');
SELECT rc.ok('RC3a registro autoconfirmado con un correo de la lista: sin cortesía y has_comp_grant=false',
  rc.st(3) = '-' AND NOT public.has_comp_grant(rc.u(3)) AND NOT public.is_pro(rc.u(3)), rc.st(3));
SELECT rc.ok('RC3b apply_comp_grants_now tampoco se la da y explica por qué',
  (SELECT result FROM public.apply_comp_grants_now() WHERE email = 'rc-auto@example.test') LIKE 'NO aplicado: el correo no está comprobado%'
  AND rc.st(3) = '-', (SELECT result FROM public.apply_comp_grants_now() WHERE email = 'rc-auto@example.test'));
-- RC4: cuenta vieja (confirmada hace días) que cambia su correo a uno de la lista y luego paga y cancela.
INSERT INTO auth.users (id, email, email_confirmed_at, created_at)
VALUES (rc.u(4), 'rc-otro@example.test', now() - interval '3 days', now() - interval '4 days');
UPDATE auth.users SET email = 'rc-cambio@example.test' WHERE id = rc.u(4);
SELECT public.apply_stripe_subscription(rc.u(4), 'cus_rc4', 'sub_rc4', 'active', NULL, now() + interval '20 days', false, 'price_rc', 'mxn', now() - interval '1 hour');
SELECT public.apply_stripe_subscription(rc.u(4), 'cus_rc4', 'sub_rc4', 'canceled', NULL, now() - interval '1 second', false, 'price_rc', 'mxn', now()) AS rc4 \gset
SELECT rc.ok('RC4 cambiar el correo a uno de la lista no da cortesía, ni al terminar su suscripción pagada',
  rc.st(4) = 'canceled' AND NOT public.has_comp_grant(rc.u(4)) AND NOT public.is_pro(rc.u(4)),
  rc.st(4) || ' ' || (:'rc4'::jsonb->>'reason'));
-- RC5: una cortesía que ya existía (fila comped) no cambia aunque su correo no cumpla la regla nueva.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (rc.u(5), 'rc-viejo@example.test', now());
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (rc.u(5), 'comped', 'pro')
  ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
SELECT rc.ok('RC5 una cortesía ya otorgada (comped) sigue siendo PRO', public.is_pro(rc.u(5)) AND rc.st(5) = 'comped', rc.st(5));
-- RC6: registro sin confirmar, cambia el correo (a uno de la lista) y luego lo confirma con el enlace.
INSERT INTO auth.users (id, email, created_at) VALUES (rc.u(6), 'rc-antes@example.test', now() - interval '10 minutes');
UPDATE auth.users SET email = 'rc-tarde@example.test' WHERE id = rc.u(6);
SELECT rc.ok('RC6a el cambio de correo sin confirmar no da cortesía', rc.st(6) = '-', rc.st(6));
UPDATE auth.users SET email_confirmed_at = clock_timestamp() + interval '1 second' WHERE id = rc.u(6);
SELECT rc.ok('RC6b al confirmar el correo nuevo con el enlace sí se aplica', rc.st(6) = 'comped', rc.st(6));

-- ===================================================================== D-P2-2 una prueba de 30 días por tarjeta
SELECT public.claim_trial_fingerprint('fp_rc_tarjeta_1', 'sub_rc10_a', 'cus_rc10_a') AS c10a \gset
SELECT public.claim_trial_fingerprint('fp_rc_tarjeta_1', 'sub_rc10_a', 'cus_rc10_a') AS c10b \gset
SELECT rc.ok('RC10 la primera suscripción con una tarjeta tiene prueba (y el reintento del webhook también)',
  (:'c10a'::jsonb->>'first')::boolean AND (:'c10b'::jsonb->>'first')::boolean
  AND (:'c10b'::jsonb->>'reason') = 'same_subscription', :'c10a' || ' ' || :'c10b');
SELECT public.claim_trial_fingerprint('fp_rc_tarjeta_1', 'sub_rc11_otra_cuenta', 'cus_rc11_otra') AS c11 \gset
SELECT rc.ok('RC11 la misma tarjeta en otra suscripción (otra cuenta, otro cliente de Stripe): sin prueba',
  NOT (:'c11'::jsonb->>'first')::boolean AND (:'c11'::jsonb->>'reason') = 'card_already_had_trial'
  AND (SELECT subscription_id FROM public.stripe_trial_fingerprints WHERE fingerprint = 'fp_rc_tarjeta_1') = 'sub_rc10_a', :'c11');
SELECT rc.ok('RC12 otra tarjeta sí tiene su prueba',
  (public.claim_trial_fingerprint('fp_rc_tarjeta_2', 'sub_rc12', 'cus_rc12')->>'first')::boolean);
DO $$ BEGIN
  PERFORM public.claim_trial_fingerprint(NULL, 'sub_x', NULL);
  RAISE NOTICE 'FALLA RC13 aceptó una huella nula';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK RC13 huella nula o inválida: error (el webhook responde 500 y Stripe reintenta)';
END $$;
SELECT rc.ok('RC14 solo service_role reclama huellas (authenticated no ve la tabla ni la función)',
  NOT has_function_privilege('authenticated', 'public.claim_trial_fingerprint(text, text, text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.stripe_trial_fingerprints', 'SELECT')
  AND has_function_privilege('service_role', 'public.claim_trial_fingerprint(text, text, text)', 'EXECUTE'));
DELETE FROM public.stripe_trial_fingerprints WHERE fingerprint LIKE 'fp_rc_%';

-- ===================================================================== D-P3-1 / N-06 is_pro y antigüedad: solo el precio de PRO
CREATE FUNCTION rc.mk(n int) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES (rc.u(n), 'rc' || n || '@example.test', now(), now() - interval '1 day')
  ON CONFLICT DO NOTHING;
  RETURN rc.u(n);
END $$;
CREATE FUNCTION rc.apply(n int, st text, price text, cur text, period_end timestamptz, ev timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.apply_stripe_subscription(rc.u(n), 'cus_rc' || n, 'sub_rc' || n, st, NULL, period_end, false, price, cur, ev) $$;
SELECT rc.mk(20); SELECT rc.apply(20, 'active', 'price_pro_mxn', 'mxn', now() + interval '20 days');
SELECT rc.ok('RC20 suscripción de Stripe activa en MXN con fecha de fin: PRO', public.is_pro(rc.u(20)) AND public.effective_plan(rc.u(20)) = 'pro');
SELECT rc.mk(21); SELECT rc.apply(21, 'trialing', 'price_pro_mxn', 'usd', now() + interval '20 days');
SELECT rc.ok('RC21 prueba de Stripe cobrada en USD (Adaptive Pricing, como la cuenta sintética B): no es PRO',
  NOT public.is_pro(rc.u(21)) AND public.effective_plan(rc.u(21)) = 'free');
-- Con precios registrados por el dueño, solo esos cuentan.
INSERT INTO public.stripe_pro_prices (price_id, note) VALUES ('price_pro_mxn', 'prueba r2');
SELECT rc.mk(22); SELECT rc.apply(22, 'active', 'price_otro_mxn', 'mxn', now() + interval '20 days');
SELECT rc.ok('RC22 con stripe_pro_prices lleno: otro precio en MXN no es PRO; el registrado sí',
  NOT public.is_pro(rc.u(22)) AND public.is_pro(rc.u(20)));
DELETE FROM public.stripe_pro_prices WHERE note = 'prueba r2';
SELECT rc.ok('RC23 con stripe_pro_prices vacío basta la moneda MXN', public.is_pro(rc.u(22)));
-- Cortesía y prueba sin tarjeta (sin Stripe) no cambian.
SELECT rc.mk(24);
INSERT INTO public.subscriptions (user_id, status, plan, currency) VALUES (rc.u(24), 'comped', 'pro', 'USD');
SELECT rc.mk(25);
INSERT INTO public.subscriptions (user_id, status, plan, trial_end, current_period_end) VALUES (rc.u(25), 'trialing', 'pro', now() + interval '9 days', now() + interval '9 days');
SELECT rc.ok('RC24 la cortesía (comped) y la prueba sin tarjeta siguen siendo PRO',
  public.is_pro(rc.u(24)) AND public.is_pro(rc.u(25)) AND public.effective_plan(rc.u(25)) = 'trial');
-- 'active' de Stripe sin fecha de fin: no es PRO indefinido.
SELECT rc.mk(26); SELECT rc.apply(26, 'active', 'price_pro_mxn', 'mxn', NULL);
SELECT rc.ok('RC25 Stripe active sin current_period_end: no es PRO', NOT public.is_pro(rc.u(26)));
-- Antigüedad: solo la oferta (MXN ≥ $99.00).
SELECT rc.mk(28);
SELECT public.prive_record_paid_period(rc.u(28), 'in_rc28_mxn', 'sub_rc28', 'cus_rc28', now() - interval '95 days', now() - interval '35 days', 9900, 'mxn', 'test');
SELECT public.prive_record_paid_period(rc.u(28), 'in_rc28_usd', 'sub_rc28', 'cus_rc28', now() - interval '35 days', now() - interval '5 days', 9900, 'usd', 'test');
SELECT public.prive_record_paid_period(rc.u(28), 'in_rc28_bajo', 'sub_rc28', 'cus_rc28', now() - interval '5 days', now() + interval '25 days', 100, 'mxn', 'test');
SELECT rc.ok('RC27 la antigüedad solo suma periodos en MXN de al menos $99 (60 de 95 días)',
  public.prive_tenure_days(rc.u(28)) = 60, 'tenure=' || public.prive_tenure_days(rc.u(28)));

-- (Al final: vuelve a aplicar la migración.) La migración conserva el PRO dado a mano ('active' sin Stripe ni fecha) como cortesía.
SELECT rc.mk(27);
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (rc.u(27), 'active', 'pro');
\ir ../../migrations/20261026170000_r2_cuentas_is_pro_price_period.sql
SELECT rc.ok('RC26 PRO dado a mano (active sin Stripe ni fecha): la migración lo deja como comped y sigue siendo PRO',
  rc.st(27) = 'comped' AND public.is_pro(rc.u(27)), rc.st(27));
DROP SCHEMA rc CASCADE;
DELETE FROM public.comp_grants WHERE email LIKE 'rc-%@example.test';
