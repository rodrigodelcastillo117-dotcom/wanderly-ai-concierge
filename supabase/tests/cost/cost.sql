-- Pruebas de las migraciones del grupo cost (20261022142000-142200) sobre un Postgres desechable.
-- Cada bloque imprime "OK ..." o falla con "ERROR: ...".
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c0570000-0000-0000-0000-000000000001', 'cost-free@test.mx', now()),
  ('c0570000-0000-0000-0000-000000000002', 'cost-trial@test.mx', now()),
  ('c0570000-0000-0000-0000-000000000003', 'cost-pro@test.mx', now()),
  ('c0570000-0000-0000-0000-000000000004', 'cost-admin@test.mx', now()),
  ('c0570000-0000-0000-0000-000000000005', 'cost-nofila@test.mx', now());
INSERT INTO public.subscriptions (user_id, status, trial_end, current_period_end) VALUES
  ('c0570000-0000-0000-0000-000000000002', 'trialing', now() + interval '30 days', now() + interval '30 days');
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end) VALUES
  ('c0570000-0000-0000-0000-000000000003', 'active', 'sub_cost', now() + interval '20 days');
INSERT INTO public.admins (user_id) VALUES ('c0570000-0000-0000-0000-000000000004');

-- K1: serp_cache y sus funciones son solo del servidor.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0570000-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.serp_cache; RAISE EXCEPTION 'K1 authenticated lee serp_cache';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.serp_cache_get(repeat('a', 64)); RAISE EXCEPTION 'K1 authenticated usa serp_cache_get';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.live_search_take('c0570000-0000-0000-0000-000000000001', 1); RAISE EXCEPTION 'K1 authenticated usa live_search_take';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.ai_usage_log (function, provider) VALUES ('x', 'y'); RAISE EXCEPTION 'K1 authenticated inserta en ai_usage_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.serp_burn_rate(7); RAISE EXCEPTION 'K1 authenticated usa serp_burn_rate';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.claim_price_watches(10, interval '0'); RAISE EXCEPTION 'K1 authenticated reclama alertas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK K1 serp_cache, ai_usage_log (insertar), live_search_*, serp_burn_rate y claim_price_watches: solo service_role';
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.ai_usage_log; RAISE EXCEPTION 'K1b anon lee ai_usage_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_cost_metrics(30); RAISE EXCEPTION 'K1b anon usa admin_cost_metrics';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK K1b anon no lee ai_usage_log ni admin_cost_metrics';
END $$;
RESET ROLE;

-- K2: caché: guarda, lee y cuenta aciertos solo mientras está vigente.
SET ROLE service_role;
DO $$
DECLARE k text := repeat('b', 64); r jsonb;
BEGIN
  PERFORM public.serp_cache_put(k, 'google_flights', '{"best_flights":[{"price":812}]}', 21600);
  r := public.serp_cache_get(k);
  IF r->'response'->'best_flights'->0->>'price' <> '812' OR (r->>'ttl_seconds')::int <> 21600 THEN RAISE EXCEPTION 'K2 %', r; END IF;
  PERFORM public.serp_cache_get(k);
  IF (SELECT hits FROM public.serp_cache WHERE key_hash = k) <> 2 THEN RAISE EXCEPTION 'K2 hits'; END IF;
  UPDATE public.serp_cache SET fetched_at = now() - interval '7 hours' WHERE key_hash = k;
  r := public.serp_cache_get(k); -- vencida: se devuelve (para uso justo) pero no cuenta como acierto
  IF r IS NULL OR (SELECT hits FROM public.serp_cache WHERE key_hash = k) <> 2 THEN RAISE EXCEPTION 'K2 vencida'; END IF;
  IF public.serp_cache_get(repeat('c', 64)) IS NOT NULL THEN RAISE EXCEPTION 'K2 inexistente'; END IF;
  PERFORM public.serp_cache_put(k, 'google_flights', '{"best_flights":[]}', 21600);
  IF (SELECT fetched_at > now() - interval '1 minute' FROM public.serp_cache WHERE key_hash = k) IS NOT TRUE THEN RAISE EXCEPTION 'K2 refresco'; END IF;
  BEGIN PERFORM public.serp_cache_put('NO-ES-HASH', 'google', '{}', 600); RAISE EXCEPTION 'K2 llave inválida aceptada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'OK K2 serp_cache: guarda, lee, cuenta aciertos solo vigentes y refresca fetched_at';
