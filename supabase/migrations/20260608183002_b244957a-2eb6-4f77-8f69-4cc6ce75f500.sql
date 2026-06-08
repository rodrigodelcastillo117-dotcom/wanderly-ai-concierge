ALTER TABLE public.user_onboarding_state
ADD COLUMN IF NOT EXISTS tooltips_shown JSONB NOT NULL DEFAULT '[]'::jsonb;