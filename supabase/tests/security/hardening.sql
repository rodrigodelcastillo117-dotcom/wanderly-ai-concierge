-- Pruebas de las migraciones 2026102214xxxx (grupo sec2): F-07, colaboradores, F-09, F-10, F-11,
-- F-15, F-16, F-17, F-18, F-19, A-14, A-18. Las corre run.sh después de rls_attacks.sql.
-- Cada línea imprime "OK <id> …" o "FALLA <id> …". Usuarios y viajes con ids propios (d/e/f…).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('d0000000-0000-0000-0000-00000000000d','h-owner@example.test',now()),
  ('e0000000-0000-0000-0000-00000000000e','h-collab@example.test',now()),
  ('f0000000-0000-0000-0000-00000000000f','h-attacker@example.test',now()),
  ('90000000-0000-0000-0000-000000000009','h-comp@example.test',now())
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,status,total_estimado) VALUES
  ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','Roma',2,'listo',50000),
  ('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','Decoy',1,'listo',1);
INSERT INTO trip_collaborators(trip_id,user_id,invited_by,status) VALUES
  ('d1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e','d0000000-0000-0000-0000-00000000000d','accepted');
INSERT INTO friendships(requester_id,addressee_id,status) VALUES
  ('d0000000-0000-0000-0000-00000000000d','e0000000-0000-0000-0000-00000000000e','accepted');
UPDATE profiles SET full_name='Dueña', username='duena', avatar_url='https://x/a.png', fecha_nacimiento='1990-01-01'
 WHERE id='d0000000-0000-0000-0000-00000000000d';
SET ROLE service_role;
INSERT INTO trip_quotes(trip_id,user_id,origin,total,line_items,travelers,nights,rooms,fx_rate,fx_source,fx_at,valid_until)
VALUES ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d','analizar-viaje',50000,'[]',2,3,1,18,'x',now(),now()+interval '1 day');
RESET ROLE;

-- ===== Colaborador: solo contenido =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false), set_config('request.jwt.claim.role','authenticated',false);
UPDATE trips SET itinerario_json='[{"dia":1}]', destino='Roma y Florencia' WHERE id='d1000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  UPDATE trips SET current_quote_id=(SELECT id FROM trip_quotes WHERE trip_id='d1000000-0000-0000-0000-000000000001' LIMIT 1)
   WHERE id='d1000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'FALLA C2 colaborador cambió current_quote_id';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK C2 colaborador no puede cambiar current_quote_id';
END $$;
DO $$ BEGIN
  UPDATE trips SET quote_basis='{"num_viajeros":9}' WHERE id='d1000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'FALLA C3 colaborador cambió quote_basis';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK C3 colaborador no puede cambiar quote_basis';
END $$;
DO $$ BEGIN
  UPDATE trips SET created_at='2000-01-01' WHERE id='d1000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'FALLA C4 colaborador cambió created_at';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK C4 colaborador no puede cambiar created_at';
END $$;
UPDATE trips SET status='archivado', tips_personalizados='["llevar paraguas"]' WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT CASE WHEN destino='Roma y Florencia' AND itinerario_json IS NOT NULL AND tips_personalizados IS NOT NULL
            THEN 'OK C1 colaborador edita contenido (destino, itinerario, tips)' ELSE 'FALLA C1 contenido: '||destino END
  FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SELECT CASE WHEN status='listo' THEN 'OK C5 colaborador no cambia status (se conserva)' ELSE 'FALLA C5 status='||status END
  FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
UPDATE trips SET status='borrador' WHERE id='d1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT CASE WHEN status='borrador' THEN 'OK C6 el dueño sí cambia status' ELSE 'FALLA C6 status='||status END
  FROM trips WHERE id='d1000000-0000-0000-0000-000000000001';
UPDATE trips SET status='listo' WHERE id='d1000000-0000-0000-0000-000000000001';

-- ===== F-09: columnas sensibles del perfil =====
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
-- N-L1 (segunda auditoría): avatar_url ya no es edición normal; la escribe solo el servidor (P1b).
UPDATE profiles SET full_name='Dueña Dos', active_trip_id='d1000000-0000-0000-0000-000000000001', food_dna='{"a":1}'
 WHERE id='d0000000-0000-0000-0000-00000000000d';
DO $$ BEGIN
  UPDATE profiles SET avatar_url='https://x/b.png' WHERE id='d0000000-0000-0000-0000-00000000000d';
  RAISE NOTICE 'FALLA P1b cambió avatar_url desde el cliente';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P1b el cliente no puede poner cualquier URL como avatar';
