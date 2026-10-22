-- T-P2-2 (segunda auditoría, grupo transversal; JR1, JR2, JR2b): fotos del diario y de "Mejores
-- momentos" en buckets PRIVADOS con enlace firmado. Idempotente.
--
-- Antes: journal-photos y travel-moments eran públicos; la app guardaba getPublicUrl() de la foto
-- ORIGINAL (con EXIF/GPS) y esa URL seguía abierta para siempre, también para un colaborador
-- expulsado o para quien recibiera el enlace. Un extraño podía subir a journal-photos/<su uid>/<viaje
-- ajeno>/… y los miembros del viaje veían ese objeto.
--
-- Ahora:
--   * journal-photos pasa a PRIVADO. Las fotos se quedan en la misma ruta (no hay que moverlas): la
--     entrada guarda photo_path y la app pide un enlace firmado (1 h) a quien tiene acceso al viaje.
--     Las entradas viejas reciben photo_path a partir de su URL pública.
--   * "Mejores momentos" nuevos van a travel-moments-private (privado, solo JPEG ya sin metadatos,
--     ruta {uid}/{uuid}.jpg) y la fila guarda image_path. travel-moments SIGUE público porque ahí
--     vive el avatar que ven los amigos (profiles.avatar_url); los momentos viejos que siguen ahí se
--     mueven con scripts/privacidad/migrar_fotos_privadas.ts (llave de servicio, requiere
--     autorización: storage solo se mueve con su API, no con SQL).
--   * Subir a journal-photos exige acceso al viaje de la carpeta; ver un objeto exige además que
--     exista la entrada del diario que lo usa (lo plantado antes no se ve); el dueño del viaje puede
--     borrar la foto de una entrada ajena (al borrar la entrada).

-- ───── Buckets ─────
UPDATE storage.buckets SET public = false WHERE id = 'journal-photos';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('travel-moments-private', 'travel-moments-private', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ───── Diario: photo_path ─────
ALTER TABLE public.trip_journal_entries ADD COLUMN IF NOT EXISTS photo_path text;

-- Entradas viejas: la ruta sale de la URL pública (…/journal-photos/<ruta>[?…]) si es de su autor y viaje.
UPDATE public.trip_journal_entries e
   SET photo_path = x.p
  FROM (SELECT id, split_part(substring(photo_url FROM '/journal-photos/(.+)$'), '?', 1) AS p
          FROM public.trip_journal_entries
         WHERE photo_path IS NULL AND photo_url LIKE '%/journal-photos/%') x
 WHERE e.id = x.id
   AND x.p LIKE e.author_id::text || '/' || e.trip_id::text || '/%'
   AND x.p !~ '\.\.' AND array_length(string_to_array(x.p, '/'), 1) = 3;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_journal_photo_path_own') THEN
    ALTER TABLE public.trip_journal_entries ADD CONSTRAINT trip_journal_photo_path_own CHECK (
      photo_path IS NULL OR (
        photo_path LIKE author_id::text || '/' || trip_id::text || '/%'
        AND photo_path !~ '\.\.' AND array_length(string_to_array(photo_path, '/'), 1) = 3)) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_journal_photo_path ON public.trip_journal_entries (photo_path) WHERE photo_path IS NOT NULL;

-- ───── Momentos: image_path (privado) ─────
ALTER TABLE public.travel_moments ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.travel_moments ALTER COLUMN image_url DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'travel_moments_image_present') THEN
    ALTER TABLE public.travel_moments ADD CONSTRAINT travel_moments_image_present
      CHECK (image_url IS NOT NULL OR image_path IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'travel_moments_image_path_own') THEN
    ALTER TABLE public.travel_moments ADD CONSTRAINT travel_moments_image_path_own CHECK (
      image_path IS NULL
      OR image_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'));
  END IF;
END $$;

-- ───── storage.objects: journal-photos ─────
-- ¿El objeto es la foto de una entrada del diario de un viaje al que p_uid tiene acceso?
-- SECURITY DEFINER: la política no debe depender de lo que RLS deja ver de trip_journal_entries.
CREATE OR REPLACE FUNCTION public.journal_photo_visible(p_name text, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND p_uid = auth.uid()  -- solo responde por quien pregunta (sin oráculo)
     AND split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND public.has_trip_access(split_part(p_name, '/', 2)::uuid, p_uid)
     AND EXISTS (SELECT 1 FROM public.trip_journal_entries e
                  WHERE e.photo_path = p_name AND e.trip_id = split_part(p_name, '/', 2)::uuid);
$$;
REVOKE ALL ON FUNCTION public.journal_photo_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_photo_visible(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS journal_photos_read_members ON storage.objects;
CREATE POLICY journal_photos_read_members ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'journal-photos' AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.journal_photo_visible(name, auth.uid())
    )
  );

DROP POLICY IF EXISTS journal_photos_insert ON storage.objects;
CREATE POLICY journal_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'journal-photos'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND array_length(string_to_array(name, '/'), 1) = 3
    AND public.has_trip_access(((storage.foldername(name))[2])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS journal_photos_delete ON storage.objects;
CREATE POLICY journal_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'journal-photos' AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR ((storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND public.is_trip_owner(((storage.foldername(name))[2])::uuid, auth.uid()))
    )
  );

-- ───── storage.objects: travel-moments-private (solo la persona) ─────
DROP POLICY IF EXISTS travel_moments_private_select ON storage.objects;
CREATE POLICY travel_moments_private_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'travel-moments-private' AND (auth.uid())::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS travel_moments_private_insert ON storage.objects;
CREATE POLICY travel_moments_private_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'travel-moments-private'
    AND name ~ ('^' || (auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );
DROP POLICY IF EXISTS travel_moments_private_delete ON storage.objects;
CREATE POLICY travel_moments_private_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'travel-moments-private' AND (auth.uid())::text = (storage.foldername(name))[1]);
-- Sin UPDATE: una foto no se sobrescribe (se borra y se sube otra).
