-- Mesa de operaciones (migración 20261028180000_mesa_operaciones). Cada caso imprime "OK <id> …" o
-- "FALLA <id> …". Lo corre run.sh sobre una base desechable con TODAS las migraciones en orden.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS mo CASCADE;
CREATE SCHEMA mo;
GRANT USAGE ON SCHEMA mo TO anon, authenticated, service_role;
CREATE FUNCTION mo.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
-- Ejecuta SQL con los privilegios del rol actual y devuelve 'OK' o el código y el error.
CREATE FUNCTION mo.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION mo.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION mo.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION mo.as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'anon', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE TABLE mo.r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON mo.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mo TO anon, authenticated, service_role;
-- Atajos (como admin): una acción y la fila de la lista.
CREATE FUNCTION mo.act(_src text, _id uuid, _a text, _m text DEFAULT NULL, _e text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_ops_act(_src, _id, _a, _m, _e) $$;
CREATE FUNCTION mo.item(_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT i FROM jsonb_array_elements(public.admin_ops_list(NULL)->'items') i WHERE i->>'id' = _id::text $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mo TO anon, authenticated, service_role;

-- Personas: A y B (usuarios), D (dueño, en admins), N (sin correo).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('7e000000-0000-0000-0000-00000000000a', 'mesa-a@example.test', now()),
  ('7e000000-0000-0000-0000-00000000000b', 'mesa-b@example.test', now()),
  ('7e000000-0000-0000-0000-00000000000d', 'dueno@example.test', now()),
  ('7e000000-0000-0000-0000-00000000000e', NULL, now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('7e000000-0000-0000-0000-00000000000a', 'Ana Viajera', 'mesa-a@example.test'),
  ('7e000000-0000-0000-0000-00000000000b', 'Beto Viajero', 'mesa-b@example.test'),
  ('7e000000-0000-0000-0000-00000000000d', 'Rodrigo Dueño', 'dueno@example.test'),
  ('7e000000-0000-0000-0000-00000000000e', 'Sin Correo', NULL)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO public.admins (user_id) VALUES ('7e000000-0000-0000-0000-00000000000d') ON CONFLICT DO NOTHING;
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso) VALUES
  ('7e100000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000a', 'Ciudad de México', 4, '2026-11-01', '2026-11-05')
ON CONFLICT DO NOTHING;

-- Solicitudes como las crea concierge-action (service role). Fechas de alta escalonadas para el orden.
SET ROLE service_role; SELECT mo.as_service();
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, payload, status, created_at) VALUES
  ('7e300000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', '7e100000-0000-0000-0000-00000000000a', 'reservation',
   'Mesa en Contramar', '{"tipo":"reservation","titulo":"Mesa en Contramar","fecha":"2026-11-02","hora":"20:30","personas":4,"lugar":"Contramar","detalle":"Aniversario, terraza si se puede","origen":"iato"}',
   'solicitado', now() - interval '3 hours'),
  ('7e300000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-00000000000b', NULL, 'transport', 'Traslado al aeropuerto', '{"detalle":"Sábado 6 am"}',
   'solicitado', now() - interval '2 hours'),
  ('7e300000-0000-0000-0000-000000000003', '7e000000-0000-0000-0000-00000000000a', NULL, 'pickup', 'Equipaje Invisible · cotización', '{"detalle":"2 maletas"}',
   'solicitado', now() - interval '1 hour'),
  ('7e300000-0000-0000-0000-000000000005', '7e000000-0000-0000-0000-00000000000e', NULL, 'alert', 'Ayuda urgente', '{}', 'solicitado', now() - interval '30 minutes');
RESET ROLE;
-- Filas que solo escriben sus RPC (Privé, reservas IA y su espejo): se cargan sin disparadores; las
-- transiciones de la prueba sí pasan por las funciones y disparadores reales.
SET session_replication_role = replica;
INSERT INTO public.concierge_requests (id, user_id, type, title, payload, status, experience_id, requested_for, party_size, created_at) VALUES
  ('7e300000-0000-0000-0000-000000000004', '7e000000-0000-0000-0000-00000000000a', 'prive_request', 'Privé: cena', '{}', 'solicitado',
   (SELECT id FROM public.prive_experiences ORDER BY slug LIMIT 1), now() + interval '9 days', 2, now() - interval '4 hours'),
  ('7e300000-0000-0000-0000-0000000000a1', '7e000000-0000-0000-0000-00000000000a', 'ai_reservation', 'Espejo de reserva IA', '{}', 'needs_user',
   NULL, NULL, NULL, now() - interval '5 hours');
INSERT INTO public.ai_reservations (id, user_id, request_id, ref_code, reply_token, venue_name, venue_timezone, requested_local, requested_for, party_size,
  customer_name, customer_email, status, reason, created_at) VALUES
  ('7e400000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', '7e300000-0000-0000-0000-0000000000a1', 'R-MESA01', 'bbbbbbbbbbbbbbbbbbbbbbb1', 'Pujol',
   'America/Mexico_City', '2026-11-03T21:00', '2026-11-04T03:00:00Z', 2, 'Ana Viajera', 'mesa-a@example.test', 'needs_user', 'no_contact', now() - interval '5 hours'),
  ('7e400000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-00000000000b', NULL, 'R-MESA02', 'bbbbbbbbbbbbbbbbbbbbbbb2', 'Quintonil',
   'America/Mexico_City', '2026-11-03T21:00', '2026-11-04T03:00:00Z', 2, 'Beto Viajero', NULL, 'sent', NULL, now() - interval '6 hours'),
  ('7e400000-0000-0000-0000-000000000003', '7e000000-0000-0000-0000-00000000000a', NULL, 'R-MESA03', 'bbbbbbbbbbbbbbbbbbbbbbb3', 'Rosetta',
   'America/Mexico_City', '2026-11-04T21:00', '2026-11-05T03:00:00Z', 3, 'Ana Viajera', NULL, 'needs_user', 'payment_required', now() - interval '7 hours');
SET session_replication_role = origin;

-- ═══ S: permisos (un no-admin no lista ni transiciona; anon nada; el cliente no escribe) ═══
SET ROLE anon; SELECT mo.as_anon();
SELECT mo.ok('S1 anon no ejecuta admin_ops_list', mo.try('SELECT public.admin_ops_list(NULL)') LIKE '42501%', mo.try('SELECT public.admin_ops_list(NULL)'));
SELECT mo.ok('S2 anon no ejecuta my_team_requests', mo.try('SELECT public.my_team_requests()') LIKE '42501%');
RESET ROLE; SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000a');
SELECT mo.ok('S3 un usuario que no es admin no puede listar la mesa (42501)', mo.try('SELECT public.admin_ops_list(NULL)') LIKE '42501%', mo.try('SELECT public.admin_ops_list(NULL)'));
SELECT mo.ok('S4 un usuario que no es admin no puede transicionar (42501)',
  mo.try($q$SELECT public.admin_ops_act('concierge_request', '7e300000-0000-0000-0000-000000000002', 'resolver', 'hecho', 'x')$q$) LIKE '42501%');
SELECT mo.ok('S5 tampoco con su propia solicitud',
  mo.try($q$SELECT public.admin_ops_act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'tomar')$q$) LIKE '42501%');
