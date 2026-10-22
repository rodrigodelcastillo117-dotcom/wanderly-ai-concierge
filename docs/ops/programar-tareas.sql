-- ============================================================================
-- IATOS · Programar tareas automáticas + dar acceso de administrador
-- ----------------------------------------------------------------------------
-- Lo corre UNA PERSONA en Lovable → pestaña Cloud → SQL editor → Run.
-- (El agente de Lovable tiene prohibido por política tocar secretos/tareas.)
-- Es seguro correrlo más de una vez.
--
-- ANTES DE CORRERLO: cambia el correo de la sección 4 por el correo con el que
-- inicias sesión en IATOS.
-- ============================================================================

-- 1) Secreto compartido aleatorio, guardado en Supabase Vault. Nadie lo ve:
--    pg_cron lo manda a las funciones y ellas lo validan contra la base.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_shared_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'cron_shared_secret',
      'Shared secret pg_cron sends to scheduled edge functions'
    );
  END IF;
END $$;

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
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

-- 2) Alertas de baja de precio: 03:17 y 15:17 UTC (21:17 y 09:17 en CDMX).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'price-watch-twice-daily') THEN
    PERFORM cron.unschedule('price-watch-twice-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'price-watch-twice-daily',
  '17 3,15 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/price-watch-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 3) Avisos de cambios en vuelos rastreados. El job anterior
--    (flight-watch-every-5-min) recibía 401 en cada ejecución; se reemplaza por
--    uno cada 15 minutos con el secreto de Vault.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flight-watch-every-5-min') THEN
    PERFORM cron.unschedule('flight-watch-every-5-min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flight-watch-every-15-min') THEN
    PERFORM cron.unschedule('flight-watch-every-15-min');
  END IF;
END $$;

SELECT cron.schedule(
  'flight-watch-every-15-min',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/flight-watch-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 3b) Chequeo diario de servicios externos (IA, SerpApi, Travelpayouts, Stripe), 7:07 a.m.
--     hora de CDMX. Guarda el resultado en health_checks y avisa por correo a los admins.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'health-check-daily';
SELECT cron.schedule(
  'health-check-daily',
  '7 13 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);

-- 4) Acceso al panel de métricas (/dashboard/admin). CAMBIA EL CORREO.
INSERT INTO public.admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('TU-CORREO@ejemplo.com')
ON CONFLICT (user_id) DO NOTHING;

-- 5) Verificación: debe listar los 2 trabajos y tu usuario como admin.
SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('price-watch-twice-daily', 'flight-watch-every-15-min');
SELECT a.user_id, u.email FROM public.admins a JOIN auth.users u ON u.id = a.user_id;
