-- Pruebas de IATOS-P1-FREE-01/02 (migración 20261022135000): límites gratuitos con datos reales y
-- reserva → confirmación → liberación del análisis gratuito. Cada bloque truena si algo no cuadra.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('33333333-0000-0000-0000-000000000001', 'gratis@test.mx', now()),
  ('33333333-0000-0000-0000-000000000002', 'activo@test.mx', now()),
  ('33333333-0000-0000-0000-000000000003', 'prueba@test.mx', now()),
  ('33333333-0000-0000-0000-000000000004', 'cortesia@test.mx', now()),
  ('33333333-0000-0000-0000-000000000005', 'analisis@test.mx', now()),
  ('33333333-0000-0000-0000-000000000006', 'abusivo@test.mx', now()),
  ('33333333-0000-0000-0000-000000000007', 'legado@test.mx', now());
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, current_period_end) VALUES
  ('33333333-0000-0000-0000-000000000002', 'active', 'sub_act', now() + interval '20 days'),
  ('33333333-0000-0000-0000-000000000003', 'trialing', 'sub_tri', now() + interval '25 days'),
  ('33333333-0000-0000-0000-000000000004', 'comped', NULL, NULL);

DO $$
DECLARE r jsonb; u uuid := '33333333-0000-0000-0000-000000000001';
  v_renews timestamptz := date_trunc('month', now()) + interval '1 month';
BEGIN
  -- F1: usuario gratis con cupo: permitido, quedan 2.
  r := public.consume_free_quota(u, 'concierge');
  IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 2 OR (r->>'used')::int <> 1 THEN RAISE EXCEPTION 'F1 %', r; END IF;
  RAISE NOTICE 'OK F1 gratis con cupo: permitido (usado 1 de 3)';
  -- F2: último mensaje permitido.
  r := public.consume_free_quota(u, 'concierge');
  r := public.consume_free_quota(u, 'concierge');
  IF NOT (r->>'allowed')::boolean OR (r->>'remaining')::int <> 0 THEN RAISE EXCEPTION 'F2 %', r; END IF;
  RAISE NOTICE 'OK F2 tercer mensaje (el último) permitido, quedan 0';
  -- F3: primer mensaje después del límite, con datos reales para el aviso.
  r := public.consume_free_quota(u, 'concierge');
  IF (r->>'allowed')::boolean OR r->>'reason' <> 'quota_exceeded' OR (r->>'limit')::int <> 3 OR (r->>'used')::int <> 3
     OR (r->>'renews_at')::timestamptz <> v_renews THEN RAISE EXCEPTION 'F3 %', r; END IF;
  RAISE NOTICE 'OK F3 cuarto mensaje negado: limit=3 used=3 renews_at=%', r->>'renews_at';
  -- F8: mes nuevo reinicia.
  UPDATE public.usage_limits SET concierge_period = '2000-01' WHERE user_id = u;
  r := public.consume_free_quota(u, 'concierge');
  IF NOT (r->>'allowed')::boolean OR (r->>'used')::int <> 1 THEN RAISE EXCEPTION 'F8 %', r; END IF;
  RAISE NOTICE 'OK F8 mes nuevo: el contador se reinicia (usado 1 de 3)';
END $$;

DO $$
DECLARE r jsonb; u uuid;
BEGIN
  -- F5/F6/F7: PRO activo, prueba y cortesía no gastan cupo, ni en concierge ni en análisis.
  FOREACH u IN ARRAY ARRAY['33333333-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000003',
                           '33333333-0000-0000-0000-000000000004']::uuid[] LOOP
    FOR i IN 1..5 LOOP
      r := public.consume_free_quota(u, 'concierge');
      IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'F5-7 concierge % %', u, r; END IF;
    END LOOP;
    r := public.reserve_quota(u, 'trip_analysis', 'c:pro-' || u);
    IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'F5-7 reserve % %', u, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid, gen_random_uuid());
    r := public.reserve_quota(u, 'trip_analysis', 'c:pro2-' || u);
    IF r->>'reason' <> 'pro' THEN RAISE EXCEPTION 'F5-7 segundo análisis % %', u, r; END IF;
    PERFORM public.release_quota((r->>'reservation_id')::uuid, 'test');
    IF COALESCE((SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u), 0) <> 0 THEN
      RAISE EXCEPTION 'F5-7 PRO gastó cupo gratuito %', u; END IF;
  END LOOP;
  RAISE NOTICE 'OK F5 PRO activo, F6 en prueba, F7 cortesía: ilimitado y sin gastar el cupo gratuito';
