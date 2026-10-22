-- IATOS Wrapped (oct 2026): "Tu año en viajes". Idempotente.
--
-- Casi todo el resumen se arma en el navegador con consultas que ya respetan RLS (viajes propios y
-- compartidos, Mejores momentos, diario propio, gastos, lugares visitados y logros: cada tabla solo
-- devuelve filas de quien pregunta). Lo único que el cliente no puede leer es el NOMBRE de las
-- personas con las que compartió viaje: desde F-10 (20261022141300) nadie lee perfiles ajenos y
-- friend_profiles() solo cubre amistades aceptadas, pero un compañero de viaje puede no ser amigo.
--
-- wrapped_companions(p_year) devuelve, para el usuario en sesión (auth.uid()) y nada más:
--   * nombre visible (full_name o, si no hay, username) y número de viajes compartidos ese año;
--   * solo de miembros de viajes en los que él también es miembro (dueño o colaborador aceptado,
--     igual que has_trip_access) y que empezaron ese año calendario sin ser futuros;
--   * nunca ids, correos, avatares ni datos del viaje; sin parámetro de usuario: no hay forma de
--     pedir el resumen de otra persona.
-- Es SECURITY DEFINER porque sin la política de amigos el invocador no puede leer esos nombres; el
-- filtro por auth.uid() va dentro. anon no tiene EXECUTE.

CREATE OR REPLACE FUNCTION public.wrapped_companions(p_year integer)
RETURNS TABLE (name text, shared_trips integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    -- Año fuera de rango (o null): sin filas. least/greatest para que make_date nunca falle.
    SELECT auth.uid() AS uid,
           make_date(least(greatest(coalesce(p_year, 2000), 2000), 2100), 1, 1) AS d0,
           make_date(least(greatest(coalesce(p_year, 2000), 2000), 2100), 12, 31) AS d1
  ),
  my_trips AS (
    SELECT t.id, t.user_id AS owner_id
      FROM public.trips t, me
     WHERE me.uid IS NOT NULL
       AND p_year BETWEEN 2000 AND 2100
       AND t.fecha_salida IS NOT NULL
       AND t.fecha_salida >= me.d0
       AND t.fecha_salida <= me.d1
       AND t.fecha_salida <= current_date
       AND (t.user_id = me.uid
            OR EXISTS (SELECT 1 FROM public.trip_collaborators c
                        WHERE c.trip_id = t.id AND c.user_id = me.uid AND c.status = 'accepted'))
  ),
  members AS (
    SELECT mt.id AS trip_id, mt.owner_id AS member_id FROM my_trips mt
    UNION
    SELECT c.trip_id, c.user_id FROM public.trip_collaborators c
      JOIN my_trips mt ON mt.id = c.trip_id
     WHERE c.status = 'accepted'
  ),
  counted AS (
    SELECT m.member_id, count(DISTINCT m.trip_id)::integer AS n
      FROM members m, me
     WHERE m.member_id IS DISTINCT FROM me.uid
     GROUP BY m.member_id
  )
  SELECT left(coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), '')), 80) AS name, c.n AS shared_trips
    FROM counted c
    JOIN public.profiles p ON p.id = c.member_id
   WHERE coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), '')) IS NOT NULL
   ORDER BY c.n DESC, 1
   LIMIT 5;
$$;

COMMENT ON FUNCTION public.wrapped_companions(integer) IS
  'IATOS Wrapped: nombre y viajes compartidos de los compañeros de viaje del usuario en sesión (solo auth.uid()).';

REVOKE ALL ON FUNCTION public.wrapped_companions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wrapped_companions(integer) TO authenticated, service_role;
