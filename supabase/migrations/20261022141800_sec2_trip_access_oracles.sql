-- F-17 (IATOS-107): is_trip_owner / is_trip_collaborator / has_trip_access(p_trip, p_user) se
-- podían llamar por RPC con CUALQUIER p_user, y así preguntar "¿X es dueño/colaborador del viaje
-- Y?" sobre otras personas. Idempotente.
--
-- No se puede quitar EXECUTE a authenticated: las políticas RLS (trips, diario, packing, split,
-- trip_quotes, storage) llaman a estas funciones con los privilegios del usuario. En su lugar,
-- cuando la petición viene de un cliente (rol anon/authenticated o un JWT con usuario), solo
-- contestan sobre el propio usuario (p_user = auth.uid()); para cualquier otro p_user responden
-- false. Todas las llamadas existentes ya pasan auth.uid() (políticas, storage, analizar-viaje) o
-- el propio id del perfil (profiles_guard_active_trip). El service role, los cron y los triggers
-- sin JWT siguen recibiendo la respuesta real.
CREATE OR REPLACE FUNCTION public._trip_check_is_foreign(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (coalesce(auth.role(), '') IN ('anon', 'authenticated') OR auth.uid() IS NOT NULL)
     AND p_user IS DISTINCT FROM auth.uid();
$$;
REVOKE ALL ON FUNCTION public._trip_check_is_foreign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._trip_check_is_foreign(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_trip_owner(p_trip uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public._trip_check_is_foreign(p_user)
     AND EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip AND user_id = p_user);
$$;

CREATE OR REPLACE FUNCTION public.is_trip_collaborator(p_trip uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public._trip_check_is_foreign(p_user)
     AND EXISTS (
       SELECT 1 FROM public.trip_collaborators
        WHERE trip_id = p_trip AND user_id = p_user AND status = 'accepted'
     );
$$;

CREATE OR REPLACE FUNCTION public.has_trip_access(p_trip uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_trip_owner(p_trip, p_user) OR public.is_trip_collaborator(p_trip, p_user);
$$;

REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_trip_collaborator(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_trip_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_trip_collaborator(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_trip_access(uuid, uuid) TO authenticated, service_role;

-- Este trigger preguntaba por OTRA persona (el colaborador que el dueño quita) y con la regla de
-- arriba recibiría siempre false. Se consulta la tabla directamente (corre como SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.clear_active_trip_on_collab_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET active_trip_id = NULL
   WHERE id = OLD.user_id AND active_trip_id = OLD.trip_id
     AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = OLD.trip_id AND t.user_id = OLD.user_id);
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_active_trip_on_collab_removed() FROM PUBLIC, anon, authenticated;
