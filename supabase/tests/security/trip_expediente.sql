-- Expediente vivo del viaje (grupo trip): viaje activo, selecciones (E-12), trip_id de reservas y
-- gastos (E-22), documentos del viaje y gastos compartidos (D-18).
-- Uso: ./run_trip.sh expediente [db] (base nueva con todas las migraciones en orden).
-- Esperado: cada línea "Xn ... [esperado]: real" con real = esperado.
\set ON_ERROR_STOP off
-- Ids propios (7d…/7e…/7f…) para no chocar con hardening.sql, que corre antes en la misma base.
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
  ('7d000000-0000-0000-0000-0000000000d7','t-owner@example.test'),
  ('7e000000-0000-0000-0000-0000000000e7','t-attacker@example.test'),
  ('7f000000-0000-0000-0000-0000000000f7','t-collab@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO profiles(id) VALUES ('7d000000-0000-0000-0000-0000000000d7'),('7e000000-0000-0000-0000-0000000000e7'),('7f000000-0000-0000-0000-0000000000f7')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso,total_estimado) VALUES
  ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','Roma',2,'2026-12-01','2026-12-06',80000),
  ('7e100000-0000-0000-0000-000000000071','7e000000-0000-0000-0000-0000000000e7','Lima',1,'2026-12-10','2026-12-12',20000);
INSERT INTO trip_collaborators(trip_id,user_id,invited_by,status)
VALUES ('7d100000-0000-0000-0000-000000000071','7f000000-0000-0000-0000-0000000000f7','7d000000-0000-0000-0000-0000000000d7','accepted');

-- ───── Viaje activo (20261022131000; no tenía prueba SQL) ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7e000000-0000-0000-0000-0000000000e7',false);
UPDATE profiles SET active_trip_id='7d100000-0000-0000-0000-000000000071' WHERE id='7e000000-0000-0000-0000-0000000000e7';
SELECT set_config('request.jwt.claim.sub','7f000000-0000-0000-0000-0000000000f7',false);
UPDATE profiles SET active_trip_id='7d100000-0000-0000-0000-000000000071' WHERE id='7f000000-0000-0000-0000-0000000000f7';
RESET ROLE;
SELECT 'T1 atacante no fija viaje ajeno [null]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='7e000000-0000-0000-0000-0000000000e7';
SELECT 'T2 colaborador fija viaje compartido [7d100000-0000-0000-0000-000000000071]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='7f000000-0000-0000-0000-0000000000f7';

-- ───── Selecciones (E-12) y base de cotización ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
UPDATE trips SET selections='{"v":1,"vuelo":{"i":1,"key":"iberia||madrid|9000"},"hospedaje":{"i":-1,"key":null},"noches_hospedaje":null,"tours":[]}'
 WHERE id='7d100000-0000-0000-0000-000000000071';
RESET ROLE;
SELECT 'S1 cambiar selección marca recotizar [true|vuelo 1]: '||quote_needs_update||'|vuelo '||(selections->'vuelo'->>'i') FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
-- El cliente no puede "aprobar" su selección escribiendo la base.
UPDATE trips SET quote_basis = quote_basis || jsonb_build_object('selections', selections), quote_needs_update=false
 WHERE id='7d100000-0000-0000-0000-000000000071';
RESET ROLE;
SELECT 'S2 la base no la escribe el cliente [true|null]: '||quote_needs_update||'|'||coalesce(quote_basis->>'selections','null') FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
UPDATE trips SET selections=NULL WHERE id='7d100000-0000-0000-0000-000000000071';
RESET ROLE;
SELECT 'S3 volver a la cotización tal cual [false]: '||quote_needs_update FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
UPDATE trips SET selections='{"v":1,"vuelo":{"i":0,"key":"a"},"hospedaje":{"i":-1,"key":null},"noches_hospedaje":null,"tours":[]}' WHERE id='7d100000-0000-0000-0000-000000000071';
UPDATE trips SET selections='[1,2]' WHERE id='7d100000-0000-0000-0000-000000000071';
RESET ROLE;
SELECT 'S4 selección debe ser objeto [0]: '||(selections->'vuelo'->>'i') FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';
-- Cotización nueva (service role, como analizar-viaje): la selección vieja se limpia y la base queda al día.
SET ROLE service_role;
INSERT INTO trip_quotes(id,trip_id,user_id,origin,total,line_items,travelers,nights,rooms,date_from,date_to,fx_rate,fx_source,fx_at,valid_until)
VALUES ('7d200000-0000-0000-0000-000000000071','7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','logistics-plan',81000,'[]',2,5,1,'2026-12-01','2026-12-06',18.4,'frankfurter',now(),now()+interval '7 days');
UPDATE trips SET current_quote_id='7d200000-0000-0000-0000-000000000071' WHERE id='7d100000-0000-0000-0000-000000000071';
RESET ROLE;
SELECT 'S5 cotización nueva limpia selección [null|false|null]: '||coalesce(selections::text,'null')||'|'||quote_needs_update||'|'||coalesce(quote_basis->>'selections','null')
FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';

-- ───── trip_id de bookings y expenses (E-22) ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7e000000-0000-0000-0000-0000000000e7',false);
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('7e000000-0000-0000-0000-0000000000e7','7d100000-0000-0000-0000-000000000071','flight','x','robo');
INSERT INTO expenses(user_id,trip_id,amount,category) VALUES ('7e000000-0000-0000-0000-0000000000e7','7d100000-0000-0000-0000-000000000071',10,'Otros');
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('7e000000-0000-0000-0000-0000000000e7','7e100000-0000-0000-0000-000000000071','hotel','x','propio');
UPDATE bookings SET trip_id='7d100000-0000-0000-0000-000000000071' WHERE user_id='7e000000-0000-0000-0000-0000000000e7';
SELECT set_config('request.jwt.claim.sub','7f000000-0000-0000-0000-0000000000f7',false);
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('7f000000-0000-0000-0000-0000000000f7','7d100000-0000-0000-0000-000000000071','car','x','colab');
INSERT INTO expenses(user_id,trip_id,amount,category) VALUES ('7f000000-0000-0000-0000-0000000000f7','7d100000-0000-0000-0000-000000000071',10,'Otros');
RESET ROLE;
SELECT 'B1 atacante no liga reservas ni gastos a viaje ajeno [0|0]: '||
  (SELECT count(*) FROM bookings WHERE trip_id='7d100000-0000-0000-0000-000000000071' AND user_id='7e000000-0000-0000-0000-0000000000e7')||'|'||
  (SELECT count(*) FROM expenses WHERE trip_id='7d100000-0000-0000-0000-000000000071' AND user_id='7e000000-0000-0000-0000-0000000000e7');
SELECT 'B2 su propio viaje sí [1]: '||count(*) FROM bookings WHERE trip_id='7e100000-0000-0000-0000-000000000071';
SELECT 'B3 colaborador aceptado sí [1|1]: '||
  (SELECT count(*) FROM bookings WHERE trip_id='7d100000-0000-0000-0000-000000000071' AND user_id='7f000000-0000-0000-0000-0000000000f7')||'|'||
  (SELECT count(*) FROM expenses WHERE trip_id='7d100000-0000-0000-0000-000000000071' AND user_id='7f000000-0000-0000-0000-0000000000f7');

-- ───── Documentos del viaje ─────
SELECT 'D0 bucket privado con límites [false|10485760|6]: '||public||'|'||file_size_limit||'|'||array_length(allowed_mime_types,1) FROM storage.buckets WHERE id='trip-documents';
-- Dueño sube boleto (objeto + fila).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','7d100000-0000-0000-0000-000000000071/0001-boleto.pdf','7d000000-0000-0000-0000-0000000000d7','7d000000-0000-0000-0000-0000000000d7');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','boleto','7d100000-0000-0000-0000-000000000071/0001-boleto.pdf','boleto.pdf','application/pdf',2048);
-- Validaciones: tipo, MIME, tamaño, ruta fuera de su viaje, subcarpeta, uploaded_by ajeno.
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','licencia','7d100000-0000-0000-0000-000000000071/x.pdf','x.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','otro','7d100000-0000-0000-0000-000000000071/x.exe','x.exe','application/x-msdownload',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','otro','7d100000-0000-0000-0000-000000000071/big.pdf','big.pdf','application/pdf',10485761);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','otro','7e100000-0000-0000-0000-000000000071/x.pdf','x.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7d000000-0000-0000-0000-0000000000d7','otro','7d100000-0000-0000-0000-000000000071/a/b.pdf','b.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7f000000-0000-0000-0000-0000000000f7','otro','7d100000-0000-0000-0000-000000000071/fake.pdf','fake.pdf','application/pdf',10);
RESET ROLE;
SELECT 'D1 solo el boleto válido quedó [1]: '||count(*) FROM trip_documents WHERE trip_id='7d100000-0000-0000-0000-000000000071';
-- Colaborador: ve, sube el suyo; no puede borrar el del dueño.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7f000000-0000-0000-0000-0000000000f7',false);
SELECT 'D2 colaborador ve filas y objetos [1|1]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','7d100000-0000-0000-0000-000000000071/0002-poliza.pdf','7f000000-0000-0000-0000-0000000000f7','7f000000-0000-0000-0000-0000000000f7');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7f000000-0000-0000-0000-0000000000f7','poliza','7d100000-0000-0000-0000-000000000071/0002-poliza.pdf','poliza.pdf','application/pdf',4096);
DELETE FROM trip_documents WHERE kind='boleto';
DELETE FROM storage.objects WHERE name='7d100000-0000-0000-0000-000000000071/0001-boleto.pdf';
UPDATE trip_documents SET kind='otro';
RESET ROLE;
SELECT 'D3 colaborador subió el suyo y no borró ni cambió el del dueño [2|1|1|0]: '||
  (SELECT count(*) FROM trip_documents WHERE trip_id='7d100000-0000-0000-0000-000000000071')||'|'||
  (SELECT count(*) FROM trip_documents WHERE kind='boleto')||'|'||
  (SELECT count(*) FROM storage.objects WHERE name='7d100000-0000-0000-0000-000000000071/0001-boleto.pdf')||'|'||
  (SELECT count(*) FROM trip_documents WHERE kind='otro');
