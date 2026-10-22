-- Freno de la cuenta de SerpApi (grupo googlemax). Idempotente.
-- serp_global_used(_period): búsquedas de SerpApi que de verdad se cobraron (ai_usage_log,
-- provider = 'serpapi') en el mes o el día en curso (UTC). La usa _shared/serpBrake.ts para dejar de
-- buscar en vivo cuando se llega a SERPAPI_MONTHLY_BUDGET / SERPAPI_DAILY_BUDGET (variables
-- opcionales; sin ellas no hay tope de cuenta). Solo service_role.

CREATE OR REPLACE FUNCTION public.serp_global_used(_period text DEFAULT 'month')
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(searches), 0)::int
    FROM public.ai_usage_log
   WHERE provider = 'serpapi'
     AND created_at >= CASE WHEN _period = 'day'
                            THEN date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                            ELSE date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' END;
$$;

REVOKE ALL ON FUNCTION public.serp_global_used(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serp_global_used(text) TO service_role;