SELECT mo.ok('S6 el cliente no ejecuta las funciones de correo del servidor',
  mo.try($q$SELECT public.ops_owner_alert_claim('7e300000-0000-0000-0000-000000000001')$q$) LIKE '42501%'
  AND mo.try($q$SELECT public.team_reply_emails_due(5)$q$) LIKE '42501%'
  AND mo.try($q$SELECT public.ops_owner_alerts_due(5)$q$) LIKE '42501%');
SELECT mo.ok('S7 el cliente no escribe respuestas del equipo',
  mo.try($q$INSERT INTO public.team_request_replies (source, source_id, user_id, kind, body) VALUES ('concierge_request', '7e300000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 'respuesta', 'yo mismo')$q$) LIKE '42501%');
SELECT mo.ok('S8 el cliente no cambia el estado de su solicitud directo',
  mo.try($q$UPDATE public.concierge_requests SET status = 'resuelto' WHERE id = '7e300000-0000-0000-0000-000000000001'$q$) LIKE '42501%');
RESET ROLE; SET ROLE service_role; SELECT mo.as_service();
SELECT mo.ok('S9 la llave de servicio sin persona tampoco usa la mesa (quién = una persona)', mo.try('SELECT public.admin_ops_list(NULL)') LIKE '42501%');
RESET ROLE;
SELECT mo.ok('S10 nada cambió tras los intentos', (SELECT count(*) FROM public.concierge_requests WHERE id::text LIKE '7e3%' AND status <> 'solicitado' AND type NOT IN ('ai_reservation')) = 0
  AND (SELECT count(*) FROM public.team_request_replies) = 0);

-- ═══ L: lista unificada (admin) ═══
SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000d');
INSERT INTO mo.r SELECT 'list', public.admin_ops_list(NULL);
SELECT mo.ok('L1 la lista trae solicitudes, Privé y reservas IA que necesitan a una persona',
  (SELECT count(*) FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i WHERE i->>'id' IN (
    '7e300000-0000-0000-0000-000000000001', '7e300000-0000-0000-0000-000000000002', '7e300000-0000-0000-0000-000000000003',
    '7e300000-0000-0000-0000-000000000004', '7e300000-0000-0000-0000-000000000005', '7e400000-0000-0000-0000-000000000001',
    '7e400000-0000-0000-0000-000000000003')) = 7);
SELECT mo.ok('L2 no trae la reserva IA que no necesita a nadie (sent) ni el espejo ai_reservation',
  (SELECT count(*) FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i WHERE i->>'id' IN (
    '7e400000-0000-0000-0000-000000000002', '7e300000-0000-0000-0000-0000000000a1')) = 0);
SELECT mo.ok('L3 más reciente primero',
  (SELECT bool_and(a >= b) FROM (SELECT (i->>'created_at')::timestamptz a, lead((i->>'created_at')::timestamptz) OVER () b
     FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i) s WHERE b IS NOT NULL));
SELECT mo.ok('L4 quién y qué pidió: nombre, correo, lugar, personas, fecha, viaje y texto completo',
  (SELECT i->'user'->>'name' = 'Ana Viajera' AND i->'user'->>'email' = 'mesa-a@example.test' AND i->>'place' = 'Contramar'
      AND (i->>'party_size')::int = 4 AND i->>'requested_for' = '2026-11-02T20:30' AND i->'trip'->>'destino' = 'Ciudad de México'
      AND i->'payload'->>'detalle' = 'Aniversario, terraza si se puede' AND i->>'stage' = 'nueva'
     FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i WHERE i->>'id' = '7e300000-0000-0000-0000-000000000001'),
  (SELECT i::text FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i WHERE i->>'id' = '7e300000-0000-0000-0000-000000000001'));
SELECT mo.ok('L5 reserva IA: lugar, folio, motivo y etapa nueva',
  (SELECT i->>'place' = 'Pujol' AND i->>'ref_code' = 'R-MESA01' AND i->>'reason' = 'no_contact' AND i->>'stage' = 'nueva'
     FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'list')->'items') i WHERE i->>'id' = '7e400000-0000-0000-0000-000000000001'));
SELECT mo.ok('L6 conteos por etapa y filtro "abiertas"',
  ((SELECT v FROM mo.r WHERE k = 'list')->'counts'->>'nueva')::int >= 7
  AND jsonb_array_length(public.admin_ops_list('abiertas')->'items') = jsonb_array_length((SELECT v FROM mo.r WHERE k = 'list')->'items')
  AND jsonb_array_length(public.admin_ops_list('resuelta')->'items') = 0);

-- ═══ T: transiciones de solicitudes generales ═══
SELECT mo.ok('T1 acción desconocida → BAD_ACTION', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'borrar')->>'code' = 'BAD_ACTION');
SELECT mo.ok('T2 id que no existe → NOT_FOUND', mo.act('concierge_request', gen_random_uuid(), 'tomar')->>'code' = 'NOT_FOUND');
SELECT mo.ok('T3 el espejo de una reserva IA no se toca como solicitud → NOT_FOUND',
  mo.act('concierge_request', '7e300000-0000-0000-0000-0000000000a1', 'tomar')->>'code' = 'NOT_FOUND');