-- Atacante: no ve, no sube, no borra (filas ni objetos).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7e000000-0000-0000-0000-0000000000e7',false);
SELECT 'D4 atacante no ve [0|0]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','7d100000-0000-0000-0000-000000000071/0003-x.pdf','7e000000-0000-0000-0000-0000000000e7','7e000000-0000-0000-0000-0000000000e7');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','sin-viaje.pdf','7e000000-0000-0000-0000-0000000000e7','7e000000-0000-0000-0000-0000000000e7');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7e000000-0000-0000-0000-0000000000e7','otro','7d100000-0000-0000-0000-000000000071/0003-x.pdf','x.pdf','application/pdf',10);
DELETE FROM trip_documents; DELETE FROM storage.objects WHERE bucket_id='trip-documents';
RESET ROLE;
SELECT 'D5 atacante no subió ni borró [2|2]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);
SELECT 'D6 anónimo no ve objetos [0]: '||count(*) FROM storage.objects WHERE bucket_id='trip-documents';
DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM public.trip_documents;
  RAISE NOTICE 'D6b anónimo sin permiso sobre la tabla [permission denied]: leyó % fila(s)', n;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'D6b anónimo sin permiso sobre la tabla [permission denied]: permission denied'; END $$;
RESET ROLE;
-- Dueño borra el documento del colaborador; colaborador borra el suyo propio en otro caso.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
DELETE FROM storage.objects WHERE name='7d100000-0000-0000-0000-000000000071/0002-poliza.pdf';
DELETE FROM trip_documents WHERE kind='poliza';
RESET ROLE;
SELECT 'D7 dueño borra el del colaborador [0|0]: '||(SELECT count(*) FROM trip_documents WHERE kind='poliza')||'|'||(SELECT count(*) FROM storage.objects WHERE name LIKE '%poliza%');
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7f000000-0000-0000-0000-0000000000f7',false);
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','7d100000-0000-0000-0000-000000000071/0004-pasaporte.jpg','7f000000-0000-0000-0000-0000000000f7','7f000000-0000-0000-0000-0000000000f7');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('7d100000-0000-0000-0000-000000000071','7f000000-0000-0000-0000-0000000000f7','pasaporte','7d100000-0000-0000-0000-000000000071/0004-pasaporte.jpg','pasaporte.jpg','image/jpeg',5000);
DELETE FROM trip_documents WHERE kind='pasaporte';
DELETE FROM storage.objects WHERE name='7d100000-0000-0000-0000-000000000071/0004-pasaporte.jpg';
RESET ROLE;
SELECT 'D8 quien lo subió lo borra [0|0]: '||(SELECT count(*) FROM trip_documents WHERE kind='pasaporte')||'|'||(SELECT count(*) FROM storage.objects WHERE name LIKE '%pasaporte%');
-- Si al colaborador lo quitan del viaje, deja de ver los documentos.
DELETE FROM trip_collaborators WHERE trip_id='7d100000-0000-0000-0000-000000000071' AND user_id='7f000000-0000-0000-0000-0000000000f7';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7f000000-0000-0000-0000-0000000000f7',false);
SELECT 'D9 ex colaborador no ve [0|0]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
RESET ROLE;
SELECT 'T3 ex colaborador pierde el viaje activo [null]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='7f000000-0000-0000-0000-0000000000f7';
-- Borrado de cuenta del dueño: incluye los archivos de su viaje.
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','7d100000-0000-0000-0000-000000000071/0005-colab.pdf','7f000000-0000-0000-0000-0000000000f7','7f000000-0000-0000-0000-0000000000f7');
SELECT 'D10 borrado de cuenta lista archivos de su viaje [2]: '||count(*) FROM public.account_deletion_files('7d000000-0000-0000-0000-0000000000d7') WHERE bucket_id='trip-documents';
SET ROLE authenticated;
DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM public.account_deletion_files('7d000000-0000-0000-0000-0000000000d7');
  RAISE NOTICE 'D11 la función de borrado no la ejecuta un usuario [permission denied]: devolvió % fila(s)', n;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'D11 la función de borrado no la ejecuta un usuario [permission denied]: permission denied'; END $$;