END $$;

-- K3: FREE = 5 búsquedas en vivo al día, tope duro; la devolución libera el cupo.
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000001'; r jsonb;
BEGIN
  FOR i IN 1..5 LOOP
    r := public.live_search_take(u, 1);
    IF NOT (r->>'allowed')::boolean OR r->>'plan' <> 'free' THEN RAISE EXCEPTION 'K3 % %', i, r; END IF;
  END LOOP;
  IF (r->>'remaining')::int <> 0 THEN RAISE EXCEPTION 'K3 remaining %', r; END IF;
  r := public.live_search_take(u, 1);
  IF (r->>'allowed')::boolean OR r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'live_searches_daily'
     OR (r->>'soft')::boolean OR (r->>'limit')::int <> 5 OR (r->>'used')::int <> 5 OR NOT (r->>'upgrade_available')::boolean
     OR (r->>'renews_at')::timestamptz <> date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day' THEN
    RAISE EXCEPTION 'K3 sexta %', r;
  END IF;
  PERFORM public.live_search_refund(u, 'free', 1);
  r := public.live_search_take(u, 1);
  IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'K3 refund %', r; END IF;
  -- Ayer no cuenta para hoy.
  UPDATE public.live_search_usage SET day = day - 1 WHERE user_id = u;
  r := public.live_search_take(u, 1);
  IF NOT (r->>'allowed')::boolean OR (r->>'used')::int <> 1 THEN RAISE EXCEPTION 'K3 día nuevo %', r; END IF;
  RAISE NOTICE 'OK K3 FREE: 5 búsquedas en vivo al día, la 6a negada (live_searches_daily, renueva mañana), la devolución libera cupo';
END $$;

-- K4: prueba sin tarjeta = 30 en total (tope duro, sin renovación).
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000002'; r jsonb;
BEGIN
  IF public.effective_plan(u) <> 'trial' THEN RAISE EXCEPTION 'K4 plan'; END IF;
  INSERT INTO public.live_search_usage (user_id, day, plan, searches) VALUES (u, (now() AT TIME ZONE 'UTC')::date - 3, 'trial', 29);
  r := public.live_search_take(u, 1);
  IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'K4 30a %', r; END IF;
  r := public.live_search_take(u, 1);
  IF (r->>'allowed')::boolean OR r->>'quota' <> 'live_searches_trial' OR (r->>'limit')::int <> 30
     OR r->'renews_at' <> 'null'::jsonb OR NOT (r->>'upgrade_available')::boolean THEN RAISE EXCEPTION 'K4 31a %', r; END IF;
  RAISE NOTICE 'OK K4 prueba: 30 búsquedas en vivo en total, la 31a negada (live_searches_trial, sin renovación)';
END $$;

-- K5: PRO sin pro_limits_enforced: nunca se niega, pero se cuenta. Con el interruptor: 80 al mes,
-- uso justo (soft): se niega con reason fair_use y soft=true (el servidor sirve precios guardados).
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000003'; r jsonb;
BEGIN
  INSERT INTO public.live_search_usage (user_id, day, plan, searches) VALUES (u, (now() AT TIME ZONE 'UTC')::date, 'pro', 200);
  r := public.live_search_take(u, 1);
  IF NOT (r->>'allowed')::boolean OR r->>'plan' <> 'pro' OR r->'limit' <> 'null'::jsonb THEN RAISE EXCEPTION 'K5 sin interruptor %', r; END IF;
  IF (SELECT searches FROM public.live_search_usage WHERE user_id = u) <> 201 THEN RAISE EXCEPTION 'K5 no contó'; END IF;
  UPDATE public.app_flags SET value = 'true' WHERE key = 'pro_limits_enforced';
  r := public.live_search_take(u, 1);
  IF (r->>'allowed')::boolean OR r->>'reason' <> 'fair_use' OR NOT (r->>'soft')::boolean OR (r->>'limit')::int <> 80
     OR r->>'quota' <> 'live_searches_monthly' OR (r->>'upgrade_available')::boolean THEN RAISE EXCEPTION 'K5 uso justo %', r; END IF;
  -- Mes nuevo: el uso del mes pasado no cuenta.
  UPDATE public.live_search_usage SET day = date_trunc('month', now() AT TIME ZONE 'UTC')::date - 1 WHERE user_id = u;
  r := public.live_search_take(u, 1);
  IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 79 THEN RAISE EXCEPTION 'K5 mes nuevo %', r; END IF;
  UPDATE public.app_flags SET value = 'false' WHERE key = 'pro_limits_enforced';
  RAISE NOTICE 'OK K5 PRO: sin interruptor siempre permite y cuenta; con interruptor 80 al mes con uso justo (soft, sin bloquear)';