INSERT INTO mo.r SELECT 'take1', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'tomar');
SELECT mo.ok('T4 Tomar → en proceso (pendiente_confirmacion) con responsable',
  (SELECT v->>'ok' = 'true' AND v->'item'->>'stage' = 'en_proceso' AND v->'item'->>'status' = 'pendiente_confirmacion'
      AND v->'item'->'owner'->>'name' = 'Rodrigo Dueño' FROM mo.r WHERE k = 'take1'), (SELECT v::text FROM mo.r WHERE k = 'take1'));
SELECT mo.ok('T5 Responder sin mensaje → MESSAGE_REQUIRED', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'responder', '  ')->>'code' = 'MESSAGE_REQUIRED');
INSERT INTO mo.r SELECT 'reply1', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'responder',
  'Hola Ana: Contramar tiene terraza a las 20:30. ¿Te la aparto a tu nombre?');
SELECT mo.ok('T6 Responder deja el mensaje para el usuario (correo pendiente) sin cambiar el estado',
  (SELECT v->>'reply_id' IS NOT NULL AND v->'item'->>'status' = 'pendiente_confirmacion' FROM mo.r WHERE k = 'reply1'));
INSERT INTO mo.r SELECT 'res1', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'resolver',
  'Listo: mesa en terraza el 2 de noviembre a las 20:30 para 4.', 'Confirmación Contramar #4471');