END $$;
DO $$ BEGIN
  UPDATE profiles SET email='otro@evil.test' WHERE id='d0000000-0000-0000-0000-00000000000d';
  RAISE NOTICE 'FALLA P2 cambió email';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P2 no puede cambiar email';
END $$;
DO $$ BEGIN
  UPDATE profiles SET invite_code='ROBADO1' WHERE id='d0000000-0000-0000-0000-00000000000d';
  RAISE NOTICE 'FALLA P3 cambió invite_code';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P3 no puede cambiar invite_code';
END $$;
DO $$ BEGIN
  UPDATE profiles SET tier='platinum' WHERE id='d0000000-0000-0000-0000-00000000000d';
  RAISE NOTICE 'FALLA P4 cambió tier';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P4 no puede cambiar tier';
END $$;
DO $$ BEGIN
  INSERT INTO profiles(id,email,invite_code) VALUES ('f0000000-0000-0000-0000-00000000000f','x@x','X');
  RAISE NOTICE 'FALLA P5 insertó un perfil';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK P5 el cliente no inserta perfiles';
END $$;
RESET ROLE;
SELECT CASE WHEN avatar_url IS DISTINCT FROM 'https://x/b.png' AND full_name='Dueña Dos' AND email='h-owner@example.test'
             AND active_trip_id='d1000000-0000-0000-0000-000000000001'
            THEN 'OK P1 edición normal del perfil (nombre, viaje activo, food_dna; el avatar no)' ELSE 'FALLA P1' END
  FROM profiles WHERE id='d0000000-0000-0000-0000-00000000000d';
SELECT CASE WHEN count(*)=1 THEN 'OK P6 índice único de invite_code creado' ELSE 'FALLA P6 sin índice' END
  FROM pg_indexes WHERE indexname='profiles_invite_code_upper_key';

-- ===== F-10: amigos solo ven columnas seguras =====
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
SELECT CASE WHEN count(*)=0 THEN 'OK F1 el amigo ya no lee la fila completa del perfil' ELSE 'FALLA F1 lee '||count(*) END
  FROM profiles WHERE id='d0000000-0000-0000-0000-00000000000d';
SELECT CASE WHEN count(*)=1 AND min(full_name)='Dueña Dos' AND min(username)='duena'
            THEN 'OK F2 friend_profiles da nombre/usuario/avatar del amigo' ELSE 'FALLA F2 '||count(*) END
  FROM friend_profiles();
SELECT CASE WHEN string_agg(attname, ',' ORDER BY attnum)='id,full_name,username,avatar_url'
            THEN 'OK F3 friend_profiles solo expone id, full_name, username, avatar_url' ELSE 'FALLA F3 '||string_agg(attname, ',') END
  FROM (SELECT unnest(proargnames) AS attname, generate_series(1, array_length(proargnames,1)) AS attnum
          FROM pg_proc WHERE proname='friend_profiles') a WHERE attname <> 'p_ids';
SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
SELECT CASE WHEN count(*)=0 THEN 'OK F4 un no-amigo no obtiene perfiles' ELSE 'FALLA F4 '||count(*) END
  FROM friend_profiles(ARRAY['d0000000-0000-0000-0000-00000000000d'::uuid]);
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN PERFORM * FROM friend_profiles(); RAISE NOTICE 'FALLA F5 anon ejecutó friend_profiles';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK F5 anon no puede ejecutar friend_profiles'; END $$;
RESET ROLE;

-- ===== F-11: límites de los buckets =====
SELECT CASE WHEN count(*)=3 AND bool_and(file_size_limit=10485760) AND bool_and(NOT ('text/html' = ANY(allowed_mime_types)))
             AND bool_and(NOT ('image/svg+xml' = ANY(allowed_mime_types)))
            THEN 'OK S1 recibos/journal-photos/travel-moments con 10 MB y sin HTML/SVG' ELSE 'FALLA S1' END
  FROM storage.buckets WHERE id IN ('recibos','journal-photos','travel-moments');
SELECT CASE WHEN 'application/pdf' = ANY(allowed_mime_types) THEN 'OK S2 recibos acepta PDF' ELSE 'FALLA S2' END
  FROM storage.buckets WHERE id='recibos';

-- ===== F-19: notificaciones entre miembros solo desde el servidor =====
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
DO $$ BEGIN
  INSERT INTO notifications(user_id,type,title,body,related_id)
  VALUES ('d0000000-0000-0000-0000-00000000000d','social','Gana un iPhone','<a href=x>clic</a>','d1000000-0000-0000-0000-000000000001');
  RAISE NOTICE 'FALLA N1 un miembro insertó una notificación para otro';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK N1 un miembro no inserta notificaciones a otros';
