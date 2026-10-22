-- Expediente vivo del viaje (grupo trip): viaje activo, selecciones (E-12), trip_id de reservas y
-- gastos (E-22), documentos del viaje y gastos compartidos (D-18).
-- Uso: después de run.sh <db>, `psql -d <db> -f trip_expediente.sql`.
-- Esperado: cada línea "Xn ... [esperado]: real" con real = esperado.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
  ('d0000000-0000-0000-0000-00000000000d','t-owner@example.test'),
  ('e0000000-0000-0000-0000-00000000000e','t-attacker@example.test'),
  ('f0000000-0000-0000-0000-00000000000f','t-collab@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO profiles(id) VALUES ('d0000000-0000-0000-0000-00000000000d'),('e0000000-0000-0000-0000-00000000000e'),('f0000000-0000-0000-0000-00000000000f')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso,total_estimado) VALUES
  ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','Roma',2,'2026-12-01','2026-12-06',80000),
  ('e1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e','Lima',1,'2026-12-10','2026-12-12',20000);
INSERT INTO trip_collaborators(trip_id,user_id,invited_by,status)
VALUES ('d1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','d0000000-0000-0000-0000-00000000000d','accepted');

-- ───── Viaje activo (20261022131000; no tenía prueba SQL) ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
UPDATE profiles SET active_trip_id='d1000000-0000-0000-0000-000000000001' WHERE id='e0000000-0000-0000-0000-00000000000e';
SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
UPDATE profiles SET active_trip_id='d1000000-0000-0000-0000-000000000001' WHERE id='f0000000-0000-0000-0000-00000000000f';
RESET ROLE;
SELECT 'T1 atacante no fija viaje ajeno [null]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='e0000000-0000-0000-0000-00000000000e';
SELECT 'T2 colaborador fija viaje compartido [d1000000-0000-0000-0000-000000000001]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='f0000000-0000-0000-0000-00000000000f';

-- ───── Selecciones (E-12) y base de cotización ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
UPDATE trips SET selections='{"v":1,"vuelo":{"i":1,"key":"iberia||madrid|9000"},"hospedaje":{"i":-1,"key":null},"noches_hospedaje":null,"tours":[]}'
 WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'S1 cambiar selección marca recotizar [t|vuelo 1]: '||quote_needs_update||'|vuelo '||(selections->'vuelo'->>'i') FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
-- El cliente no puede "aprobar" su selección escribiendo la base.
UPDATE trips SET quote_basis = quote_basis || jsonb_build_object('selections', selections), quote_needs_update=false
 WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'S2 la base no la escribe el cliente [t|null]: '||quote_needs_update||'|'||coalesce(quote_basis->>'selections','null') FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
UPDATE trips SET selections=NULL WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'S3 volver a la cotización tal cual [f]: '||quote_needs_update FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
UPDATE trips SET selections='{"v":1,"vuelo":{"i":0,"key":"a"},"hospedaje":{"i":-1,"key":null},"noches_hospedaje":null,"tours":[]}' WHERE id='d1000000-0000-0000-0000-000000000001';
UPDATE trips SET selections='[1,2]' WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'S4 selección debe ser objeto [0]: '||(selections->'vuelo'->>'i') FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
-- Cotización nueva (service role, como analizar-viaje): la selección vieja se limpia y la base queda al día.
SET ROLE service_role;
INSERT INTO trip_quotes(id,trip_id,user_id,origin,total,line_items,travelers,nights,rooms,date_from,date_to,fx_rate,fx_source,fx_at,valid_until)
VALUES ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','logistics-plan',81000,'[]',2,5,1,'2026-12-01','2026-12-06',18.4,'frankfurter',now(),now()+interval '7 days');
UPDATE trips SET current_quote_id='d2000000-0000-0000-0000-000000000001' WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT 'S5 cotización nueva limpia selección [null|f|null]: '||coalesce(selections::text,'null')||'|'||quote_needs_update||'|'||coalesce(quote_basis->>'selections','null')
FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';

-- ───── trip_id de bookings y expenses (E-22) ─────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('e0000000-0000-0000-0000-00000000000e','d1000000-0000-0000-0000-000000000001','flight','x','robo');
INSERT INTO expenses(user_id,trip_id,amount,category) VALUES ('e0000000-0000-0000-0000-00000000000e','d1000000-0000-0000-0000-000000000001',10,'Otros');
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('e0000000-0000-0000-0000-00000000000e','e1000000-0000-0000-0000-000000000001','hotel','x','propio');
UPDATE bookings SET trip_id='d1000000-0000-0000-0000-000000000001' WHERE user_id='e0000000-0000-0000-0000-00000000000e';
SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('f0000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-000000000001','car','x','colab');
INSERT INTO expenses(user_id,trip_id,amount,category) VALUES ('f0000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-000000000001',10,'Otros');
RESET ROLE;
SELECT 'B1 atacante no liga reservas ni gastos a viaje ajeno [0|0]: '||
  (SELECT count(*) FROM bookings WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='e0000000-0000-0000-0000-00000000000e')||'|'||
  (SELECT count(*) FROM expenses WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='e0000000-0000-0000-0000-00000000000e');
SELECT 'B2 su propio viaje sí [1]: '||count(*) FROM bookings WHERE trip_id='e1000000-0000-0000-0000-000000000001';
SELECT 'B3 colaborador aceptado sí [1|1]: '||
  (SELECT count(*) FROM bookings WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='f0000000-0000-0000-0000-00000000000f')||'|'||
  (SELECT count(*) FROM expenses WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='f0000000-0000-0000-0000-00000000000f');

-- ───── Documentos del viaje ─────
SELECT 'D0 bucket privado con límites [f|10485760|6]: '||public||'|'||file_size_limit||'|'||array_length(allowed_mime_types,1) FROM storage.buckets WHERE id='trip-documents';
-- Dueño sube boleto (objeto + fila).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','d1000000-0000-0000-0000-000000000001/0001-boleto.pdf','d0000000-0000-0000-0000-00000000000d','d0000000-0000-0000-0000-00000000000d');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','boleto','d1000000-0000-0000-0000-000000000001/0001-boleto.pdf','boleto.pdf','application/pdf',2048);
-- Validaciones: tipo, MIME, tamaño, ruta fuera de su viaje, subcarpeta, uploaded_by ajeno.
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','licencia','d1000000-0000-0000-0000-000000000001/x.pdf','x.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','otro','d1000000-0000-0000-0000-000000000001/x.exe','x.exe','application/x-msdownload',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','otro','d1000000-0000-0000-0000-000000000001/big.pdf','big.pdf','application/pdf',10485761);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','otro','e1000000-0000-0000-0000-000000000001/x.pdf','x.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','otro','d1000000-0000-0000-0000-000000000001/a/b.pdf','b.pdf','application/pdf',10);
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','otro','d1000000-0000-0000-0000-000000000001/fake.pdf','fake.pdf','application/pdf',10);
RESET ROLE;
SELECT 'D1 solo el boleto válido quedó [1]: '||count(*) FROM trip_documents WHERE trip_id='d1000000-0000-0000-0000-000000000001';
-- Colaborador: ve, sube el suyo; no puede borrar el del dueño.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
SELECT 'D2 colaborador ve filas y objetos [1|1]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','d1000000-0000-0000-0000-000000000001/0002-poliza.pdf','f0000000-0000-0000-0000-00000000000f','f0000000-0000-0000-0000-00000000000f');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','poliza','d1000000-0000-0000-0000-000000000001/0002-poliza.pdf','poliza.pdf','application/pdf',4096);
DELETE FROM trip_documents WHERE kind='boleto';
DELETE FROM storage.objects WHERE name='d1000000-0000-0000-0000-000000000001/0001-boleto.pdf';
UPDATE trip_documents SET kind='otro';
RESET ROLE;
SELECT 'D3 colaborador subió el suyo y no borró ni cambió el del dueño [2|1|1|0]: '||
  (SELECT count(*) FROM trip_documents WHERE trip_id='d1000000-0000-0000-0000-000000000001')||'|'||
  (SELECT count(*) FROM trip_documents WHERE kind='boleto')||'|'||
  (SELECT count(*) FROM storage.objects WHERE name='d1000000-0000-0000-0000-000000000001/0001-boleto.pdf')||'|'||
  (SELECT count(*) FROM trip_documents WHERE kind='otro');
