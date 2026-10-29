-- Opiniones (migración 20261029060000_opiniones). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS op CASCADE;
CREATE SCHEMA op;
GRANT USAGE ON SCHEMA op TO anon, authenticated, service_role;
CREATE FUNCTION op.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION op.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION op.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
-- Ejecuta SQL con el rol actual; devuelve 'sin error' o el código y el mensaje.
CREATE FUNCTION op.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE op.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION op.reply_status(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT email_status FROM public.team_request_replies WHERE id = _id $$;
CREATE FUNCTION op.status(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT status FROM public.concierge_requests WHERE id = _id $$;
GRANT ALL ON op.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA op TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0b000000-0000-0000-0000-00000000000a', 'op-alvaro@example.test', now()),
  ('0b000000-0000-0000-0000-00000000000b', 'op-bea@example.test', now()),
  ('0b000000-0000-0000-0000-00000000000d', 'op-dueno@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0b000000-0000-0000-0000-00000000000a', 'Álvaro Prueba', 'op-alvaro@example.test'),
  ('0b000000-0000-0000-0000-00000000000b', 'Bea Prueba', 'op-bea@example.test'),
  ('0b000000-0000-0000-0000-00000000000d', 'Dueño Prueba', 'op-dueno@example.test')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO public.admins (user_id) VALUES ('0b000000-0000-0000-0000-00000000000d') ON CONFLICT DO NOTHING;
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso) VALUES
  ('0b100000-0000-0000-0000-00000000000a', '0b000000-0000-0000-0000-00000000000a', 'Oaxaca', 2, '2026-11-10', '2026-11-14')
ON CONFLICT DO NOTHING;

-- ═══ V: forma validada en la base (como inserta la función enviar-opinion, con la llave de servicio) ═══
SET ROLE service_role; SELECT op.as_service();
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, payload, status) VALUES
  ('0b200000-0000-0000-0000-000000000001', '0b000000-0000-0000-0000-00000000000a', '0b100000-0000-0000-0000-00000000000a', 'opinion',
   'Algo es confuso: no entendí dónde ver mis vuelos',
   '{"tipo":"confuso","texto":"No entendí dónde ver mis vuelos","calificacion":3,"contactar":true,"ruta":"/viajes/0b100000-0000-0000-0000-00000000000a","pantalla":"Detalle del viaje","dispositivo":"celular","version":"index-AbC123","origen":"app_opinion"}',
   'solicitado'),
  ('0b200000-0000-0000-0000-000000000002', '0b000000-0000-0000-0000-00000000000b', NULL, 'opinion',
   'Me gustó: la guía de Oaxaca',
   '{"tipo":"me_gusto","texto":"La guía de Oaxaca está increíble","calificacion":null,"contactar":false,"ruta":"/dashboard","dispositivo":"escritorio","origen":"app_opinion"}',
   'solicitado');
SELECT op.ok('V1 la opinión válida se guarda (con y sin calificación)',
  (SELECT count(*) FROM public.concierge_requests WHERE type = 'opinion') = 2);
SELECT op.ok('V2 tipo fuera de la lista → rechazada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"queja","texto":"algo","contactar":true}')$q$) LIKE '23514%');
SELECT op.ok('V3 texto vacío o de más de 2000 caracteres → rechazada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"   ","contactar":true}')$q$) LIKE '23514%'
  AND op.err(format($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo', %L)$q$,
    jsonb_build_object('tipo', 'idea', 'texto', repeat('a', 2001), 'contactar', true))) LIKE '23514%');
SELECT op.ok('V4 calificación fuera de 1–5 o en texto → rechazada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","calificacion":6,"contactar":true}')$q$) LIKE '23514%'
  AND op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","calificacion":"5","contactar":true}')$q$) LIKE '23514%');
SELECT op.ok('V5 sin la casilla de contacto (booleana) → rechazada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea"}')$q$) LIKE '23514%'
  AND op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","contactar":"si"}')$q$) LIKE '23514%');
SELECT op.ok('V6 ruta que no empieza con / o dispositivo inventado → rechazada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","contactar":true,"ruta":"https://evil.test/x"}')$q$) LIKE '23514%'
  AND op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","contactar":true,"dispositivo":"tablet"}')$q$) LIKE '23514%');
SELECT op.ok('V7 las demás solicitudes no cambian (una reserva sin esos campos se sigue guardando)',
  op.err($q$INSERT INTO public.concierge_requests (id, user_id, type, title, payload) VALUES ('0b200000-0000-0000-0000-0000000000f1', '0b000000-0000-0000-0000-00000000000a', 'reservation', 'Mesa en Casa Oaxaca',
    '{"lugar":"Casa Oaxaca","personas":2}')$q$) = 'sin error');
RESET ROLE;

-- ═══ U: el usuario ═══
SET ROLE authenticated; SELECT op.as_user('0b000000-0000-0000-0000-00000000000a');
SELECT op.ok('U1 el usuario no puede insertar una opinión directo (solo la función con su límite)',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Hola equipo',
    '{"tipo":"idea","texto":"una idea","contactar":true}')$q$) LIKE '42501%');
