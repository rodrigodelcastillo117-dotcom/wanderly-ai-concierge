-- Price watch: nightly re-quote of a saved trip's flights, alerting when the
-- live price drops below the price at the moment the user started watching.
-- Writes happen only through the price-watch / price-watch-cron edge functions
-- (service role), so users cannot forge a baseline or a "drop".

CREATE TABLE IF NOT EXISTS public.price_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date DATE,
  adults INT NOT NULL DEFAULT 1 CHECK (adults BETWEEN 1 AND 9),
  baseline_price_mxn NUMERIC NOT NULL CHECK (baseline_price_mxn > 0),
  -- true when the baseline came from a month-level fallback (not the exact date);
  -- the first exact-date price then becomes the baseline, without alerting.
  baseline_approximate BOOLEAN NOT NULL DEFAULT false,
  last_price_mxn NUMERIC,
  lowest_price_mxn NUMERIC,
  booking_link TEXT,
  last_checked_at TIMESTAMPTZ,
  last_alert_at TIMESTAMPTZ,
  last_alert_price_mxn NUMERIC,
  alerts_sent INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id)
);

CREATE INDEX IF NOT EXISTS idx_price_watches_due
  ON public.price_watches (active, last_checked_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_price_watches_user ON public.price_watches (user_id);

CREATE TABLE IF NOT EXISTS public.price_watch_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id UUID NOT NULL REFERENCES public.price_watches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  price_mxn NUMERIC NOT NULL,
  approximate_dates BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'travelpayouts',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_watch_checks_watch
  ON public.price_watch_checks (watch_id, checked_at DESC);

DROP TRIGGER IF EXISTS trg_price_watches_updated ON public.price_watches;
CREATE TRIGGER trg_price_watches_updated BEFORE UPDATE ON public.price_watches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.price_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_watch_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_watches_select_own ON public.price_watches;
CREATE POLICY price_watches_select_own ON public.price_watches
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS price_watch_checks_select_own ON public.price_watch_checks;
CREATE POLICY price_watch_checks_select_own ON public.price_watch_checks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.price_watches FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.price_watch_checks FROM anon, authenticated;
GRANT SELECT ON public.price_watches TO authenticated;
GRANT SELECT ON public.price_watch_checks TO authenticated;
