-- F-10 (IATOS-053): un amigo aceptado podía leer la fila COMPLETA del perfil del otro (correo,
-- fecha de nacimiento, programas de lealtad, food_dna y ahora active_trip_id) porque la política
-- profiles_select_friends filtra por fila y no por columna. Idempotente.
--
-- Ahora los amigos solo ven lo que la app muestra (Social, Compatibilidad, Compartir viaje,
-- Invitar al viaje): id, nombre, usuario y avatar, mediante esta función. Es SECURITY DEFINER
-- porque, ya sin la política, el invocador no puede leer filas ajenas de profiles; el filtro de
-- amistad aceptada con auth.uid() va dentro de la función y solo devuelve esas 4 columnas.
CREATE OR REPLACE FUNCTION public.friend_profiles(p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, full_name text, username text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.username, p.avatar_url
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL
     AND p.id <> auth.uid()
     AND (p_ids IS NULL OR p.id = ANY (p_ids))
     AND EXISTS (
       SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = auth.uid() AND f.addressee_id = p.id)
            OR (f.addressee_id = auth.uid() AND f.requester_id = p.id))
     )
   ORDER BY p.full_name NULLS LAST, p.id;
$$;
REVOKE ALL ON FUNCTION public.friend_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_profiles(uuid[]) TO authenticated, service_role;

-- Ya nadie lee perfiles ajenos directamente: el frontend usa friend_profiles(), y
-- compatibilidad_viaje / invitar_amigo_viaje / share-trip-notify no leen el perfil del amigo.
DROP POLICY IF EXISTS profiles_select_friends ON public.profiles;
