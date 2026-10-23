-- Recuerdos (oct 2026): las fotos y videos cortos que la persona sube de su celular o computadora,
-- guardados por fecha y por viaje (vista calendario y álbumes). IATOS Wrapped los usa para el resumen
-- y para el video «Hazme mi video». Idempotente.
--
-- Por qué una tabla nueva y no travel_moments: "Mejores momentos" son pocos y curados (pie de foto,
-- etiquetas de visión con IA que cuestan y alimentan el perfil de gustos, tope diario de etiquetado).
-- Recuerdos es el rollo de la cámara: muchas fotos, videos, fecha de captura, favoritas y álbum
-- compartible por viaje. Mezclarlos inundaría Mejores momentos y dispararía el etiquetado con IA.
-- La pantalla Recuerdos es una vista UNIFICADA: muestra estas filas más los Mejores momentos y las
-- fotos del diario propias (sin copiarlas).
--
-- Privacidad:
--   * Bucket PRIVADO `recuerdos`, ruta {uid}/{id}.jpg|mp4|mov (y la miniatura {uid}/{id}_t.jpg), donde
--     id es el de la fila. El cliente ya sube la copia sin EXIF ni GPS (fotos: JPEG reescrito y
--     limpiado a nivel de bytes; videos: las cajas udta/meta del MP4/MOV, donde va la ubicación, se
--     vuelven 'free').
--   * Cada quien ve solo lo suyo. Opcional y apagado por defecto: compartir el álbum de UN viaje con
--     sus miembros (recuerdos_album_shares). Lo compartido lo ven solo los miembros actuales del viaje
--     (dueño o colaborador aceptado) y solo mientras quien lo compartió también siga en el viaje.
--   * anon no tiene acceso a nada.
-- Borrado:
--   * Cuenta: purge_account_data borra las filas (tienen user_id) y account_deletion_files ya incluye
--     los objetos {uid}/… de cualquier bucket.
--   * Viaje: un trigger BEFORE DELETE en trips anota en storage_purge_queue los archivos de las fotos
--     del DUEÑO del viaje ligadas a él y borra esas filas (lo pidió el dueño de IATOS: "si son de un
--     viaje, también con el viaje"). Las fotos de los colaboradores son suyas: se quedan en su
--     calendario sin viaje (FK ON DELETE SET NULL) y el álbum compartido desaparece (CASCADE).

-- ───── Bucket ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recuerdos', 'recuerdos', false, 52428800, ARRAY['image/jpeg', 'video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ───── Tabla ─────
CREATE TABLE IF NOT EXISTS public.recuerdos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  trip_id      uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  media_type   text NOT NULL CHECK (media_type IN ('foto', 'video')),
  mime_type    text NOT NULL CHECK (mime_type IN ('image/jpeg', 'video/mp4', 'video/quicktime')),
  storage_path text NOT NULL,
  thumb_path   text,
  bytes        integer NOT NULL CHECK (bytes > 0 AND bytes <= 52428800),
  width        integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height       integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  duration_s   numeric(6, 2) CHECK (duration_s IS NULL OR (duration_s >= 0 AND duration_s <= 61)),
  -- Día del calendario (fecha local de la foto) y, si se conoce, el instante.
  taken_on     date NOT NULL,
  taken_at     timestamptz,
  -- De dónde salió la fecha: EXIF de la foto, metadatos del video, fecha del archivo o a mano.
  date_source  text NOT NULL CHECK (date_source IN ('exif', 'video', 'archivo', 'manual')),
  -- Cómo se eligió el viaje: por fecha (automático), a mano o sin viaje.
  trip_source  text NOT NULL DEFAULT 'ninguno' CHECK (trip_source IN ('fecha', 'manual', 'ninguno')),
  favorite     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recuerdos_storage_path_key UNIQUE (storage_path),
  CONSTRAINT recuerdos_path_own CHECK (
    storage_path = user_id::text || '/' || id::text || CASE mime_type WHEN 'image/jpeg' THEN '.jpg' WHEN 'video/mp4' THEN '.mp4' ELSE '.mov' END),
  CONSTRAINT recuerdos_thumb_own CHECK (thumb_path IS NULL OR thumb_path = user_id::text || '/' || id::text || '_t.jpg'),
  CONSTRAINT recuerdos_media_mime CHECK ((media_type = 'foto') = (mime_type = 'image/jpeg')),
  CONSTRAINT recuerdos_video_duration CHECK (media_type = 'video' OR duration_s IS NULL),
  CONSTRAINT recuerdos_taken_on_range CHECK (taken_on >= DATE '1990-01-01')
);
CREATE INDEX IF NOT EXISTS idx_recuerdos_user_day ON public.recuerdos (user_id, taken_on);
CREATE INDEX IF NOT EXISTS idx_recuerdos_trip ON public.recuerdos (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recuerdos_thumb ON public.recuerdos (thumb_path) WHERE thumb_path IS NOT NULL;

-- Álbum de un viaje compartido con sus miembros (una fila = compartido; sin fila = privado).
CREATE TABLE IF NOT EXISTS public.recuerdos_album_shares (
  user_id    uuid NOT NULL,
  trip_id    uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trip_id)
);
CREATE INDEX IF NOT EXISTS idx_recuerdos_album_shares_trip ON public.recuerdos_album_shares (trip_id);

