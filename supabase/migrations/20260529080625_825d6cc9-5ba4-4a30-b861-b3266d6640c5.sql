
-- Enable RLS on historical_flight_prices (public reference data)
ALTER TABLE public.historical_flight_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS historical_flight_prices_public_read ON public.historical_flight_prices;
CREATE POLICY historical_flight_prices_public_read
  ON public.historical_flight_prices FOR SELECT
  TO anon, authenticated
  USING (true);

-- Switch views to SECURITY INVOKER so they enforce caller RLS
ALTER VIEW public.user_autonomy SET (security_invoker = true);
ALTER VIEW public.mis_amigos SET (security_invoker = true);
