-- T-P2-3 y T-P2-4 (segunda auditoría, grupo transversal): documentos del viaje. Idempotente.
--
-- T-P2-4. Antes todos los colaboradores veían (fila y archivo) el pasaporte de los demás. Ahora cada
-- documento tiene visibility: 'viaje' (todos los del viaje) o 'solo_yo' (solo quien lo subió; ni el
-- dueño del viaje). Por omisión 'solo_yo' para pasaporte y visa (tipo nuevo), 'viaje' para lo demás.
-- Los pasaportes que ya existen pasan a 'solo_yo'. Lo cambia solo quien lo subió
-- (set_trip_document_visibility).
--
-- T-P2-3. Antes, al borrar el viaje sus archivos (trip-documents y fotos del diario, de cualquiera que
-- los subió) se quedaban en storage sin que nadie pudiera verlos ni borrarlos, y el borrado de cuenta
-- del dueño ya no los encontraba. Storage solo se borra con su API (no con SQL), así que:
--   * un trigger BEFORE DELETE en trips anota TODOS los archivos del viaje en storage_purge_queue
--     (user_id = dueño del viaje); también se anotan los huérfanos que ya existen;
--   * la función trip-files-purge (llave de servicio) los borra: la app la llama justo después de
--     borrar el viaje (vacía la cola de esa persona) y como tarea programada vacía el resto;
--   * account_deletion_files incluye lo que siga en la cola de esa persona, y purge_account_data deja
--     la cola sin su id (los archivos se siguen borrando por la tarea programada).

-- ═════════════ T-P2-4: visibilidad por documento ═════════════
ALTER TABLE public.trip_documents DROP CONSTRAINT IF EXISTS trip_documents_kind_check;
ALTER TABLE public.trip_documents ADD CONSTRAINT trip_documents_kind_check
  CHECK (kind IN ('boleto', 'pasaporte', 'visa', 'poliza', 'reserva', 'otro'));

ALTER TABLE public.trip_documents ADD COLUMN IF NOT EXISTS visibility text;
UPDATE public.trip_documents
   SET visibility = CASE WHEN kind IN ('pasaporte', 'visa') THEN 'solo_yo' ELSE 'viaje' END
 WHERE visibility IS NULL;
ALTER TABLE public.trip_documents ALTER COLUMN visibility SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_documents_visibility_chk') THEN
    ALTER TABLE public.trip_documents ADD CONSTRAINT trip_documents_visibility_chk CHECK (visibility IN ('viaje', 'solo_yo'));
  END IF;
END $$;

-- Valor por omisión según el tipo (si el cliente no lo manda).
CREATE OR REPLACE FUNCTION public.trip_documents_default_visibility()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.visibility := coalesce(NEW.visibility, CASE WHEN NEW.kind IN ('pasaporte', 'visa') THEN 'solo_yo' ELSE 'viaje' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trip_documents_default_visibility() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trip_documents_default_visibility ON public.trip_documents;
CREATE TRIGGER trip_documents_default_visibility BEFORE INSERT ON public.trip_documents
  FOR EACH ROW EXECUTE FUNCTION public.trip_documents_default_visibility();

-- Fila: los del viaje ven lo 'viaje'; lo 'solo_yo' solo quien lo subió.
DROP POLICY IF EXISTS trip_documents_select ON public.trip_documents;
CREATE POLICY trip_documents_select ON public.trip_documents FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()) AND (visibility = 'viaje' OR uploaded_by = auth.uid()));

