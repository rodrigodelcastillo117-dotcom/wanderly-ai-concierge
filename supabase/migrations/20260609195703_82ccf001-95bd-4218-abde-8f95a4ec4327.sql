
CREATE TABLE IF NOT EXISTS public.concierge_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  resumen_historico TEXT,
  resumen_actualizado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique partial indexes for upsert onConflict (one conv per user+trip, one general per user)
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_user_trip
  ON public.concierge_conversations(user_id, trip_id)
  WHERE trip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_user_general
  ON public.concierge_conversations(user_id)
  WHERE trip_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_user_trip ON public.concierge_conversations(user_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON public.concierge_conversations(updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_conversations TO authenticated;
GRANT ALL ON public.concierge_conversations TO service_role;

ALTER TABLE public.concierge_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own conversations" ON public.concierge_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own conversations" ON public.concierge_conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own conversations" ON public.concierge_conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own conversations" ON public.concierge_conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER concierge_conversations_updated_at
  BEFORE UPDATE ON public.concierge_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
