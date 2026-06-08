CREATE TABLE IF NOT EXISTS public.user_onboarding_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  current_step INT NOT NULL DEFAULT 1,
  selected_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_loyalty_airlines JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_loyalty_hotels JSONB NOT NULL DEFAULT '[]'::jsonb,
  travel_dna_seed TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_onboarding_state TO authenticated;
GRANT ALL ON public.user_onboarding_state TO service_role;

ALTER TABLE public.user_onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own onboarding state" ON public.user_onboarding_state
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own onboarding state" ON public.user_onboarding_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own onboarding state" ON public.user_onboarding_state
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_completed ON public.user_onboarding_state(completed_onboarding);

CREATE TRIGGER set_user_onboarding_state_updated_at
  BEFORE UPDATE ON public.user_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();