-- Archivo: además de tener acceso al viaje, la fila debe ser visible para quien pregunta (o ser suyo).
-- SECURITY DEFINER: la política no puede depender de lo que RLS deja ver de trip_documents.
CREATE OR REPLACE FUNCTION public.trip_document_object_visible(p_name text, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND p_uid = auth.uid()  -- solo responde por quien pregunta
     AND EXISTS (SELECT 1 FROM public.trip_documents d
                  WHERE d.storage_path = p_name AND (d.visibility = 'viaje' OR d.uploaded_by = p_uid));
$$;
REVOKE ALL ON FUNCTION public.trip_document_object_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_document_object_visible(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS trip_documents_obj_select ON storage.objects;
CREATE POLICY trip_documents_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-documents'
    AND public.has_trip_access(public.trip_document_path_trip(name), auth.uid())
    AND (owner_id = (auth.uid())::text OR owner = auth.uid() OR public.trip_document_object_visible(name, auth.uid()))
  );

-- Cambiar la visibilidad: solo quien lo subió (sin UPDATE directo para clientes).
CREATE OR REPLACE FUNCTION public.set_trip_document_visibility(p_id uuid, p_visibility text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_visibility IS NULL OR p_visibility NOT IN ('viaje', 'solo_yo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'visibilidad_invalida');
  END IF;
  UPDATE public.trip_documents SET visibility = p_visibility
   WHERE id = p_id AND uploaded_by = v_me AND public.has_trip_access(trip_id, v_me);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_permitido'); END IF;
  RETURN jsonb_build_object('ok', true, 'visibility', p_visibility);
END $$;
REVOKE ALL ON FUNCTION public.set_trip_document_visibility(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_trip_document_visibility(uuid, text) TO authenticated;

-- ═════════════ T-P2-3: archivos del viaje borrado ═════════════
CREATE TABLE IF NOT EXISTS public.storage_purge_queue (
  id        bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  bucket_id text NOT NULL,
  name      text NOT NULL,
  -- Quien puede pedir que se vacíe (dueño del viaje). NULL: solo la tarea programada.
  user_id   uuid,
  reason    text NOT NULL DEFAULT 'trip_deleted' CHECK (reason IN ('trip_deleted', 'huerfano')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_purge_queue_unique UNIQUE (bucket_id, name)
);
CREATE INDEX IF NOT EXISTS idx_storage_purge_queue_user ON public.storage_purge_queue (user_id, queued_at);
ALTER TABLE public.storage_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_purge_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storage_purge_queue TO service_role;

-- Antes de borrar el viaje: todos sus archivos, sin importar quién los subió.
CREATE OR REPLACE FUNCTION public.trips_queue_storage_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_purge_queue (bucket_id, name, user_id, reason)
  SELECT o.bucket_id, o.name, OLD.user_id, 'trip_deleted'
    FROM storage.objects o
   WHERE (o.bucket_id = 'trip-documents' AND public.trip_document_path_trip(o.name) = OLD.id)
      OR (o.bucket_id = 'journal-photos' AND split_part(o.name, '/', 2) = OLD.id::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.trips_queue_storage_purge() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trips_queue_storage_purge ON public.trips;
CREATE TRIGGER trips_queue_storage_purge BEFORE DELETE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_queue_storage_purge();

-- Huérfanos que ya existen (viajes borrados antes de esta corrección).
INSERT INTO public.storage_purge_queue (bucket_id, name, user_id, reason)
SELECT o.bucket_id, o.name, NULL, 'huerfano'
  FROM storage.objects o
 WHERE (o.bucket_id = 'trip-documents'
        AND public.trip_document_path_trip(o.name) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = public.trip_document_path_trip(o.name)))
    OR (o.bucket_id = 'journal-photos'
        AND split_part(o.name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = split_part(o.name, '/', 2)::uuid))
ON CONFLICT (bucket_id, name) DO NOTHING;

-- Borrado de cuenta: la versión de 20261022143100 + lo que siga en la cola de esa persona.
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
       AND public.trip_document_path_trip(o.name) IN (SELECT t.id FROM public.trips t WHERE t.user_id = p_user_id))
   OR EXISTS (SELECT 1 FROM public.storage_purge_queue q
               WHERE q.user_id = p_user_id AND q.bucket_id = o.bucket_id AND q.name = o.name);
$$;
REVOKE ALL ON FUNCTION public.account_deletion_files(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_files(uuid) TO service_role;

-- purge_account_data: la versión de 20261018120000; al final, la cola queda sin el id de la persona
-- (el borrado de sus viajes acaba de anotar lo que quedara; lo vacía la tarea programada).
CREATE OR REPLACE FUNCTION public.purge_account_data(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t record; v_trips uuid[]; v_count integer; v_counts jsonb := '{}'::jsonb;
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_trips FROM public.trips WHERE user_id=p_user_id;
 -- Remove only relationships involving this identity, never the other person's profile/trip.
 DELETE FROM public.friendships WHERE requester_id=p_user_id OR addressee_id=p_user_id;
 DELETE FROM public.trip_collaborators WHERE user_id=p_user_id OR invited_by=p_user_id OR trip_id=ANY(v_trips);
 DELETE FROM public.trip_journal_entries WHERE author_id=p_user_id;
 DELETE FROM public.notifications WHERE related_id=ANY(v_trips);
 DELETE FROM public.referrals WHERE referrer_id=p_user_id;
 -- These two legacy trip references have no FK; detach others' records explicitly.
 UPDATE public.concierge_requests SET trip_id=NULL WHERE trip_id=ANY(v_trips) AND user_id<>p_user_id;
 UPDATE public.tracked_flights SET trip_id=NULL WHERE trip_id=ANY(v_trips) AND user_id<>p_user_id;
 -- Enumerate actual base tables, not views: new user_id tables are covered automatically.
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables b ON b.table_schema=c.table_schema AND b.table_name=c.table_name
 WHERE c.table_schema='public' AND c.column_name='user_id' AND c.udt_name='uuid' AND b.table_type='BASE TABLE' AND c.table_name<>'trips' ORDER BY c.table_name
 LOOP
   EXECUTE format('DELETE FROM public.%I WHERE user_id = $1',t.table_name) USING p_user_id;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   v_counts := v_counts || jsonb_build_object(t.table_name,v_count);
 END LOOP;
 DELETE FROM public.rate_limits WHERE subject='user:'||p_user_id::text OR subject=p_user_id::text;
 -- Cascades remove journal, packing and split data of owned trips. SET NULL FKs retain others' personal records.
 DELETE FROM public.trips WHERE user_id=p_user_id;
 DELETE FROM public.profiles WHERE id=p_user_id;
 -- T-P2-3: lo que el borrado de sus viajes anotó en la cola sigue pendiente, pero sin su id.
 UPDATE public.storage_purge_queue SET user_id = NULL WHERE user_id = p_user_id;
 RETURN jsonb_build_object('ok',true,'tables',v_counts);
END $$;
REVOKE ALL ON FUNCTION public.purge_account_data(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_data(uuid) TO service_role;
