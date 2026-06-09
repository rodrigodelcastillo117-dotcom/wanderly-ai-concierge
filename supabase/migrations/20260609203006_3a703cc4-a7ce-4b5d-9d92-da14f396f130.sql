
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  proveedor TEXT NOT NULL,
  accion TEXT NOT NULL,
  payload JSONB,
  url_final TEXT,
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT ON public.affiliate_clicks TO authenticated;
GRANT ALL ON public.affiliate_clicks TO service_role;

ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own affiliate clicks" ON public.affiliate_clicks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own affiliate clicks" ON public.affiliate_clicks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_affclicks_user_date ON public.affiliate_clicks(user_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affclicks_proveedor ON public.affiliate_clicks(proveedor);
