-- Correcciones de seguridad P0/P1 (auditoría 2026-10-22, hallazgos F-01, F-02, F-03, F-05, F-06).
-- Idempotente: se puede aplicar más de una vez. Ninguna pantalla escribe directo en estas tablas;
-- invitar, aceptar, agregar amigos y seguir vuelos pasan por funciones del servidor
-- (invitar_amigo_viaje, aceptar_invitacion_viaje, agregar_amigo_por_codigo, track-flight).

-- F-01: un usuario podía mover su propia fila de colaborador a cualquier viaje y marcarse "accepted".
DROP POLICY IF EXISTS trip_collab_update_self ON public.trip_collaborators;
DROP POLICY IF EXISTS trip_collab_insert_owner ON public.trip_collaborators;
REVOKE INSERT, UPDATE ON public.trip_collaborators FROM anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_collaborators_trip_fk') THEN
    ALTER TABLE public.trip_collaborators ADD CONSTRAINT trip_collaborators_trip_fk
      FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- F-02: una amistad "accepted" se podía crear sin el consentimiento de la otra persona.
DROP POLICY IF EXISTS friend_insert_self ON public.friendships;
DROP POLICY IF EXISTS friend_update_involved ON public.friendships;
REVOKE INSERT, UPDATE ON public.friendships FROM anon, authenticated;

-- F-03: los buckets journal-photos y travel-moments se podían listar con la llave pública,
-- exponiendo fotos e IDs de todos los usuarios. Los enlaces públicos de cada foto siguen
-- funcionando; solo se quita el listado y la lectura vía API a quien no es dueño o miembro.
DROP POLICY IF EXISTS journal_photos_read ON storage.objects;
DROP POLICY IF EXISTS "Moments public read" ON storage.objects;
DROP POLICY IF EXISTS journal_photos_read_members ON storage.objects;
DROP POLICY IF EXISTS travel_moments_read_own ON storage.objects;
CREATE POLICY journal_photos_read_members ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'journal-photos' AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.has_trip_access(((storage.foldername(name))[2])::uuid, auth.uid())
      )
    )
  );
CREATE POLICY travel_moments_read_own ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'travel-moments' AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR ((storage.foldername(name))[1] = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[2])
    )
  );

-- F-05: un colaborador podía quedarse con el viaje cambiando trips.user_id.
CREATE OR REPLACE FUNCTION public.trips_guard_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'No se puede cambiar el dueño de un viaje' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_guard_owner ON public.trips;
CREATE TRIGGER trips_guard_owner BEFORE UPDATE OF user_id ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_guard_owner();

-- F-06: cualquier usuario podía insertar vuelos seguidos sin límite (cada uno consume SerpApi
-- cada 15 min). track-flight usa la llave de servicio y aplica las validaciones.
REVOKE INSERT, UPDATE ON public.tracked_flights FROM anon, authenticated;
