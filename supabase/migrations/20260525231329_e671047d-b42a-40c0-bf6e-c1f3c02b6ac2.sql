
CREATE TABLE IF NOT EXISTS public.user_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  place_name TEXT NOT NULL,
  place_id TEXT,
  category TEXT,
  lat NUMERIC,
  lng NUMERIC,
  notes TEXT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own visits" ON public.user_visits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own visits" ON public.user_visits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own visits" ON public.user_visits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own visits" ON public.user_visits FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_visits_user ON public.user_visits(user_id, visited_at DESC);
