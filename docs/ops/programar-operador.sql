-- ============================================================================
-- IATOS · Operador IATOS: tarea programada + encender (cuando el dueño lo decida)
-- ----------------------------------------------------------------------------
-- Correr DESPUÉS de aplicar las migraciones 20261029080000_incidentes, 20261029090000_reclamos y
-- 20261029100000_operador, y de desplegar las funciones operador, telegram-webhook, canales (y las que cambiaron).
-- Lo corre UNA PERSONA en el SQL editor (Lovable → Cloud → SQL editor → Run). Seguro correrlo más de una vez.
-- No contiene secretos: usa el cron_shared_secret de Vault (ya existe; lo crea docs/ops/programar-tareas.sql).
-- ============================================================================

-- 1) El operador trabaja cada 2 minutos: casos con algo nuevo, horas de seguimiento vencidas y correos a
--    proveedores que ya están en su horario. (El vigilante de incidentes también lo despierta; esto es el respaldo.)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'operador-cada-2-min';
SELECT cron.schedule(
  'operador-cada-2-min',
  '1-59/2 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/operador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{"tick": true, "async": true}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- 2) ENCENDER el operador (solo con el visto bueno del dueño). Mientras esté en false, todo va al equipo humano
--    como hoy y el operador no gasta nada.
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'operador_enabled';
--    Para que pueda ENVIAR reclamos por correo (con el sí del viajero) también hace falta:
-- UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'reclamos_enabled';

-- 3) (OPCIONAL) Topes por caso. Valores iniciales: 25 acciones, US$0.80 de IA, 1 búsqueda de vuelos, 3 correos a
--    proveedores, 40 corridas al día, candado de 120 s.
-- UPDATE public.operator_config SET max_actions = 25, max_spend_usd = 0.80, max_flight_searches = 1, max_provider_emails = 3 WHERE id;

-- 4) APAGAR de inmediato (si algo no se ve bien): todo vuelve al equipo humano.
-- UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now() WHERE key = 'operador_enabled';

-- 5) Verificación.
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('operador-cada-2-min', 'incidentes-vigilante-cada-2-min');
SELECT key, value FROM public.app_flags WHERE key IN ('operador_enabled', 'reclamos_enabled');
SELECT * FROM public.operator_config;
-- Lo que hizo el operador en las últimas 24 h (casos, acciones, gasto, cuántos pasaron a una persona):
SELECT count(*) AS casos, sum(actions) AS acciones, round(sum(spend_usd), 3) AS gasto_usd,
       count(*) FILTER (WHERE state = 'con_humano') AS a_persona
  FROM public.operator_cases WHERE updated_at > now() - interval '24 hours';