RESET ROLE;

-- ───── Gastos compartidos (D-18) ─────
INSERT INTO trip_split_people(id,trip_id,name) VALUES
  ('7d300000-0000-0000-0000-000000000071','7d100000-0000-0000-0000-000000000071','Ana'),
  ('7d300000-0000-0000-0000-000000000072','7d100000-0000-0000-0000-000000000071','Luis');
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','7d000000-0000-0000-0000-0000000000d7',false);
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description) VALUES ('7d100000-0000-0000-0000-000000000071','7d300000-0000-0000-0000-000000000071',100,'cena');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description,currency) VALUES ('7d100000-0000-0000-0000-000000000071','7d300000-0000-0000-0000-000000000071',50,'museo','EUR');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description) VALUES ('7d100000-0000-0000-0000-000000000071','7d300000-0000-0000-0000-000000000072',-500,'negativo');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description,currency) VALUES ('7d100000-0000-0000-0000-000000000071','7d300000-0000-0000-0000-000000000072',5,'mal','pesos');
DELETE FROM trip_split_people WHERE id='7d300000-0000-0000-0000-000000000071';
DELETE FROM trip_split_people WHERE id='7d300000-0000-0000-0000-000000000072';
RESET ROLE;
SELECT 'P1 moneda por gasto, sin negativos ni monedas inválidas [EUR,MXN]: '||string_agg(currency,',' ORDER BY currency) FROM trip_split_expenses WHERE trip_id='7d100000-0000-0000-0000-000000000071';
SELECT 'P2 no se borra a quien pagó; sí a quien no [Ana]: '||string_agg(name,',') FROM trip_split_people WHERE trip_id='7d100000-0000-0000-0000-000000000071';
DELETE FROM trips WHERE id='7d100000-0000-0000-0000-000000000071';
SELECT 'P3 borrar el viaje borra todo en cascada [0|0|0|0]: '||
  (SELECT count(*) FROM trip_split_people WHERE trip_id='7d100000-0000-0000-0000-000000000071')||'|'||
  (SELECT count(*) FROM trip_split_expenses WHERE trip_id='7d100000-0000-0000-0000-000000000071')||'|'||
  (SELECT count(*) FROM trip_documents WHERE trip_id='7d100000-0000-0000-0000-000000000071')||'|'||
  (SELECT count(*) FROM trip_quotes WHERE trip_id='7d100000-0000-0000-0000-000000000071');
