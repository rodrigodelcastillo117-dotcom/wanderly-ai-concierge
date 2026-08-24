REVOKE ALL ON FUNCTION public.is_pro(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_access_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_free_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pro(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_access_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_free_quota(uuid, text) TO service_role;