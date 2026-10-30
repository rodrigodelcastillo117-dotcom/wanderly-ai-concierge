-- ============================================================================
-- IATOS · Derechos y reclamos: tarea programada diaria de seguimiento (reclamos-cron)
-- ----------------------------------------------------------------------------
-- Correr DESPUÉS de aplicar la migración 20261029090000_reclamos (ya aplicada en producción) y de desplegar la
-- función reclamos-cron. Lo corre UNA PERSONA en el SQL editor (Lovable → Cloud → SQL editor → Run).
-- Seguro correrlo más de una vez. No contiene secretos: usa el cron_shared_secret de Vault (ya existe; lo crea
-- docs/ops/programar-tareas.sql).
-- Frecuencia: DIARIA, como pide docs/iatos/IATOS_DERECHOS_RECLAMOS.md §4.3 (los plazos de los reclamos son de días).
-- Guía para el dueño: docs/iatos/IATOS_DERECHOS_RECLAMOS.md
-- ============================================================================

-- 1) Seguimiento de reclamos: una vez al día, a las 15:41 UTC (09:41 en CDMX, horario de oficina para el proveedor).
--    - Si el proveedor no respondió en su plazo, le manda UN recordatorio (desde reclamos@, con el mismo hilo).
--    - Si vence el plazo de escalamiento, el reclamo pasa a "escalable" y se avisa al viajero por correo: la queja a la
--      autoridad solo se envía si él la autoriza.
--    - Con app_flags.reclamos_enabled = false no sale NINGÚN correo (la base lo impide); la corrida no hace nada.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reclamos-seguimiento-diario';
SELECT cron.schedule(
  'reclamos-seguimiento-diario',
  '41 15 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/reclamos-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 2) Bandera (nace apagada; encenderla solo con el visto bueno del dueño):
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'reclamos_enabled';

-- 3) APAGAR de inmediato (no sale ningún recordatorio ni carta):
-- UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now() WHERE key = 'reclamos_enabled';
-- Quitar la tarea programada:
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reclamos-seguimiento-diario';

-- 4) Verificación.
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'reclamos-seguimiento-diario';
SELECT key, value FROM public.app_flags WHERE key = 'reclamos_enabled';
-- Últimas corridas (status 200 = bien; 401 = falta el secreto de cron en la función):
SELECT d.start_time, d.status, d.return_message
  FROM cron.job_run_details d JOIN cron.job j USING (jobid)
 WHERE j.jobname = 'reclamos-seguimiento-diario' ORDER BY d.start_time DESC LIMIT 5;
