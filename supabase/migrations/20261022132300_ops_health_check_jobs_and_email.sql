-- Chequeo diario más útil (auditoría C-11, C-12, C-14). Idempotente.
-- a) Se guarda qué pasó con el correo de alerta (antes solo quedaba en la respuesta HTTP, que nadie lee).
-- b) cron_health(): lee el historial de pg_cron y de pg_net para detectar tareas que no corrieron o
--    cuyas llamadas fallan (el job viejo de vuelos recibió 401 en cada corrida sin que nadie lo notara).
-- c) verify_cron_secret(): estaba solo en docs/ops/programar-tareas.sql (aplicada a mano); aquí queda
--    en las migraciones con la misma definición, para que un entorno nuevo sea igual a producción.

-- a) Resultado del correo
ALTER TABLE public.health_checks
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS email_error text;
-- Valores: not_needed | skipped_unchanged | sent | partial | failed | no_recipient | pending

-- b) Salud de las tareas programadas. SECURITY DEFINER porque los esquemas cron y net no están
--    expuestos; solo service_role puede llamarla. Si pg_cron/pg_net no existen (entorno local),
--    lo dice en "available" en vez de fallar.
CREATE OR REPLACE FUNCTION public.cron_health(p_http_window interval DEFAULT interval '6 hours')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jobs jsonb := '[]'::jsonb;
  v_http jsonb := NULL;
  v_cron boolean := to_regclass('cron.job') IS NOT NULL AND to_regclass('cron.job_run_details') IS NOT NULL;
  v_net boolean := to_regclass('net._http_response') IS NOT NULL;
BEGIN
  IF v_cron THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'jobname', j.jobname,
             'schedule', j.schedule,
             'active', j.active,
             'last_start', d.start_time,
             'last_end', d.end_time,
             'last_status', d.status,
             'last_message', left(d.return_message, 200),
             'failed_24h', (SELECT count(*) FROM cron.job_run_details f
                             WHERE f.jobid = j.jobid AND f.status = 'failed'
                               AND f.start_time > now() - interval '24 hours'))
           ORDER BY j.jobname), '[]'::jsonb)
      INTO v_jobs
      FROM cron.job j
      LEFT JOIN LATERAL (
        SELECT r.start_time, r.end_time, r.status, r.return_message
          FROM cron.job_run_details r
         WHERE r.jobid = j.jobid
         ORDER BY r.start_time DESC NULLS LAST
         LIMIT 1) d ON true;
  END IF;

  -- pg_net guarda unas horas la respuesta de cada llamada: un 401/500/timeout de una función
  -- programada solo se ve aquí (para pg_cron la tarea "terminó bien" en cuanto encoló la llamada).
  IF v_net THEN
    SELECT jsonb_build_object(
             'window_hours', extract(epoch FROM p_http_window) / 3600,
             'total', count(*),
             'failed', count(*) FILTER (WHERE r.timed_out IS TRUE OR r.error_msg IS NOT NULL
                                          OR r.status_code IS NULL OR r.status_code NOT BETWEEN 200 AND 299),
             'last_failure', (SELECT CASE WHEN f.timed_out IS TRUE THEN 'timeout'
                                          WHEN f.status_code IS NOT NULL THEN 'HTTP ' || f.status_code
                                          ELSE left(coalesce(f.error_msg, 'error'), 120) END
                                FROM net._http_response f
                               WHERE f.created > now() - p_http_window
                                 AND (f.timed_out IS TRUE OR f.error_msg IS NOT NULL
                                      OR f.status_code IS NULL OR f.status_code NOT BETWEEN 200 AND 299)
                               ORDER BY f.created DESC LIMIT 1))
      INTO v_http
      FROM net._http_response r
     WHERE r.created > now() - p_http_window;
  END IF;

  RETURN jsonb_build_object('available', v_cron, 'checked_at', now(), 'jobs', v_jobs, 'http', v_http);
END;
$$;
REVOKE ALL ON FUNCTION public.cron_health(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health(interval) TO service_role;

-- c) Misma definición que docs/ops/programar-tareas.sql. El secreto en sí NO va aquí (sería
--    público): lo crea ese script dentro de Supabase Vault. Se desactiva la validación del cuerpo
--    porque el esquema vault solo existe en Supabase.
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(length(p_secret) >= 32, false)
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
       WHERE name = 'cron_shared_secret' AND decrypted_secret = p_secret
     );
$$;
RESET check_function_bodies;
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;
