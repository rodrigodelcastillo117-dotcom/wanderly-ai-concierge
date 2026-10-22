-- Pruebas de las migraciones de operación (2026102213xxxx) sobre un Postgres local desechable.
-- Uso: supabase/tests/ops/run.sh. Cada caso imprime "T<n> <qué> [<esperado>]: <observado>"; run.sh lo
-- convierte en OK/FALLA (t_brackets de ../lib.sh). Antes solo se imprimía el valor y había que comparar
-- los corchetes a mano: un GRANT de más (T1) no hacía fallar nada (P2-QA-2).
\pset footer off
\pset tuples_only on
\set u '\'11111111-0000-0000-0000-000000000001\''
TRUNCATE public.tracked_flights;
DELETE FROM public.notifications WHERE user_id = :u;

-- Vuelos de prueba (fechas relativas a "hoy" en UTC). "flight" sirve de nombre del caso.
INSERT INTO public.tracked_flights (user_id, flight, flight_date, last_attempt_at, consecutive_failures, arrival_at, departure_at) VALUES
 (:u, 'HOY_NUNCA',        (now() AT TIME ZONE 'UTC')::date,      NULL,                          0, NULL, NULL),
 (:u, 'AYER_20MIN',       (now() AT TIME ZONE 'UTC')::date - 1,  now() - interval '20 minutes', 0, NULL, NULL),
 (:u, 'MANANA_5MIN',      (now() AT TIME ZONE 'UTC')::date + 1,  now() - interval '5 minutes',  0, NULL, NULL),
 (:u, 'EN2DIAS_2H',       (now() AT TIME ZONE 'UTC')::date + 2,  now() - interval '2 hours',    0, NULL, NULL),
 (:u, 'EN3DIAS_4H',       (now() AT TIME ZONE 'UTC')::date + 3,  now() - interval '4 hours',    0, NULL, NULL),
 (:u, 'EN10DIAS_5H',      (now() AT TIME ZONE 'UTC')::date + 10, now() - interval '5 hours',    0, NULL, NULL),
 (:u, 'EN10DIAS_7H',      (now() AT TIME ZONE 'UTC')::date + 10, now() - interval '7 hours',    0, NULL, NULL),
 (:u, 'SIN_FECHA',        NULL,                                  NULL,                          0, NULL, NULL),
 (:u, 'ANTIER',           (now() AT TIME ZONE 'UTC')::date - 2,  NULL,                          0, NULL, NULL),
 (:u, 'YA_LLEGO_HACE_4H', (now() AT TIME ZONE 'UTC')::date,      NULL,                          0, now() - interval '4 hours', NULL),
 (:u, 'HOY_3FALLAS_20MIN',(now() AT TIME ZONE 'UTC')::date,      now() - interval '20 minutes', 3, NULL, NULL),
 (:u, 'SALE_EN_10H_20MIN', (now() AT TIME ZONE 'UTC')::date + 1, now() - interval '20 minutes', 0, NULL, now() + interval '10 hours'),
 (:u, 'SALE_EN_10H_70MIN', (now() AT TIME ZONE 'UTC')::date + 1, now() - interval '70 minutes', 0, NULL, now() + interval '10 hours'),
 (:u, 'HOY_SALE_EN_2H_20MIN', (now() AT TIME ZONE 'UTC')::date, now() - interval '20 minutes', 0, NULL, now() + interval '2 hours');

-- T1 y T2: authenticated no puede reclamar vuelos ni usar las funciones internas de cron.
SET ROLE authenticated;
DO $$ DECLARE n bigint; BEGIN
  SELECT count(*) INTO n FROM public.claim_tracked_flights(50);
  RAISE NOTICE 'T1 authenticated no puede reclamar vuelos [permission denied]: reclamó %', n;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T1 authenticated no puede reclamar vuelos [permission denied]: permission denied'; END $$;
DO $$ DECLARE denied int := 0; BEGIN
  BEGIN PERFORM public.notify_once('11111111-0000-0000-0000-000000000001', 'x', 't', 'b', NULL, 'k'); EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1; END;
  BEGIN PERFORM public.cron_health(); EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1; END;
  BEGIN PERFORM public.verify_cron_secret(repeat('a', 40)); EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1; END;
  RAISE NOTICE 'T2 authenticated no puede usar notify_once / cron_health / verify_cron_secret [3 negadas]: % negadas', denied;
