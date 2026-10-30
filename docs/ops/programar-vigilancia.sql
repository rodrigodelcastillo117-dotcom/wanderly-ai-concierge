-- ============================================================================
-- IATOS · Vigilancia proactiva: tareas programadas (vuelos, confirmaciones previas, avisos de viaje)
-- ----------------------------------------------------------------------------
-- Correr DESPUÉS de aplicar la migración 20261030010000_vigilancia y de desplegar las funciones vigilancia-cron y
-- reclamos-inbound (cambió: recibe las respuestas confirma+<token>@). Lo corre UNA PERSONA en el SQL editor
-- (Lovable → Cloud → SQL editor → Run). Seguro correrlo más de una vez.
-- No contiene secretos: usa el cron_shared_secret de Vault (ya existe; lo crea docs/ops/programar-tareas.sql).
-- ============================================================================

-- 1) Vuelos + entrega de avisos: cada 10 minutos. Cada vuelo se revisa SOLO cuando le toca (nada antes de 48 h;
--    a las 48 h y a las 24 h; cada 6 h hasta 6 h antes; cada hora hasta 2 h antes; cada 30 min hasta la salida;
--    cada 2 h en el aire hasta la llegada), dentro del cupo diario vigilancia_config.serp_tope_diario (4 por omisión)
--    Y del freno global de la cuenta (SERPAPI_DAILY_BUDGET / SERPAPI_MONTHLY_BUDGET con la reserva de vuelos): si el
--    freno está puesto no consulta, no cuenta el vuelo como falla y lo anota en la bitácora (sin_cupo_global). Una
--    corrida sin nada que revisar no gasta nada. Los avisos urgentes del vuelo salen en esta misma corrida.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vigilancia-vuelos-cada-10-min';
SELECT cron.schedule(
  'vigilancia-vuelos-cada-10-min',
  '3-59/10 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/vigilancia-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{"fases": ["vuelos", "entregar"]}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 2) Confirmaciones previas con proveedores + avisos de viaje (check-in, documentos, clima extremo, alertas
--    oficiales) + entrega: cada hora (minuto 17). Solo escribe a un proveedor si el viajero lo autorizó en
--    Perfil › Ajustes, a un correo con fuente verificada y en el horario local del proveedor.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vigilancia-previos-cada-hora';
SELECT cron.schedule(
  'vigilancia-previos-cada-hora',
  '17 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/vigilancia-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{"fases": ["confirmaciones", "avisos_viaje", "entregar"]}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 3) (OPCIONAL) Ajustes. Valores iniciales: 4 búsquedas de SerpApi al día, 3 avisos no urgentes por viajero al día,
--    horario 8–21 h del viajero, aviso de retraso desde 60 min e incidente desde 120 min, sin incidente por cambio de
--    puerta (solo aviso al viajero).
--
--    Cupo de SerpApi de la vigilancia según el plan. Todas las funciones gastan de la misma bolsa; el freno global
--    (_shared/serpBrake.ts) aparta el 20 % del tope del día (mínimo 2) para búsquedas de vuelos y para lo demás
--    (vigilancia, hoteles, mapas, cron) al llegar al resto. Sugerido: la mitad de SERPAPI_DAILY_BUDGET, sin pasar de lo
--    que queda fuera de la reserva (topeVigilanciaSugerido en _shared/vigilancia/vuelos.ts):
--
--      Plan de SerpApi              | búsquedas/mes | SERPAPI_DAILY_BUDGET | reserva vuelos | serp_tope_diario
--      Gratis (el elegido)          |           250 |                    8 |              2 |                4
--      Developer                    |         5,000 |                  160 |             32 |               80
--      Production                   |        15,000 |                  480 |             96 |              240
--    (SERPAPI_DAILY_BUDGET ≈ búsquedas del mes / 31. Las cifras de los planes de pago son de la página de precios de
--    SerpApi; confirmar antes de cambiar de plan.)
--
--    Qué alcanza con 4 al día: un vuelo completo usa ~16 búsquedas (3 h) a ~21 (11 h), así que con el plan gratis se
--    hacen las revisiones de 48 h y 24 h y unas pocas más el día del vuelo; si el cupo se acaba, lo anota la bitácora
--    («sin_cupo» o «sin_cupo_global») y la Mesa lo muestra en la sección Vigilancia. Varias personas en el mismo vuelo
--    comparten la consulta. Para vigilar todos los vuelos completos hace falta el plan Developer o mayor.
-- UPDATE public.vigilancia_config SET serp_tope_diario = 4, avisos_tope_diario = 3, retraso_incidente_min = 120 WHERE id;
-- UPDATE public.vigilancia_config SET incidente_por_puerta = true WHERE id;   -- también abrir caso por puerta/terminal

-- 4) APAGAR de inmediato (no revisa ni avisa nada; lo encolado se queda sin enviar):
-- UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now() WHERE key = 'vigilancia_enabled';

-- 5) Verificación.
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'vigilancia-%';
SELECT key, value FROM public.app_flags WHERE key = 'vigilancia_enabled';
SELECT * FROM public.vigilancia_config;
-- Búsquedas de SerpApi de la vigilancia hoy y vuelos vigilados:
SELECT coalesce(sum(searches), 0) AS busquedas_hoy FROM public.ai_usage_log
 WHERE provider = 'serpapi' AND function = 'vigilancia-cron' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
SELECT vuelo, fecha, origen, destino, estado->>'status' AS estado, ultimo_resultado, proxima_revision_at, activo
  FROM public.vigilancia_vuelos ORDER BY salida_at DESC NULLS LAST LIMIT 20;
-- Lo último que detectó y avisó:
SELECT created_at, ambito, tipo, resumen FROM public.vigilancia_eventos ORDER BY id DESC LIMIT 20;
