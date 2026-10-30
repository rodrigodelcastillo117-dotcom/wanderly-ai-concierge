-- ============================================================================
-- IATOS · Comisiones y reservas gestionadas: tareas programadas y banderas
-- ----------------------------------------------------------------------------
-- Correr DESPUÉS de aplicar la migración 20261030020000_comisiones y de desplegar las funciones comisiones-sync,
-- reservas-gestionadas y proveedores-webhook (y operador, que cambió). Lo corre UNA PERSONA en el SQL editor
-- (Lovable → Cloud → SQL editor → Run). Seguro correrlo más de una vez. No contiene secretos: usa el
-- cron_shared_secret de Vault (ya existe; lo crea docs/ops/programar-tareas.sql).
-- Guía para el dueño: docs/iatos/IATOS_COMISIONES.md
-- ============================================================================

-- 1) Libro de comisiones: lee ventas y pagos de Travelpayouts una vez al día (solo lectura, ~15 llamadas).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'comisiones-sync-diario';
SELECT cron.schedule(
  'comisiones-sync-diario',
  '17 9 * * *',   -- 09:17 UTC = 03:17 en CDMX
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/comisiones-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- 2) Reservas gestionadas: cada hora ejecuta lo que una persona aprobó (si la ejecución está prendida) y consulta el
--    estado de las reservas activas con su proveedor (Viator pide revisar cada hora).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reservas-gestionadas-cada-hora';
SELECT cron.schedule(
  'reservas-gestionadas-cada-hora',
  '23 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/reservas-gestionadas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{"tick": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 3) Banderas (todas nacen así; cambiarlas solo con el visto bueno del dueño):
--    comisiones_sync_enabled              = true   (lectura de Travelpayouts)
--    reservas_gestionadas_cambios_enabled = false  (ejecutar con el proveedor lo que una persona aprobó)
--    proveedores_reservas_enabled         = false  (reservar/cancelar/cambiar en PRODUCCIÓN; en sandbox no hace falta)
--    cargo_servicio_enabled               = false  (cargo por servicio de IATOS)
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'reservas_gestionadas_cambios_enabled';
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'proveedores_reservas_enabled';

-- 4) Cargo por servicio en vuelos (ejemplo: 150 MXN por reserva, no reembolsable). Primero el monto, luego la bandera.
-- UPDATE public.service_fee_rules SET modo = 'fijo', monto_fijo = 150, moneda = 'MXN', por = 'reserva', reembolsable = false, activo = true, updated_at = now()
--  WHERE producto = 'vuelo';
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'cargo_servicio_enabled';

-- 5) APAGAR de inmediato.
-- UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now()
--  WHERE key IN ('comisiones_sync_enabled','reservas_gestionadas_cambios_enabled','proveedores_reservas_enabled','cargo_servicio_enabled');

-- 6) Verificación.
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('comisiones-sync-diario', 'reservas-gestionadas-cada-hora');
SELECT key, value FROM public.app_flags
 WHERE key IN ('comisiones_sync_enabled','reservas_gestionadas_cambios_enabled','proveedores_reservas_enabled','cargo_servicio_enabled');
-- Última sincronización con Travelpayouts (ok, cuántas ventas, error):
SELECT source, finished_at, ok, error, stats FROM public.commission_sync_runs ORDER BY started_at DESC LIMIT 5;