SELECT mo.ok('T7 Marcar resuelta con evidencia → resuelto y la evidencia queda guardada',
  (SELECT v->'item'->>'status' = 'resuelto' AND v->'item'->>'stage' = 'resuelta' AND v->'item'->'evidence'->>'evidence' = 'Confirmación Contramar #4471'
      AND v->'item'->'evidence'->>'confirmed_by' = 'Rodrigo Dueño' FROM mo.r WHERE k = 'res1'), (SELECT v::text FROM mo.r WHERE k = 'res1'));
SELECT mo.ok('T8 resuelta no se vuelve a resolver → ILLEGAL_TRANSITION',
  mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'resolver')->>'code' = 'ILLEGAL_TRANSITION');
SELECT mo.ok('T9 ni se toma otra vez → ILLEGAL_TRANSITION',
  mo.act('concierge_request', '7e300000-0000-0000-0000-000000000001', 'tomar')->>'code' = 'ILLEGAL_TRANSITION');
SELECT mo.ok('T10 No se pudo sin motivo → REASON_REQUIRED', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000003', 'no_se_pudo', 'x')->>'code' = 'REASON_REQUIRED');
INSERT INTO mo.r SELECT 'fail3', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000003', 'no_se_pudo',
  'Equipaje Invisible no opera en tu ruta esas fechas. Te sugerimos documentar en el mostrador.');
SELECT mo.ok('T11 No se pudo con motivo → rechazado (desde nueva)', (SELECT v->'item'->>'status' = 'rechazado' AND v->'item'->>'stage' = 'no_se_pudo' FROM mo.r WHERE k = 'fail3'));
SELECT mo.ok('T12 Resolver sin evidencia es válido en solicitudes generales',
  mo.act('concierge_request', '7e300000-0000-0000-0000-000000000005', 'resolver')->'item'->>'status' = 'resuelto');
SELECT mo.ok('T13 Responder a una cerrada sí se puede (seguimiento)',
  mo.act('concierge_request', '7e300000-0000-0000-0000-000000000003', 'responder', 'Si cambian tus fechas lo vemos de nuevo.')->>'ok' = 'true');
