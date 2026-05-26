
REVOKE EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_trip_collaborator(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_trip_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invitar_amigo_viaje(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trip_collaborator(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_trip_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invitar_amigo_viaje(uuid, uuid) TO authenticated;
