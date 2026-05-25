
-- Profiles: nuevas columnas
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS currency_preference TEXT DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS loyalty_programs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Expenses
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  category TEXT NOT NULL,
  description TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own expenses" ON public.expenses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own expenses" ON public.expenses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own expenses" ON public.expenses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own expenses" ON public.expenses FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER expenses_set_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON public.expenses(user_id, expense_date DESC);

-- Behavioral insights
CREATE TABLE IF NOT EXISTS public.behavioral_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'saved','removed','viewed','searched','planned','skipped'
  target_type TEXT,     -- 'destination','hotel','flight','tour','restaurant'
  target_label TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.behavioral_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own insights" ON public.behavioral_insights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own insights" ON public.behavioral_insights FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own insights" ON public.behavioral_insights FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_insights_user ON public.behavioral_insights(user_id, created_at DESC);

-- Storage bucket for receipts (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recibos', 'recibos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users view own receipts"
ON storage.objects FOR SELECT
USING (bucket_id = 'recibos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own receipts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'recibos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own receipts"
ON storage.objects FOR DELETE
USING (bucket_id = 'recibos' AND auth.uid()::text = (storage.foldername(name))[1]);