RESET ROLE;
SELECT mo.ok('T14 historial: quién, cuándo y de qué estado a cuál',
  (SELECT string_agg(coalesce(from_status, '∅') || '→' || to_status || '/' || actor || '/' || (actor_id = '7e000000-0000-0000-0000-00000000000d')::text, ' ' ORDER BY id)
     FROM public.concierge_request_events WHERE request_id = '7e300000-0000-0000-0000-000000000001')
  = 'solicitado→pendiente_confirmacion/equipo/true pendiente_confirmacion→resuelto/equipo/true',
  (SELECT string_agg(coalesce(from_status, '∅') || '→' || to_status, ' ' ORDER BY id) FROM public.concierge_request_events WHERE request_id = '7e300000-0000-0000-0000-000000000001'));
SELECT mo.ok('T15 respuestas guardadas con su tipo y su correo pendiente',
  (SELECT string_agg(kind || ':' || email_status, ' ' ORDER BY created_at, kind) FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000001')
  IN ('respuesta:pendiente resuelta:pendiente', 'resuelta:pendiente respuesta:pendiente'));
SELECT mo.ok('T16 el usuario recibe UN aviso en la app al tomarla y uno por respuesta',
  (SELECT count(*) FROM public.notifications WHERE user_id = '7e000000-0000-0000-0000-00000000000a' AND related_id = '7e300000-0000-0000-0000-000000000001'
     AND dedup_key = 'team_take:7e300000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.notifications WHERE related_id = '7e300000-0000-0000-0000-000000000001' AND dedup_key LIKE 'team_reply:%') = 2);
SELECT mo.as_user('7e000000-0000-0000-0000-00000000000d');
SELECT mo.ok('T17 lista del admin: historial con nombre de quién actuó',
  (SELECT bool_and(h->'by'->>'name' = 'Rodrigo Dueño') AND count(*) = 2 FROM jsonb_array_elements(
     (SELECT mo.item('7e300000-0000-0000-0000-000000000001')->'history')) h));

-- ═══ P: Privé (solo por prive_request_transition; evidencia obligatoria) ═══
SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000d');
SELECT mo.ok('P1 Tomar una Privé → pendiente_confirmacion', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000004', 'tomar')->'item'->>'status' = 'pendiente_confirmacion');
SELECT mo.ok('P2 Resolver Privé sin evidencia → EVIDENCE_REQUIRED', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000004', 'resolver', 'Listo')->>'code' = 'EVIDENCE_REQUIRED');
INSERT INTO mo.r SELECT 'p3', mo.act('concierge_request', '7e300000-0000-0000-0000-000000000004', 'resolver', NULL, 'Folio del lugar PV-2026-118');
SELECT mo.ok('P3 Resolver Privé con evidencia → confirmado_externamente', (SELECT v->'item'->>'status' = 'confirmado_externamente' AND v->'item'->>'stage' = 'resuelta' FROM mo.r WHERE k = 'p3'),
  (SELECT v::text FROM mo.r WHERE k = 'p3'));
RESET ROLE;
SELECT mo.ok('P4 la confirmación Privé crea su constancia en bookings con el folio',
  (SELECT count(*) FROM public.bookings WHERE raw_payload->>'prive_request_id' = '7e300000-0000-0000-0000-000000000004' AND status = 'confirmed'
     AND confirmation_code = 'Folio del lugar PV-2026-118') = 1);
SELECT mo.ok('P5 historial Privé (disparador real): actor equipo con el id del admin',
  (SELECT string_agg(from_status || '→' || to_status || '/' || actor || '/' || coalesce((actor_id = '7e000000-0000-0000-0000-00000000000d')::text, 'null'), ' ' ORDER BY id)
     FROM public.concierge_request_events WHERE request_id = '7e300000-0000-0000-0000-000000000004')
  = 'solicitado→pendiente_confirmacion/equipo/true pendiente_confirmacion→confirmado_externamente/equipo/true',
  (SELECT string_agg(from_status || '→' || to_status || '/' || actor, ' ' ORDER BY id) FROM public.concierge_request_events WHERE request_id = '7e300000-0000-0000-0000-000000000004'));

-- ═══ A: reservas IA (solo por ai_reservation_transition) ═══
SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000d');
INSERT INTO mo.r SELECT 'a1', mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000001', 'tomar');
SELECT mo.ok('A1 Tomar una reserva IA: en proceso sin cambiar su estado', (SELECT v->'item'->>'stage' = 'en_proceso' AND v->'item'->>'status' = 'needs_user'
  AND v->'item'->'owner'->>'name' = 'Rodrigo Dueño' FROM mo.r WHERE k = 'a1'), (SELECT v::text FROM mo.r WHERE k = 'a1'));
SELECT mo.ok('A2 Resolver reserva IA sin evidencia suficiente → EVIDENCE_REQUIRED',
  mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000001', 'resolver', NULL, 'ok')->>'code' = 'EVIDENCE_REQUIRED');
INSERT INTO mo.r SELECT 'a3', mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000001', 'resolver',
  'Te confirmamos Pujol el 3 de noviembre a las 21:00 para 2.', 'Llamada a Pujol, confirmó Laura, folio 88');
SELECT mo.ok('A3 Resolver reserva IA → confirmed por el canal equipo', (SELECT v->'item'->>'status' = 'confirmed' AND v->'item'->'evidence'->>'channel' = 'equipo'
  AND v->'item'->'evidence'->>'confirmed_by' = 'Rodrigo Dueño' FROM mo.r WHERE k = 'a3'), (SELECT v::text FROM mo.r WHERE k = 'a3'));
SELECT mo.ok('A4 una reserva IA confirmada no pasa a "No se pudo" → ILLEGAL_TRANSITION',
  mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000001', 'no_se_pudo', 'Ya no hay lugar')->>'code' = 'ILLEGAL_TRANSITION');
SELECT mo.ok('A5 No se pudo en reserva IA → declined', mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000003', 'no_se_pudo',
  'Rosetta pide pago con tarjeta por teléfono; no lo hacemos por ti.')->'item'->>'status' = 'declined');
SELECT mo.ok('A6 Tomar una reserva IA cerrada → ILLEGAL_TRANSITION', mo.act('ai_reservation', '7e400000-0000-0000-0000-000000000003', 'tomar')->>'code' = 'ILLEGAL_TRANSITION');
RESET ROLE;
SELECT mo.ok('A7 historial de la reserva IA: transición del equipo y nota con el admin',
  (SELECT count(*) FROM public.ai_reservation_events WHERE reservation_id = '7e400000-0000-0000-0000-000000000001' AND kind = 'transition'
     AND from_status = 'needs_user' AND to_status = 'confirmed' AND actor = 'equipo') = 1
  AND (SELECT count(*) FROM public.ai_reservation_events WHERE reservation_id = '7e400000-0000-0000-0000-000000000001' AND kind = 'note'
     AND data->>'admin_id' = '7e000000-0000-0000-0000-00000000000d') = 2);
SELECT mo.ok('A8 la confirmación del equipo crea la constancia en bookings',
  (SELECT count(*) FROM public.bookings WHERE raw_payload->>'ai_reservation_id' = '7e400000-0000-0000-0000-000000000001' AND status = 'confirmed') = 1);
SELECT mo.ok('A9 el espejo en concierge_requests sigue el estado (disparador de reservas IA)',
  (SELECT status FROM public.concierge_requests WHERE id = '7e300000-0000-0000-0000-0000000000a1') = 'confirmed');

-- ═══ U: lo que ve el usuario (solo lo suyo) ═══
SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000a');
INSERT INTO mo.r SELECT 'ua', public.my_team_requests();
SELECT mo.ok('U1 A ve sus solicitudes, su Privé y la reserva IA que atendió el equipo; no las de B',
  (SELECT count(*) FILTER (WHERE i->>'id' IN ('7e300000-0000-0000-0000-000000000001', '7e300000-0000-0000-0000-000000000003', '7e300000-0000-0000-0000-000000000004',
       '7e400000-0000-0000-0000-000000000001', '7e400000-0000-0000-0000-000000000003')) = 5
     AND count(*) FILTER (WHERE i->>'id' IN ('7e300000-0000-0000-0000-000000000002', '7e400000-0000-0000-0000-000000000002', '7e300000-0000-0000-0000-0000000000a1')) = 0
   FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'ua')) i));
SELECT mo.ok('U2 estado real, evidencia y respuestas del equipo en su solicitud',
  (SELECT i->>'stage' = 'resuelta' AND i->>'evidence' = 'Confirmación Contramar #4471' AND jsonb_array_length(i->'replies') = 2
      AND i->'replies'->0->>'body' LIKE 'Hola Ana%'
     FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'ua')) i WHERE i->>'id' = '7e300000-0000-0000-0000-000000000001'));
SELECT mo.ok('U3 al usuario no se le dice quién del equipo ni errores de correo',
  (SELECT bool_and(NOT (r ? 'admin') AND NOT (r ? 'email_error')) FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'ua')) i, jsonb_array_elements(i->'replies') r)
  AND (SELECT bool_and(NOT (h ? 'by') AND NOT (h ? 'note')) FROM jsonb_array_elements((SELECT v FROM mo.r WHERE k = 'ua')) i, jsonb_array_elements(i->'history') h));
