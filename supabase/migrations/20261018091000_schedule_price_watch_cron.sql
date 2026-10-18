-- Schedule price-watch-cron twice a day without exposing any credential:
-- a random shared secret is generated and kept in Supabase Vault, pg_cron sends
-- it as x-cron-secret, and the function validates it through verify_cron_secret()
-- (service_role only). The value never appears in code, logs or this file.

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'price-watch-twice-daily') THEN
    PERFORM cron.unschedule('price-watch-twice-daily');
  END IF;
END $$;

-- 03:17 and 15:17 UTC (21:17 and 09:17 in Mexico City).
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
