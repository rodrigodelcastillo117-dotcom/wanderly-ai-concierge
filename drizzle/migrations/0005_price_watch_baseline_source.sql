-- Prices from different providers aren't comparable (a cached Aviasales fare vs a
-- live Google Flights fare can differ with no real price change), so each watch
-- remembers which source its baseline came from and only same-source checks alert.
ALTER TABLE public.price_watches
  ADD COLUMN IF NOT EXISTS baseline_source TEXT NOT NULL DEFAULT 'travelpayouts'
  CHECK (baseline_source IN ('travelpayouts', 'google_flights'));