SELECT mo.ok('U4 RLS: A lee sus respuestas directo; ninguna de otro', (SELECT count(id) FROM public.team_request_replies) > 0
  AND (SELECT count(id) FROM public.team_request_replies WHERE user_id <> '7e000000-0000-0000-0000-00000000000a') = 0);
SELECT mo.ok('U5 A no puede leer quién del equipo respondió (columna admin_id)',
  mo.try('SELECT admin_id FROM public.team_request_replies') LIKE '42501%');
RESET ROLE; SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000b');
SELECT mo.ok('U6 B solo ve lo suyo (su traslado)', (SELECT string_agg(i->>'id', ',') FROM jsonb_array_elements(public.my_team_requests()) i)
  = '7e300000-0000-0000-0000-000000000002', (SELECT string_agg(i->>'id', ',') FROM jsonb_array_elements(public.my_team_requests()) i));
SELECT mo.ok('U7 RLS: B no ve ninguna respuesta de A', (SELECT count(id) FROM public.team_request_replies) = 0);
SELECT mo.ok('U8 RLS: B no ve las solicitudes de A ni su historial',
  (SELECT count(*) FROM public.concierge_requests WHERE user_id = '7e000000-0000-0000-0000-00000000000a') = 0
  AND (SELECT count(*) FROM public.concierge_request_events WHERE request_id = '7e300000-0000-0000-0000-000000000001') = 0);
