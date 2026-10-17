-- Explicit server access required for the price-watch functions.
GRANT ALL ON public.price_watches TO service_role;
GRANT ALL ON public.price_watch_checks TO service_role;