-- Atacante: no ve, no sube, no borra (filas ni objetos).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
SELECT 'D4 atacante no ve [0|0]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','d1000000-0000-0000-0000-000000000001/0003-x.pdf','e0000000-0000-0000-0000-00000000000e','e0000000-0000-0000-0000-00000000000e');
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','sin-viaje.pdf','e0000000-0000-0000-0000-00000000000e','e0000000-0000-0000-0000-00000000000e');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e','otro','d1000000-0000-0000-0000-000000000001/0003-x.pdf','x.pdf','application/pdf',10);
DELETE FROM trip_documents; DELETE FROM storage.objects WHERE bucket_id='trip-documents';
RESET ROLE;
SELECT 'D5 atacante no subió ni borró [2|2]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);
SELECT 'D6 anónimo no ve objetos [0]: '||count(*) FROM storage.objects WHERE bucket_id='trip-documents';
SELECT 'D6b anónimo sin permiso sobre la tabla [error abajo]';
SELECT count(*) FROM trip_documents;
RESET ROLE;
-- Dueño borra el documento del colaborador; colaborador borra el suyo propio en otro caso.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
DELETE FROM storage.objects WHERE name='d1000000-0000-0000-0000-000000000001/0002-poliza.pdf';
DELETE FROM trip_documents WHERE kind='poliza';
RESET ROLE;
SELECT 'D7 dueño borra el del colaborador [0|0]: '||(SELECT count(*) FROM trip_documents WHERE kind='poliza')||'|'||(SELECT count(*) FROM storage.objects WHERE name LIKE '%poliza%');
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','d1000000-0000-0000-0000-000000000001/0004-pasaporte.jpg','f0000000-0000-0000-0000-00000000000f','f0000000-0000-0000-0000-00000000000f');
INSERT INTO trip_documents(trip_id,uploaded_by,kind,storage_path,filename,mime,size)
VALUES ('d1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','pasaporte','d1000000-0000-0000-0000-000000000001/0004-pasaporte.jpg','pasaporte.jpg','image/jpeg',5000);
DELETE FROM trip_documents WHERE kind='pasaporte';
DELETE FROM storage.objects WHERE name='d1000000-0000-0000-0000-000000000001/0004-pasaporte.jpg';
RESET ROLE;
SELECT 'D8 quien lo subió lo borra [0|0]: '||(SELECT count(*) FROM trip_documents WHERE kind='pasaporte')||'|'||(SELECT count(*) FROM storage.objects WHERE name LIKE '%pasaporte%');
-- Si al colaborador lo quitan del viaje, deja de ver los documentos.
DELETE FROM trip_collaborators WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='f0000000-0000-0000-0000-00000000000f';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
SELECT 'D9 ex colaborador no ve [0|0]: '||(SELECT count(*) FROM trip_documents)||'|'||(SELECT count(*) FROM storage.objects WHERE bucket_id='trip-documents');
RESET ROLE;
SELECT 'T3 ex colaborador pierde el viaje activo [null]: '||coalesce(active_trip_id::text,'null') FROM profiles WHERE id='f0000000-0000-0000-0000-00000000000f';
-- Borrado de cuenta del dueño: incluye los archivos de su viaje.
INSERT INTO storage.objects(bucket_id,name,owner,owner_id) VALUES ('trip-documents','d1000000-0000-0000-0000-000000000001/0005-colab.pdf','f0000000-0000-0000-0000-00000000000f','f0000000-0000-0000-0000-00000000000f');
SELECT 'D10 borrado de cuenta lista archivos de su viaje [2]: '||count(*) FROM public.account_deletion_files('d0000000-0000-0000-0000-00000000000d') WHERE bucket_id='trip-documents';
SET ROLE authenticated;
SELECT 'D11 la función de borrado no la ejecuta un usuario [error abajo]';
SELECT count(*) FROM public.account_deletion_files('d0000000-0000-0000-0000-00000000000d');
RESET ROLE;

