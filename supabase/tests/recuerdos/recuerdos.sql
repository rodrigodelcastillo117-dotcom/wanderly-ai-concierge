-- Recuerdos (fotos por fecha y viaje) y aviso de créditos de IA a administradores.
-- Imprime "OK …" o "FALLA …". Requiere run.sh.
-- Usuarios (ids c1…): 1 Olga (dueña del viaje Lisboa) · 2 Carlos (colaborador aceptado en Lisboa)
--   3 Sara (ajena) · 4 Pedro (invitación pendiente en Lisboa) · 5 Admin (public.admins)
-- Viajes (ids c2…): 1 Lisboa (Olga) · 2 Roma (Olga, sin colaboradores) · 3 Oaxaca (Sara)
-- Recuerdos (ids c3…): 1 Olga/Lisboa foto+miniatura · 2 Olga/Roma · 3 Olga sin viaje · 4 Carlos/Lisboa · 5 Sara/Oaxaca
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.rc_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION public.rc_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION public.rc_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
  SET LOCAL ROLE anon;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Como la llave de servicio.
CREATE OR REPLACE FUNCTION public.rc_service(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Ids visibles de recuerdos (último dígito de cada uno, ordenados) para quien pregunta.
CREATE OR REPLACE FUNCTION public.rc_ids() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT $q$SELECT coalesce(string_agg(right(id::text, 1), ',' ORDER BY id), '') FROM public.recuerdos$q$
$$;
CREATE OR REPLACE FUNCTION public.rc_objs() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT $q$SELECT coalesce(string_agg(regexp_replace(name, '^.*/c3000000-0000-0000-0000-00000000000', ''), ',' ORDER BY name), '') FROM storage.objects WHERE bucket_id = 'recuerdos'$q$
$$;
GRANT EXECUTE ON FUNCTION public.rc_ok(text, boolean, text), public.rc_as(uuid, text), public.rc_anon(text), public.rc_service(text), public.rc_ids(), public.rc_objs() TO authenticated, anon, service_role;

INSERT INTO auth.users(id, email) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'rc-olga@example.test'),
  ('c1000000-0000-0000-0000-000000000002', 'rc-carlos@example.test'),
  ('c1000000-0000-0000-0000-000000000003', 'rc-sara@example.test'),
  ('c1000000-0000-0000-0000-000000000004', 'rc-pedro@example.test'),
  ('c1000000-0000-0000-0000-000000000005', 'rc-admin@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(id) SELECT id FROM auth.users WHERE id::text LIKE 'c1000000-%' ON CONFLICT DO NOTHING;

INSERT INTO public.trips(id, user_id, destino, fecha_salida, fecha_regreso) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Lisboa', current_date - 40, current_date - 33),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Roma', current_date - 20, current_date - 15),
  ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'Oaxaca', current_date - 60, current_date - 55);
INSERT INTO public.trip_collaborators(trip_id, user_id, invited_by, status) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'accepted'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'pending');

-- ───── Esquema y permisos ─────
SELECT public.rc_ok('R0 bucket recuerdos privado, 50 MB, solo JPEG/MP4/MOV',
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'recuerdos' AND NOT public AND file_size_limit = 52428800
          AND allowed_mime_types::text[] @> ARRAY['image/jpeg', 'video/mp4', 'video/quicktime']
          AND cardinality(allowed_mime_types) = 3));
