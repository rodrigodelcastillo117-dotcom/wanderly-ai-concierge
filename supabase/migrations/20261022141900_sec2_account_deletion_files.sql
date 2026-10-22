-- F-18 (IATOS-108): archivos que quedaban al borrar la cuenta. Idempotente.
-- account_deletion_files ya devolvía, en TODOS los buckets, los objetos subidos por el usuario
-- (owner/owner_id) y los que están bajo su carpeta (<uid>/… y avatars/<uid>/…). Faltaban las fotos
-- del diario que otros miembros subieron a los viajes de los que el usuario es DUEÑO
-- (journal-photos/<otro_uid>/<trip_id>/…): al borrar la cuenta el viaje y sus entradas se borran
-- en cascada y esas fotos quedaban huérfanas, públicas por URL y sin dueño que las pudiera borrar.
-- delete-account llama a esta función ANTES de purge_account_data, cuando los viajes aún existen.
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
       AND (storage.foldername(o.name))[2] IN (SELECT t.id::text FROM public.trips t WHERE t.user_id = p_user_id));
$$;
REVOKE ALL ON FUNCTION public.account_deletion_files(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_files(uuid) TO service_role;
