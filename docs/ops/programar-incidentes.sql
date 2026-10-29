-- ============================================================================
-- IATOS · Incidentes: vigilante programado + guardia (opcional)
-- ----------------------------------------------------------------------------
-- Correr DESPUÉS de aplicar la migración 20261029080000_incidentes.sql y de desplegar la función
-- incidentes-vigilante. Lo corre UNA PERSONA en el SQL editor (Lovable → Cloud → SQL editor → Run).
-- Es seguro correrlo más de una vez. No contiene secretos: usa el cron_shared_secret de Vault (ya existe;
-- lo crea docs/ops/programar-tareas.sql).
-- ============================================================================

-- 1) Vigilante cada 2 minutos: escala lo que no tuvo avance o que nadie tomó (crítico 10 min, alto 30),
--    avisa si un mensaje del viajero no tiene respuesta o venció la hora prometida, pasa a humanos lo del
--    operador IA si deja de dar latido, y reintenta los avisos que no salieron.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'incidentes-vigilante-cada-2-min';
SELECT cron.schedule(
  'incidentes-vigilante-cada-2-min',
  '*/2 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/incidentes-vigilante',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

-- 2) (OPCIONAL) Guardia con horario. Si NO se llena, se usa FIXER_EMAIL: el primer correo es el primario
--    (recibe el aviso al nacer) y los demás son el respaldo (reciben desde el primer escalamiento).
--    Para llenarla, cambia los correos y horarios y quita los "--":
-- INSERT INTO public.incident_oncall (email, name, role, timezone, start_hour, end_hour, phone, channels) VALUES
--   ('CORREO-DEL-DUENO@ejemplo.com', 'Dueño', 'primario', 'America/Mexico_City', 0, 24, NULL, ARRAY['email','push']),
--   ('CORREO-DE-CARLO@ejemplo.com',  'Carlo', 'respaldo', 'America/Mexico_City', 0, 24, NULL, ARRAY['email','push'])
-- ON CONFLICT DO NOTHING;
--    Con WhatsApp/SMS prendidos (secretos de Twilio): pon el teléfono en formato +52155… y agrega 'whatsapp' o 'sms'
--    a channels. En incidentes críticos se manda también por esos canales; en los demás, solo si el correo falla.

-- 3) (OPCIONAL) Tiempos. Valores iniciales: escalar sin avance/sin tomar a los 10 (crítica), 30 (alta),
--    120 (media) y 480 (baja) minutos; alerta por mensaje sin respuesta a los 5/10/30/60.
-- UPDATE public.incident_config SET take_minutes = '{"critica":10,"alta":30,"media":120,"baja":480}'::jsonb WHERE id;
--    El operador IA queda APAGADO (todo va directo al equipo humano) hasta que exista y se prenda:
-- UPDATE public.incident_config SET ai_operator_enabled = true WHERE id;

-- 4) Verificación.
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'incidentes-vigilante-cada-2-min';
SELECT ai_operator_enabled, take_minutes, reply_minutes, notify_on_create FROM public.incident_config;
SELECT email, role, timezone, start_hour, end_hour, channels, active FROM public.incident_oncall ORDER BY role, email;