SELECT public.rc_ok('R1 RLS activo en recuerdos y recuerdos_album_shares; anon sin ningún privilegio de tabla',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.recuerdos'::regclass, 'public.recuerdos_album_shares'::regclass))
  AND NOT has_table_privilege('anon', 'public.recuerdos', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.recuerdos_album_shares', 'SELECT,INSERT,UPDATE,DELETE'));
SELECT public.rc_ok('R2 authenticated solo puede cambiar viaje, origen del viaje y favorita (no la ruta ni el dueño)',
  has_column_privilege('authenticated', 'public.recuerdos', 'favorite', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.recuerdos', 'trip_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.recuerdos', 'storage_path', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.recuerdos', 'user_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.recuerdos', 'taken_on', 'UPDATE'));
SELECT public.rc_ok('R3 funciones SECURITY DEFINER con search_path fijo; anon sin EXECUTE',
  (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) FROM pg_proc p
    WHERE p.oid IN ('public.recuerdo_shared_with_me(uuid,uuid)'::regprocedure, 'public.recuerdo_object_visible(text,uuid)'::regprocedure,
                    'public.trips_purge_recuerdos()'::regprocedure, 'public.alert_admins_ai_credits(text,text)'::regprocedure))
  AND NOT has_function_privilege('anon', 'public.recuerdo_shared_with_me(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.recuerdo_object_visible(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.trips_purge_recuerdos()', 'EXECUTE'));

-- ───── Subir: cada quien lo suyo ─────
SELECT public.rc_ok('R4 Olga sube 3 recuerdos (Lisboa con miniatura, Roma y sin viaje)',
  public.rc_as('c1000000-0000-0000-0000-000000000001', $q$
    WITH x AS (INSERT INTO public.recuerdos(id, user_id, trip_id, media_type, mime_type, storage_path, thumb_path, bytes, taken_on, date_source, trip_source) VALUES
      ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001.jpg', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001_t.jpg', 1000, current_date - 38, 'exif', 'fecha'),
      ('c3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002', 'video', 'video/mp4',
       'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000002.mp4', NULL, 5000, current_date - 18, 'video', 'fecha'),
      ('c3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', NULL, 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000003.jpg', NULL, 1000, current_date - 2, 'archivo', 'fecha')
      RETURNING 1) SELECT count(*)::text FROM x$q$) = '3');
SELECT public.rc_ok('R5 sin viaje, trip_source queda en "ninguno" aunque el cliente mande otro',
  (SELECT trip_source FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000003') = 'ninguno');
SELECT public.rc_ok('R6 Carlos (colaborador) sube a Lisboa; Sara sube a su Oaxaca',
  public.rc_as('c1000000-0000-0000-0000-000000000002', $q$
    WITH x AS (INSERT INTO public.recuerdos(id, user_id, trip_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000002/c3000000-0000-0000-0000-000000000004.jpg', 1000, current_date - 37, 'exif') RETURNING 1) SELECT count(*)::text FROM x$q$) = '1'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    WITH x AS (INSERT INTO public.recuerdos(id, user_id, trip_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000003', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000005.jpg', 1000, current_date - 58, 'exif') RETURNING 1) SELECT count(*)::text FROM x$q$) = '1');
SELECT public.rc_ok('R7 Sara no puede subir a nombre de Olga',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    INSERT INTO public.recuerdos(id, user_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000001', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000009.jpg', 1000, current_date, 'exif') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%');
SELECT public.rc_ok('R8 Sara no puede ligar su foto a un viaje de Olga (no es miembro)',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    INSERT INTO public.recuerdos(id, user_id, trip_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000009.jpg', 1000, current_date, 'exif') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%');
SELECT public.rc_ok('R9 la ruta debe ser {su uid}/{id de la fila}.{ext del tipo}: otra ruta o extensión se rechaza',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    INSERT INTO public.recuerdos(id, user_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000003', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001.jpg', 1000, current_date, 'exif') RETURNING 'x'$q$) LIKE 'ERR:%recuerdos_path_own%'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    INSERT INTO public.recuerdos(id, user_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000003', 'foto', 'video/mp4',
       'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000009.mp4', 1000, current_date, 'exif') RETURNING 'x'$q$) LIKE 'ERR:%recuerdos_media_mime%');
SELECT public.rc_ok('R10 una fecha de captura en el futuro se rechaza',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$
    INSERT INTO public.recuerdos(id, user_id, media_type, mime_type, storage_path, bytes, taken_on, date_source) VALUES
      ('c3000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000003', 'foto', 'image/jpeg',
       'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000009.jpg', 1000, current_date + 30, 'exif') RETURNING 'x'$q$) LIKE 'ERR:recuerdos_fecha_futura%');

-- ───── Ver: nadie ve fotos de otro ─────
SELECT public.rc_ok('R11 anon no puede leer recuerdos ni álbumes', public.rc_anon(public.rc_ids()) LIKE 'ERR:permission denied%'
  AND public.rc_anon('SELECT count(*)::text FROM public.recuerdos_album_shares') LIKE 'ERR:permission denied%', public.rc_anon(public.rc_ids()));
SELECT public.rc_ok('R12 sin sesión (authenticated sin sub) no ve nada', public.rc_as(NULL, public.rc_ids()) = '');
SELECT public.rc_ok('R13 Olga ve solo las suyas (1,2,3)', public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_ids()) = '1,2,3',
  public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_ids()));
SELECT public.rc_ok('R14 Carlos, colaborador de Lisboa, NO ve las de Olga mientras no comparta (solo la suya)',
  public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()) = '4', public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()));
SELECT public.rc_ok('R15 Sara solo ve la suya', public.rc_as('c1000000-0000-0000-0000-000000000003', public.rc_ids()) = '5');

-- ───── Cambiar: solo la dueña, solo viaje y favorita ─────
SELECT public.rc_ok('R16 Sara no puede marcar como favorita ni mover una foto de Olga (0 filas)',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$WITH x AS (UPDATE public.recuerdos SET favorite = true WHERE id = 'c3000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM x$q$) = '0'
  AND NOT (SELECT favorite FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000001'));
SELECT public.rc_ok('R17 Olga marca favorita y mueve a mano la foto sin viaje a Roma (trip_source = manual)',
  public.rc_as('c1000000-0000-0000-0000-000000000001', $q$WITH x AS (UPDATE public.recuerdos SET favorite = true, trip_id = 'c2000000-0000-0000-0000-000000000002' WHERE id = 'c3000000-0000-0000-0000-000000000003' RETURNING trip_source) SELECT string_agg(trip_source, ',') FROM x$q$) = 'manual'
  AND (SELECT favorite FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000003'));
SELECT public.rc_ok('R18 Olga no puede cambiar la ruta del archivo ni moverla a un viaje ajeno',
  public.rc_as('c1000000-0000-0000-0000-000000000001', $q$UPDATE public.recuerdos SET storage_path = 'x' WHERE id = 'c3000000-0000-0000-0000-000000000003' RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND public.rc_as('c1000000-0000-0000-0000-000000000001', $q$UPDATE public.recuerdos SET trip_id = 'c2000000-0000-0000-0000-000000000003' WHERE id = 'c3000000-0000-0000-0000-000000000003' RETURNING 'x'$q$) LIKE 'ERR:%row-level security%');

-- ───── Archivos en storage ─────
INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES
  ('recuerdos', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001.jpg', 'c1000000-0000-0000-0000-000000000001'),
  ('recuerdos', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001_t.jpg', 'c1000000-0000-0000-0000-000000000001'),
  ('recuerdos', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000002.mp4', 'c1000000-0000-0000-0000-000000000001'),
  ('recuerdos', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000003.jpg', 'c1000000-0000-0000-0000-000000000001'),
  ('recuerdos', 'c1000000-0000-0000-0000-000000000002/c3000000-0000-0000-0000-000000000004.jpg', 'c1000000-0000-0000-0000-000000000002'),
  ('recuerdos', 'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000005.jpg', 'c1000000-0000-0000-0000-000000000003');
SELECT public.rc_ok('R19 anon no ve ningún archivo del bucket', public.rc_anon(public.rc_objs()) = '', public.rc_anon(public.rc_objs()));
SELECT public.rc_ok('R20 cada quien ve solo sus archivos (Olga 1, 1_t, 2, 3; Sara 5)',
  public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_objs()) = '1.jpg,1_t.jpg,2.mp4,3.jpg'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', public.rc_objs()) = '5.jpg',
  public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_objs()));
SELECT public.rc_ok('R21 subir archivo: solo en su carpeta, con uuid y extensión permitida (no .html ni otra carpeta)',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('recuerdos', 'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000009.jpg') RETURNING 'ok'$q$) = 'ok'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('recuerdos', 'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000008.html') RETURNING 'ok'$q$) LIKE 'ERR:%row-level security%'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('recuerdos', 'c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000008.jpg') RETURNING 'ok'$q$) LIKE 'ERR:%row-level security%');
SELECT public.rc_ok('R22 nadie borra archivos de otro (0 filas)',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$WITH x AS (DELETE FROM storage.objects WHERE bucket_id = 'recuerdos' AND name LIKE 'c1000000-0000-0000-0000-000000000001/%' RETURNING 1) SELECT count(*)::text FROM x$q$) = '0');
DELETE FROM storage.objects WHERE name = 'c1000000-0000-0000-0000-000000000003/c3000000-0000-0000-0000-000000000009.jpg';

-- ───── Álbum compartido con los miembros del viaje ─────
SELECT public.rc_ok('R23 Sara no puede compartir un álbum de un viaje ajeno ni a nombre de otra persona',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$INSERT INTO public.recuerdos_album_shares(user_id, trip_id) VALUES ('c1000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$INSERT INTO public.recuerdos_album_shares(user_id, trip_id) VALUES ('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000003') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%');
SELECT public.rc_ok('R24 Olga comparte su álbum de Lisboa',
  public.rc_as('c1000000-0000-0000-0000-000000000001', $q$INSERT INTO public.recuerdos_album_shares(user_id, trip_id) VALUES ('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001') RETURNING 'ok'$q$) = 'ok');
SELECT public.rc_ok('R25 Carlos (miembro) ve ahora la de Lisboa de Olga, pero no las de Roma ni la que movió a Roma',
  public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()) = '1,4', public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()));
SELECT public.rc_ok('R26 Carlos ve el archivo y la miniatura compartidos y ningún otro de Olga',
  public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_objs()) = '1.jpg,1_t.jpg,4.jpg', public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_objs()));
SELECT public.rc_ok('R27 Pedro (invitación pendiente) y Sara (ajena) no ven lo compartido',
  public.rc_as('c1000000-0000-0000-0000-000000000004', public.rc_ids()) = '' AND public.rc_as('c1000000-0000-0000-0000-000000000004', public.rc_objs()) = ''
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', public.rc_ids()) = '5');
SELECT public.rc_ok('R28 Carlos no ve ni puede borrar el registro de compartido de Olga',
  public.rc_as('c1000000-0000-0000-0000-000000000002', 'SELECT count(*)::text FROM public.recuerdos_album_shares') = '0'
  AND public.rc_as('c1000000-0000-0000-0000-000000000002', $q$WITH x AS (DELETE FROM public.recuerdos_album_shares RETURNING 1) SELECT count(*)::text FROM x$q$) = '0');
SELECT public.rc_ok('R29 recuerdo_shared_with_me no responde por terceros: Sara pregunta por Lisboa y recibe false',
  public.rc_as('c1000000-0000-0000-0000-000000000003', $q$SELECT public.recuerdo_shared_with_me('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001')::text$q$) = 'false'
  AND public.rc_as('c1000000-0000-0000-0000-000000000003', $q$SELECT public.recuerdo_object_visible('c1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000001.jpg', 'c1000000-0000-0000-0000-000000000002')::text$q$) = 'false');
SELECT public.rc_ok('R30 Carlos comparte el suyo; Olga lo ve. Si Carlos deja el viaje, Olga deja de verlo y él deja de ver el de Olga',
  public.rc_as('c1000000-0000-0000-0000-000000000002', $q$INSERT INTO public.recuerdos_album_shares(user_id, trip_id) VALUES ('c1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001') RETURNING 'ok'$q$) = 'ok'
  AND public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_ids()) = '1,2,3,4');
UPDATE public.trip_collaborators SET status = 'removed' WHERE trip_id = 'c2000000-0000-0000-0000-000000000001' AND user_id = 'c1000000-0000-0000-0000-000000000002';
SELECT public.rc_ok('R31 (cont.) tras salir: Olga ve 1,2,3 y Carlos solo la suya',
  public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_ids()) = '1,2,3' AND public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()) = '4',
  public.rc_as('c1000000-0000-0000-0000-000000000001', public.rc_ids()) || ' / ' || public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()));