END $$;

-- K6: si alguien borra el renglón de FREE, sigue en 5 al día (nunca ilimitado).
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000005'; r jsonb; saved public.plan_limits%ROWTYPE;
BEGIN
  SELECT * INTO saved FROM public.plan_limits WHERE plan = 'free' AND kind = 'live_searches';
  DELETE FROM public.plan_limits WHERE plan = 'free' AND kind = 'live_searches';
  FOR i IN 1..5 LOOP PERFORM public.live_search_take(u, 1); END LOOP;
  r := public.live_search_take(u, 1);
  IF (r->>'allowed')::boolean OR (r->>'limit')::int <> 5 THEN RAISE EXCEPTION 'K6 %', r; END IF;
  INSERT INTO public.plan_limits SELECT (saved).*;
  RAISE NOTICE 'OK K6 sin renglón de FREE el tope sigue en 5 al día';
END $$;

-- K7: ai_usage_log: el plan y la fecha los pone la base.
DO $$
BEGIN
  INSERT INTO public.ai_usage_log (user_id, function, provider, model, searches, cost_estimate_usd, plan, created_at) VALUES
    ('c0570000-0000-0000-0000-000000000001', 'flights-search', 'serpapi', 'google_flights', 1, 0.015, 'pro', now() - interval '400 days'),
    ('c0570000-0000-0000-0000-000000000002', 'concierge-chat', 'gemini', 'gemini-flash-latest', 0, 0.013, NULL, NULL),
    ('c0570000-0000-0000-0000-000000000003', 'analizar-viaje', 'anthropic', 'claude-sonnet-5-5', 0, 0.084, NULL, NULL),
    (NULL, 'flight-watch-cron', 'serpapi', 'google', 1, 0.015, NULL, NULL);
  IF (SELECT string_agg(plan, ',' ORDER BY id) FROM public.ai_usage_log) <> 'free,trial,pro,system' THEN
    RAISE EXCEPTION 'K7 planes %', (SELECT string_agg(plan, ',' ORDER BY id) FROM public.ai_usage_log);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_usage_log WHERE created_at < now() - interval '1 minute') THEN RAISE EXCEPTION 'K7 fecha falsa'; END IF;
  RAISE NOTICE 'OK K7 ai_usage_log: plan (free/trial/pro/system) y fecha los pone la base';
END $$;
-- Historial de 7 días para el ritmo de gasto.
UPDATE public.ai_usage_log SET created_at = now() - interval '3 days' WHERE function = 'flight-watch-cron';
INSERT INTO public.ai_usage_log (function, provider, model, searches) SELECT 'price-watch-cron', 'serpapi', 'google_flights', 1 FROM generate_series(1, 4);
DO $$
DECLARE r jsonb := public.serp_burn_rate(7);
BEGIN
  -- 6 búsquedas en 3 días de historia → 2 al día.
  IF (r->>'searches')::int <> 6 OR abs((r->>'avg_per_day')::numeric - 2) > 0.05 THEN RAISE EXCEPTION 'K8 %', r; END IF;
  RAISE NOTICE 'OK K8 serp_burn_rate: % búsquedas, % al día', r->>'searches', r->>'avg_per_day';
END $$;
RESET ROLE;

