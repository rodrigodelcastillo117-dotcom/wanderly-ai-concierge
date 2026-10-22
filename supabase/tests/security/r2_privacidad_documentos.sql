-- T-P2-3 y T-P2-4 (segunda auditoría, grupo transversal; DOC1, DOC1b, DOC1c, TRD1, TRD2, TRD4):
-- documentos del viaje con visibilidad "solo yo" y archivos que se borran al borrar el viaje.
-- Imprime "OK …" o "FALLA …". Lo corre security/run.sh. Ids propios: 7d….
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.td_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_cond, false) THEN 'OK ' ELSE 'FALLA ' END || _label || CASE WHEN _detail <> '' THEN ' [' || _detail || ']' ELSE '' END;
$$;
CREATE OR REPLACE FUNCTION public.td_as(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION public.td_ok(text, boolean, text), public.td_as(uuid, text) TO authenticated;

-- 1 Ana (dueña) · 3 Caro (colaboradora aceptada) · 2 Beto (extraño)
INSERT INTO auth.users(id, email) VALUES
  ('7d000000-0000-0000-0000-000000000001', 'td-ana@example.test'),
  ('7d000000-0000-0000-0000-000000000002', 'td-beto@example.test'),
  ('7d000000-0000-0000-0000-000000000003', 'td-caro@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino) VALUES
  ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001', 'Kioto'),
  ('7d100000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000001', 'Oaxaca')
ON CONFLICT DO NOTHING;
INSERT INTO public.trip_collaborators(trip_id, user_id, role, invited_by, status)
VALUES ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000003', 'editor', '7d000000-0000-0000-0000-000000000001', 'accepted')
ON CONFLICT DO NOTHING;
-- Un huérfano de antes de la corrección: archivo de un viaje que ya no existe.
INSERT INTO storage.objects(bucket_id, name, owner, owner_id) VALUES
  ('trip-documents', '7d1fffff-0000-0000-0000-00000000dead/0d0d0d0d-0000-0000-0000-000000000099-viejo.pdf', '7d000000-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-000000000003');

\ir ../../migrations/20261026130000_r2_privacidad_documentos.sql
RESET ROLE;

SELECT public.td_ok('DV0 el huérfano que ya existía quedó en la cola de borrado',
  EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE bucket_id = 'trip-documents' AND name LIKE '7d1fffff-%'));

-- Ana sube su pasaporte y un boleto; Caro sube su visa y un boleto (rutas reales del storage).
INSERT INTO storage.objects(bucket_id, name, owner, owner_id) VALUES
  ('trip-documents', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000001-pasaporte-ana.jpg', '7d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001'),
  ('trip-documents', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000002-boleto-ana.pdf', '7d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001'),
  ('trip-documents', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000003-visa-caro.pdf', '7d000000-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-000000000003'),
  ('trip-documents', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000004-boleto-caro.pdf', '7d000000-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-000000000003'),
  ('journal-photos', '7d000000-0000-0000-0000-000000000003/7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000005.jpg', '7d000000-0000-0000-0000-000000000003', '7d000000-0000-0000-0000-000000000003');
SELECT public.td_as('7d000000-0000-0000-0000-000000000001', $q$WITH i AS (INSERT INTO public.trip_documents (trip_id, uploaded_by, kind, storage_path, filename, mime, size) VALUES
  ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001', 'pasaporte', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000001-pasaporte-ana.jpg', 'pasaporte-ana.jpg', 'image/jpeg', 1000),
  ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001', 'boleto', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000002-boleto-ana.pdf', 'boleto-ana.pdf', 'application/pdf', 1000) RETURNING 1) SELECT count(*)::text FROM i$q$) AS ins_ana \gset
SELECT public.td_as('7d000000-0000-0000-0000-000000000003', $q$WITH i AS (INSERT INTO public.trip_documents (trip_id, uploaded_by, kind, storage_path, filename, mime, size) VALUES
  ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000003', 'visa', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000003-visa-caro.pdf', 'visa-caro.pdf', 'application/pdf', 1000),
  ('7d100000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000003', 'boleto', '7d100000-0000-0000-0000-000000000001/0d0d0d0d-0000-0000-0000-000000000004-boleto-caro.pdf', 'boleto-caro.pdf', 'application/pdf', 1000) RETURNING 1) SELECT count(*)::text FROM i$q$) AS ins_caro \gset
SELECT public.td_ok('DV1 subir documentos (incluido el tipo nuevo "visa")', :'ins_ana' = '2' AND :'ins_caro' = '2', :'ins_ana' || '/' || :'ins_caro');
SELECT public.td_ok('DV2 por omisión: pasaporte y visa "solo yo"; boletos "viaje"',
  (SELECT string_agg(kind || '=' || visibility, ',' ORDER BY kind) FROM public.trip_documents WHERE trip_id = '7d100000-0000-0000-0000-000000000001')
    = 'boleto=viaje,boleto=viaje,pasaporte=solo_yo,visa=solo_yo',
  (SELECT string_agg(kind || '=' || visibility, ',' ORDER BY kind) FROM public.trip_documents WHERE trip_id = '7d100000-0000-0000-0000-000000000001'));

-- DOC1/DOC1b: Caro (colaboradora) ya no ve el pasaporte de Ana; sí su boleto. Y al revés con la visa.
SELECT public.td_ok('DV3 Caro no ve la fila del pasaporte de Ana',
  public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_documents WHERE kind = 'pasaporte'$q$) = '0');
SELECT public.td_ok('DV3b Caro no ve el objeto del pasaporte (ni puede firmarlo)',
  public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-documents' AND name LIKE '%pasaporte-ana%'$q$) = '0');
SELECT public.td_ok('DV3c Caro sí ve el boleto de Ana (visibilidad "viaje")',
  public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'trip-documents' AND name LIKE '%boleto-ana%'$q$) = '1'
  AND public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_documents WHERE filename = 'boleto-ana.pdf'$q$) = '1');
