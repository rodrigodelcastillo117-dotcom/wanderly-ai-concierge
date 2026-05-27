
CREATE TABLE public.visited_places (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  place_id text NOT NULL,
  name text NOT NULL,
  address text,
  lat numeric,
  lng numeric,
  types text[] DEFAULT '{}'::text[],
  primary_type text,
  cuisine text,
  price_level text,
  rating numeric,
  ratings_count integer,
  photo_ref text,
  maps_url text,
  status text NOT NULL DEFAULT 'visited',
  visited_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, place_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visited_places TO authenticated;
GRANT ALL ON public.visited_places TO service_role;

ALTER TABLE public.visited_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visited_places_select_own" ON public.visited_places
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "visited_places_insert_own" ON public.visited_places
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "visited_places_update_own" ON public.visited_places
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "visited_places_delete_own" ON public.visited_places
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_visited_places_user ON public.visited_places(user_id);
CREATE INDEX idx_visited_places_cuisine ON public.visited_places(user_id, cuisine);

CREATE TRIGGER trg_visited_places_updated
  BEFORE UPDATE ON public.visited_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS food_dna jsonb NOT NULL DEFAULT '{}'::jsonb;
