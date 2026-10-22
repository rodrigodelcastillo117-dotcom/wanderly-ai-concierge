-- Formato: "<ID> <qué> [<esperado>]: <observado>"; run.sh lo convierte en OK/FALLA (t_brackets de ../lib.sh).
-- Los ataques dan "permission denied" o violan RLS a propósito: el veredicto lo dan las líneas con corchetes.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','owner@example.test'),('bbbbbbbb-0000-0000-0000-00000000000b','attacker@example.test'),('cccccccc-0000-0000-0000-00000000000c','friend@example.test');
INSERT INTO storage.buckets(id,name,public) VALUES ('journal-photos','journal-photos',true),('travel-moments','travel-moments',true) ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino) VALUES ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','Paris');
INSERT INTO storage.objects(bucket_id,name) VALUES ('journal-photos','aaaaaaaa-0000-0000-0000-00000000000a/11111111-0000-0000-0000-000000000001/x.jpg'),('travel-moments','aaaaaaaa-0000-0000-0000-00000000000a/m.jpg'),('travel-moments','avatars/aaaaaaaa-0000-0000-0000-00000000000a/v2.png');
-- ATAQUES (atacante b)
SET ROLE anon; SELECT 'A1 anon ve objetos [0]: '||count(*) FROM storage.objects; RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-00000000000b',false), set_config('request.jwt.claim.role','authenticated',false);
SELECT 'A2 atacante ve objetos ajenos [0]: '||count(*) FROM storage.objects;
INSERT INTO trips(id,user_id,destino) VALUES ('22222222-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','Decoy');
INSERT INTO trip_collaborators(trip_id,user_id,invited_by) VALUES ('22222222-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b');
UPDATE trip_collaborators SET trip_id='11111111-0000-0000-0000-000000000001', status='accepted' WHERE user_id='bbbbbbbb-0000-0000-0000-00000000000b';
SELECT 'A3 atacante ve viaje ajeno [0]: '||count(*) FROM trips WHERE id='11111111-0000-0000-0000-000000000001';
INSERT INTO friendships(requester_id,addressee_id,status) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-00000000000a','accepted');
SELECT 'A4 atacante ve perfil ajeno [0]: '||count(*) FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-00000000000a';
INSERT INTO tracked_flights(user_id,flight,flight_date) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b','AM1',current_date);
RESET ROLE; SELECT 'A5 vuelos insertados directo [0]: '||count(*) FROM tracked_flights;
-- FLUJOS LEGITIMOS: a invita a c (amigos vía código), c acepta, c edita, c intenta cambiar dueño, a remueve
DELETE FROM friendships; DELETE FROM trip_collaborators;
SELECT invite_code AS code FROM public.profiles WHERE id='aaaaaaaa-0000-0000-0000-00000000000a' \gset
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-00000000000c',false);
SELECT 'L1 agregar amigo por código [{"ok": true, "amigo_id": "aaaaaaaa-0000-0000-0000-00000000000a"}]: '||agregar_amigo_por_codigo(:'code')::text;
RESET ROLE; SELECT 'L1b amistades [1 accepted]: '||count(*)||' '||string_agg(status,',') FROM friendships;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-00000000000a',false);
SELECT 'L2 invitar [{"ok": true}]: '||invitar_amigo_viaje('11111111-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c')::text;
SELECT 'L2b dueño ve sus fotos [3]: '||count(*) FROM storage.objects;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-00000000000c',false);
SELECT 'L3 aceptar [{"ok": true}]: '||aceptar_invitacion_viaje('11111111-0000-0000-0000-000000000001')::text;
SELECT 'L4 colaborador ve viaje [1]: '||count(*) FROM trips WHERE id='11111111-0000-0000-0000-000000000001';
SELECT 'L4b colaborador ve foto del diario [1]: '||count(*) FROM storage.objects WHERE bucket_id='journal-photos';
UPDATE trips SET destino='Paris y Lyon' WHERE id='11111111-0000-0000-0000-000000000001';
SELECT 'L5 colaborador editó [Paris y Lyon]: '||destino FROM trips WHERE id='11111111-0000-0000-0000-000000000001';
UPDATE trips SET user_id='cccccccc-0000-0000-0000-00000000000c' WHERE id='11111111-0000-0000-0000-000000000001';
RESET ROLE; SELECT 'L6 dueño tras intento [aaaaaaaa-0000-0000-0000-00000000000a]: '||user_id FROM trips WHERE id='11111111-0000-0000-0000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-00000000000a',false);
DELETE FROM trip_collaborators WHERE trip_id='11111111-0000-0000-0000-000000000001' AND user_id='cccccccc-0000-0000-0000-00000000000c';
RESET ROLE; SELECT 'L7 colaboradores tras remover [0]: '||count(*) FROM trip_collaborators;
