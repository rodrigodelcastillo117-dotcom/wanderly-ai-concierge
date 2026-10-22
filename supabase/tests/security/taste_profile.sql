-- Pruebas de la migración 20261024103000_personal_taste_profile.sql (Mejores momentos + caché del
-- perfil de gustos). Lo corre run.sh. Esperado: solo líneas "OK …" (cualquier "FALLA" es un error).
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES
  ('e1000000-0000-0000-0000-000000000001','taste-owner@example.test'),
  ('e2000000-0000-0000-0000-000000000002','taste-stranger@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso) VALUES
  ('e1100000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Mykonos, Grecia',2,'2025-07-01','2025-07-07'),
  ('e2200000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000002','Lima',1,'2025-03-01','2025-03-05')
ON CONFLICT DO NOTHING;

-- El servidor crea la fila de caché (rev 0, calculada con rev 0).
SET ROLE service_role;
INSERT INTO user_taste_profiles(user_id, profile, version, computed_rev, computed_for)
VALUES ('e1000000-0000-0000-0000-000000000001','{"v":1}',1,0,'2026-10-22') ON CONFLICT (user_id) DO NOTHING;
RESET ROLE;

-- ── Como la dueña ──
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false) \g /dev/null
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000001',false) \g /dev/null

INSERT INTO travel_moments(id,user_id,image_url,trip_id,destino,caption,tags,ai_tags,ai_tag_status,ai_tagged_at)
VALUES ('e1300000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','https://x.test/travel-moments/e1/a.jpg',
  'e1100000-0000-0000-0000-000000000001','Mykonos','  Atardecer en Little Venice  ','{Playa,playa,Atardecer}','{"tags":["inventado"]}','done',now());
SELECT CASE WHEN ai_tags IS NULL AND ai_tag_status='pending' AND ai_tagged_at IS NULL
  THEN 'OK TP1 el cliente no puede escribir etiquetas de visión al crear'
  ELSE 'FALLA TP1 ai_tags='||coalesce(ai_tags::text,'null')||' status='||ai_tag_status END
FROM travel_moments WHERE id='e1300000-0000-0000-0000-000000000001';
SELECT CASE WHEN caption='Atardecer en Little Venice' AND tags @> '{playa,atardecer}' AND cardinality(tags)=2
  THEN 'OK TP2 texto recortado y etiquetas normalizadas sin repetir' ELSE 'FALLA TP2 '||caption||' '||tags::text END
FROM travel_moments WHERE id='e1300000-0000-0000-0000-000000000001';

-- Ligarlo al viaje de otra persona: negado.
DO $$ BEGIN
  INSERT INTO travel_moments(user_id,image_url,trip_id) VALUES
    ('e1000000-0000-0000-0000-000000000001','https://x.test/b.jpg','e2200000-0000-0000-0000-000000000002');
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT CASE WHEN count(*)=0 THEN 'OK TP3 no se puede ligar un momento a un viaje ajeno' ELSE 'FALLA TP3' END
FROM travel_moments WHERE trip_id='e2200000-0000-0000-0000-000000000002';
DO $$ BEGIN
  UPDATE travel_moments SET trip_id='e2200000-0000-0000-0000-000000000002' WHERE id='e1300000-0000-0000-0000-000000000001';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT CASE WHEN trip_id='e1100000-0000-0000-0000-000000000001' THEN 'OK TP4 tampoco al editar' ELSE 'FALLA TP4' END
FROM travel_moments WHERE id='e1300000-0000-0000-0000-000000000001';
RESET ROLE;

-- El servidor (tag-moment) sí escribe las etiquetas de visión.
SET ROLE service_role;
UPDATE travel_moments SET ai_tags='{"tags":["playa","atardecer"]}', ai_tag_status='done', ai_tagged_at=now()
WHERE id='e1300000-0000-0000-0000-000000000001';
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e1000000-0000-0000-0000-000000000001',false) \g /dev/null
UPDATE travel_moments SET ai_tags='{"tags":["hackeado"]}', ai_tag_status='pending', caption='Lo mejor' WHERE id='e1300000-0000-0000-0000-000000000001';
SELECT CASE WHEN ai_tags->'tags'->>0='playa' AND ai_tag_status='done' AND caption='Lo mejor'
  THEN 'OK TP5 el cliente edita el texto pero no las etiquetas del servidor' ELSE 'FALLA TP5 '||coalesce(ai_tags::text,'null') END
FROM travel_moments WHERE id='e1300000-0000-0000-0000-000000000001';

