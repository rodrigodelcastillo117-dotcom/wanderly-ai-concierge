-- T-P2-2 (segunda auditoría, grupo transversal; JR1, JR2, JR2b): fotos del diario y de "Mejores
-- momentos" en buckets PRIVADOS, sin objetos plantados en viajes ajenos y borrables por el dueño.
-- Imprime "OK …" o "FALLA …". Lo corre security/run.sh. Ids propios: 7e….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.tf_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'OK ' ELSE 'FALLA ' END || _label || CASE WHEN _detail <> '' THEN ' [' || _detail || ']' ELSE '' END;
$$;
CREATE OR REPLACE FUNCTION public.tf_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.tf_ok(text, boolean, text), public.tf_as(uuid, text) TO authenticated;

-- 1 Ana (dueña del viaje) · 2 Beto (extraño) · 3 Caro (colaboradora aceptada)
INSERT INTO auth.users(id, email) VALUES
  ('7e000000-0000-0000-0000-000000000001', 'tf-ana@example.test'),
  ('7e000000-0000-0000-0000-000000000002', 'tf-beto@example.test'),
  ('7e000000-0000-0000-0000-000000000003', 'tf-caro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino) VALUES ('7e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001', 'Lisboa')
ON CONFLICT DO NOTHING;
INSERT INTO public.trip_collaborators(trip_id, user_id, role, invited_by, status)
VALUES ('7e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000003', 'editor', '7e000000-0000-0000-0000-000000000001', 'accepted')
ON CONFLICT DO NOTHING;

-- Antes de la migración (se vuelve a aplicar abajo): una entrada vieja con URL pública y su objeto.
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  ('journal-photos', '7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000001.jpg', '7e000000-0000-0000-0000-000000000003');
INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text, photo_url) VALUES
  ('7e200000-0000-0000-0000-000000000001', '7e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000003', 'Pastel de nata',
   'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/journal-photos/7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000001.jpg');
-- Un objeto que Beto plantó antes de la corrección en la carpeta del viaje de Ana (sin entrada).
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  ('journal-photos', '7e000000-0000-0000-0000-000000000002/7e100000-0000-0000-0000-000000000001/plantada.jpg', '7e000000-0000-0000-0000-000000000002');

\ir ../../migrations/20261026120000_r2_privacidad_fotos_privadas.sql
RESET ROLE;

SELECT public.tf_ok('PF1 journal-photos ya no es público', NOT coalesce((SELECT public FROM storage.buckets WHERE id = 'journal-photos'), true));
SELECT public.tf_ok('PF1b travel-moments-private existe, es privado y solo acepta JPEG',
  (SELECT NOT public AND allowed_mime_types = ARRAY['image/jpeg'] FROM storage.buckets WHERE id = 'travel-moments-private'));
SELECT public.tf_ok('PF2 la entrada vieja recibió su ruta (photo_path) a partir de la URL pública',
  (SELECT photo_path FROM public.trip_journal_entries WHERE id = '7e200000-0000-0000-0000-000000000001')
    = '7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000001.jpg');

