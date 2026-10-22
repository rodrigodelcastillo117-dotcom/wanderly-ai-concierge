-- Bóveda: RLS de vault_items / vault_files / bucket travel-vault, reglas de tarjetas, proyección sin
-- números para la IA, copia de la bóveda vieja y borrado de cuenta.
-- Uso: run.sh (aplica migraciones y legacy_seed.sql antes). Imprime "OK …" / "FALLA …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
-- A = dueña, B = otra cuenta, L = cuenta con bóveda vieja (legacy_seed.sql).
INSERT INTO auth.users(id,email) VALUES
  ('b0000000-0000-4000-8000-0000000000a1','b-owner@example.test'),
  ('b0000000-0000-4000-8000-0000000000b2','b-other@example.test')
ON CONFLICT DO NOTHING;

-- Ayudantes de prueba (se borran al final).
CREATE OR REPLACE FUNCTION public._bv_ok(p_cond boolean, p_label text, p_detail text DEFAULT '')
RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN p_cond THEN 'OK ' || p_label ELSE 'FALLA ' || p_label || ' ' || coalesce(p_detail, '') END $$;
CREATE OR REPLACE FUNCTION public._bv_fails(p_sql text, p_label text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FALLA ' || p_label || ' (se permitió)';
EXCEPTION WHEN others THEN
  RETURN 'OK ' || p_label || ' [' || SQLSTATE || ']';
END $$;
GRANT EXECUTE ON FUNCTION public._bv_ok(boolean, text, text), public._bv_fails(text, text) TO anon, authenticated;

SELECT public._bv_ok(public = false AND file_size_limit = 10485760 AND allowed_mime_types = ARRAY['image/jpeg','application/pdf'],
  'B0 bucket travel-vault privado, 10 MB, solo JPEG y PDF') FROM storage.buckets WHERE id = 'travel-vault';
SELECT public._bv_ok(count(*) = 2, 'B0b RLS activa en vault_items y vault_files')
FROM pg_class WHERE relname IN ('vault_items','vault_files') AND relrowsecurity;

-- ───── Dueña: crear, leer, editar, borrar ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-0000000000a1',false);
INSERT INTO vault_items(id,section,kind,title,number,country_code,expires_on,holder_name)
VALUES ('b1000000-0000-4000-8000-000000000001','documento','pasaporte','Pasaporte mexicano','G55501234','MX','2027-01-15','Ana Prueba');
INSERT INTO vault_items(id,section,kind,title,program_id,tier_id,tier,number,benefits)
VALUES ('b1000000-0000-4000-8000-000000000002','membresia','hotel','Marriott Bonvoy','marriott-bonvoy','platinum','Platinum Elite','MB123456789','{"Desayuno en hoteles participantes"}');
INSERT INTO vault_items(id,section,kind,title,issuer,tier,number)
VALUES ('b1000000-0000-4000-8000-000000000003','tarjeta','tarjeta','The Platinum Card','American Express','Platino','1005');
UPDATE vault_items SET tier = 'Titanium Elite' WHERE id = 'b1000000-0000-4000-8000-000000000002';
SELECT public._bv_ok(count(*) = 3, 'C1 la dueña ve sus 3 filas', count(*)::text) FROM vault_items;
SELECT public._bv_ok(tier = 'Titanium Elite', 'C2 la dueña edita su fila') FROM vault_items WHERE id = 'b1000000-0000-4000-8000-000000000002';
SELECT public._bv_ok(user_id = 'b0000000-0000-4000-8000-0000000000a1', 'C3 user_id por defecto = auth.uid()') FROM vault_items WHERE id = 'b1000000-0000-4000-8000-000000000001';

-- Reglas: tarjetas sin número completo ni vencimiento; tipo coherente con la sección; límites.
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,number) VALUES ('tarjeta','tarjeta','Visa','4111111111111111')$$, 'R1 tarjeta con número completo rechazada');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,number) VALUES ('tarjeta','tarjeta','Visa','4111 1111')$$, 'R2 tarjeta con más de 4 dígitos rechazada');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,expires_on) VALUES ('tarjeta','tarjeta','Visa','2030-01-01')$$, 'R3 tarjeta con vencimiento rechazada');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title) VALUES ('tarjeta','pasaporte','X')$$, 'R4 tipo fuera de su sección rechazado');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,number) VALUES ('documento','pasaporte','X','<script>')$$, 'R5 número con símbolos rechazado');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,benefits) VALUES ('membresia','hotel','X',ARRAY[repeat('a',201)])$$, 'R6 beneficio de más de 200 caracteres rechazado');
SELECT public._bv_fails($$INSERT INTO vault_items(section,kind,title,valid_from,expires_on) VALUES ('documento','visa','X','2030-01-01','2029-01-01')$$, 'R7 vigencia invertida rechazada');
SELECT public._bv_fails($$INSERT INTO vault_items(user_id,section,kind,title) VALUES ('b0000000-0000-4000-8000-0000000000b2','documento','ine','Ajena')$$, 'R8 no crea filas a nombre de otra cuenta');
SELECT public._bv_fails($$UPDATE vault_items SET user_id = 'b0000000-0000-4000-8000-0000000000b2' WHERE id = 'b1000000-0000-4000-8000-000000000001'$$, 'R9 no regala su fila a otra cuenta');

