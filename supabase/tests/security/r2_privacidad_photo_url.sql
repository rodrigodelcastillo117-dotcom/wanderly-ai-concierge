-- SEG-N4 / P3-6 (segunda auditoría, JR4): photo_url del diario aceptaba cualquier URL (píxel de
-- rastreo que los demás miembros cargan con <img>). Ahora solo una foto de nuestro storage, de la
-- carpeta de su autor y su viaje. Imprime "OK …" o "FALLA …". Ids propios: 7c7c….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
CREATE OR REPLACE FUNCTION public.tu_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'OK ' ELSE 'FALLA ' END || _label || CASE WHEN _detail <> '' THEN ' [' || _detail || ']' ELSE '' END;
$$;
CREATE OR REPLACE FUNCTION public.tu_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION public.tu_ok(text, boolean, text), public.tu_as(uuid, text) TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('7c7c0000-0000-0000-0000-000000000001', 'tu-ana@example.test'),
  ('7c7c0000-0000-0000-0000-000000000003', 'tu-caro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000001', 'Roma') ON CONFLICT DO NOTHING;
INSERT INTO public.trip_collaborators(trip_id, user_id, role, invited_by, status)
VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'editor', '7c7c0000-0000-0000-0000-000000000001', 'accepted') ON CONFLICT DO NOTHING;
-- Antes de la migración: una entrada con un píxel de rastreo ya guardado.
ALTER TABLE public.trip_journal_entries DROP CONSTRAINT IF EXISTS trip_journal_photo_url_storage;
INSERT INTO public.trip_journal_entries(id, trip_id, author_id, text, photo_url) VALUES
  ('7c7c2000-0000-0000-0000-000000000001', '7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'hola', 'https://evil.test/pixel.gif?who=ana');

\ir ../../migrations/20261026060000_r2_privacidad_photo_url.sql
RESET ROLE;

SELECT public.tu_ok('PU1 el píxel ya guardado se borra (la entrada se conserva)',
  (SELECT photo_url IS NULL AND text = 'hola' FROM public.trip_journal_entries WHERE id = '7c7c2000-0000-0000-0000-000000000001'));
SELECT public.tu_ok('PU2 (JR4) Caro no puede guardar una photo_url externa',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_url) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'x', 'https://evil.test/pixel.gif?who=ana') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%trip_journal_photo_url_storage%');
SELECT public.tu_ok('PU2b ni una URL de otro proyecto de Supabase',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_url) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'x', 'https://evilproj.supabase.co/storage/v1/object/public/journal-photos/7c7c0000-0000-0000-0000-000000000003/7c7c1000-0000-0000-0000-000000000001/a.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%');
SELECT public.tu_ok('PU2c ni una foto nuestra de la carpeta de otra persona',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_url) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'x', 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/journal-photos/7c7c0000-0000-0000-0000-000000000001/7c7c1000-0000-0000-0000-000000000001/a.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) LIKE 'ERR:%');
SELECT public.tu_ok('PU3 una URL de nuestro storage, de su carpeta y su viaje, sí (clientes viejos)',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text, photo_url) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'x', 'https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/public/journal-photos/7c7c0000-0000-0000-0000-000000000003/7c7c1000-0000-0000-0000-000000000001/0a0a0a0a-0000-4000-8000-000000000001.jpg') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
SELECT public.tu_ok('PU3b sin URL (solo photo_path o sin foto) sí',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_journal_entries (trip_id, author_id, text) VALUES ('7c7c1000-0000-0000-0000-000000000001', '7c7c0000-0000-0000-0000-000000000003', 'sin foto') RETURNING 1) SELECT count(*)::text FROM i$q$) = '1');
SELECT public.tu_ok('PU4 tampoco se puede cambiar después a una URL externa (UPDATE)',
  public.tu_as('7c7c0000-0000-0000-0000-000000000003', $q$WITH u AS (UPDATE public.trip_journal_entries SET photo_url = 'https://evil.test/p.gif' WHERE id = '7c7c2000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%');

DROP FUNCTION public.tu_ok(text, boolean, text);
DROP FUNCTION public.tu_as(uuid, text);
