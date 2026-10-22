-- cron_health() con tablas mínimas que imitan pg_cron y pg_net (solo en la base local de prueba).
\pset footer off
\pset tuples_only on
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigint PRIMARY KEY, schedule text, command text, jobname text, active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
CREATE TABLE IF NOT EXISTS net._http_response (id bigserial PRIMARY KEY, status_code int, content text, timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
TRUNCATE cron.job, cron.job_run_details, net._http_response;
INSERT INTO cron.job (jobid, schedule, command, jobname) VALUES
 (1, '*/15 * * * *', 'select net.http_post(...)', 'flight-watch-every-15-min'),
 (2, '17 3,15 * * *', 'select net.http_post(...)', 'price-watch-twice-daily'),
 (3, '7 13 * * *', 'select net.http_post(...)', 'health-check-daily');
INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time) VALUES
 (1, 'succeeded', '1 row', now() - interval '2 hours', now() - interval '2 hours'),
 (1, 'succeeded', '1 row', now() - interval '50 minutes', now() - interval '50 minutes'),
 (2, 'failed', 'ERROR: schema "net" does not exist', now() - interval '5 hours', now() - interval '5 hours'),
 (3, 'succeeded', '1 row', now() - interval '1 day', now() - interval '1 day');
INSERT INTO net._http_response (status_code, timed_out, created) VALUES
 (200, false, now() - interval '1 hour'), (401, false, now() - interval '30 minutes'), (NULL, true, now() - interval '10 minutes'),
 (401, false, now() - interval '9 hours');
\echo 'C1 cron_health devuelve los 3 jobs con su última corrida y las fallas HTTP de 6 h [total 3, failed 2, last_failure timeout]'
SET ROLE service_role;
SELECT jsonb_pretty(public.cron_health());
RESET ROLE;
DROP SCHEMA cron CASCADE;
DROP SCHEMA net CASCADE;