END $$;
RESET ROLE;

-- T3: service_role reclama solo los pendientes, primero la ventana de ±1 día; no SALE_EN_10H_20MIN
-- (sale en >6 h: se reclama cada hora).
SET ROLE service_role;
SELECT 'T3 service_role reclama solo los pendientes, primero la ventana de ±1 día [AYER_20MIN, HOY_NUNCA, HOY_SALE_EN_2H_20MIN, SALE_EN_10H_70MIN, EN10DIAS_7H, EN3DIAS_4H]: '
  || coalesce(string_agg(flight, ', ' ORDER BY (flight_date > (now() AT TIME ZONE 'UTC')::date + 1), flight), '(nada)')
  FROM public.claim_tracked_flights(50);
RESET ROLE;
SELECT 'T4 se apagaron sin fecha, fecha pasada y llegada hace >3 h [ANTIER, SIN_FECHA, YA_LLEGO_HACE_4H]: '
  || coalesce(string_agg(flight, ', ' ORDER BY flight), '(nada)') FROM public.tracked_flights WHERE NOT active;
SELECT count(*) AS t5a FROM public.tracked_flights WHERE last_attempt_at > now() - interval '1 minute' \gset
SET ROLE service_role;
SELECT count(*) AS t5b FROM public.claim_tracked_flights(50) \gset
RESET ROLE;
SELECT 'T5 los reclamados quedan con last_attempt_at = ahora y no se vuelven a reclamar [6|0]: ' || :'t5a' || '|' || :'t5b';
-- T6: con límite 2 gana la ventana de ±1 día: AYER_20MIN (la fecha más temprana) y uno de hoy.
UPDATE public.tracked_flights SET last_attempt_at = NULL, consecutive_failures = 0 WHERE active;
SET ROLE service_role;
SELECT 'T6 con límite 2 gana la ventana de ±1 día (AYER_20MIN y uno de hoy) [2|true|true]: '
  || count(*) || '|' || coalesce(bool_or(flight = 'AYER_20MIN'), false) || '|'
  || coalesce(bool_and(flight_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1 AND (now() AT TIME ZONE 'UTC')::date), false)
  FROM public.claim_tracked_flights(2);
RESET ROLE;

-- T7: notify_once inserta una vez por llave; sin llave (INSERT directo) no deduplica.
SET ROLE service_role;
SELECT (public.notify_once(:u, 'flight_update', 'Vuelo AM1 actualizado', 'Puerta asignada: B12', NULL, 'flight:x:fp1') IS NOT NULL)::text AS t7a \gset
SELECT coalesce(public.notify_once(:u, 'flight_update', 'Vuelo AM1 actualizado', 'Puerta asignada: B12', NULL, 'flight:x:fp1')::text, 'NULL') AS t7b \gset
RESET ROLE;
INSERT INTO public.notifications (user_id, title) VALUES (:u, 'manual'), (:u, 'manual');
SELECT 'T7 notify_once inserta una vez por llave; sin llave no deduplica [true|NULL|1|2]: ' || :'t7a' || '|' || :'t7b' || '|'
  || (SELECT count(*) FROM public.notifications WHERE user_id = :u AND dedup_key = 'flight:x:fp1') || '|'
  || (SELECT count(*) FROM public.notifications WHERE user_id = :u AND title = 'manual');

-- T8: cron_health sin pg_cron/pg_net locales.
SET ROLE service_role;
SELECT 'T8 cron_health sin pg_cron/pg_net locales [available false, 0 jobs, http null]: '
  || 'available ' || (j->>'available') || ', ' || jsonb_array_length(j->'jobs') || ' jobs, http ' || coalesce((j->'http')::text, 'NULL')
  FROM (SELECT public.cron_health() AS j) s;
RESET ROLE;

SELECT 'T9 tracked_flight_gap por distancia, salida y fallas [00:10:00|03:00:00|06:00:00|00:30:00|01:00:00|01:00:00|00:10:00]: '
  || concat_ws('|',
       public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date + 2, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date + 4, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 3, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 6, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes', now() + interval '8 hours', now()),
       public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes', now() + interval '5 hours', now()));
