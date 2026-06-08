
CREATE TABLE IF NOT EXISTS public.packing_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lista_json JSONB NOT NULL,
  estado_checkboxes JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trip_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packing_lists TO authenticated;
GRANT ALL ON public.packing_lists TO service_role;

ALTER TABLE public.packing_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own packing lists" ON public.packing_lists
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own packing lists" ON public.packing_lists
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own packing lists" ON public.packing_lists
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own packing lists" ON public.packing_lists
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_packing_lists_trip ON public.packing_lists(trip_id);
CREATE INDEX IF NOT EXISTS idx_packing_lists_user ON public.packing_lists(user_id);

CREATE TRIGGER trg_packing_lists_updated_at
  BEFORE UPDATE ON public.packing_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
