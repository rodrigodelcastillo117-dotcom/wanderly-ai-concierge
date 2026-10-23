-- Avatar por capas e inventario de fondos y objetos (grupo avatar-inventario). Idempotente.
--
-- La IA se usa UNA vez por persona (crear el avatar desde la selfie, con el juez de parecido). La
-- persona se genera sobre verde croma y se recorta en código; después su avatar público es
-- fondo de SU país + persona recortada + hasta 3 objetos de sus viajes, compuesto sin IA (0 USD).
--
-- 1) Bucket PÚBLICO avatar-assets: fondos (hasta 3 por país) y objetos (2 por lugar) que generamos
--    una sola vez con scripts/avatar-assets/generate.mjs. Solo service_role escribe.
-- 2) avatar_assets: qué imágenes del inventario ya existen (id, tipo, ruta, huella del prompt). El
--    script la usa para no volver a pagar lo que ya generó; la app, para no ofrecer lo que aún no hay.
-- 3) avatar_profiles: capas (la imagen base es una persona recortada), pais_fondo (país de origen
--    confirmado por la persona), fondo_id y objetos visibles (máx. 3).
-- 4) avatar_variants.recortada: la variante quedó recortada (si el modelo no respetó el fondo plano,
--    se guarda tal cual y ese avatar sigue el camino anterior).
-- 5) Cuerpo completo (pedido del dueño): la versión con capas es de cuerpo entero. Se publican DOS
--    imágenes: el cuerpo completo (cuerpo_url/cuerpo_path: Perfil, tarjeta, compartir) y el recorte de
--    la cara (current_url/current_path = profiles.avatar_url: todos los círculos, también los de los
--    amigos). cara = rectángulo de la cara en la persona [cx, cy, lado] y mano = punto de la mano
--    levantada [x, y], ambos en fracciones 0-1; se calculan al crear (cara: del recorte; mano: el juez).

-- ───── 1) bucket público del inventario ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatar-assets', 'avatar-assets', true, 4194304, ARRAY['image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Sin políticas de escritura para anon/authenticated en storage.objects: solo service_role sube.
-- Las imágenes son arte genérico (paisajes y objetos), sin datos de nadie: se leen por URL pública.

-- ───── 2) catálogo de lo ya generado ─────
CREATE TABLE IF NOT EXISTS public.avatar_assets (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id) <= 60),
  kind         text NOT NULL CHECK (kind IN ('fondo', 'objeto')),
  pais         text CHECK (pais IS NULL OR pais ~ '^[A-Z]{2}$'),
  souvenir_key text CHECK (souvenir_key IS NULL OR souvenir_key ~ '^(ciudad|pais|generico):[A-Za-z0-9-]{2,40}$'),
  path         text NOT NULL UNIQUE,
  prompt_hash  text NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{16}$'),
  width        integer NOT NULL CHECK (width BETWEEN 64 AND 4096),
  height       integer NOT NULL CHECK (height BETWEEN 64 AND 4096),
  bytes        integer NOT NULL CHECK (bytes BETWEEN 1 AND 4194304),
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_assets_path_kind CHECK (
    (kind = 'fondo' AND path = 'fondos/' || id || '.png' AND pais IS NOT NULL AND souvenir_key IS NULL)
    OR (kind = 'objeto' AND path = 'objetos/' || id || '.png' AND souvenir_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_avatar_assets_kind ON public.avatar_assets (kind, pais);

ALTER TABLE public.avatar_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_assets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.avatar_assets FROM authenticated;
GRANT SELECT ON public.avatar_assets TO authenticated;
GRANT ALL ON public.avatar_assets TO service_role;
DROP POLICY IF EXISTS avatar_assets_select_auth ON public.avatar_assets;
CREATE POLICY avatar_assets_select_auth ON public.avatar_assets FOR SELECT TO authenticated USING (true);

-- ───── 3) estado de capas en avatar_profiles ─────
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS capas boolean NOT NULL DEFAULT false;
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS pais_fondo text;
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS fondo_id text;
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS objetos text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_pais_fondo_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_pais_fondo_chk
  CHECK (pais_fondo IS NULL OR pais_fondo ~ '^[A-Z]{2}$');
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_fondo_id_chk;
-- El fondo siempre es del país de origen: su id empieza con el código del país en minúsculas.
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_fondo_id_chk
  CHECK (fondo_id IS NULL OR (pais_fondo IS NOT NULL AND fondo_id ~ ('^' || lower(pais_fondo) || '-[a-z0-9]+(-[a-z0-9]+)*$')));
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_objetos_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_objetos_chk
  CHECK (cardinality(objetos) <= 3
         AND array_to_string(objetos, '|') ~ '^([a-z0-9]+(-[a-z0-9]+)*(\|[a-z0-9]+(-[a-z0-9]+)*)*)?$');
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS cara real[];
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS mano real[];
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS cuerpo_url text;
ALTER TABLE public.avatar_profiles ADD COLUMN IF NOT EXISTS cuerpo_path text;
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_cara_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_cara_chk
  CHECK (cara IS NULL OR (cardinality(cara) = 3 AND 0 <= ALL (cara) AND 1 >= ALL (cara)));
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_mano_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_mano_chk
  CHECK (mano IS NULL OR (cardinality(mano) = 2 AND 0 <= ALL (mano) AND 1 >= ALL (mano)));
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_cuerpo_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_cuerpo_chk
  CHECK ((cuerpo_url IS NULL OR cuerpo_url LIKE 'https://%')
         AND (cuerpo_path IS NULL OR cuerpo_path ~ ('^avatars/' || user_id::text || '/[A-Za-z0-9._-]+$')));
ALTER TABLE public.avatar_profiles DROP CONSTRAINT IF EXISTS avatar_profiles_capas_base_chk;
ALTER TABLE public.avatar_profiles ADD CONSTRAINT avatar_profiles_capas_base_chk
  CHECK (NOT capas OR base_path IS NOT NULL);

-- ───── 4) variantes recortadas ─────
ALTER TABLE public.avatar_variants ADD COLUMN IF NOT EXISTS recortada boolean NOT NULL DEFAULT false;
ALTER TABLE public.avatar_variants ADD COLUMN IF NOT EXISTS cara real[];
ALTER TABLE public.avatar_variants ADD COLUMN IF NOT EXISTS mano real[];
ALTER TABLE public.avatar_variants DROP CONSTRAINT IF EXISTS avatar_variants_cara_chk;
ALTER TABLE public.avatar_variants ADD CONSTRAINT avatar_variants_cara_chk
  CHECK (cara IS NULL OR (cardinality(cara) = 3 AND 0 <= ALL (cara) AND 1 >= ALL (cara)));
ALTER TABLE public.avatar_variants DROP CONSTRAINT IF EXISTS avatar_variants_mano_chk;
ALTER TABLE public.avatar_variants ADD CONSTRAINT avatar_variants_mano_chk
  CHECK (mano IS NULL OR (cardinality(mano) = 2 AND 0 <= ALL (mano) AND 1 >= ALL (mano)));