ALTER TABLE public.recuerdos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recuerdos_album_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recuerdos, public.recuerdos_album_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.recuerdos TO authenticated;
-- Lo único que se cambia después de subir: el viaje (y cómo se eligió) y la estrella de favorita.
GRANT UPDATE (trip_id, trip_source, favorite) ON public.recuerdos TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.recuerdos_album_shares TO authenticated;
GRANT ALL ON public.recuerdos, public.recuerdos_album_shares TO service_role;

-- ───── ¿Puedo ver lo que p_owner subió a p_trip? ─────
-- Solo responde por quien pregunta (auth.uid()); consulta las tablas directamente porque
-- has_trip_access no contesta por otra persona desde un cliente (F-17). No es un oráculo útil: si da
-- true, quien pregunta es miembro del viaje y de todos modos ve esas fotos.
CREATE OR REPLACE FUNCTION public.recuerdo_shared_with_me(p_owner uuid, p_trip uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND p_trip IS NOT NULL AND p_owner IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.recuerdos_album_shares s WHERE s.user_id = p_owner AND s.trip_id = p_trip)
     AND EXISTS (SELECT 1 FROM public.trips t
                  WHERE t.id = p_trip
                    AND (t.user_id = auth.uid()
                         OR EXISTS (SELECT 1 FROM public.trip_collaborators c
                                     WHERE c.trip_id = t.id AND c.user_id = auth.uid() AND c.status = 'accepted'))
                    AND (t.user_id = p_owner
                         OR EXISTS (SELECT 1 FROM public.trip_collaborators c
                                     WHERE c.trip_id = t.id AND c.user_id = p_owner AND c.status = 'accepted')));
$$;
REVOKE ALL ON FUNCTION public.recuerdo_shared_with_me(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recuerdo_shared_with_me(uuid, uuid) TO authenticated, service_role;

-- ───── Políticas: recuerdos ─────
DROP POLICY IF EXISTS recuerdos_select ON public.recuerdos;
CREATE POLICY recuerdos_select ON public.recuerdos FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.recuerdo_shared_with_me(user_id, trip_id));
DROP POLICY IF EXISTS recuerdos_insert ON public.recuerdos;
CREATE POLICY recuerdos_insert ON public.recuerdos FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS recuerdos_update ON public.recuerdos;
CREATE POLICY recuerdos_update ON public.recuerdos FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS recuerdos_delete ON public.recuerdos;
CREATE POLICY recuerdos_delete ON public.recuerdos FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ───── Políticas: álbumes compartidos (solo quien comparte ve y cambia sus filas) ─────
DROP POLICY IF EXISTS recuerdos_album_shares_select ON public.recuerdos_album_shares;
CREATE POLICY recuerdos_album_shares_select ON public.recuerdos_album_shares FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS recuerdos_album_shares_insert ON public.recuerdos_album_shares;
CREATE POLICY recuerdos_album_shares_insert ON public.recuerdos_album_shares FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS recuerdos_album_shares_delete ON public.recuerdos_album_shares;
CREATE POLICY recuerdos_album_shares_delete ON public.recuerdos_album_shares FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ───── Reglas al subir: cupo por persona y fechas razonables ─────
CREATE OR REPLACE FUNCTION public.recuerdos_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Fecha de captura en el futuro (reloj mal puesto): se rechaza; el cliente usa la del archivo.
    IF NEW.taken_on > current_date + 1 THEN RAISE EXCEPTION 'recuerdos_fecha_futura' USING ERRCODE = '22007'; END IF;
    -- Costo de almacenamiento acotado: 5000 recuerdos por persona.
    IF (SELECT count(*) FROM public.recuerdos WHERE user_id = NEW.user_id) >= 5000 THEN
      RAISE EXCEPTION 'recuerdos_cupo' USING ERRCODE = '54000';
    END IF;
    NEW.created_at := now();
    IF NEW.trip_id IS NULL THEN NEW.trip_source := 'ninguno'; END IF;
  ELSE
    IF NEW.trip_id IS NULL THEN NEW.trip_source := 'ninguno';
    ELSIF NEW.trip_id IS DISTINCT FROM OLD.trip_id AND NEW.trip_source = 'ninguno' THEN NEW.trip_source := 'manual';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.recuerdos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS recuerdos_guard ON public.recuerdos;