-- Archivos: objeto + fila con la ruta {user}/{item}/{uuid}.jpg
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001.jpg','b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000a1');
INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000001','frente','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001.jpg','image/jpeg',120000);
SELECT public._bv_ok(count(*) = 1, 'F1 la dueña sube foto (objeto y fila)') FROM vault_files;
SELECT public._bv_fails($$INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000001','frente','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/pasaporte-ana.jpg','image/jpeg',10)$$, 'F2 ruta con nombre original rechazada');
SELECT public._bv_fails($$INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000001','pdf','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000009.jpg','application/pdf',10)$$, 'F3 extensión distinta al tipo rechazada');
SELECT public._bv_fails($$INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000001','frente','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000008.jpg','image/png',10)$$, 'F4 PNG/otro tipo rechazado (solo JPEG reescrito sin EXIF)');
SELECT public._bv_fails($$INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000001','pdf','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000007.pdf','application/pdf',10485761)$$, 'F5 archivo de más de 10 MB rechazado');
SELECT public._bv_fails($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/suelto.jpg','b0000000-0000-4000-8000-0000000000a1')$$, 'F6 objeto con ruta inválida rechazado');
SELECT public._bv_fails($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-0000000000ff/b2000000-0000-4000-8000-000000000002.jpg','b0000000-0000-4000-8000-0000000000a1')$$, 'F7 objeto para una fila inexistente rechazado');
RESET ROLE;

-- ───── Otra cuenta: no ve, no cambia, no borra, no sube en carpeta ajena ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-0000000000b2',false);
SELECT public._bv_ok(count(*) = 0, 'X1 otra cuenta no ve filas ajenas', count(*)::text) FROM vault_items;
SELECT public._bv_ok(count(*) = 0, 'X2 otra cuenta no ve archivos ajenos') FROM vault_files;
SELECT public._bv_ok(count(*) = 0, 'X3 otra cuenta no ve objetos ajenos del bucket') FROM storage.objects WHERE bucket_id = 'travel-vault';
SELECT public._bv_ok(count(*) = 0, 'X3b otra cuenta no ve la proyección ajena') FROM user_vault_benefits WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1';
UPDATE vault_items SET title = 'robado' WHERE id = 'b1000000-0000-4000-8000-000000000001';
DELETE FROM vault_items WHERE id = 'b1000000-0000-4000-8000-000000000002';
DELETE FROM vault_files;
DELETE FROM storage.objects WHERE bucket_id = 'travel-vault';
SELECT public._bv_fails($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000003.jpg','b0000000-0000-4000-8000-0000000000b2')$$, 'X4 no sube objetos a la carpeta de otra cuenta');
-- Su propia carpeta, pero apuntando a una fila ajena.
SELECT public._bv_fails($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000b2/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000004.jpg','b0000000-0000-4000-8000-0000000000b2')$$, 'X5 no sube objetos ligados a una fila ajena');
SELECT public._bv_fails($$INSERT INTO vault_files(user_id,item_id,side,storage_path,mime,size) VALUES ('b0000000-0000-4000-8000-0000000000b2','b1000000-0000-4000-8000-000000000001','frente','b0000000-0000-4000-8000-0000000000b2/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000004.jpg','image/jpeg',10)$$, 'X6 no liga archivos a una fila ajena');
SELECT public._bv_fails($$INSERT INTO user_vault_benefits(user_id) VALUES ('b0000000-0000-4000-8000-0000000000b2')$$, 'X7 el cliente ya no escribe la proyección para la IA');
RESET ROLE;
SELECT public._bv_ok((SELECT title FROM vault_items WHERE id = 'b1000000-0000-4000-8000-000000000001') = 'Pasaporte mexicano'
  AND (SELECT count(*) FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1') = 3
  AND (SELECT count(*) FROM vault_files) = 1
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id = 'travel-vault') = 1,
  'X8 lo de la dueña sigue intacto tras los intentos');

-- ───── Anónimo: nada ─────
SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);
SELECT public._bv_fails($$SELECT count(*) FROM vault_items$$, 'N1 anónimo sin permiso sobre vault_items');
SELECT public._bv_fails($$SELECT count(*) FROM vault_files$$, 'N2 anónimo sin permiso sobre vault_files');
SELECT public._bv_ok(count(*) = 0, 'N3 anónimo no ve objetos del bucket') FROM storage.objects WHERE bucket_id = 'travel-vault';
SELECT public._bv_fails($$INSERT INTO storage.objects(bucket_id,name) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000005.jpg')$$, 'N4 anónimo no sube al bucket');
RESET ROLE;

-- ───── Proyección para la IA: nombres y niveles, sin números ni documentos ─────
SELECT public._bv_ok(hotel_loyalty->0->>'chain_name' = 'Marriott Bonvoy' AND hotel_loyalty->0->>'status_tier' = 'Titanium Elite'
  AND credit_cards->0->>'card_tier' = 'Platino' AND travel_documents = '[]'::jsonb
  AND position('MB123456789' IN (to_jsonb(b))::text) = 0 AND position('G55501234' IN (to_jsonb(b))::text) = 0
  AND position('1005' IN (to_jsonb(b))::text) = 0,
  'P1 la proyección tiene programas y niveles pero ningún número', (to_jsonb(b))::text)
FROM user_vault_benefits b WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1';

-- ───── Bóveda vieja copiada a filas (legacy_seed.sql + migración otra vez) ─────
SELECT public._bv_ok(count(*) = 7, 'L1 la bóveda vieja se copió a 7 filas (1 tarjeta, 1 aerolínea, 1 hotel, 1 auto, 3 documentos)', count(*)::text)
FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3';
SELECT public._bv_ok(number = 'G12345678' AND expires_on = '2027-03-01' AND section = 'documento', 'L2 pasaporte copiado con número y vigencia')
FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3' AND kind = 'pasaporte';
SELECT public._bv_ok(expires_on IS NULL AND country_code = 'US', 'L3 fecha imposible queda vacía; visa USA con país US')
FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3' AND kind = 'visa';
SELECT public._bv_ok(section = 'membresia', 'L4 Global Entry pasa a Membresías') FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3' AND kind = 'viajero_confiable';
SELECT public._bv_ok(number = 'AM123456', 'L5 número con símbolos saneado') FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3' AND kind = 'aerolinea';
SELECT public._bv_ok(benefits_unverified AND benefits = ARRAY['Acceso a salas','Centurion'], 'L6 beneficios de IA viejos marcados como no verificados', benefits::text)
FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3' AND section = 'tarjeta';
SELECT public._bv_ok(travel_documents = '[]'::jsonb AND position('G12345678' IN (to_jsonb(b))::text) = 0
  AND position('MB998877' IN (to_jsonb(b))::text) = 0 AND position('KTN15151515' IN (to_jsonb(b))::text) = 0,
  'L7 la tabla que lee la IA ya no guarda números de la bóveda vieja', (to_jsonb(b))::text)
FROM user_vault_benefits b WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3';

-- ───── Límite de archivos por fila ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-0000000000a1',false);
INSERT INTO vault_files(item_id,side,storage_path,mime,size)
SELECT 'b1000000-0000-4000-8000-000000000002','pagina','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-00000000000'||g||'.jpg','image/jpeg',10
FROM generate_series(1,6) g;
SELECT public._bv_fails($$INSERT INTO vault_files(item_id,side,storage_path,mime,size) VALUES ('b1000000-0000-4000-8000-000000000002','pagina','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000002/b3000000-0000-4000-8000-000000000007.jpg','image/jpeg',10)$$, 'M1 máximo 6 archivos por fila');
-- La dueña borra su objeto y su fila (con sus archivos en cascada).
DELETE FROM storage.objects WHERE name = 'b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001.jpg';
DELETE FROM vault_items WHERE id = 'b1000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT public._bv_ok((SELECT count(*) FROM storage.objects WHERE bucket_id = 'travel-vault') = 0
  AND (SELECT count(*) FROM vault_files WHERE item_id = 'b1000000-0000-4000-8000-000000000002') = 0
  AND (SELECT count(*) FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1') = 2,
  'C4 la dueña borra su objeto y su fila (archivos en cascada)');
SELECT public._bv_ok(hotel_loyalty = '[]'::jsonb, 'P2 la proyección se actualiza al borrar') FROM user_vault_benefits WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1';

-- ───── Borrado de cuenta ─────
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('travel-vault','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-0000000000aa.pdf',NULL,NULL);
INSERT INTO vault_files(user_id,item_id,side,storage_path,mime,size) VALUES ('b0000000-0000-4000-8000-0000000000a1','b1000000-0000-4000-8000-000000000001','pdf','b0000000-0000-4000-8000-0000000000a1/b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-0000000000aa.pdf','application/pdf',2048);
SELECT public._bv_ok(count(*) = 1, 'D1 account_deletion_files incluye los archivos de la bóveda (aunque no traigan owner)')
FROM public.account_deletion_files('b0000000-0000-4000-8000-0000000000a1') f WHERE f.bucket_id = 'travel-vault';
SELECT public.purge_account_data('b0000000-0000-4000-8000-0000000000a1');
SELECT public._bv_ok((SELECT count(*) FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1') = 0
  AND (SELECT count(*) FROM vault_files WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1') = 0
  AND (SELECT count(*) FROM user_vault_benefits WHERE user_id = 'b0000000-0000-4000-8000-0000000000a1') = 0,
  'D2 purge_account_data borra filas, archivos y proyección de la bóveda');
SELECT public._bv_ok((SELECT count(*) FROM vault_items WHERE user_id = 'b0000000-0000-4000-8000-0000000000c3') = 7,
  'D3 el borrado no toca la bóveda de otra cuenta');

DROP FUNCTION public._bv_ok(boolean, text, text);
DROP FUNCTION public._bv_fails(text, text);
