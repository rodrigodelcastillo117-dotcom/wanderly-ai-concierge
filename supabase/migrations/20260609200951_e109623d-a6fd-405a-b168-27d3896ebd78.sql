CREATE TABLE IF NOT EXISTS public.fixer_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  motivo TEXT,
  contexto_chat JSONB,
  urgencia TEXT CHECK (urgencia IN ('baja', 'media', 'alta', 'critica')),
  status TEXT NOT NULL DEFAULT 'iniciado' CHECK (status IN ('iniciado', 'whatsapp_abierto', 'resuelto', 'pendiente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON public.fixer_escalations TO authenticated;
GRANT ALL ON public.fixer_escalations TO service_role;

ALTER TABLE public.fixer_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own escalations" ON public.fixer_escalations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own escalations" ON public.fixer_escalations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own escalations" ON public.fixer_escalations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_fixer_user_date ON public.fixer_escalations(user_id, created_at DESC);