END $$;
INSERT INTO notifications(user_id,type,title,body) VALUES ('e0000000-0000-0000-0000-00000000000e','social','nota','propia');
RESET ROLE;
SELECT CASE WHEN count(*)=1 THEN 'OK N2 notificación propia sí' ELSE 'FALLA N2 '||count(*) END
  FROM notifications WHERE user_id='e0000000-0000-0000-0000-00000000000e' AND title='nota';
-- El servidor (trigger SECURITY DEFINER) sigue avisando al dueño cuando el colaborador edita.
SELECT CASE WHEN count(*)>=1 THEN 'OK N3 notify_trip_updated sigue notificando al dueño' ELSE 'FALLA N3' END
  FROM notifications WHERE user_id='d0000000-0000-0000-0000-00000000000d' AND type='trip_updated';

-- ===== F-15: trip_id ajeno =====
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
DO $$ BEGIN
  INSERT INTO packing_lists(trip_id,user_id,lista_json) VALUES ('d1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f','{}');
  RAISE NOTICE 'FALLA T1 ocupó la lista de equipaje de un viaje ajeno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T1 packing_lists con viaje ajeno rechazado';
END $$;
DO $$ BEGIN
  INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('f0000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-000000000001','hotel','x','x');
  RAISE NOTICE 'FALLA T2 reserva en viaje ajeno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T2 bookings con viaje ajeno rechazado';
END $$;
DO $$ BEGIN
  INSERT INTO expenses(user_id,trip_id,amount,currency,category) VALUES ('f0000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-000000000001',10,'MXN','comida');
  RAISE NOTICE 'FALLA T3 gasto en viaje ajeno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T3 expenses con viaje ajeno rechazado';
END $$;
DO $$ BEGIN
  INSERT INTO concierge_requests(user_id,trip_id,type,title) VALUES ('f0000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-000000000001','jet','x');
  RAISE NOTICE 'FALLA T4 solicitud en viaje ajeno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T4 concierge_requests con viaje ajeno rechazado';
END $$;
INSERT INTO expenses(user_id,trip_id,amount,currency,category) VALUES ('f0000000-0000-0000-0000-00000000000f',NULL,10,'MXN','comida');
INSERT INTO expenses(user_id,trip_id,amount,currency,category) VALUES ('f0000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001',10,'MXN','comida');
DO $$ BEGIN
  UPDATE expenses SET trip_id='d1000000-0000-0000-0000-000000000001' WHERE user_id='f0000000-0000-0000-0000-00000000000f';
  RAISE NOTICE 'FALLA T5 movió su gasto a un viaje ajeno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK T5 UPDATE a viaje ajeno rechazado';
END $$;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
INSERT INTO bookings(user_id,trip_id,category,provider,title) VALUES ('e0000000-0000-0000-0000-00000000000e','d1000000-0000-0000-0000-000000000001','hotel','manual','colab');
RESET ROLE;
SELECT CASE WHEN count(*)=2 THEN 'OK T6 gasto sin viaje y en viaje propio sí' ELSE 'FALLA T6 '||count(*) END
  FROM expenses WHERE user_id='f0000000-0000-0000-0000-00000000000f';
SELECT CASE WHEN count(*)=1 THEN 'OK T7 el colaborador sí registra reservas del viaje compartido' ELSE 'FALLA T7' END
  FROM bookings WHERE user_id='e0000000-0000-0000-0000-00000000000e';

-- ===== F-17: oráculos =====
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
SELECT CASE WHEN NOT is_trip_owner('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d')
             AND NOT is_trip_collaborator('d1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e')
             AND NOT has_trip_access('d1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e')
            THEN 'OK O1 un tercero no averigua quién es dueño/colaborador' ELSE 'FALLA O1 oráculo responde' END;
SELECT CASE WHEN is_trip_owner('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-00000000000f')
            THEN 'OK O2 sobre sí mismo sí responde' ELSE 'FALLA O2' END;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
SELECT CASE WHEN has_trip_access('d1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000e')
             AND (SELECT count(*) FROM trips WHERE id='d1000000-0000-0000-0000-000000000001')=1
            THEN 'OK O3 el colaborador conserva su acceso (RLS)' ELSE 'FALLA O3' END;
RESET ROLE;
SET ROLE service_role; SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','service_role',false);
SELECT CASE WHEN is_trip_owner('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000d')
            THEN 'OK O4 service role recibe la respuesta real' ELSE 'FALLA O4' END;