CREATE TRIGGER recuerdos_guard BEFORE INSERT OR UPDATE ON public.recuerdos
  FOR EACH ROW EXECUTE FUNCTION public.recuerdos_guard();

-- ───── storage.objects: bucket recuerdos ─────
-- ¿El objeto es la foto (o miniatura) de un recuerdo compartido con quien pregunta?
CREATE OR REPLACE FUNCTION public.recuerdo_object_visible(p_name text, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND p_uid = auth.uid()  -- solo responde por quien pregunta
     AND EXISTS (SELECT 1 FROM public.recuerdos r
                  WHERE (r.storage_path = p_name OR r.thumb_path = p_name)
                    AND (r.user_id = p_uid OR public.recuerdo_shared_with_me(r.user_id, r.trip_id)));
$$;
REVOKE ALL ON FUNCTION public.recuerdo_object_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recuerdo_object_visible(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS recuerdos_obj_select ON storage.objects;
CREATE POLICY recuerdos_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'recuerdos' AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR public.recuerdo_object_visible(name, auth.uid())
  ));
DROP POLICY IF EXISTS recuerdos_obj_insert ON storage.objects;
CREATE POLICY recuerdos_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recuerdos'
    AND name ~ ('^' || (auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t\.jpg|\.jpg|\.mp4|\.mov)$')
  );
DROP POLICY IF EXISTS recuerdos_obj_delete ON storage.objects;
CREATE POLICY recuerdos_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'recuerdos' AND (auth.uid())::text = (storage.foldername(name))[1]);
-- Sin UPDATE: un archivo no se sobrescribe (se borra y se sube otro).

-- ───── Viaje borrado: las fotos del dueño ligadas a él se van con el viaje ─────
CREATE OR REPLACE FUNCTION public.trips_purge_recuerdos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_purge_queue (bucket_id, name, user_id, reason)
  SELECT 'recuerdos', p.name, OLD.user_id, 'trip_deleted'
    FROM public.recuerdos r
   CROSS JOIN LATERAL unnest(ARRAY[r.storage_path, r.thumb_path]) AS p(name)
   WHERE r.trip_id = OLD.id AND r.user_id = OLD.user_id AND p.name IS NOT NULL
  ON CONFLICT (bucket_id, name) DO NOTHING;
  DELETE FROM public.recuerdos WHERE trip_id = OLD.id AND user_id = OLD.user_id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.trips_purge_recuerdos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trips_purge_recuerdos ON public.trips;
CREATE TRIGGER trips_purge_recuerdos BEFORE DELETE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_purge_recuerdos();

COMMENT ON TABLE public.recuerdos IS
  'Recuerdos: fotos y videos cortos de la persona por fecha y viaje (bucket privado recuerdos, sin EXIF/GPS). Wrapped los usa.';
COMMENT ON TABLE public.recuerdos_album_shares IS
  'Álbum de Recuerdos de un viaje compartido con sus miembros (apagado por defecto).';