-- JR2: un extraño no sube a la carpeta de un viaje ajeno (aunque sea dentro de SU carpeta).
SELECT public.tf_ok('PF3 Beto no puede plantar journal-photos/<Beto>/<viaje de Ana>/x.jpg',
  public.tf_as('7e000000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('journal-photos', '7e000000-0000-0000-0000-000000000002/7e100000-0000-0000-0000-000000000001/x.jpg', '7e000000-0000-0000-0000-000000000002') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%row-level security%');
SELECT public.tf_ok('PF3b Caro (colaboradora) sí sube a su carpeta del viaje',
  public.tf_as('7e000000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('journal-photos', '7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000002.jpg', '7e000000-0000-0000-0000-000000000003') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
-- JR2b: lo plantado antes no lo ve ningún miembro (no tiene entrada del diario).
SELECT public.tf_ok('PF4 Ana y Caro no ven el objeto plantado por Beto',
  public.tf_as('7e000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%plantada.jpg'$q$) = '0'
  AND public.tf_as('7e000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%plantada.jpg'$q$) = '0');
SELECT public.tf_ok('PF4b Ana (miembro) sí ve la foto de la entrada de Caro (para el enlace firmado)',
  public.tf_as('7e000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'journal-photos' AND name LIKE '%0f0f0f0f-0000-0000-0000-000000000001.jpg'$q$) = '1');
SELECT public.tf_ok('PF4c Beto (extraño) no ve fotos del viaje',
  public.tf_as('7e000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'journal-photos' AND name LIKE '%7e100000-0000-0000-0000-000000000001%' AND name NOT LIKE '7e000000-0000-0000-0000-000000000002/%'$q$) = '0');

-- La entrada solo puede apuntar a una foto de su autor y de su viaje.
SELECT public.tf_ok('PF5 Caro no puede ligar a su entrada una foto de otra carpeta',
  public.tf_as('7e000000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_path) VALUES ('7e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000003', 'x', '7e000000-0000-0000-0000-000000000001/7e100000-0000-0000-0000-000000000001/a.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%');
SELECT public.tf_ok('PF5b Caro sí guarda una entrada con su foto',
  public.tf_as('7e000000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_path) VALUES ('7e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000003', 'Tranvía 28', '7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000002.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');

-- Borrar: el dueño del viaje puede quitar la foto de la entrada de una colaboradora; un extraño no.
SELECT public.tf_ok('PF6 Beto no borra fotos del viaje',
  public.tf_as('7e000000-0000-0000-0000-000000000002', $q$WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'journal-photos' AND name LIKE '7e000000-0000-0000-0000-000000000003/%' RETURNING 1) SELECT count(*)::text FROM d$q$) = '0');
SELECT public.tf_ok('PF6b Ana (dueña) borra la foto de la entrada de Caro',
  public.tf_as('7e000000-0000-0000-0000-000000000001', $q$WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'journal-photos' AND name = '7e000000-0000-0000-0000-000000000003/7e100000-0000-0000-0000-000000000001/0f0f0f0f-0000-0000-0000-000000000001.jpg' RETURNING 1) SELECT count(*)::text FROM d$q$) = '1');

-- Mejores momentos en el bucket privado: solo la persona.
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  ('travel-moments-private', '7e000000-0000-0000-0000-000000000001/0e0e0e0e-0000-0000-0000-000000000001.jpg', '7e000000-0000-0000-0000-000000000001');
SELECT public.tf_ok('PF7 nadie más ve los momentos privados de Ana',
  public.tf_as('7e000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'travel-moments-private'$q$) = '0');
SELECT public.tf_ok('PF7b Ana sí los ve (enlace firmado)',
  public.tf_as('7e000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'travel-moments-private'$q$) = '1');
SELECT public.tf_ok('PF7c Beto no sube a la carpeta de Ana ni con otro nombre que uid/uuid.jpg',
  public.tf_as('7e000000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('travel-moments-private', '7e000000-0000-0000-0000-000000000001/0e0e0e0e-0000-0000-0000-000000000009.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%'
  AND public.tf_as('7e000000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('travel-moments-private', '7e000000-0000-0000-0000-000000000002/foto.html') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%');
SELECT public.tf_ok('PF8 un momento nuevo se guarda con image_path (sin URL pública)',
  public.tf_as('7e000000-0000-0000-0000-000000000001', $q$WITH i AS (INSERT INTO public.travel_moments (user_id, image_path) VALUES ('7e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001/0e0e0e0e-0000-0000-0000-000000000001.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
SELECT public.tf_ok('PF8b no se puede apuntar image_path a la carpeta de otra persona',
  public.tf_as('7e000000-0000-0000-0000-000000000002', $q$WITH i AS (INSERT INTO public.travel_moments (user_id, image_path) VALUES ('7e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-000000000001/0e0e0e0e-0000-0000-0000-000000000001.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%');

DROP FUNCTION public.tf_ok(text, boolean, text);
DROP FUNCTION public.tf_as(uuid, text);
