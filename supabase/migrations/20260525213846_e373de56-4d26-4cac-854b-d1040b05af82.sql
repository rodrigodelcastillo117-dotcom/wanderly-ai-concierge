ALTER TABLE public.travel_profiles
  ADD COLUMN IF NOT EXISTS llegada_estilo text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS descripcion_personal text,
  ADD COLUMN IF NOT EXISTS perfil_ia jsonb;