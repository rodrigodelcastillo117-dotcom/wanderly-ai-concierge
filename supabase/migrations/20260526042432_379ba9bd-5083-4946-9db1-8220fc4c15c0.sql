
revoke execute on function public.agregar_amigo_por_codigo(text) from public, anon;
revoke execute on function public.compatibilidad_viaje(uuid) from public, anon;
revoke execute on function public.gen_invite_code() from public, anon;
alter function public.gen_invite_code() set search_path = public;
