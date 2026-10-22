-- Documentos del viaje (IATOS-100, diseño 3.5 de IATOS_ARQUITECTURA_OBJETIVO.md). Idempotente.
--
-- Boletos, pasaporte, pólizas y reservas en un bucket PRIVADO (no se repite el patrón público de
-- journal-photos). Ruta obligatoria {trip_id}/{uuid}-{nombre}. Acceso = has_trip_access(trip_id):
-- el dueño y los colaboradores aceptados. Borra quien lo subió o el dueño del viaje. Descarga solo
-- por enlace firmado (el cliente lo pide con 60 s de vida). Tipo y tamaño los limita el bucket y
-- también los CHECK de la tabla.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-documents', 'trip-documents', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.trip_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  -- Si la persona borra su cuenta, sus documentos se van con ella (el archivo lo borra delete-account).
  uploaded_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('boleto', 'pasaporte', 'poliza', 'reserva', 'otro')),
  storage_path text NOT NULL UNIQUE,
  filename     text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  mime         text NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size         bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- La ruta debe vivir dentro de la carpeta de SU viaje: {trip_id}/{uuid}-{nombre}.
  CONSTRAINT trip_documents_path_in_trip CHECK (
    storage_path LIKE trip_id::text || '/%' AND position('/' IN substr(storage_path, 38)) = 0
    AND storage_path !~ '\.\.'
  )
);
CREATE INDEX IF NOT EXISTS idx_trip_documents_trip ON public.trip_documents (trip_id, created_at DESC);

ALTER TABLE public.trip_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_documents FROM anon;
REVOKE UPDATE, TRUNCATE ON public.trip_documents FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.trip_documents TO authenticated;
GRANT ALL ON public.trip_documents TO service_role;

DROP POLICY IF EXISTS trip_documents_select ON public.trip_documents;
CREATE POLICY trip_documents_select ON public.trip_documents FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS trip_documents_insert ON public.trip_documents;
CREATE POLICY trip_documents_insert ON public.trip_documents FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS trip_documents_delete ON public.trip_documents;
CREATE POLICY trip_documents_delete ON public.trip_documents FOR DELETE TO authenticated
  USING (
    public.has_trip_access(trip_id, auth.uid())
    AND (uploaded_by = auth.uid() OR public.is_trip_owner(trip_id, auth.uid()))
  );

-- ───── storage.objects del bucket trip-documents ─────
-- Primer segmento de la ruta = trip_id (validado como UUID antes de convertir).
CREATE OR REPLACE FUNCTION public.trip_document_path_trip(p_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND array_length(string_to_array(p_name, '/'), 1) = 2
              AND split_part(p_name, '/', 2) <> ''
         THEN split_part(p_name, '/', 1)::uuid END;
$$;
GRANT EXECUTE ON FUNCTION public.trip_document_path_trip(text) TO authenticated, service_role;

DROP POLICY IF EXISTS trip_documents_obj_select ON storage.objects;
CREATE POLICY trip_documents_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'trip-documents' AND public.has_trip_access(public.trip_document_path_trip(name), auth.uid()));

DROP POLICY IF EXISTS trip_documents_obj_insert ON storage.objects;
CREATE POLICY trip_documents_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trip-documents' AND public.has_trip_access(public.trip_document_path_trip(name), auth.uid()));

DROP POLICY IF EXISTS trip_documents_obj_delete ON storage.objects;
CREATE POLICY trip_documents_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-documents'
    AND public.has_trip_access(public.trip_document_path_trip(name), auth.uid())
    AND (owner_id = (auth.uid())::text OR owner = auth.uid()
         OR public.is_trip_owner(public.trip_document_path_trip(name), auth.uid()))
  );
-- Sin política UPDATE: un documento no se sobrescribe (se borra y se sube otro).

-- Borrado de cuenta: la versión de 20261022141900 (F-18, fotos del diario de otros en sus viajes)
-- más los documentos que otros subieron a SUS viajes (el viaje se borra en cascada y quedarían
-- huérfanos en el bucket). delete-account la llama antes de purge_account_data.
CREATE OR REPLACE FUNCTION public.account_deletion_files(p_user_id uuid)
RETURNS TABLE (bucket_id text, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT o.bucket_id, o.name FROM storage.objects o
WHERE o.owner_id = p_user_id::text OR o.owner = p_user_id
   OR o.name LIKE p_user_id::text || '/%'
   OR o.name LIKE 'avatars/' || p_user_id::text || '/%'
   OR (o.bucket_id = 'journal-photos'
       AND (storage.foldername(o.name))[2] IN (SELECT t.id::text FROM public.trips t WHERE t.user_id = p_user_id))
   OR (o.bucket_id = 'trip-documents'
       AND public.trip_document_path_trip(o.name) IN (SELECT t.id FROM public.trips t WHERE t.user_id = p_user_id));
$$;
REVOKE ALL ON FUNCTION public.account_deletion_files(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_files(uuid) TO service_role;