-- K9: lectura de ai_usage_log y admin_cost_metrics: solo administradores.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0570000-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ai_usage_log) <> 0 THEN RAISE EXCEPTION 'K9 un usuario ve ai_usage_log'; END IF;
  BEGIN PERFORM public.admin_cost_metrics(30); RAISE EXCEPTION 'K9 no admin usa admin_cost_metrics';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'OK K9 un usuario normal no ve ai_usage_log y admin_cost_metrics le responde not_authorized';
END $$;
SELECT set_config('request.jwt.claim.sub', 'c0570000-0000-0000-0000-000000000004', false);
DO $$
DECLARE m jsonb := public.admin_cost_metrics(30);
BEGIN
  IF (SELECT count(*) FROM public.ai_usage_log) <> 8 THEN RAISE EXCEPTION 'K9 admin no ve el registro'; END IF;
  IF (m->'total'->>'searches')::int <> 6 OR (m->'total'->>'calls')::int <> 8
     OR abs((m->'total'->>'cost_usd')::numeric - 0.127) > 0.0001
     OR (SELECT (x->>'cost_usd')::numeric FROM jsonb_array_elements(m->'by_plan') x WHERE x->>'plan' = 'pro') <> 0.084
     OR (SELECT (x->>'searches')::int FROM jsonb_array_elements(m->'by_function') x WHERE x->>'function' = 'price-watch-cron') <> 4
     OR (m->'cache'->>'entries')::int <> 1 THEN
    RAISE EXCEPTION 'K9 métricas %', m;
  END IF;
  RAISE NOTICE 'OK K9 admin: costo de 30 días por plan y por función (total US$%)', m->'total'->>'cost_usd';
END $$;
RESET ROLE;

-- K10: C-01 — (user_id, flight, flight_date) único con NULLS NOT DISTINCT; la migración borra solo
-- duplicados ya inactivos y conserva la fila activa o la más reciente.
SET ROLE service_role;
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000001';
BEGIN
  BEGIN
    INSERT INTO public.tracked_flights (user_id, flight, flight_date, active) VALUES (u, 'AM58', NULL, false), (u, 'AM58', NULL, false);
    RAISE EXCEPTION 'K10 se aceptaron dos filas sin fecha iguales';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO public.tracked_flights (user_id, flight, flight_date) VALUES (u, 'AM58', current_date)
    ON CONFLICT (user_id, flight, flight_date) DO UPDATE SET active = true;
  INSERT INTO public.tracked_flights (user_id, flight, flight_date) VALUES (u, 'AM58', current_date)
    ON CONFLICT (user_id, flight, flight_date) DO UPDATE SET active = true;
  INSERT INTO public.tracked_flights (user_id, flight, flight_date, active) VALUES (u, 'AM58', NULL, false)
    ON CONFLICT (user_id, flight, flight_date) DO UPDATE SET active = false;
  INSERT INTO public.tracked_flights (user_id, flight, flight_date, active) VALUES (u, 'AM58', NULL, false)
    ON CONFLICT (user_id, flight, flight_date) DO UPDATE SET active = false;
  IF (SELECT count(*) FROM public.tracked_flights WHERE user_id = u AND flight = 'AM58') <> 2 THEN RAISE EXCEPTION 'K10 upsert'; END IF;
  RAISE NOTICE 'OK K10 upsert repetido deja 1 fila por (usuario, vuelo, fecha), también sin fecha';
END $$;
RESET ROLE;
-- Estado heredado: duplicados sin fecha (sin la restricción), luego se vuelve a correr la migración.
ALTER TABLE public.tracked_flights DROP CONSTRAINT tracked_flights_user_flight_date_uniq;
INSERT INTO public.tracked_flights (user_id, flight, flight_date, active, created_at) VALUES
  ('c0570000-0000-0000-0000-000000000002', 'Y4100', NULL, false, now() - interval '3 days'),
  ('c0570000-0000-0000-0000-000000000002', 'Y4100', NULL, false, now() - interval '2 days'),
  ('c0570000-0000-0000-0000-000000000002', 'Y4100', NULL, false, now() - interval '1 day'),
  ('c0570000-0000-0000-0000-000000000002', 'IB6400', NULL, true, now() - interval '5 days'),
  ('c0570000-0000-0000-0000-000000000002', 'IB6400', NULL, false, now() - interval '1 day'),
  ('c0570000-0000-0000-0000-000000000002', 'AF179', NULL, false, now() - interval '1 day');