RESET ROLE;

-- ═══ E: correos (marca de enviado, sin duplicados, reintento) ═══
SET ROLE service_role; SELECT mo.as_service();
INSERT INTO mo.r SELECT 'e1', public.ops_owner_alert_claim('7e300000-0000-0000-0000-000000000002');
SELECT mo.ok('E1 reclamar el aviso al dueño trae los datos para el correo',
  (SELECT v->>'ok' = 'true' AND v->'alert'->>'title' = 'Traslado al aeropuerto' AND v->'alert'->'user'->>'email' = 'mesa-b@example.test' FROM mo.r WHERE k = 'e1'),
  (SELECT v::text FROM mo.r WHERE k = 'e1'));
SELECT mo.ok('E2 mientras se envía nadie más lo toma (sin duplicado)',
  public.ops_owner_alert_claim('7e300000-0000-0000-0000-000000000002')->>'code' = 'IN_FLIGHT'
  AND jsonb_array_length(public.ops_owner_alerts_due(10)) = 0);
SELECT public.ops_owner_alert_finish('7e300000-0000-0000-0000-000000000002', false, NULL, 'resend_500');
SELECT mo.ok('E3 si falló queda registrado (fallido + error) y el reintento lo toma',
  (SELECT owner_alert_status = 'fallido' AND owner_alert_error = 'resend_500' FROM public.concierge_requests WHERE id = '7e300000-0000-0000-0000-000000000002')
  AND (SELECT string_agg(a->>'id', ',') FROM jsonb_array_elements(public.ops_owner_alerts_due(10)) a) = '7e300000-0000-0000-0000-000000000002');
