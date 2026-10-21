-- Retroactive: profiles.invite_code exists live but was never versioned. Must
-- precede 20260526042412, which adds its generator, trigger and backfill.
-- Idempotent; a no-op on the live database.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code text;
