-- Retroactive: Travel DNA columns that exist live on ai_user_preferences but were
-- never versioned. Must precede 20260525235000 (user_autonomy view). Idempotent;
-- a no-op on the live database.
ALTER TABLE public.ai_user_preferences ADD COLUMN IF NOT EXISTS trip_count integer DEFAULT 0;
ALTER TABLE public.ai_user_preferences ADD COLUMN IF NOT EXISTS visit_count integer DEFAULT 0;
ALTER TABLE public.ai_user_preferences ADD COLUMN IF NOT EXISTS dna_version integer DEFAULT 1;
ALTER TABLE public.ai_user_preferences ADD COLUMN IF NOT EXISTS dna_signal jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_user_preferences ADD COLUMN IF NOT EXISTS dna_updated_at timestamptz;