RESET ROLE; SELECT set_config('request.jwt.claim.role','authenticated',false);
-- Al quitar al colaborador, su viaje activo se limpia (trigger reescrito sin el oráculo).
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
UPDATE profiles SET active_trip_id='d1000000-0000-0000-0000-000000000001' WHERE id='e0000000-0000-0000-0000-00000000000e';
RESET ROLE;
SELECT CASE WHEN active_trip_id IS NOT NULL THEN 'OK O5a el colaborador fija el viaje compartido como activo' ELSE 'FALLA O5a' END
  FROM profiles WHERE id='e0000000-0000-0000-0000-00000000000e';
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
DELETE FROM trip_collaborators WHERE trip_id='d1000000-0000-0000-0000-000000000001' AND user_id='e0000000-0000-0000-0000-00000000000e';
RESET ROLE;
SELECT CASE WHEN active_trip_id IS NULL THEN 'OK O5 quitar colaborador limpia su viaje activo' ELSE 'FALLA O5' END
  FROM profiles WHERE id='e0000000-0000-0000-0000-00000000000e';

-- ===== F-16: Members =====
INSERT INTO nightlife_access(user_id) VALUES ('f0000000-0000-0000-0000-00000000000f') ON CONFLICT DO NOTHING;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
INSERT INTO nightlife_access(user_id,confirmed_adult,password_unlocked) VALUES ('f0000000-0000-0000-0000-00000000000f',true,true)
  ON CONFLICT (user_id) DO UPDATE SET confirmed_adult=true, password_unlocked=true;
SELECT CASE WHEN confirmed_adult AND NOT password_unlocked THEN 'OK M1 el cliente confirma 18+ pero no se auto-desbloquea' ELSE 'FALLA M1' END
  FROM nightlife_access WHERE user_id='f0000000-0000-0000-0000-00000000000f';
SELECT 'OK M2 sin contraseña temporal encendida: '||(unlock_members_access('loquesea')->>'error');
DO $$ BEGIN PERFORM set_members_password('una-clave-larga-de-prueba', now() + interval '1 day'); RAISE NOTICE 'FALLA M3 el cliente fijó la contraseña';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK M3 el cliente no puede fijar la contraseña'; END $$;
DO $$ BEGIN PERFORM * FROM members_gate; RAISE NOTICE 'FALLA M4 el cliente lee el hash';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK M4 el cliente no lee members_gate'; END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN PERFORM set_members_password('Clave-De-Prueba-Local', NULL); RAISE NOTICE 'FALLA M5a contraseña sin caducidad aceptada';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK M5a la contraseña temporal exige caducidad'; END $$;
DO $$ BEGIN PERFORM set_members_password('Clave-De-Prueba-Local', now() + interval '90 days'); RAISE NOTICE 'FALLA M5b caducidad de 90 días aceptada';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK M5b caducidad máxima de 30 días'; END $$;
SELECT set_members_password('Clave-De-Prueba-Local', now() + interval '2 days');
RESET ROLE;
SELECT CASE WHEN password_hash LIKE '$2%' AND password_hash NOT ILIKE '%clave%' AND enabled THEN 'OK M5 se guarda solo un hash bcrypt, encendida' ELSE 'FALLA M5' END FROM members_gate;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
SELECT CASE WHEN unlock_members_access('incorrecta')->>'error'='contrasena_incorrecta' THEN 'OK M6 contraseña incorrecta rechazada' ELSE 'FALLA M6' END;
SELECT CASE WHEN (unlock_members_access('  clave-de-prueba-local ')->>'ok')::boolean THEN 'OK M7 contraseña correcta desbloquea' ELSE 'FALLA M7' END;
SELECT CASE WHEN password_unlocked AND password_access_expires_at BETWEEN now() + interval '1 day' AND now() + interval '3 days'
            THEN 'OK M8 el desbloqueo caduca con la contraseña' ELSE 'FALLA M8' END
  FROM nightlife_access WHERE user_id='f0000000-0000-0000-0000-00000000000f';
SELECT count(*) FILTER (WHERE r->>'error'='contrasena_incorrecta')||' intentos fallidos más' FROM (SELECT unlock_members_access('x') r FROM generate_series(1,8)) t;
SELECT CASE WHEN unlock_members_access('clave-de-prueba-local')->>'error'='demasiados_intentos' THEN 'OK M9 más de 10 intentos/hora bloqueados' ELSE 'FALLA M9' END;
RESET ROLE;