SELECT op.ok('U2 ve solo la suya (RLS): la de Bea no aparece',
  (SELECT count(*) FROM public.concierge_requests WHERE type = 'opinion') = 1
  AND NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE id = '0b200000-0000-0000-0000-000000000002'));
INSERT INTO op.r SELECT 'mine', public.my_team_requests();
SELECT op.ok('U3 aparece en "Mis solicitudes" como opinión nueva',
  (SELECT count(*) = 1 AND bool_and(i->>'stage' = 'nueva' AND i->>'title' = 'Algo es confuso: no entendí dónde ver mis vuelos')
     FROM jsonb_array_elements((SELECT v FROM op.r WHERE k = 'mine')) i WHERE i->>'type' = 'opinion'),
  (SELECT v::text FROM op.r WHERE k = 'mine'));
SELECT op.ok('U4 la vista de reservas (la que lee Iato) no incluye opiniones; la reserva sigue',
  NOT EXISTS (SELECT 1 FROM public.reservation_state_v WHERE kind = 'opinion')
  AND EXISTS (SELECT 1 FROM public.reservation_state_v WHERE source_id = '0b200000-0000-0000-0000-0000000000f1')
  AND NOT EXISTS (SELECT 1 FROM public.my_open_reservations(NULL) WHERE kind = 'opinion'));
SELECT op.ok('U5 un usuario que no es del equipo no puede marcarla',
  op.err($q$SELECT public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'leida')$q$) LIKE '42501%');
SELECT op.ok('U6 ni ver la Mesa',
  op.err($q$SELECT public.admin_ops_list(NULL)$q$) LIKE '42501%');
RESET ROLE;

-- ═══ M: Mesa de operaciones ═══
SET ROLE authenticated; SELECT op.as_user('0b000000-0000-0000-0000-00000000000d');
INSERT INTO op.r SELECT 'list', public.admin_ops_list('abiertas');
SELECT op.ok('M1 la Mesa ve las dos con nombre, correo, texto, pantalla y viaje',
  (SELECT count(*) = 2 FROM jsonb_array_elements((SELECT v FROM op.r WHERE k = 'list')->'items') i WHERE i->>'type' = 'opinion')
  AND (SELECT i->'user'->>'email' = 'op-alvaro@example.test' AND i->'user'->>'name' = 'Álvaro Prueba'
          AND i->'payload'->>'texto' = 'No entendí dónde ver mis vuelos' AND i->'payload'->>'pantalla' = 'Detalle del viaje'
          AND i->'trip'->>'destino' = 'Oaxaca' AND i->>'stage' = 'nueva'
         FROM jsonb_array_elements((SELECT v FROM op.r WHERE k = 'list')->'items') i
        WHERE i->>'id' = '0b200000-0000-0000-0000-000000000001'),
  (SELECT v::text FROM op.r WHERE k = 'list'));
INSERT INTO op.r SELECT 'read', public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'leida');
SELECT op.ok('M2 Marcar leída → en proceso, a nombre de quien la leyó',
  (SELECT v->>'ok' = 'true' AND v->'item'->>'stage' = 'en_proceso' AND v->'item'->'owner'->>'name' = 'Dueño Prueba' FROM op.r WHERE k = 'read'),
  (SELECT v::text FROM op.r WHERE k = 'read'));
SELECT op.ok('M3 queda en el historial (quién y de qué estado a cuál)',
  EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_ops_list(NULL)->'items') i, jsonb_array_elements(i->'history') h
           WHERE i->>'id' = '0b200000-0000-0000-0000-000000000001' AND h->>'from' = 'solicitado' AND h->>'to' = 'pendiente_confirmacion'
             AND h->'by'->>'name' = 'Dueño Prueba' AND h->>'note' = 'Leída por Dueño Prueba'));
SELECT op.ok('M4 marcar leída otra vez no cambia nada ni duplica el historial',
  (public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'leida')->>'unchanged') = 'true'
  AND (SELECT count(*) FROM jsonb_array_elements(public.admin_ops_list(NULL)->'items') i, jsonb_array_elements(i->'history') h
        WHERE i->>'id' = '0b200000-0000-0000-0000-000000000001') = 1);
SELECT op.ok('M5 marcar algo que no es opinión o una acción inventada → no aplica',
  (public.admin_opinion_mark('0b200000-0000-0000-0000-0000000000f1', 'resuelta')->>'code') = 'NOT_FOUND'
  AND (public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'borrar')->>'code') = 'BAD_ACTION'
  AND op.status('0b200000-0000-0000-0000-0000000000f1') = 'solicitado');
INSERT INTO op.r SELECT 'reply_a', public.admin_ops_act('concierge_request', '0b200000-0000-0000-0000-000000000001', 'responder', 'Gracias, Álvaro: los vuelos están en la pestaña Vuelos del viaje.');
INSERT INTO op.r SELECT 'reply_b', public.admin_ops_act('concierge_request', '0b200000-0000-0000-0000-000000000002', 'responder', 'Gracias, Bea.');
SELECT op.ok('M6 Responder reutiliza la mesa: correo pendiente si aceptó correo',
  (SELECT v->>'ok' = 'true' FROM op.r WHERE k = 'reply_a')
  AND op.reply_status((SELECT (v->>'reply_id')::uuid FROM op.r WHERE k = 'reply_a')) = 'pendiente',
  (SELECT v::text FROM op.r WHERE k = 'reply_a'));
