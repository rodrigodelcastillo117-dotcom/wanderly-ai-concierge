-- Pruebas de cuota gratuita, sincronía de Stripe y cortesía (migración 20261022130000).
-- Cada bloque lanza una excepción si algo no cuadra; si todo pasa imprime "OK ...".
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('11111111-0000-0000-0000-000000000001', 'free@test.mx', now()),
  ('11111111-0000-0000-0000-000000000002', 'pro@test.mx', now()),
  ('11111111-0000-0000-0000-000000000003', 'stripe@test.mx', now()),
  ('11111111-0000-0000-0000-000000000004', 'comped@test.mx', now()),
  ('11111111-0000-0000-0000-000000000005', 'vuelve@test.mx', now());
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end)
VALUES ('11111111-0000-0000-0000-000000000002', 'active', 'sub_pro', now() + interval '20 days');

DO $$
DECLARE r jsonb; u uuid := '11111111-0000-0000-0000-000000000001';
BEGIN
  -- Q1: un análisis gratis de por vida; el segundo se niega.
  r := public.consume_free_quota(u, 'trip_analysis');
  IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 0 THEN RAISE EXCEPTION 'Q1a %', r; END IF;
  r := public.consume_free_quota(u, 'trip_analysis');
  IF (r->>'allowed')::boolean OR r->>'reason' <> 'quota_exceeded' THEN RAISE EXCEPTION 'Q1b %', r; END IF;
  IF (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'Q1c contador'; END IF;
  RAISE NOTICE 'OK Q1 trip_analysis: 1 permitido, el 2o negado, contador=1';

  -- Q2: 3 mensajes al mes; el 4o se niega; mes nuevo reinicia.
  FOR i IN 1..3 LOOP
    r := public.consume_free_quota(u, 'concierge');
    IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 3 - i THEN RAISE EXCEPTION 'Q2a % %', i, r; END IF;
  END LOOP;
  r := public.consume_free_quota(u, 'concierge');
  IF (r->>'allowed')::boolean THEN RAISE EXCEPTION 'Q2b %', r; END IF;
  UPDATE public.usage_limits SET concierge_period = '2000-01' WHERE user_id = u;
  r := public.consume_free_quota(u, 'concierge');
  IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 2 THEN RAISE EXCEPTION 'Q2c %', r; END IF;
  RAISE NOTICE 'OK Q2 concierge: 3 permitidos, el 4o negado, mes nuevo reinicia (quedan 2)';

  -- Q3: PRO no descuenta.
  r := public.consume_free_quota('11111111-0000-0000-0000-000000000002', 'trip_analysis');
  IF r->>'reason' <> 'pro' OR EXISTS (SELECT 1 FROM public.usage_limits WHERE user_id = '11111111-0000-0000-0000-000000000002')
    THEN RAISE EXCEPTION 'Q3 %', r; END IF;
  RAISE NOTICE 'OK Q3 PRO: permitido sin descontar';

  -- Q4: tipo desconocido.
  r := public.consume_free_quota(u, 'otra_cosa');
  IF (r->>'allowed')::boolean OR r->>'reason' <> 'unknown_kind' THEN RAISE EXCEPTION 'Q4 %', r; END IF;
  RAISE NOTICE 'OK Q4 tipo desconocido negado';
END $$;

-- Q5: permisos, solo service_role.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.consume_free_quota(uuid, text)',
    'public.apply_stripe_subscription(uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz)',
    'public.apply_comp_grants_now()', 'public.has_comp_grant(uuid)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'Q5 % ejecutable por cliente', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION 'Q5 % sin service_role', f; END IF;
  END LOOP;
  RAISE NOTICE 'OK Q5 solo service_role puede ejecutar las funciones de pago y cuota';
END $$;

DO $$
DECLARE r jsonb; u uuid := '11111111-0000-0000-0000-000000000003'; t0 timestamptz := '2026-10-01 10:00+00';
  s public.subscriptions%ROWTYPE;
BEGIN
  -- S1: primer evento crea la fila.
  r := public.apply_stripe_subscription(u, 'cus_3', 'sub_A', 'trialing', now() + interval '30 days',
         now() + interval '30 days', false, 'price_1', 'mxn', t0);
  SELECT * INTO s FROM public.subscriptions WHERE user_id = u;
  IF NOT (r->>'applied')::boolean OR s.status <> 'trialing' OR s.currency <> 'MXN' OR s.stripe_event_created <> t0
    THEN RAISE EXCEPTION 'S1 % %', r, s; END IF;
  RAISE NOTICE 'OK S1 evento inicial crea la fila trialing';

  -- S2: evento más nuevo de la misma suscripción se aplica (active).
  r := public.apply_stripe_subscription(u, 'cus_3', 'sub_A', 'active', NULL, now() + interval '30 days', false, 'price_1', 'mxn', t0 + interval '2 hours');
  IF NOT (r->>'applied')::boolean OR (SELECT status FROM public.subscriptions WHERE user_id = u) <> 'active' THEN RAISE EXCEPTION 'S2 %', r; END IF;
  RAISE NOTICE 'OK S2 evento más nuevo se aplica (active)';

  -- S3: un past_due viejo que llega tarde se ignora.
  r := public.apply_stripe_subscription(u, 'cus_3', 'sub_A', 'past_due', NULL, now() + interval '30 days', false, 'price_1', 'mxn', t0 + interval '1 hour');
  IF (r->>'applied')::boolean OR r->>'reason' <> 'stale_event' OR (SELECT status FROM public.subscriptions WHERE user_id = u) <> 'active'
    THEN RAISE EXCEPTION 'S3 %', r; END IF;
  RAISE NOTICE 'OK S3 evento viejo (past_due tardío) ignorado; sigue active';

  -- S4: 'deleted' de una suscripción vieja B no le quita PRO a la suscripción viva A.
  r := public.apply_stripe_subscription(NULL, 'cus_3', 'sub_B', 'canceled', NULL, now() - interval '1 day', false, 'price_1', 'mxn', t0 + interval '5 hours');
  IF (r->>'applied')::boolean OR r->>'reason' <> 'other_live_subscription' OR (SELECT stripe_subscription_id FROM public.subscriptions WHERE user_id = u) <> 'sub_A'
    THEN RAISE EXCEPTION 'S4 %', r; END IF;
  RAISE NOTICE 'OK S4 deleted de otra suscripción no toca la viva (búsqueda por customer)';

  -- S5: la propia suscripción A se cancela; después una nueva C (re-suscripción legítima) sí se aplica.
  r := public.apply_stripe_subscription(u, 'cus_3', 'sub_A', 'canceled', NULL, now() + interval '30 days', false, 'price_1', 'mxn', t0 + interval '6 hours');
  IF NOT (r->>'applied')::boolean OR public.is_pro(u) THEN RAISE EXCEPTION 'S5a %', r; END IF;
  r := public.apply_stripe_subscription(u, 'cus_3', 'sub_C', 'active', NULL, now() + interval '30 days', false, 'price_1', 'mxn', t0 - interval '1 day');
  IF NOT (r->>'applied')::boolean OR NOT public.is_pro(u) THEN RAISE EXCEPTION 'S5b %', r; END IF;
  RAISE NOTICE 'OK S5 cancelación propia aplicada; nueva suscripción tras cancelar sí se aplica';

  -- S6: fila comped nunca la pisa Stripe.
  INSERT INTO public.subscriptions (user_id, status, plan) VALUES ('11111111-0000-0000-0000-000000000004', 'comped', 'pro');
  r := public.apply_stripe_subscription('11111111-0000-0000-0000-000000000004', 'cus_4', 'sub_D', 'canceled', NULL, NULL, false, NULL, 'mxn', now());
  IF (r->>'applied')::boolean OR r->>'reason' <> 'comped' OR (SELECT status FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000004') <> 'comped'
    THEN RAISE EXCEPTION 'S6 %', r; END IF;
  RAISE NOTICE 'OK S6 fila comped intacta ante eventos de Stripe';

  -- S7: usuario desconocido / cuenta borrada.
  r := public.apply_stripe_subscription(NULL, 'cus_nadie', 'sub_X', 'active', NULL, NULL, false, NULL, 'mxn', now());
  IF r->>'reason' <> 'unknown_user' THEN RAISE EXCEPTION 'S7a %', r; END IF;
  r := public.apply_stripe_subscription('99999999-0000-0000-0000-000000000000', 'cus_x', 'sub_X', 'active', NULL, NULL, false, NULL, 'mxn', now());
  IF r->>'reason' <> 'user_not_found' THEN RAISE EXCEPTION 'S7b %', r; END IF;
  RAISE NOTICE 'OK S7 usuario desconocido y cuenta borrada no truenan';

  -- S8: suscripción que termina para alguien en comp_grants queda como cortesía.
  INSERT INTO public.comp_grants (email) VALUES ('vuelve@test.mx');
  r := public.apply_stripe_subscription('11111111-0000-0000-0000-000000000005', 'cus_5', 'sub_E', 'active', NULL, now() + interval '9 days', false, NULL, 'mxn', t0);
  IF (SELECT status FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000005') <> 'active' THEN RAISE EXCEPTION 'S8a'; END IF;
  r := public.apply_stripe_subscription('11111111-0000-0000-0000-000000000005', 'cus_5', 'sub_E', 'canceled', NULL, now() + interval '9 days', false, NULL, 'mxn', t0 + interval '1 hour');
  IF r->>'reason' <> 'applied_comped' OR (SELECT status FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000005') <> 'comped'
    OR NOT public.is_pro('11111111-0000-0000-0000-000000000005') THEN RAISE EXCEPTION 'S8b %', r; END IF;
  RAISE NOTICE 'OK S8 al terminar la suscripción pagada, quien está en comp_grants queda comped';
END $$;

DO $$
DECLARE st text;
BEGIN
  -- C1: correo de cortesía sin confirmar no recibe PRO; al confirmar, sí.
  INSERT INTO public.comp_grants (email) VALUES ('nuevo@test.mx'), ('pagador@test.mx'), ('stripe@test.mx');
  INSERT INTO auth.users (id, email) VALUES ('11111111-0000-0000-0000-000000000006', 'Nuevo@Test.mx');
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000006') THEN
    RAISE EXCEPTION 'C1a comped sin confirmar'; END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = '11111111-0000-0000-0000-000000000006';
  SELECT status INTO st FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000006';
  IF st IS DISTINCT FROM 'comped' THEN RAISE EXCEPTION 'C1b %', st; END IF;
  RAISE NOTICE 'OK C1 cortesía solo con correo confirmado';

  -- C2: quien paga una suscripción viva y cambia su correo a uno de cortesía conserva su suscripción.
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('11111111-0000-0000-0000-000000000007', 'otro@test.mx', now());
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end)
    VALUES ('11111111-0000-0000-0000-000000000007', 'active', 'sub_pagado', now() + interval '10 days');
  UPDATE auth.users SET email = 'pagador@test.mx' WHERE id = '11111111-0000-0000-0000-000000000007';
  SELECT status INTO st FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000007';
  IF st <> 'active' THEN RAISE EXCEPTION 'C2 %', st; END IF;
  RAISE NOTICE 'OK C2 la cortesía no pisa una suscripción pagada viva';
END $$;

-- C3: aplicar la lista a cuentas existentes no pisa a quien paga y reporta a quién no se le aplicó.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.apply_comp_grants_now() WHERE result LIKE 'NO aplicado%';
  IF n <> 2 THEN RAISE EXCEPTION 'C3 esperaba 2 no aplicados (pagador, stripe), hubo %', n; END IF;
  IF (SELECT status FROM public.subscriptions WHERE user_id = '11111111-0000-0000-0000-000000000003') <> 'active'
    THEN RAISE EXCEPTION 'C3 pisó una suscripción viva'; END IF;
  RAISE NOTICE 'OK C3 apply_comp_grants_now respeta suscripciones pagadas vivas';
END $$;