SELECT public.ops_owner_alert_finish('7e300000-0000-0000-0000-000000000002', true, 're_123', NULL);
SELECT mo.ok('E4 enviado no se repite (ni reclamo ni reintento)',
  public.ops_owner_alert_claim('7e300000-0000-0000-0000-000000000002')->>'code' = 'ALREADY_SENT'
  AND jsonb_array_length(public.ops_owner_alerts_due(10)) = 0
  AND (SELECT owner_alert_status = 'enviado' AND owner_alert_sent_at IS NOT NULL AND owner_alert_attempts = 2 FROM public.concierge_requests WHERE id = '7e300000-0000-0000-0000-000000000002'));
SELECT mo.ok('E5 las solicitudes viejas (sin marca) nunca se reenvían solas',
  (SELECT owner_alert_status IS NULL FROM public.concierge_requests WHERE id = '7e300000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.ops_owner_alerts_due(10)) a WHERE a->>'id' = '7e300000-0000-0000-0000-000000000001'));
INSERT INTO mo.r SELECT 'e6', public.team_reply_email_claim((SELECT id FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000001' AND kind = 'respuesta'));
SELECT mo.ok('E6 correo al usuario: destinatario del servidor y datos de la solicitud',
  (SELECT v->>'to' = 'mesa-a@example.test' AND v->'reply'->>'kind' = 'respuesta' AND v->'item'->>'place' = 'Contramar' AND NOT (v->'item' ? 'payload') FROM mo.r WHERE k = 'e6'),
  (SELECT v::text FROM mo.r WHERE k = 'e6'));
SELECT public.team_reply_email_finish((SELECT id FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000001' AND kind = 'respuesta'), true, 're_u1', NULL);
SELECT mo.ok('E7 respuesta enviada no se vuelve a mandar',
  public.team_reply_email_claim((SELECT id FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000001' AND kind = 'respuesta'))->>'code' = 'ALREADY_DONE');
SELECT public.team_reply_email_finish((SELECT id FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000001' AND kind = 'resuelta'), false, NULL, 'timeout');
SELECT mo.ok('E8 el reintento toma las respuestas pendientes o fallidas (no las enviadas)',
  (SELECT bool_and(c->'reply'->>'kind' <> 'respuesta' OR c->'reply'->>'source_id' <> '7e300000-0000-0000-0000-000000000001')
     AND bool_or(c->'reply'->>'kind' = 'resuelta' AND c->'reply'->>'source_id' = '7e300000-0000-0000-0000-000000000001')
     FROM jsonb_array_elements(public.team_reply_emails_due(50)) c));
RESET ROLE; SET ROLE authenticated; SELECT mo.as_user('7e000000-0000-0000-0000-00000000000d');
SELECT mo.act('concierge_request', '7e300000-0000-0000-0000-000000000005', 'responder', 'Te llamamos al número de tu perfil.');
RESET ROLE; SET ROLE service_role; SELECT mo.as_service();
INSERT INTO mo.r SELECT 'e9', public.team_reply_email_claim((SELECT id FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000005' AND kind = 'respuesta'));
SELECT mo.ok('E9 usuario sin correo → sin_correo (no se reintenta)', (SELECT v->>'code' FROM mo.r WHERE k = 'e9') = 'NO_EMAIL'
  AND (SELECT email_status FROM public.team_request_replies WHERE source_id = '7e300000-0000-0000-0000-000000000005' AND kind = 'respuesta') = 'sin_correo'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.team_reply_emails_due(50)) c WHERE c->'reply'->>'source_id' = '7e300000-0000-0000-0000-000000000005'));
RESET ROLE;

-- ═══ D: datos y borrado de cuenta ═══
SELECT mo.ok('D1 el borrado de cuenta se lleva las respuestas del usuario (tabla con user_id)',
  (SELECT (public.purge_account_data('7e000000-0000-0000-0000-00000000000b')->'tables' ? 'team_request_replies')));
SELECT mo.ok('D2 el CHECK de etapas no rompe los estados del ciclo', public.ops_stage('concierge_request', 'pickup', 'in_progress') = 'en_proceso'
  AND public.ops_stage('concierge_request', 'prive_request', 'caducado') = 'vencida' AND public.ops_stage('ai_reservation', 'ai_reservation', 'needs_user', true) = 'en_proceso');
