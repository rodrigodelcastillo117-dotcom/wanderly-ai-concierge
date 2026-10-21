-- Retroactive: columns the app reads that exist live (per src/integrations/supabase/types.ts)
-- but were never versioned and that no migration depends on. Idempotent; a no-op on the
-- live database. No index, constraint or default is added, so live behaviour is unchanged.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