-- ===== F-07: check_rate_limit =====
SET ROLE service_role;
SELECT CASE WHEN (check_rate_limit('user:h','rl-test:m',2,60)->>'allowed')::boolean
             AND (check_rate_limit('user:h','rl-test:m',2,60)->>'allowed')::boolean
             AND NOT (check_rate_limit('user:h','rl-test:m',2,60)->>'allowed')::boolean
            THEN 'OK R1 límite 2: pasa, pasa, se niega' ELSE 'FALLA R1' END;
RESET ROLE;
SELECT CASE WHEN count(*)=2 THEN 'OK R2 la llamada negada no se cuenta' ELSE 'FALLA R2 '||count(*) END FROM rate_limits WHERE subject='user:h';
SET ROLE authenticated;
DO $$ BEGIN PERFORM check_rate_limit('user:h','rl-test:m',100,60); RAISE NOTICE 'FALLA R3 authenticated ejecutó check_rate_limit';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK R3 solo service_role ejecuta check_rate_limit'; END $$;
RESET ROLE;

-- ===== F-18: archivos al borrar la cuenta =====
INSERT INTO storage.objects(bucket_id,name) VALUES
  ('journal-photos','e0000000-0000-0000-0000-00000000000e/d1000000-0000-0000-0000-000000000001/foto-colab.jpg'),
  ('journal-photos','e0000000-0000-0000-0000-00000000000e/f1000000-0000-0000-0000-000000000001/otra.jpg'),
  ('recibos','d0000000-0000-0000-0000-00000000000d/ticket.pdf');
SET ROLE service_role;
SELECT CASE WHEN count(*) FILTER (WHERE name LIKE '%foto-colab.jpg')=1 AND count(*) FILTER (WHERE name LIKE '%ticket.pdf')=1
             AND count(*) FILTER (WHERE name LIKE '%otra.jpg')=0
            THEN 'OK D1 incluye recibos y fotos de otros miembros en SUS viajes, no ajenas' ELSE 'FALLA D1' END
  FROM account_deletion_files('d0000000-0000-0000-0000-00000000000d');
RESET ROLE;

-- ===== A-14 / A-18 =====
INSERT INTO subscriptions(user_id,status,stripe_subscription_id,stripe_customer_id,current_period_end)
VALUES ('f0000000-0000-0000-0000-00000000000f','active','sub_h1','cus_h1',now()+interval '20 days');
INSERT INTO comp_grants(email) VALUES ('h-comp@example.test');
INSERT INTO subscriptions(user_id,status,plan) VALUES ('90000000-0000-0000-0000-000000000009','comped','pro')
  ON CONFLICT (user_id) DO UPDATE SET status='comped';
SET ROLE service_role;
SELECT CASE WHEN (mark_subscription_cancel_at_period_end('sub_h1')->>'applied')::boolean THEN 'OK B1 reembolso marca cancel_at_period_end' ELSE 'FALLA B1' END;
SELECT CASE WHEN NOT (mark_subscription_cancel_at_period_end('sub_inexistente')->>'applied')::boolean THEN 'OK B2 sin fila no crea nada' ELSE 'FALLA B2' END;
SELECT CASE WHEN (revoke_comp(' H-Comp@Example.test ')->>'accounts_revoked')='1' THEN 'OK B3 revoke_comp quita la cortesía' ELSE 'FALLA B3' END;
RESET ROLE;
SELECT CASE WHEN status='active' AND cancel_at_period_end THEN 'OK B4 sigue activa hasta fin de periodo, sin renovar' ELSE 'FALLA B4 '||status END
  FROM subscriptions WHERE stripe_subscription_id='sub_h1';
SELECT CASE WHEN NOT is_pro('90000000-0000-0000-0000-000000000009') AND NOT EXISTS (SELECT 1 FROM comp_grants WHERE email='h-comp@example.test')
            THEN 'OK B5 tras revoke_comp ya no es PRO ni está en la lista' ELSE 'FALLA B5' END;
SELECT CASE WHEN count(*)=0 THEN 'OK B6 subscriptions sin filas nuevas por reembolsos' ELSE 'FALLA B6' END
  FROM subscriptions WHERE stripe_subscription_id='sub_inexistente';
SET ROLE authenticated;
DO $$ BEGIN PERFORM revoke_comp('x@y'); RAISE NOTICE 'FALLA B7 authenticated ejecutó revoke_comp';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK B7 revoke_comp solo para service_role'; END $$;
DO $$ BEGIN PERFORM * FROM stripe_payment_events; RAISE NOTICE 'FALLA B8 el cliente lee stripe_payment_events';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK B8 stripe_payment_events solo servidor'; END $$;
RESET ROLE;