-- Caché: la dueña lee la suya, no la puede escribir.
SELECT CASE WHEN count(*)=1 THEN 'OK TP6 la dueña lee su perfil de gustos' ELSE 'FALLA TP6' END FROM user_taste_profiles;
DO $$ BEGIN
  UPDATE user_taste_profiles SET computed_rev=999 WHERE user_id='e1000000-0000-0000-0000-000000000001';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  INSERT INTO user_taste_profiles(user_id,profile) VALUES ('e1000000-0000-0000-0000-000000000001','{}');
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT CASE WHEN computed_rev=0 THEN 'OK TP7 el cliente no puede escribir la caché' ELSE 'FALLA TP7 computed_rev='||computed_rev END
FROM user_taste_profiles WHERE user_id='e1000000-0000-0000-0000-000000000001';

-- ── Como otra persona ──
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e2000000-0000-0000-0000-000000000002',false) \g /dev/null
SELECT CASE WHEN count(*)=0 THEN 'OK TP8 nadie más ve tu perfil de gustos' ELSE 'FALLA TP8' END FROM user_taste_profiles;
SELECT CASE WHEN count(*)=0 THEN 'OK TP9 nadie más ve tus momentos' ELSE 'FALLA TP9' END FROM travel_moments WHERE user_id='e1000000-0000-0000-0000-000000000001';
RESET ROLE;

-- ── rev: qué invalida el perfil ──
SELECT CASE WHEN rev>=3 THEN 'OK TP10 crear/editar momentos sube rev' ELSE 'FALLA TP10 rev='||rev END
FROM user_taste_profiles WHERE user_id='e1000000-0000-0000-0000-000000000001';
INSERT INTO ai_user_preferences(user_id) VALUES ('e1000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
CREATE TEMP TABLE r AS SELECT rev FROM user_taste_profiles WHERE user_id='e1000000-0000-0000-0000-000000000001';
UPDATE trips SET cover_image_url='https://x.test/c.jpg' WHERE id='e1100000-0000-0000-0000-000000000001';
UPDATE ai_user_preferences SET dna_signal='{"categories":{"flights":3}}' WHERE user_id='e1000000-0000-0000-0000-000000000001';
INSERT INTO recomendaciones(user_id,tipo,titulo,guardado) VALUES ('e1000000-0000-0000-0000-000000000001','destination_ai','Comporta',false);
SELECT CASE WHEN u.rev=r.rev THEN 'OK TP11 portada, dna_signal y recomendaciones sin guardar no invalidan' ELSE 'FALLA TP11 '||r.rev||'→'||u.rev END
FROM user_taste_profiles u, r WHERE u.user_id='e1000000-0000-0000-0000-000000000001';
UPDATE trips SET fecha_regreso='2025-07-08' WHERE id='e1100000-0000-0000-0000-000000000001';
UPDATE recomendaciones SET guardado=true WHERE user_id='e1000000-0000-0000-0000-000000000001' AND titulo='Comporta';
INSERT INTO trips(user_id,destino,fecha_salida,fecha_regreso) VALUES ('e1000000-0000-0000-0000-000000000001','Kioto','2024-04-01','2024-04-08');
INSERT INTO visited_places(user_id,place_id,name,cuisine) VALUES ('e1000000-0000-0000-0000-000000000001','p1','Sushi Saito','japonesa');
SELECT CASE WHEN u.rev=r.rev+4 THEN 'OK TP12 fechas del viaje, favorito, viaje nuevo y visita invalidan' ELSE 'FALLA TP12 '||r.rev||'→'||u.rev END
FROM user_taste_profiles u, r WHERE u.user_id='e1000000-0000-0000-0000-000000000001';

-- Sin fila de caché, los triggers no crean una (borrar la cuenta no deja nada atrás).
INSERT INTO travel_moments(user_id,image_url) VALUES ('e2000000-0000-0000-0000-000000000002','https://x.test/z.jpg');
SELECT CASE WHEN count(*)=0 THEN 'OK TP13 los triggers no crean filas de caché' ELSE 'FALLA TP13' END
FROM user_taste_profiles WHERE user_id='e2000000-0000-0000-0000-000000000002';
SELECT CASE WHEN NOT has_function_privilege('authenticated','public.taste_profile_bump()','EXECUTE')
  THEN 'OK TP14 authenticated no ejecuta taste_profile_bump' ELSE 'FALLA TP14' END;

-- Borrar el viaje deja el momento sin viaje (no lo borra).
DELETE FROM trips WHERE id='e1100000-0000-0000-0000-000000000001';
SELECT CASE WHEN trip_id IS NULL THEN 'OK TP15 borrar el viaje conserva el momento sin viaje' ELSE 'FALLA TP15' END
FROM travel_moments WHERE id='e1300000-0000-0000-0000-000000000001';
