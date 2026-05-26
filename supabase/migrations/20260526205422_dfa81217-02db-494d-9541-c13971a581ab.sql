
-- JOURNAL ENTRIES
CREATE TABLE public.trip_journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  text TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_trip ON public.trip_journal_entries(trip_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_journal_entries TO authenticated;
GRANT ALL ON public.trip_journal_entries TO service_role;
ALTER TABLE public.trip_journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journal_select" ON public.trip_journal_entries FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
CREATE POLICY "journal_insert" ON public.trip_journal_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()) AND author_id = auth.uid());
CREATE POLICY "journal_update" ON public.trip_journal_entries FOR UPDATE TO authenticated
  USING (author_id = auth.uid());
CREATE POLICY "journal_delete" ON public.trip_journal_entries FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_trip_owner(trip_id, auth.uid()));

-- PACKING ITEMS
CREATE TABLE public.trip_packing_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Otros',
  done BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_packing_trip ON public.trip_packing_items(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_packing_items TO authenticated;
GRANT ALL ON public.trip_packing_items TO service_role;
ALTER TABLE public.trip_packing_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "packing_all" ON public.trip_packing_items FOR ALL TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()))
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()));

-- SPLIT PEOPLE
CREATE TABLE public.trip_split_people (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_split_people_trip ON public.trip_split_people(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_split_people TO authenticated;
GRANT ALL ON public.trip_split_people TO service_role;
ALTER TABLE public.trip_split_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_people_all" ON public.trip_split_people FOR ALL TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()))
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()));

-- SPLIT EXPENSES
CREATE TABLE public.trip_split_expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.trip_split_people(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_split_exp_trip ON public.trip_split_expenses(trip_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_split_expenses TO authenticated;
GRANT ALL ON public.trip_split_expenses TO service_role;
ALTER TABLE public.trip_split_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_exp_all" ON public.trip_split_expenses FOR ALL TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()))
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()));

-- STORAGE BUCKET FOR JOURNAL PHOTOS
INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-photos', 'journal-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "journal_photos_read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'journal-photos');
CREATE POLICY "journal_photos_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'journal-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "journal_photos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'journal-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