UPDATE public.trip_collaborators SET status = 'accepted' WHERE trip_id = 'c2000000-0000-0000-0000-000000000001' AND user_id = 'c1000000-0000-0000-0000-000000000002';
SELECT public.rc_ok('R32 Olga deja de compartir: Carlos ya no ve la de Lisboa',
  public.rc_as('c1000000-0000-0000-0000-000000000001', $q$WITH x AS (DELETE FROM public.recuerdos_album_shares WHERE trip_id = 'c2000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM x$q$) = '1'
  AND public.rc_as('c1000000-0000-0000-0000-000000000002', public.rc_ids()) = '4');
SELECT public.rc_ok('R33 Carlos no puede borrar la fila de Olga aunque la viera (0 filas)',
  public.rc_as('c1000000-0000-0000-0000-000000000002', $q$WITH x AS (DELETE FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM x$q$) = '0');

-- ───── Borrar el viaje ─────
DELETE FROM public.storage_purge_queue WHERE bucket_id = 'recuerdos';
INSERT INTO public.recuerdos_album_shares(user_id, trip_id) VALUES ('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001');
DELETE FROM public.trips WHERE id = 'c2000000-0000-0000-0000-000000000001';
SELECT public.rc_ok('R34 borrar Lisboa: la foto de Olga (dueña) se borra y su archivo y miniatura quedan en la cola de purga',
  NOT EXISTS (SELECT 1 FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000001')
  AND (SELECT string_agg(right(name, 6), ',' ORDER BY name) FROM public.storage_purge_queue WHERE bucket_id = 'recuerdos'
        AND user_id = 'c1000000-0000-0000-0000-000000000001' AND reason = 'trip_deleted') = '01.jpg,_t.jpg',
  (SELECT string_agg(name, ',') FROM public.storage_purge_queue WHERE bucket_id = 'recuerdos'));
SELECT public.rc_ok('R35 la foto de Carlos (colaborador) se queda en su calendario sin viaje; el álbum compartido desaparece',
  (SELECT trip_id IS NULL AND trip_source = 'ninguno' FROM public.recuerdos WHERE id = 'c3000000-0000-0000-0000-000000000004')
  AND NOT EXISTS (SELECT 1 FROM public.recuerdos_album_shares WHERE trip_id = 'c2000000-0000-0000-0000-000000000001'));

-- ───── Borrar la cuenta ─────
SELECT public.rc_ok('R36 account_deletion_files de Olga incluye sus archivos de recuerdos',
  (SELECT count(*) FROM public.account_deletion_files('c1000000-0000-0000-0000-000000000001') f WHERE f.bucket_id = 'recuerdos') = 4);
SELECT public.rc_ok('R37 purge_account_data borra los recuerdos y álbumes de Olga y no toca los de los demás',
  (public.purge_account_data('c1000000-0000-0000-0000-000000000001') ->> 'ok') = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.recuerdos WHERE user_id = 'c1000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.recuerdos_album_shares WHERE user_id = 'c1000000-0000-0000-0000-000000000001')
  AND (SELECT count(*) FROM public.recuerdos WHERE user_id <> 'c1000000-0000-0000-0000-000000000001' AND id::text LIKE 'c3000000-%') = 2);

-- ───── Aviso de créditos de IA ─────
DELETE FROM public.admins;
SELECT public.rc_ok('A1 solo la llave de servicio puede avisar (authenticated y anon no)',
  NOT has_function_privilege('authenticated', 'public.alert_admins_ai_credits(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.alert_admins_ai_credits(text,text)', 'EXECUTE')
  AND public.rc_as('c1000000-0000-0000-0000-000000000002', $q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_saldo')::text$q$) LIKE 'ERR:permission denied%');
SELECT public.rc_ok('A2 sin administradores devuelve -1 (no es "ya avisado")',
  public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_saldo')::text$q$) = '-1');
INSERT INTO public.admins(user_id) VALUES ('c1000000-0000-0000-0000-000000000005');
SELECT public.rc_ok('A3 con un administrador: 1 campana la primera vez y 0 las siguientes del mismo día',
  public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_saldo')::text$q$) = '1'
  AND public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_saldo')::text$q$) = '0'
  AND public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_saldo')::text$q$) = '0');
SELECT public.rc_ok('A4 la campana es system_alert con el texto fijo y la llave del día',
  (SELECT count(*) FROM public.notifications WHERE user_id = 'c1000000-0000-0000-0000-000000000005' AND type = 'system_alert'
     AND title = 'Se acabaron los créditos de IA (imágenes)' AND body LIKE '%HTTP 402%'
     AND dedup_key = 'ia_sin_creditos:imagenes:sin_saldo:' || to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')) = 1);
SELECT public.rc_ok('A5 otro motivo (falta la llave) es otro aviso; servicio o motivo inválidos dan error',
  public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', 'sin_llave')::text$q$) = '1'
  AND public.rc_service($q$SELECT public.alert_admins_ai_credits('otro', 'sin_saldo')::text$q$) LIKE 'ERR:servicio_invalido%'
  AND public.rc_service($q$SELECT public.alert_admins_ai_credits('imagenes', '<b>x</b>')::text$q$) LIKE 'ERR:motivo_invalido%');
SELECT public.rc_ok('A6 nadie más recibe la campana (solo administradores)',
  (SELECT count(*) FROM public.notifications WHERE type = 'system_alert' AND user_id <> 'c1000000-0000-0000-0000-000000000005') = 0);
