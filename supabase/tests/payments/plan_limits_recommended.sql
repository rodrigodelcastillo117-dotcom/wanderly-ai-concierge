-- Pruebas de la migración 20261022135300: is_pro sin pruebas eternas, valores recomendados,
-- plan de prueba sin tarjeta, tope diario de PRO y plan_limit().
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('77777777-0000-0000-0000-000000000001', 'rec-trial-null@test.mx', now()),
  ('77777777-0000-0000-0000-000000000002', 'rec-active-null@test.mx', now()),
  ('77777777-0000-0000-0000-000000000003', 'rec-trial@test.mx', now()),
  ('77777777-0000-0000-0000-000000000004', 'rec-pro@test.mx', now()),
  ('77777777-0000-0000-0000-000000000005', 'rec-free@test.mx', now());

DO $$
DECLARE r jsonb; t uuid := '77777777-0000-0000-0000-000000000003'; p uuid := '77777777-0000-0000-0000-000000000004';
BEGIN
  -- L1: 'trialing' sin fecha de fin ya no es PRO para siempre.
  -- r2 (D-P3-1 / N-06): 'active' de Stripe sin fecha de fin TAMPOCO es PRO indefinido (antes sí).
  INSERT INTO public.subscriptions (user_id, status, current_period_end) VALUES ('77777777-0000-0000-0000-000000000001', 'trialing', NULL);
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end) VALUES ('77777777-0000-0000-0000-000000000002', 'active', 'sub_x', NULL);
  IF public.is_pro('77777777-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'L1 trialing NULL sigue PRO'; END IF;
  IF public.is_pro('77777777-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'L1 active de Stripe sin fecha sigue PRO indefinido'; END IF;
  RAISE NOTICE 'OK L1 trialing y active de Stripe sin current_period_end ya no son PRO';

  -- L2: valores recomendados sembrados (todos los tipos y planes).
  IF (SELECT count(*) FROM public.plan_limits WHERE note LIKE 'RECOMENDADO%') <> 15
     OR (SELECT daily_limit FROM public.plan_limits WHERE plan = 'pro' AND kind = 'concierge') <> 20
     OR (SELECT daily_limit FROM public.plan_limits WHERE plan = 'pro' AND kind = 'trip_analysis') <> 3
     OR NOT (SELECT soft FROM public.plan_limits WHERE plan = 'pro' AND kind = 'live_searches')
     OR (SELECT limit_value FROM public.plan_limits WHERE plan = 'trial' AND kind = 'concierge') <> 50
     OR EXISTS (SELECT 1 FROM public.plan_limits WHERE kind = 'price_alerts') THEN RAISE EXCEPTION 'L2'; END IF;
  RAISE NOTICE 'OK L2 valores recomendados sembrados (FREE/PRO/TRIAL, 5 tipos)';

  -- L3: prueba sin tarjeta = plan 'trial' con 5 análisis para los 30 días (aunque PRO siga sin límites).
  INSERT INTO public.subscriptions (user_id, status, trial_end, current_period_end)
  VALUES (t, 'trialing', now() + interval '30 days', now() + interval '30 days');
  IF public.effective_plan(t) <> 'trial' THEN RAISE EXCEPTION 'L3 plan'; END IF;
  FOR i IN 1..5 LOOP
    r := public.reserve_quota(t, 'trip_analysis', 'c:t' || i);
    IF NOT (r->>'allowed')::boolean OR r->>'plan' <> 'trial' THEN RAISE EXCEPTION 'L3 % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid, gen_random_uuid());
  END LOOP;
  r := public.reserve_quota(t, 'trip_analysis', 'c:t6');
  IF r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'trip_analysis_trial' OR (r->>'limit')::int <> 5
     OR NOT (r->>'upgrade_available')::boolean OR r->'renews_at' <> 'null'::jsonb THEN RAISE EXCEPTION 'L3b %', r; END IF;
  IF (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = t) <> 0 THEN RAISE EXCEPTION 'L3 gastó cupo gratuito'; END IF;
  IF (public.get_access_state(t)->>'plan') <> 'trial' OR (public.get_access_state(t)->>'trips_limit')::int <> 5 THEN RAISE EXCEPTION 'L3 access'; END IF;
  RAISE NOTICE 'OK L3 prueba sin tarjeta: 5 análisis en los 30 días, quota trip_analysis_trial, puede contratar PRO';

  -- L4: una prueba de Stripe (con tarjeta) es PRO, no 'trial'.
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, trial_end, current_period_end)
  VALUES (p, 'trialing', 'sub_card', now() + interval '30 days', now() + interval '30 days');
  IF public.effective_plan(p) <> 'pro' THEN RAISE EXCEPTION 'L4'; END IF;
  RAISE NOTICE 'OK L4 prueba de Stripe con tarjeta cuenta como PRO';

  -- L5: con pro_limits_enforced, tope diario de 3 análisis aunque el mes tenga cupo; sin oferta de PRO.
  UPDATE public.app_flags SET value = 'true' WHERE key = 'pro_limits_enforced';
  FOR i IN 1..3 LOOP
    r := public.reserve_quota(p, 'trip_analysis', 'c:d' || i);
    IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'L5 % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid, gen_random_uuid());
  END LOOP;
  r := public.reserve_quota(p, 'trip_analysis', 'c:d4');
  IF r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'trip_analysis_daily' OR (r->>'limit')::int <> 3
     OR (r->>'upgrade_available')::boolean OR (r->>'renews_at')::timestamptz <> date_trunc('day', now()) + interval '1 day'
    THEN RAISE EXCEPTION 'L5b %', r; END IF;
  -- Al día siguiente vuelve a poder.
  UPDATE public.quota_reservations SET committed_at = committed_at - interval '1 day' WHERE user_id = p;
  IF NOT (public.reserve_quota(p, 'trip_analysis', 'c:d5')->>'allowed')::boolean THEN RAISE EXCEPTION 'L5c'; END IF;
  UPDATE public.app_flags SET value = 'false' WHERE key = 'pro_limits_enforced';
  RAISE NOTICE 'OK L5 PRO con interruptor: máx. 3 análisis al día (trip_analysis_daily, renueva mañana)';

  -- L6: plan_limit() expone los tipos que aún no se aplican.
  r := public.plan_limit('77777777-0000-0000-0000-000000000005', 'price_watches');
  IF r->>'plan' <> 'free' OR (r->>'limit')::int <> 0 OR r->>'period' <> 'active' THEN RAISE EXCEPTION 'L6a %', r; END IF;
  r := public.plan_limit(p, 'live_searches');
  IF r->>'plan' <> 'pro' OR (r->>'enforced')::boolean OR r->'limit' <> 'null'::jsonb OR NOT (r->>'soft')::boolean THEN RAISE EXCEPTION 'L6b %', r; END IF;
  r := public.plan_limit(t, 'tracked_flights');
  IF (r->>'limit')::int <> 2 THEN RAISE EXCEPTION 'L6c %', r; END IF;
  IF has_function_privilege('authenticated', 'public.plan_limit(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'L6 cliente'; END IF;
  RAISE NOTICE 'OK L6 plan_limit(): free price_watches=0, pro live_searches suave y sin aplicar, trial tracked_flights=2';

  -- L7: lo que el dueño editó a mano no lo pisa una nueva corrida de la siembra.
  UPDATE public.plan_limits SET limit_value = 7, note = 'Aprobado por el dueño' WHERE plan = 'free' AND kind = 'live_searches';
END $$;
