ALTER TABLE public.user_vault_benefits
  ADD COLUMN IF NOT EXISTS travel_documents jsonb NOT NULL DEFAULT '[]'::jsonb;