END $$;

DO $$
DECLARE r jsonb; r2 jsonb; u uuid := '33333333-0000-0000-0000-000000000005'; v_id uuid; v_trip uuid := gen_random_uuid();
BEGIN
  -- R1: un fallo (timeout, 500, IA, datos insuficientes, parcial o guardado) libera: no se pierde el análisis.
  r := public.reserve_quota(u, 'trip_analysis', 'c:intento-1');
  IF r->>'reason' <> 'reserved' THEN RAISE EXCEPTION 'R1a %', r; END IF;
  r2 := public.release_quota((r->>'reservation_id')::uuid, 'ai_provider_error');
  IF NOT (r2->>'released')::boolean OR (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 0
    THEN RAISE EXCEPTION 'R1b %', r2; END IF;
  RAISE NOTICE 'OK R1 análisis fallido liberado: contador sigue en 0';

  -- R2: reintento con la misma llave tras el fallo reutiliza la fila (attempts=2).
  r := public.reserve_quota(u, 'trip_analysis', 'c:intento-1');
  IF r->>'reason' <> 'reserved' OR (SELECT attempts FROM public.quota_reservations WHERE id = (r->>'reservation_id')::uuid) <> 2
    THEN RAISE EXCEPTION 'R2 %', r; END IF;
  v_id := (r->>'reservation_id')::uuid;
  RAISE NOTICE 'OK R2 reintento con la misma llave reutiliza la reserva';

  -- R3: doble clic (misma llave mientras corre) → in_progress, sin segunda reserva.
  r := public.reserve_quota(u, 'trip_analysis', 'c:intento-1');
  IF r->>'reason' <> 'in_progress' THEN RAISE EXCEPTION 'R3 %', r; END IF;
  -- R4: otra petición simultánea con otra llave → in_progress (el cupo ya está apartado).
  r := public.reserve_quota(u, 'trip_analysis', 'c:otra-pestana');
  IF r->>'reason' <> 'in_progress' THEN RAISE EXCEPTION 'R4 %', r; END IF;
  RAISE NOTICE 'OK R3 doble clic y R4 petición simultánea: in_progress, una sola reserva viva';

  -- R5: confirmación al guardar el viaje; contador = 1; get_access_state lo ve.
  r := public.commit_quota(v_id, v_trip);
  IF NOT (r->>'committed')::boolean OR (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 1
    THEN RAISE EXCEPTION 'R5 %', r; END IF;
  IF (public.get_access_state(u)->>'trips_remaining')::int <> 0 THEN RAISE EXCEPTION 'R5 access_state'; END IF;
  RAISE NOTICE 'OK R5 confirmado: trips_analyzed_used=1 y get_access_state.trips_remaining=0';

  -- R6: respuesta perdida → reintento (o recarga) con la misma llave devuelve el viaje guardado sin cobrar.
  r := public.reserve_quota(u, 'trip_analysis', 'c:intento-1');
  IF r->>'reason' <> 'replay' OR (r->>'trip_id')::uuid <> v_trip
     OR (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'R6 %', r; END IF;
  RAISE NOTICE 'OK R6 reintento tras conexión perdida devuelve el viaje guardado (sin cobrar de nuevo)';

  -- R7: error después de completar: liberar una reserva confirmada no hace nada; confirmar dos veces tampoco.
  r := public.release_quota(v_id, 'error_despues');
  r2 := public.commit_quota(v_id, v_trip);
  IF (r->>'released')::boolean OR r2->>'reason' <> 'already_committed'
     OR (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'R7 % %', r, r2; END IF;
  RAISE NOTICE 'OK R7 error tras completar no deshace ni duplica el cobro';

  -- F4: análisis de una sola vez agotado → quota_exceeded con limit 1, used 1 y sin renovación.
  r := public.reserve_quota(u, 'trip_analysis', 'c:nuevo');
  IF r->>'reason' <> 'quota_exceeded' OR (r->>'limit')::int <> 1 OR (r->>'used')::int <> 1 OR r->'renews_at' <> 'null'::jsonb
    THEN RAISE EXCEPTION 'F4 %', r; END IF;
  RAISE NOTICE 'OK F4 análisis de una sola vez agotado: limit=1 used=1 renews_at=null';

  -- R8: llave derivada ('d:') ya confirmada no devuelve el viaje viejo: cuenta como análisis nuevo (aquí negado).
  r := public.reserve_quota(u, 'trip_analysis', 'd:x');
  IF r->>'reason' <> 'quota_exceeded' THEN RAISE EXCEPTION 'R8 %', r; END IF;
  RAISE NOTICE 'OK R8 llave derivada sin repetición de viaje viejo';
END $$;

DO $$
DECLARE r jsonb; u uuid := '33333333-0000-0000-0000-000000000006'; n int;
BEGIN
  -- R9: abuso con llaves nuevas: una sola reserva viva, una sola confirmación.
  r := public.reserve_quota(u, 'trip_analysis', 'c:k0');
  FOR i IN 1..20 LOOP
    IF public.reserve_quota(u, 'trip_analysis', 'c:k' || i)->>'allowed' = 'true' THEN RAISE EXCEPTION 'R9 reserva extra %', i; END IF;
  END LOOP;
  PERFORM public.commit_quota((r->>'reservation_id')::uuid, gen_random_uuid());
  FOR i IN 21..30 LOOP
    IF public.reserve_quota(u, 'trip_analysis', 'c:k' || i)->>'reason' <> 'quota_exceeded' THEN RAISE EXCEPTION 'R9 tras commit %', i; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.quota_reservations WHERE user_id = u AND status = 'COMMITTED';
  IF n <> 1 OR (SELECT trips_analyzed_used FROM public.usage_limits WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'R9 commits=%', n; END IF;
  RAISE NOTICE 'OK R9 30 llaves nuevas: 1 reserva viva, 1 confirmación';

  -- R10: PRO con muchas reservas vivas: tope de 3.
  FOR i IN 1..3 LOOP
    IF public.reserve_quota('33333333-0000-0000-0000-000000000002', 'trip_analysis', 'c:p' || i)->>'reason' <> 'pro' THEN RAISE EXCEPTION 'R10 %', i; END IF;
  END LOOP;
  IF public.reserve_quota('33333333-0000-0000-0000-000000000002', 'trip_analysis', 'c:p4')->>'reason' <> 'too_many_in_progress'
    THEN RAISE EXCEPTION 'R10 tope'; END IF;
  RAISE NOTICE 'OK R10 PRO: máximo 3 análisis en curso a la vez';
END $$;

DO $$
DECLARE r jsonb; u uuid := '33333333-0000-0000-0000-000000000007';
BEGIN
  -- R11: una reserva que nunca se confirma (la función se cayó) caduca a los 10 minutos y el cupo regresa.
  r := public.reserve_quota(u, 'trip_analysis', 'c:caida');
  UPDATE public.quota_reservations SET expires_at = now() - interval '1 second' WHERE id = (r->>'reservation_id')::uuid;
  r := public.reserve_quota(u, 'trip_analysis', 'c:despues');
  IF r->>'reason' <> 'reserved' OR (SELECT status FROM public.quota_reservations WHERE request_key = 'c:caida' AND user_id = u) <> 'EXPIRED'
    THEN RAISE EXCEPTION 'R11 %', r; END IF;
  PERFORM public.release_quota((r->>'reservation_id')::uuid, 'test');
  RAISE NOTICE 'OK R11 reserva caída caduca y no quema el beneficio';

  -- R12: uso registrado antes de esta migración (trips_analyzed_used=1 sin reservas) sigue contando.
  UPDATE public.usage_limits SET trips_analyzed_used = 1 WHERE user_id = u;
  IF public.reserve_quota(u, 'trip_analysis', 'c:legado')->>'reason' <> 'quota_exceeded' THEN RAISE EXCEPTION 'R12'; END IF;
  RAISE NOTICE 'OK R12 el uso anterior a la migración se respeta';
END $$;

DO $$
DECLARE r jsonb; u uuid; v_renews timestamptz := date_trunc('month', now()) + interval '1 month';
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('33333333-0000-0000-0000-000000000008', 'chat@test.mx', now());
  u := '33333333-0000-0000-0000-000000000008';
  -- M1: la pregunta "¿de qué viaje hablas?" (o un error del modelo) libera el mensaje: no cuenta.
  r := public.reserve_quota(u, 'concierge', 's:aclaracion');
  PERFORM public.release_quota((r->>'reservation_id')::uuid, 'trip_clarification');
  IF (SELECT concierge_messages_used FROM public.usage_limits WHERE user_id = u) <> 0 THEN RAISE EXCEPTION 'M1'; END IF;
  RAISE NOTICE 'OK M1 aclaración de viaje / error del modelo no gasta mensaje gratis';
  -- M2: tres respuestas reales cuentan; la cuarta se niega con datos de renovación.
  FOR i IN 1..3 LOOP
    r := public.reserve_quota(u, 'concierge', 's:m' || i);
    IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'M2 % %', i, r; END IF;
    PERFORM public.commit_quota((r->>'reservation_id')::uuid);
  END LOOP;
  r := public.reserve_quota(u, 'concierge', 's:m4');
  IF r->>'reason' <> 'quota_exceeded' OR r->>'quota' <> 'concierge_monthly' OR (r->>'used')::int <> 3
     OR (r->>'renews_at')::timestamptz <> v_renews THEN RAISE EXCEPTION 'M2b %', r; END IF;
  IF (public.get_access_state(u)->>'concierge_remaining')::int <> 0 THEN RAISE EXCEPTION 'M2 access'; END IF;
  RAISE NOTICE 'OK M2 3 respuestas cuentan; la 4a: quota_exceeded concierge_monthly renews_at=%', r->>'renews_at';
  -- M3: mes nuevo con reserva/commit reinicia el contador.
  UPDATE public.usage_limits SET concierge_period = '2000-01' WHERE user_id = u;
  r := public.reserve_quota(u, 'concierge', 's:m5');
  PERFORM public.commit_quota((r->>'reservation_id')::uuid);
  IF (SELECT concierge_messages_used FROM public.usage_limits WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'M3'; END IF;
  RAISE NOTICE 'OK M3 mes nuevo: contador reiniciado a 1';
  -- M4: PRO no cuenta mensajes.
  r := public.reserve_quota('33333333-0000-0000-0000-000000000002', 'concierge', 's:pro');
  PERFORM public.commit_quota((r->>'reservation_id')::uuid);
  IF r->>'reason' <> 'pro' OR COALESCE((SELECT concierge_messages_used FROM public.usage_limits WHERE user_id = '33333333-0000-0000-0000-000000000002'), 0) <> 0
    THEN RAISE EXCEPTION 'M4 %', r; END IF;
  RAISE NOTICE 'OK M4 PRO: mensajes sin contar';
END $$;

-- F10: el cliente no puede saltarse el límite: ni ejecutar las funciones ni escribir los contadores.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.reserve_quota(uuid, text, text)', 'public.commit_quota(uuid, uuid, jsonb)',
                           'public.release_quota(uuid, text)', 'public.consume_free_quota(uuid, text)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'F10 % ejecutable por cliente', f; END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.quota_reservations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.quota_reservations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.usage_limits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.usage_limits', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.usage_limits', 'DELETE') THEN
    RAISE EXCEPTION 'F10 cliente puede escribir contadores'; END IF;
  RAISE NOTICE 'OK F10 sin acceso del cliente a reservas, contadores ni funciones de cuota';
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000005', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.reserve_quota('33333333-0000-0000-0000-000000000005', 'trip_analysis', 'c:directo');
    RAISE EXCEPTION 'F10 llamada directa permitida';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.usage_limits SET trips_analyzed_used = 0 WHERE user_id = '33333333-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'F10 reset directo permitido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK F10 llamada directa como usuario autenticado: permission denied';
END $$;
RESET ROLE;