SELECT public.td_ok('DV3d Ana (dueña del viaje) tampoco ve la visa de Caro',
  public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM public.trip_documents WHERE kind = 'visa'$q$) = '0'
  AND public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%visa-caro%'$q$) = '0');
SELECT public.td_ok('DV3e cada quien ve su documento "solo yo"',
  public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM storage.objects WHERE name LIKE '%pasaporte-ana%'$q$) = '1'
  AND public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_documents WHERE kind = 'visa'$q$) = '1');
SELECT public.td_ok('DV3f Beto (extraño) no ve nada',
  public.td_as('7d000000-0000-0000-0000-000000000002', $q$SELECT count(*)::text FROM public.trip_documents$q$) = '0');

-- Cambiar la visibilidad: solo quien lo subió.
SELECT public.td_ok('DV4 Caro no puede cambiar la visibilidad de un documento de Ana',
  public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT public.set_trip_document_visibility((SELECT id FROM public.trip_documents WHERE filename = 'boleto-ana.pdf'), 'solo_yo')->>'ok'$q$) = 'false');
SELECT public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT public.set_trip_document_visibility((SELECT id FROM public.trip_documents WHERE kind = 'pasaporte'), 'viaje')->>'ok'$q$) AS vis \gset
SELECT public.td_ok('DV4b Ana comparte su pasaporte con el viaje y Caro ya lo ve',
  :'vis' = 'true' AND public.td_as('7d000000-0000-0000-0000-000000000003', $q$SELECT count(*)::text FROM public.trip_documents WHERE kind = 'pasaporte'$q$) = '1');
SELECT public.td_ok('DV4c valor inválido rechazado',
  public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT public.set_trip_document_visibility((SELECT id FROM public.trip_documents WHERE kind = 'pasaporte'), 'todos')->>'ok'$q$) = 'false');
SELECT public.td_ok('DV4d el cliente no puede cambiar la visibilidad con UPDATE directo',
  public.td_as('7d000000-0000-0000-0000-000000000003', $q$WITH u AS (UPDATE public.trip_documents SET visibility = 'viaje' WHERE kind = 'visa' RETURNING 1) SELECT count(*)::text FROM u$q$) LIKE 'ERR:%');

-- T-P2-3: borrar el viaje manda TODOS sus archivos (de cualquiera que los subió) a la cola de borrado.
SELECT public.td_as('7d000000-0000-0000-0000-000000000001', $q$WITH d AS (DELETE FROM public.trips WHERE id = '7d100000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$q$) AS del \gset
SELECT public.td_ok('DV5 al borrar el viaje, sus 4 documentos y la foto del diario quedan en la cola para borrarse',
  :'del' = '1' AND (SELECT count(*) FROM public.storage_purge_queue WHERE name LIKE '7d100000-0000-0000-0000-000000000001/%' OR name LIKE '%/7d100000-0000-0000-0000-000000000001/%') = 5,
  (SELECT count(*)::text FROM public.storage_purge_queue WHERE name LIKE '%7d100000-0000-0000-0000-000000000001%'));
SELECT public.td_ok('DV5b la cola es del dueño del viaje (la vacía trip-files-purge con su sesión)',
  (SELECT bool_and(user_id = '7d000000-0000-0000-0000-000000000001') FROM public.storage_purge_queue WHERE name LIKE '%7d100000-0000-0000-0000-000000000001%'));
SELECT public.td_ok('DV6 (TRD2) el borrado de cuenta de Ana incluye el boleto que subió Caro al viaje ya borrado',
  (SELECT count(*) FROM public.account_deletion_files('7d000000-0000-0000-0000-000000000001') f WHERE f.name LIKE '%boleto-caro%') = 1);
SELECT public.td_ok('DV6b la cola no es visible ni editable para clientes',
  public.td_as('7d000000-0000-0000-0000-000000000001', $q$SELECT count(*)::text FROM public.storage_purge_queue$q$) LIKE 'ERR:%permission denied%');
SELECT public.purge_account_data('7d000000-0000-0000-0000-000000000001')->>'ok' AS purged \gset
SELECT public.td_ok('DV6c al borrar la cuenta la cola no conserva el id de la persona',
  :'purged' = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.storage_purge_queue WHERE user_id = '7d000000-0000-0000-0000-000000000001'));

DROP FUNCTION public.td_ok(text, boolean, text);
DROP FUNCTION public.td_as(uuid, text);