-- ───── Gastos compartidos (D-18) ─────
INSERT INTO trip_split_people(id,trip_id,name) VALUES
  ('d3000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Ana'),
  ('d3000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','Luis');
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description) VALUES ('d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',100,'cena');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description,currency) VALUES ('d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',50,'museo','EUR');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description) VALUES ('d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002',-500,'negativo');
INSERT INTO trip_split_expenses(trip_id,payer_id,amount,description,currency) VALUES ('d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002',5,'mal','pesos');
DELETE FROM trip_split_people WHERE id='d3000000-0000-0000-0000-000000000001';
DELETE FROM trip_split_people WHERE id='d3000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT 'P1 moneda por gasto, sin negativos ni monedas inválidas [EUR,MXN]: '||string_agg(currency,',' ORDER BY currency) FROM trip_split_expenses WHERE trip_id='d1000000-0000-0000-0000-000000000001';
SELECT 'P2 no se borra a quien pagó; sí a quien no [Ana]: '||string_agg(name,',') FROM trip_split_people WHERE trip_id='d1000000-0000-0000-0000-000000000001';
DELETE FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SELECT 'P3 borrar el viaje borra todo en cascada [0|0|0|0]: '||
  (SELECT count(*) FROM trip_split_people WHERE trip_id='d1000000-0000-0000-0000-000000000001')||'|'||
  (SELECT count(*) FROM trip_split_expenses WHERE trip_id='d1000000-0000-0000-0000-000000000001')||'|'||
  (SELECT count(*) FROM trip_documents WHERE trip_id='d1000000-0000-0000-0000-000000000001')||'|'||
  (SELECT count(*) FROM trip_quotes WHERE trip_id='d1000000-0000-0000-0000-000000000001');