\ir ../../migrations/20261022142100_cost_tracked_flights_unique.sql
DO $$
DECLARE u uuid := 'c0570000-0000-0000-0000-000000000002';
BEGIN
  IF (SELECT count(*) FROM public.tracked_flights WHERE user_id = u AND flight = 'Y4100') <> 1
     OR (SELECT created_at > now() - interval '25 hours' FROM public.tracked_flights WHERE user_id = u AND flight = 'Y4100') IS NOT TRUE THEN
    RAISE EXCEPTION 'K11 Y4100';
  END IF;
  IF (SELECT count(*) FROM public.tracked_flights WHERE user_id = u AND flight = 'IB6400') <> 1
     OR NOT (SELECT active FROM public.tracked_flights WHERE user_id = u AND flight = 'IB6400') THEN RAISE EXCEPTION 'K11 IB6400'; END IF;
  IF (SELECT count(*) FROM public.tracked_flights WHERE user_id = u AND flight = 'AF179') <> 1 THEN RAISE EXCEPTION 'K11 AF179'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_flights_user_flight_date_uniq' AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%') THEN
    RAISE EXCEPTION 'K11 restricción';
  END IF;
  RAISE NOTICE 'OK K11 migración C-01: borra solo duplicados inactivos, conserva la activa o la más reciente y crea UNIQUE NULLS NOT DISTINCT';
END $$;

-- K12: claim_price_watches: reclama las pendientes, apaga las de viajes que ya salieron y no
-- devuelve dos veces la misma dentro del intervalo.
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso) VALUES
  ('c0571000-0000-0000-0000-000000000001', 'c0570000-0000-0000-0000-000000000003', 'Madrid', 1, current_date + 30, current_date + 40),
  ('c0571000-0000-0000-0000-000000000002', 'c0570000-0000-0000-0000-000000000003', 'Roma', 1, current_date + 31, current_date + 41),
  ('c0571000-0000-0000-0000-000000000003', 'c0570000-0000-0000-0000-000000000003', 'Lima', 1, current_date, current_date + 5);
INSERT INTO public.price_watches (user_id, trip_id, origin_iata, destination_iata, departure_date, baseline_price_mxn, last_checked_at) VALUES
  ('c0570000-0000-0000-0000-000000000003', 'c0571000-0000-0000-0000-000000000001', 'MEX', 'MAD', current_date + 30, 15000, now() - interval '13 hours'),
  ('c0570000-0000-0000-0000-000000000003', 'c0571000-0000-0000-0000-000000000002', 'MEX', 'FCO', current_date + 31, 16000, NULL),
  ('c0570000-0000-0000-0000-000000000003', 'c0571000-0000-0000-0000-000000000003', 'MEX', 'LIM', current_date, 9000, NULL);
SET ROLE service_role;
DO $$
DECLARE got text; again int;
BEGIN
  SELECT string_agg(destination_iata, ',' ORDER BY last_checked_at NULLS FIRST) INTO got FROM public.claim_price_watches(40, interval '6 hours');
  IF got <> 'FCO,MAD' THEN RAISE EXCEPTION 'K12 reclamó %', got; END IF;
  IF (SELECT active FROM public.price_watches WHERE destination_iata = 'LIM') THEN RAISE EXCEPTION 'K12 no apagó la de un viaje que ya sale'; END IF;
  SELECT count(*) INTO again FROM public.claim_price_watches(40, interval '6 hours');
  IF again <> 0 THEN RAISE EXCEPTION 'K12 reclamó dos veces'; END IF;
  IF (SELECT count(*) FROM public.claim_price_watches(1, interval '0')) <> 1 THEN RAISE EXCEPTION 'K12 límite'; END IF;
  RAISE NOTICE 'OK K12 claim_price_watches: pendientes primero, apaga viajes que ya salen y no repite dentro del intervalo';
END $$;
RESET ROLE;
