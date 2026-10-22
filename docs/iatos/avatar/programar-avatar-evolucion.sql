-- ============================================================================
-- IATOS · Tarea diaria: el avatar gana un detalle por cada viaje que terminó
-- ----------------------------------------------------------------------------
-- Lo corre UNA PERSONA en Lovable → Cloud → SQL editor, DESPUÉS de aplicar
-- supabase/migrations/20261024200000_avatar_evolution.sql y desplegar avatar-evolve.
-- Usa el mismo secreto de Vault que las demás tareas (docs/ops/programar-tareas.sql).
-- Es seguro correrlo más de una vez. 10:23 UTC = 04:23 en CDMX.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avatar-evolve-daily') THEN
    PERFORM cron.unschedule('avatar-evolve-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'avatar-evolve-daily',
  '23 10 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/avatar-evolve',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cmd$
);
