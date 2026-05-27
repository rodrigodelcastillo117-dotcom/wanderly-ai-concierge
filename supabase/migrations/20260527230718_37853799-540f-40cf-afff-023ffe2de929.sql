
CREATE TABLE public.travel_moments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  trip_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.travel_moments TO authenticated;
GRANT ALL ON public.travel_moments TO service_role;
ALTER TABLE public.travel_moments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own moments" ON public.travel_moments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own moments" ON public.travel_moments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own moments" ON public.travel_moments FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own moments" ON public.travel_moments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_travel_moments_user ON public.travel_moments(user_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public) VALUES ('travel-moments', 'travel-moments', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Moments public read" ON storage.objects FOR SELECT USING (bucket_id = 'travel-moments');
CREATE POLICY "Users upload own moments" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'travel-moments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own moments" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'travel-moments' AND auth.uid()::text = (storage.foldername(name))[1]);
