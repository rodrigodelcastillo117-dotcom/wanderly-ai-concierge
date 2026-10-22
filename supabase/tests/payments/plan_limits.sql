-- Pruebas de límites configurables por plan y del interruptor pro_limits_enforced (migración 20261022135100).
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('55555555-0000-0000-0000-000000000001', 'pl-free@test.mx', now()),
  ('55555555-0000-0000-0000-000000000002', 'pl-pro@test.mx', now());
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end)
VALUES ('55555555-0000-0000-0000-000000000002', 'active', 'sub_pl', now() + interval '20 days');

DO $$
DECLARE r jsonb; p uuid := '55555555-0000-0000-0000-000000000002'; s jsonb;
BEGIN
  -- P1: valores sembrados = propuesta; interruptores apagados.
  IF (SELECT count(*) FROM public.plan_limits) < 4 OR public.app_flag('pro_limits_enforced') OR public.app_flag('trial_no_card_enabled')
    THEN RAISE EXCEPTION 'P1 semilla'; END IF;
  IF (SELECT limit_value FROM public.plan_limits WHERE plan='pro' AND kind='concierge') <> 100
     OR (SELECT limit_value FROM public.plan_limits WHERE plan='pro' AND kind='trip_analysis') <> 10 THEN RAISE EXCEPTION 'P1 pro'; END IF;
  RAISE NOTICE 'OK P1 semilla propuesta (FREE 3/1, PRO 100/10) e interruptores apagados';

  -- P2: interruptor apagado = producción hoy: PRO sin límites (12 análisis, 105 mensajes).
  FOR i IN 1..12 LOOP
    r := public.reserve_quota(p, 'trip_analysis', 'c:pa' || i);
    IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'P2 análisis % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid, gen_random_uuid());
  END LOOP;
  FOR i IN 1..105 LOOP
    r := public.reserve_quota(p, 'concierge', 's:pm' || i);
    IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'P2 mensaje % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid);
  END LOOP;
  s := public.get_access_state(p);
  IF s->'concierge_limit' <> 'null'::jsonb OR s->'trips_limit' <> 'null'::jsonb OR (s->>'limits_enforced')::boolean
    THEN RAISE EXCEPTION 'P2 access %', s; END IF;
  RAISE NOTICE 'OK P2 interruptor apagado: PRO ilimitado (12 análisis y 105 mensajes); access_state sin límites';

  -- P3: interruptor encendido: PRO llega a 10 análisis / 100 mensajes del mes, sin oferta de upgrade.
  UPDATE public.app_flags SET value = 'true' WHERE key = 'pro_limits_enforced';
  r := public.reserve_quota(p, 'trip_analysis', 'c:pa13');
  IF r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'trip_analysis_monthly' OR (r->>'limit')::int <> 10
     OR (r->>'used')::int <> 12 OR (r->>'upgrade_available')::boolean OR r->>'renews_at' IS NULL THEN RAISE EXCEPTION 'P3a %', r; END IF;
  r := public.reserve_quota(p, 'concierge', 's:pm106');
  IF r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'concierge_monthly' OR (r->>'limit')::int <> 100
     OR (r->>'upgrade_available')::boolean THEN RAISE EXCEPTION 'P3b %', r; END IF;
  s := public.get_access_state(p);
  IF (s->>'trips_limit')::int <> 10 OR (s->>'trips_remaining')::int <> 0 OR (s->>'concierge_limit')::int <> 100 OR s->>'trips_period' <> 'month'
    THEN RAISE EXCEPTION 'P3 access %', s; END IF;
  RAISE NOTICE 'OK P3 interruptor encendido: PRO limitado a 10/100 al mes, quota *_monthly y upgrade_available=false';

  -- P4: mes siguiente: el uso de PRO se cuenta por mes (renueva).
  UPDATE public.quota_reservations SET committed_at = committed_at - interval '40 days' WHERE user_id = p;
  r := public.reserve_quota(p, 'trip_analysis', 'c:pa14');
  IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'P4 %', r; END IF;
  PERFORM public.release_quota((r->>'reservation_id')::uuid, 'test');
  RAISE NOTICE 'OK P4 PRO: uso del mes anterior no cuenta';
  UPDATE public.app_flags SET value = 'false' WHERE key = 'pro_limits_enforced';
END $$;

DO $$
DECLARE r jsonb; u uuid := '55555555-0000-0000-0000-000000000001'; s jsonb;
BEGIN
  -- P5: el dueño cambia el límite gratuito (sin desplegar): 5 mensajes.
  UPDATE public.plan_limits SET limit_value = 5 WHERE plan = 'free' AND kind = 'concierge';
  FOR i IN 1..5 LOOP
    r := public.reserve_quota(u, 'concierge', 's:f' || i);
    IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'P5 % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid);
  END LOOP;
  r := public.reserve_quota(u, 'concierge', 's:f6');
  IF r->>'reason' <> 'quota_exceeded' OR (r->>'limit')::int <> 5 OR NOT (r->>'upgrade_available')::boolean THEN RAISE EXCEPTION 'P5b %', r; END IF;
  s := public.get_access_state(u);
  IF (s->>'concierge_limit')::int <> 5 OR (s->>'concierge_remaining')::int <> 0 THEN RAISE EXCEPTION 'P5 access %', s; END IF;
  RAISE NOTICE 'OK P5 límite gratuito leído de plan_limits (5), también en get_access_state';

  -- P6: NULL = ilimitado (a propósito); fila borrada = valores de siempre (nunca ilimitado por error).
  UPDATE public.plan_limits SET limit_value = NULL WHERE plan = 'free' AND kind = 'concierge';
  IF NOT (public.reserve_quota(u, 'concierge', 's:f7')->>'allowed')::boolean THEN RAISE EXCEPTION 'P6a'; END IF;
  DELETE FROM public.plan_limits WHERE plan = 'free' AND kind = 'concierge';
  r := public.reserve_quota(u, 'concierge', 's:f8');
  IF r->>'reason' <> 'quota_exceeded' OR (r->>'limit')::int <> 3 THEN RAISE EXCEPTION 'P6b %', r; END IF;
  INSERT INTO public.plan_limits (plan, kind, period, limit_value, note) VALUES ('free', 'concierge', 'month', 3, 'RECOMENDADO: mensajes de Iato al mes');
  RAISE NOTICE 'OK P6 NULL = ilimitado; sin fila se usa el límite de siempre (3)';

  -- P7: el cliente no puede leer ni cambiar límites ni interruptores.
  IF has_table_privilege('authenticated', 'public.plan_limits', 'SELECT') OR has_table_privilege('authenticated', 'public.app_flags', 'UPDATE')
     OR has_function_privilege('authenticated', 'public.app_flag(text)', 'EXECUTE') THEN RAISE EXCEPTION 'P7'; END IF;
  RAISE NOTICE 'OK P7 límites e interruptores solo para el servidor';
END $$;