SELECT op.ok('M7 …y solo en la app ("sin_correo") si desmarcó "pueden contactarme por correo"',
  op.reply_status((SELECT (v->>'reply_id')::uuid FROM op.r WHERE k = 'reply_b')) = 'sin_correo',
  (SELECT v::text FROM op.r WHERE k = 'reply_b'));
INSERT INTO op.r SELECT 'done', public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'resuelta');
SELECT op.ok('M8 Marcar resuelta → resuelta; leída después ya no la regresa',
  (SELECT v->'item'->>'stage' = 'resuelta' FROM op.r WHERE k = 'done')
  AND (public.admin_opinion_mark('0b200000-0000-0000-0000-000000000001', 'leida')->>'unchanged') = 'true'
  AND op.status('0b200000-0000-0000-0000-000000000001') = 'resuelto',
  (SELECT v::text FROM op.r WHERE k = 'done'));
SELECT op.ok('M9 resolver directo desde nueva también funciona',
  (public.admin_opinion_mark('0b200000-0000-0000-0000-000000000002', 'resuelta')->'item'->>'stage') = 'resuelta');
RESET ROLE;
SET ROLE authenticated; SELECT op.as_user('0b000000-0000-0000-0000-00000000000a');
SELECT op.ok('U7 el usuario ve la respuesta y que quedó resuelta (sin saber quién del equipo)',
  (SELECT i->>'stage' = 'resuelta' AND i->'replies'->0->>'body' LIKE 'Gracias, Álvaro%' AND NOT (i->'replies'->0 ? 'admin')
     FROM jsonb_array_elements(public.my_team_requests()) i WHERE i->>'type' = 'opinion'));
RESET ROLE;

-- ═══ A: aviso al equipo (correo con marca, sin duplicados) ═══
SET ROLE service_role; SELECT op.as_service();
INSERT INTO op.r SELECT 'claim', public.ops_owner_alert_claim('0b200000-0000-0000-0000-000000000001');
SELECT op.ok('A1 el aviso se reclama con lo que necesita el correo (nombre, correo, texto, ruta)',
  (SELECT v->>'ok' = 'true' AND v->'alert'->>'type' = 'opinion' AND v->'alert'->'user'->>'email' = 'op-alvaro@example.test'
          AND v->'alert'->'payload'->>'texto' = 'No entendí dónde ver mis vuelos' AND v->'alert'->'payload'->>'ruta' LIKE '/viajes/%'
     FROM op.r WHERE k = 'claim'),
  (SELECT v::text FROM op.r WHERE k = 'claim'));
SELECT public.ops_owner_alert_finish('0b200000-0000-0000-0000-000000000001', true, 'em_op1');
SELECT op.ok('A2 enviado no se vuelve a mandar',
  (public.ops_owner_alert_claim('0b200000-0000-0000-0000-000000000001')->>'code') = 'ALREADY_SENT');

-- ═══ T: tope de 10 por hora en la base ═══
DO $$
BEGIN
  FOR i IN 1..8 LOOP
    INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Idea: número ' || i,
      jsonb_build_object('tipo', 'idea', 'texto', 'Idea número ' || i, 'contactar', true));
  END LOOP;
END $$;
SELECT op.ok('T1 hasta 10 por hora se guardan',
  (SELECT count(*) FROM public.concierge_requests WHERE type = 'opinion' AND user_id = '0b000000-0000-0000-0000-00000000000a') = 9
  AND op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Idea: diez',
    '{"tipo":"idea","texto":"Idea diez","contactar":true}')$q$) = 'sin error');
SELECT op.ok('T2 la 11.ª en la misma hora se rechaza (OPINION_RATE_LIMIT); otra persona no se ve afectada',
  op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000a', 'opinion', 'Idea: once',
    '{"tipo":"idea","texto":"Idea once","contactar":true}')$q$) LIKE 'P0001%OPINION_RATE_LIMIT%'
  AND op.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0b000000-0000-0000-0000-00000000000b', 'opinion', 'Idea: de Bea',
    '{"tipo":"idea","texto":"Idea de Bea","contactar":true}')$q$) = 'sin error');
RESET ROLE;

-- ═══ P: permisos ═══
SELECT op.ok('P1 las funciones de los disparadores no se pueden llamar desde el cliente',
  NOT has_function_privilege('authenticated', 'public.opinion_insert_guard()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.opinion_reply_contact()', 'EXECUTE'));
SELECT op.ok('P2 admin_opinion_mark: sesión sí (adentro exige admins), anónimo no',
  has_function_privilege('authenticated', 'public.admin_opinion_mark(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_opinion_mark(uuid, text)', 'EXECUTE'));
