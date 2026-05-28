ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS dates_optimized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dates_optimization_meta jsonb;