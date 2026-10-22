-- Pruebas de las migraciones de operación (2026102213xxxx) sobre un Postgres local desechable.
-- Uso: supabase/tests/ops/run.sh. Cada línea "T*" dice qué se espera.
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

\echo 'T1 authenticated no puede reclamar vuelos [permission denied]'
SET ROLE authenticated;
SELECT count(*) FROM public.claim_tracked_flights(50);
RESET ROLE;
\echo 'T2 authenticated no puede usar notify_once / cron_health / verify_cron_secret [permission denied x3]'
SET ROLE authenticated;
SELECT public.notify_once(:u, 'x', 't', 'b', NULL, 'k');
SELECT public.cron_health();
SELECT public.verify_cron_secret(repeat('a', 40));
RESET ROLE;

\echo 'T3 service_role reclama solo los pendientes, primero la ventana de ±1 día [AYER_20MIN, HOY_NUNCA, HOY_SALE_EN_2H_20MIN, SALE_EN_10H_70MIN, EN10DIAS_7H, EN3DIAS_4H; no SALE_EN_10H_20MIN (sale en >6 h: cada hora)]'
SET ROLE service_role;
SELECT string_agg(flight, ', ' ORDER BY (flight_date > (now() AT TIME ZONE 'UTC')::date + 1), flight) FROM public.claim_tracked_flights(50);
RESET ROLE;
\echo 'T4 se apagaron sin fecha, fecha pasada y llegada hace >3 h [ANTIER, SIN_FECHA, YA_LLEGO_HACE_4H]'
SELECT string_agg(flight, ', ' ORDER BY flight) FROM public.tracked_flights WHERE NOT active;
\echo 'T5 los reclamados quedan con last_attempt_at = ahora y no se vuelven a reclamar [6 | 0]'
SELECT count(*) FROM public.tracked_flights WHERE last_attempt_at > now() - interval '1 minute';
SET ROLE service_role;
SELECT count(*) FROM public.claim_tracked_flights(50);
RESET ROLE;
\echo 'T6 con límite 2 gana la ventana de ±1 día (los más próximos) [2: los de fecha más temprana dentro de ±1 día: AYER_20MIN y uno de hoy]'
UPDATE public.tracked_flights SET last_attempt_at = NULL, consecutive_failures = 0 WHERE active;
SET ROLE service_role;
SELECT count(*) || ': ' || string_agg(flight, ', ' ORDER BY flight) FROM public.claim_tracked_flights(2);
RESET ROLE;

\echo 'T7 notify_once inserta una vez por llave; sin llave no deduplica [id | NULL | 1 | 2]'
SET ROLE service_role;
SELECT public.notify_once(:u, 'flight_update', 'Vuelo AM1 actualizado', 'Puerta asignada: B12', NULL, 'flight:x:fp1') IS NOT NULL;
SELECT coalesce(public.notify_once(:u, 'flight_update', 'Vuelo AM1 actualizado', 'Puerta asignada: B12', NULL, 'flight:x:fp1')::text, 'NULL');
RESET ROLE;
SELECT count(*) FROM public.notifications WHERE user_id = :u AND dedup_key = 'flight:x:fp1';
INSERT INTO public.notifications (user_id, title) VALUES (:u, 'manual'), (:u, 'manual');
SELECT count(*) FROM public.notifications WHERE user_id = :u AND title = 'manual';

\echo 'T8 cron_health sin pg_cron/pg_net locales [available false, jobs [], http null]'
SET ROLE service_role;
SELECT public.cron_health();
RESET ROLE;

\echo 'T9 tracked_flight_gap por distancia, salida y fallas [00:10:00 | 03:00:00 | 06:00:00 | 00:30:00 | 01:00:00 | 01:00:00 | 00:10:00]'
SELECT public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date + 2, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date + 4, current_date, 0, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 3, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 6, interval '10 minutes'),
       public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes', now() + interval '8 hours', now()),
       public.tracked_flight_gap(current_date, current_date, 0, interval '10 minutes', now() + interval '5 hours', now());
