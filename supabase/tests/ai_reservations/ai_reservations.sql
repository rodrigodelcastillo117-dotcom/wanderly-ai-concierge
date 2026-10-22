-- Pruebas de Reservas IA (grupo reservas): RLS, permisos, transiciones, evidencia obligatoria para
-- "confirmed", idempotencia del webhook, límites, recordatorio único, bandera apagada y borrado de
-- cuenta. Cada caso imprime "OK <id> …" o "FALLA <id> …". Lo corre run.sh sobre una base desechable.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

DROP SCHEMA IF EXISTS rt CASCADE;
CREATE SCHEMA rt;
GRANT USAGE ON SCHEMA rt TO anon, authenticated, service_role;
CREATE FUNCTION rt.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION rt.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
-- Ejecuta SQL con los privilegios del rol actual y devuelve 'OK' o el error.
CREATE FUNCTION rt.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION rt.as_user(n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rt.u(n)::text, false), set_config('request.jwt.claim.role', 'authenticated', false) $$;
CREATE FUNCTION rt.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false) $$;
CREATE FUNCTION rt.mk_user(n int) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (rt.u(n), 'res' || n || '@example.test', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, full_name, email) VALUES (rt.u(n), 'Persona ' || n, 'res' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
  RETURN rt.u(n);
END $$;
-- Intención típica (lugar de Google, mañana a las 20:30 hora de CDMX).
CREATE FUNCTION rt.intent(n int, place text, email text DEFAULT 'reservas@casaoaxaca.com.mx', local text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'venue', jsonb_build_object('name', 'Casa Oaxaca', 'place_id', place, 'timezone', 'America/Mexico_City', 'country', 'MX', 'email', email,
      'email_source', CASE WHEN email IS NULL THEN NULL ELSE jsonb_build_object('kind', 'website', 'url', 'https://casaoaxaca.com.mx/contacto', 'quote', 'Reservaciones: ' || email) END,
      'language', 'es'),
    'requested_local', coalesce(local, to_char((now() AT TIME ZONE 'America/Mexico_City') + interval '2 days', 'YYYY-MM-DD') || 'T20:30'),
    'party_size', 4, 'customer', jsonb_build_object('name', 'Persona ' || n, 'email', 'res' || n || '@example.test'))
$$;
CREATE FUNCTION rt.flag(v boolean) RETURNS void LANGUAGE sql AS $$
  UPDATE public.app_flags SET value = to_jsonb(v) WHERE key = 'ai_reservations_enabled' $$;
CREATE FUNCTION rt.consent() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"confirmed": true, "share_contact": false, "cc_user": false, "text": "Confirmar: escribiremos a Casa Oaxaca en tu nombre"}'::jsonb $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rt TO anon, authenticated, service_role;

SELECT count(*) FROM (SELECT rt.mk_user(n) FROM generate_series(1, 6) n) t;

-- ===================================================================== bandera y permisos
SELECT rt.ok('R01 la bandera nace apagada', (SELECT value FROM app_flags WHERE key = 'ai_reservations_enabled') = 'false'::jsonb);
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_create_intent(rt.u(1), rt.intent(1, 'ChIJ_place_00000001')) AS off_create \gset
SELECT public.ai_reservation_claim_reminder('00000000-0000-0000-0000-000000000000') AS off_rem \gset
RESET ROLE;
SELECT rt.ok('R02 con la bandera apagada no se crea nada', (:'off_create'::jsonb)->>'code' = 'FEATURE_DISABLED'
  AND NOT EXISTS (SELECT 1 FROM ai_reservations), :'off_create');

SELECT rt.flag(true);
SELECT rt.as_user(1); SET ROLE authenticated;
SELECT rt.try($q$SELECT public.ai_reservation_create_intent(auth.uid(), rt.intent(1, 'ChIJ_place_00000001'))$q$) AS u_create \gset
SELECT rt.try($q$INSERT INTO public.ai_reservations (user_id, ref_code, reply_token, venue_name, venue_timezone, requested_local, requested_for, party_size, customer_name)
  VALUES (auth.uid(), 'R-AAAAAA', repeat('a', 24), 'x', 'UTC', '2027-01-01T20:00', now(), 2, 'Yo')$q$) AS u_insert \gset
SELECT rt.try($q$SELECT public.ai_reservation_transition('00000000-0000-0000-0000-000000000000', 'confirmed', 'equipo')$q$) AS u_trans \gset
RESET ROLE;
SELECT rt.ok('R03 un usuario no puede llamar las funciones del servidor', :'u_create' LIKE '42501%', :'u_create');
SELECT rt.ok('R04 un usuario no puede insertar en ai_reservations', :'u_insert' LIKE '42501%', :'u_insert');
SELECT rt.ok('R05 un usuario no puede confirmar a mano (ni como "equipo")', :'u_trans' LIKE '42501%', :'u_trans');

-- ===================================================================== alta
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_create_intent(rt.u(1), rt.intent(1, 'ChIJ_place_00000001')) AS c1 \gset
SELECT public.ai_reservation_create_intent(rt.u(1), rt.intent(1, 'ChIJ_place_00000001')) AS c1b \gset
SELECT public.ai_reservation_create_intent(rt.u(2), rt.intent(2, 'ChIJ_place_00000002', NULL)) AS c2 \gset
SELECT public.ai_reservation_create_intent(rt.u(1), jsonb_set(rt.intent(1, NULL), '{venue,place_id}', 'null')) AS c_noid \gset
SELECT public.ai_reservation_create_intent(rt.u(1), jsonb_set(rt.intent(1, 'ChIJ_place_00000009'), '{venue,email_source}', 'null')) AS c_nosrc \gset
SELECT public.ai_reservation_create_intent(rt.u(1), rt.intent(1, 'ChIJ_place_00000009', 'a@b.mx', to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD"T"HH24:MI'))) AS c_soon \gset
RESET ROLE;
SELECT (:'c1'::jsonb)->>'id' AS id1, (:'c2'::jsonb)->>'id' AS id2 \gset
SELECT rt.ok('R06 alta con correo verificado → awaiting_user_ok + solicitud de concierge espejo',
  (:'c1'::jsonb)->>'status' = 'awaiting_user_ok'
  AND (SELECT r.status = c.status AND c.type = 'ai_reservation' FROM ai_reservations r JOIN concierge_requests c ON c.id = r.request_id WHERE r.id = :'id1'),
  :'c1');
SELECT rt.ok('R07 la misma solicitud (lugar + hora) no se duplica', (:'c1b'::jsonb)->>'replay' = 'true' AND (:'c1b'::jsonb)->>'id' = :'id1'
  AND (SELECT count(*) FROM ai_reservations WHERE user_id = rt.u(1)) = 1);
SELECT rt.ok('R08 sin correo → needs_user/no_contact con aviso honesto',
  (:'c2'::jsonb)->>'status' = 'needs_user' AND (SELECT reason FROM ai_reservations WHERE id = :'id2') = 'no_contact'
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = rt.u(2) AND type = 'ai_reservation' AND title LIKE 'No encontramos un correo de reservas%'));
SELECT rt.ok('R09 sin lugar identificado (Google/Privé) o sin fuente del correo → rechazado',
  (:'c_noid'::jsonb)->>'code' = 'VENUE_ID_REQUIRED' AND (:'c_nosrc'::jsonb)->>'code' = 'EMAIL_SOURCE_REQUIRED', :'c_noid' || ' ' || :'c_nosrc');
SELECT rt.ok('R10 hora demasiado próxima → DATE_TOO_SOON', (:'c_soon'::jsonb)->>'code' = 'DATE_TOO_SOON', :'c_soon');
SELECT rt.ok('R11 hora local convertida con la zona del lugar',
  (SELECT to_char(requested_for AT TIME ZONE 'America/Mexico_City', 'HH24:MI') = '20:30' FROM ai_reservations WHERE id = :'id1'));

-- ===================================================================== lectura (RLS + columnas)
SELECT rt.as_user(1); SET ROLE authenticated;
SELECT count(*) AS mine FROM ai_reservations WHERE id = :'id1' \gset
SELECT (SELECT status FROM ai_reservations WHERE id = :'id1') AS mystatus \gset
SELECT rt.try($q$SELECT reply_token FROM public.ai_reservations$q$) AS tok_read \gset
SELECT rt.try($q$SELECT * FROM public.ai_reservations$q$) AS star_read \gset
SELECT rt.try($q$UPDATE public.ai_reservations SET status = 'confirmed'$q$) AS u_update \gset
SELECT count(*) AS myevents FROM ai_reservation_events e WHERE e.reservation_id = :'id1' \gset
SELECT rt.try($q$SELECT * FROM public.ai_reservation_inbound$q$) AS inbound_read \gset
RESET ROLE;
SELECT rt.as_user(2); SET ROLE authenticated;
SELECT count(*) AS other FROM ai_reservations WHERE id = :'id1' \gset
SELECT count(*) AS otherevents FROM ai_reservation_events WHERE reservation_id = :'id1' \gset
RESET ROLE;
SET ROLE anon;
SELECT rt.try($q$SELECT id FROM public.ai_reservations$q$) AS anon_read \gset
RESET ROLE;
SELECT rt.ok('R12 el dueño lee su reserva y su historial', :'mine' = '1' AND :'mystatus' = 'awaiting_user_ok' AND :'myevents'::int >= 1);
SELECT rt.ok('R13 otro usuario no ve la reserva ni su historial', :'other' = '0' AND :'otherevents' = '0');
SELECT rt.ok('R14 el token de respuesta no se puede leer desde el cliente (ni con SELECT *)',
  :'tok_read' LIKE '42501%' AND :'star_read' LIKE '42501%', :'tok_read');
SELECT rt.ok('R15 el usuario no puede cambiar el estado', :'u_update' LIKE '42501%', :'u_update');
SELECT rt.ok('R16 la tabla de correos recibidos y la de reservas son invisibles para clientes/anon',
  :'inbound_read' LIKE '42501%' AND :'anon_read' LIKE '42501%', :'inbound_read' || ' / ' || :'anon_read');

-- Ni la llave de servicio salta la guardia: el estado solo cambia por las funciones.
SET ROLE service_role;
SELECT rt.try(format($q$UPDATE public.ai_reservations SET status = 'confirmed' WHERE id = %L$q$, :'id1')) AS svc_update \gset
SELECT rt.try(format($q$UPDATE public.ai_reservations SET status = 'sent' WHERE id = %L$q$, :'id1')) AS svc_update2 \gset
RESET ROLE;
SELECT rt.ok('R17 UPDATE directo con service_role → rechazado por la guardia', :'svc_update' LIKE '42501%' AND :'svc_update2' LIKE '42501%', :'svc_update');

-- ===================================================================== envío
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_claim_send(:'id1', rt.u(1), '{"share_contact": true}') AS cs_noconsent \gset
SELECT public.ai_reservation_claim_send(:'id1', rt.u(2), rt.consent()) AS cs_other \gset
SELECT public.ai_reservation_claim_send(:'id1', rt.u(1), rt.consent()) AS cs1 \gset
SELECT public.ai_reservation_claim_send(:'id1', rt.u(1), rt.consent()) AS cs1b \gset
SELECT public.ai_reservation_mark_sent(:'id1', 'request', true, 're_1', NULL) AS ms1 \gset
SELECT public.ai_reservation_claim_send(:'id1', rt.u(1), rt.consent()) AS cs1c \gset
SELECT public.ai_reservation_claim_send(:'id2', rt.u(2), rt.consent()) AS cs2 \gset
RESET ROLE;
SELECT rt.ok('R18 sin consentimiento explícito no se reserva el envío', (:'cs_noconsent'::jsonb)->>'code' = 'CONSENT_REQUIRED');
SELECT rt.ok('R19 otro usuario no puede enviar mi solicitud', (:'cs_other'::jsonb)->>'code' = 'NOT_FOUND');
SELECT rt.ok('R20 doble toque: el segundo envío queda bloqueado (candado)', (:'cs1'::jsonb)->>'ok' = 'true' AND (:'cs1b'::jsonb)->>'code' = 'IN_PROGRESS'
  AND (:'cs1'::jsonb)->'reservation'->>'reply_token' ~ '^[0-9a-f]{24}$');
SELECT rt.ok('R21 envío registrado → sent, plazo de vencimiento y aviso "aún no es una reserva"',
  (:'ms1'::jsonb)->>'status' = 'sent' AND (SELECT expires_at > now() AND sent_at IS NOT NULL AND attempts = 1 AND consent->>'at' IS NOT NULL FROM ai_reservations WHERE id = :'id1')
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = rt.u(1) AND title = 'Escribimos a Casa Oaxaca en tu nombre' AND body LIKE 'Aún no es una reserva%'));
SELECT rt.ok('R22 ya enviada → ALREADY_SENT; sin correo → NOT_SENDABLE', (:'cs1c'::jsonb)->>'code' = 'ALREADY_SENT' AND (:'cs2'::jsonb)->>'code' = 'NOT_SENDABLE');

-- ===================================================================== correo recibido
SELECT reply_token AS tok1 FROM ai_reservations WHERE id = :'id1' \gset
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_inbound_claim('msg_evt_1', 'em_1', :'tok1', 'casaoaxaca.com.mx') AS ib1 \gset
SELECT public.ai_reservation_inbound_claim('msg_evt_1', 'em_1', :'tok1', 'casaoaxaca.com.mx') AS ib1b \gset
SELECT public.ai_reservation_inbound_claim('msg_evt_2', 'em_2', repeat('f', 24), 'x.mx') AS ib_unmatched \gset
SELECT public.ai_reservation_inbound_claim('msg_evt_3', 'em_3', NULL, 'casaoaxaca.com.mx', (SELECT ref_code FROM ai_reservations WHERE id = :'id1'), 'otro@casaoaxaca.com.mx') AS ib_ref_bad \gset
RESET ROLE;
SELECT rt.ok('R23 webhook nuevo se reclama una vez; el mismo otra vez → duplicate',
  (:'ib1'::jsonb)->>'state' = 'new' AND (:'ib1b'::jsonb)->>'state' = 'duplicate' AND (SELECT count(*) FROM ai_reservation_inbound WHERE email_id = 'em_1') = 1);
SELECT rt.ok('R24 token desconocido → unmatched; folio del asunto solo cuenta con el remitente exacto',
  (:'ib_unmatched'::jsonb)->>'state' = 'unmatched' AND (:'ib_ref_bad'::jsonb)->>'state' = 'unmatched');
SELECT (:'ib1'::jsonb)->>'inbound_id' AS inb1 \gset

-- Confirmación SIN evidencia (sin remitente verificado) → la base la rechaza.
SET ROLE service_role;
SELECT rt.try(format($q$SELECT public.ai_reservation_apply_reply(%L, %L, '{"outcome":"confirmed","excerpt":"ok","confirmation":{"channel":"venue_email","inbound_email_id":"em_1","quote":"Confirmado","verified_sender":false}}')$q$, :'id1', :'inb1')) AS no_ev \gset
SELECT rt.try(format($q$SELECT public.ai_reservation_apply_reply(%L, %L, '{"outcome":"confirmed","excerpt":"ok","confirmation":{"channel":"venue_email","inbound_email_id":"em_1","verified_sender":true}}')$q$, :'id1', :'inb1')) AS no_quote \gset
RESET ROLE;
SELECT rt.ok('R25 "confirmed" sin remitente verificado o sin cita → CHECK lo rechaza',
  :'no_ev' LIKE '23514%' AND :'no_quote' LIKE '23514%' AND (SELECT status FROM ai_reservations WHERE id = :'id1') = 'sent', :'no_ev');

SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_apply_reply(:'id1', :'inb1', '{"outcome":"ignored","excerpt":"Fuera de la oficina","quotes":[]}') AS ap_ign \gset
SELECT public.ai_reservation_apply_reply(:'id1', :'inb1', jsonb_build_object('outcome', 'confirmed', 'excerpt', 'Con gusto confirmamos su reserva para 4 personas',
  'inbound_email_id', 'em_1', 'from_domain', 'casaoaxaca.com.mx', 'verified_sender', true, 'quotes', '["Con gusto confirmamos su reserva para 4 personas"]'::jsonb,
  'claude_calls', 1,
  'confirmation', jsonb_build_object('channel', 'venue_email', 'inbound_email_id', 'em_1', 'quote', 'Con gusto confirmamos su reserva para 4 personas',
    'verified_sender', true, 'code', 'MX-4821'))) AS ap_ok \gset
RESET ROLE;
SELECT rt.ok('R26 respuesta automática no cambia el estado', (:'ap_ign'::jsonb)->>'status' = 'sent');
SELECT rt.ok('R27 confirmación escrita verificada → confirmed + constancia en bookings + aviso con quién confirmó',
  (:'ap_ok'::jsonb)->>'status' = 'confirmed'
  AND EXISTS (SELECT 1 FROM bookings WHERE user_id = rt.u(1) AND status = 'confirmed' AND confirmation_code = 'MX-4821' AND raw_payload->>'ai_reservation_id' = :'id1')
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = rt.u(1) AND title = 'Reserva confirmada por escrito por Casa Oaxaca')
  AND (SELECT c.status FROM concierge_requests c JOIN ai_reservations r ON r.request_id = c.id WHERE r.id = :'id1') = 'confirmed'
  AND (SELECT status FROM ai_reservation_inbound WHERE id = :'inb1') = 'done'
  AND (SELECT claude_calls FROM ai_reservations WHERE id = :'id1') = 1, :'ap_ok');
SELECT rt.as_service(); SET ROLE service_role;
SELECT (public.ai_reservation_inbound_claim('msg_evt_1b', 'em_1b', :'tok1', 'casaoaxaca.com.mx'))->>'inbound_id' AS inb1b \gset
SELECT public.ai_reservation_apply_reply(:'id1', :'inb1b', '{"outcome":"declined","excerpt":"tarde"}') AS ap_late \gset
RESET ROLE;
SELECT rt.ok('R28 una respuesta después de confirmar no cambia nada (LATE)', (:'ap_late'::jsonb)->>'code' = 'LATE'
  AND (SELECT status FROM ai_reservations WHERE id = :'id1') = 'confirmed' AND (SELECT status FROM ai_reservation_inbound WHERE id = :'inb1b') = 'late');
SELECT rt.ok('R29 ningún aviso dice "mesa confirmada"', NOT EXISTS (SELECT 1 FROM notifications WHERE lower(title || ' ' || coalesce(body, '')) LIKE '%mesa confirmada%'));

-- ===================================================================== transiciones
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_transition(:'id1', 'expired', 'sistema') AS t_illegal \gset
SELECT public.ai_reservation_transition(:'id1', 'cancelled', 'usuario', rt.u(2)) AS t_other \gset
SELECT public.ai_reservation_transition(:'id1', 'confirmed', 'equipo', NULL, NULL, '{"channel":"equipo"}') AS t_noevid \gset
SELECT public.ai_reservation_transition(:'id1', 'cancelled', 'usuario', rt.u(1)) AS t_cancel \gset
SELECT public.ai_reservation_transition(:'id1', 'sent', 'sistema') AS t_after \gset
RESET ROLE;
SELECT rt.ok('R30 confirmed → expired no es legal', (:'t_illegal'::jsonb)->>'code' = 'ILLEGAL_TRANSITION', :'t_illegal');
SELECT rt.ok('R31 nadie cancela la reserva de otro', (:'t_other'::jsonb)->>'code' = 'NOT_FOUND');
SELECT rt.ok('R32 cancelar una confirmada → cancelled, constancia cancelada y hay que avisar al restaurante',
  (:'t_cancel'::jsonb)->>'status' = 'cancelled' AND (:'t_cancel'::jsonb)->>'notify_venue' = 'true'
  AND EXISTS (SELECT 1 FROM bookings WHERE raw_payload->>'ai_reservation_id' = :'id1' AND status = 'cancelled'), :'t_cancel');
SELECT rt.ok('R33 el sistema no puede reabrir (cancelled → sent)', (:'t_after'::jsonb)->>'code' = 'NOT_ALLOWED');
SELECT rt.ok('R34 historial completo con actor', (SELECT string_agg(coalesce(from_status, '∅') || '>' || to_status || ':' || actor, ',' ORDER BY id)
  FROM ai_reservation_events WHERE reservation_id = :'id1' AND kind = 'transition')
  = '∅>awaiting_user_ok:sistema,awaiting_user_ok>sent:sistema,sent>confirmed:restaurante,confirmed>cancelled:usuario',
  (SELECT string_agg(coalesce(from_status, '∅') || '>' || to_status || ':' || actor, ',' ORDER BY id) FROM ai_reservation_events WHERE reservation_id = :'id1' AND kind = 'transition'));

-- ===================================================================== alterno apartado + aceptación del usuario
SELECT rt.as_service(); SET ROLE service_role;
SELECT (public.ai_reservation_create_intent(rt.u(3), rt.intent(3, 'ChIJ_place_00000003')))->>'id' AS id3 \gset
SELECT public.ai_reservation_claim_send(:'id3', rt.u(3), rt.consent()) IS NOT NULL AS x \gset
SELECT public.ai_reservation_mark_sent(:'id3', 'request', true, 're_3', NULL) IS NOT NULL AS x \gset
SELECT reply_token AS tok3 FROM ai_reservations WHERE id = :'id3' \gset
SELECT (public.ai_reservation_inbound_claim('msg_evt_30', 'em_30', :'tok3', 'casaoaxaca.com.mx'))->>'inbound_id' AS inb3 \gset
SELECT public.ai_reservation_apply_reply(:'id3', :'inb3', jsonb_build_object('outcome', 'alternative_offered', 'excerpt', 'Les apartamos 21:15',
  'alternatives', jsonb_build_array(jsonb_build_object('local', to_char((now() AT TIME ZONE 'America/Mexico_City') + interval '2 days', 'YYYY-MM-DD') || 'T21:15',
    'held', true, 'verified_sender', true, 'inbound_email_id', 'em_30', 'quote', 'Les apartamos una mesa a las 21:15', 'from_domain', 'casaoaxaca.com.mx')))) AS ap3 \gset
SELECT public.ai_reservation_claim_alternative(:'id3', rt.u(3), 5) AS alt_bad \gset
SELECT public.ai_reservation_claim_alternative(:'id3', rt.u(3), 0) AS alt_ok \gset
SELECT public.ai_reservation_mark_sent(:'id3', 'alternative', true, 're_3b', NULL) AS ms3 \gset
RESET ROLE;
SELECT rt.ok('R35 alterno ofrecido → needs_user; índice inválido rechazado',
  (:'ap3'::jsonb)->>'status' = 'needs_user' AND (:'ap3'::jsonb)->>'reason' = 'alternative_offered' AND (:'alt_bad'::jsonb)->>'code' = 'BAD_INDEX');
SELECT rt.ok('R36 el usuario acepta un alterno YA apartado por escrito → confirmed con la cita del restaurante',
  (:'alt_ok'::jsonb)->>'held' = 'true' AND (:'ms3'::jsonb)->>'status' = 'confirmed'
  AND (SELECT requested_local LIKE '%T21:15' AND confirmation->>'quote' = 'Les apartamos una mesa a las 21:15' AND confirmation ? 'user_accepted_at'
       AND evidence->'original_request'->>'local' LIKE '%T20:30' FROM ai_reservations WHERE id = :'id3'), :'ms3');

-- ===================================================================== límites
UPDATE app_flags SET value = 'true' WHERE key = 'ai_reservations_enabled';
INSERT INTO app_flags (key, value) VALUES ('ai_reservations_limits', '{"user_sends_per_day": 1, "venue_sends_per_day": 2}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SELECT rt.as_service(); SET ROLE service_role;
SELECT (public.ai_reservation_create_intent(rt.u(3), rt.intent(3, 'ChIJ_place_00000004', 'otro@lugar.mx')))->>'id' AS id4 \gset
SELECT public.ai_reservation_claim_send(:'id4', rt.u(3), rt.consent()) AS lim_user \gset
SELECT (public.ai_reservation_create_intent(rt.u(4), rt.intent(4, 'ChIJ_place_00000003')))->>'id' AS id5 \gset
SELECT public.ai_reservation_claim_send(:'id5', rt.u(4), rt.consent()) AS lim_venue \gset
RESET ROLE;
SELECT rt.ok('R37 límite diario por usuario', (:'lim_user'::jsonb)->>'code' = 'USER_DAILY_LIMIT', :'lim_user');
SELECT rt.ok('R38 límite diario por restaurante (todos los usuarios)', (:'lim_venue'::jsonb)->>'code' = 'VENUE_THROTTLED', :'lim_venue');
DELETE FROM app_flags WHERE key = 'ai_reservations_limits';

-- ===================================================================== reintento del webhook y recordatorio único
SELECT rt.as_service(); SET ROLE service_role;
SELECT (public.ai_reservation_create_intent(rt.u(5), rt.intent(5, 'ChIJ_place_00000005', 'hola@lugar5.mx')))->>'id' AS id6 \gset
SELECT public.ai_reservation_claim_send(:'id6', rt.u(5), rt.consent()) IS NOT NULL AS x \gset
SELECT public.ai_reservation_mark_sent(:'id6', 'request', true, 're_6', NULL) IS NOT NULL AS x \gset
SELECT reply_token AS tok6 FROM ai_reservations WHERE id = :'id6' \gset
SELECT (public.ai_reservation_inbound_claim('msg_evt_60', 'em_60', :'tok6', 'lugar5.mx'))->>'inbound_id' AS inb6 \gset
SELECT public.ai_reservation_inbound_finish(:'inb6', 'failed', 'fetch_failed');
SELECT public.ai_reservation_inbound_claim('msg_evt_60', 'em_60', :'tok6', 'lugar5.mx') AS retry6 \gset
SELECT public.ai_reservation_claim_reminder(:'id6') IS NOT NULL AS rem1 \gset
SELECT public.ai_reservation_claim_reminder(:'id6') IS NOT NULL AS rem2 \gset
SELECT jsonb_array_length(public.ai_reservation_due(50)) AS due_n \gset
SELECT public.ai_reservation_transition(:'id6', 'expired', 'sistema', NULL, 'El restaurante no respondió a tiempo') AS exp6 \gset
SELECT public.ai_reservation_transition(:'id6', 'expired', 'sistema') AS exp6b \gset
RESET ROLE;
SELECT rt.ok('R39 un webhook que falló se puede reintentar (retry) una vez reclamado', (:'retry6'::jsonb)->>'state' = 'retry'
  AND (SELECT attempts FROM ai_reservation_inbound WHERE id = :'inb6') = 2);
SELECT rt.ok('R40 el recordatorio al restaurante se reclama una sola vez', :'rem1' = 't' AND :'rem2' = 'f');
SELECT rt.ok('R41 vencer es idempotente y avisa una vez al usuario',
  (:'exp6'::jsonb)->>'status' = 'expired' AND (:'exp6b'::jsonb)->>'noop' = 'true' AND :'due_n'::int >= 1
  AND (SELECT count(*) FROM notifications WHERE user_id = rt.u(5) AND title = 'Casa Oaxaca no respondió a tiempo') = 1
  AND (SELECT reason FROM ai_reservations WHERE id = :'id6') = 'no_reply');

-- Bandera apagada a mitad de camino: no se reclama ningún envío ni recordatorio.
SELECT rt.flag(false);
SELECT rt.as_service(); SET ROLE service_role;
SELECT public.ai_reservation_claim_send(:'id4', rt.u(3), rt.consent()) AS off_send \gset
RESET ROLE;
SELECT rt.ok('R42 con la bandera apagada no se reclama ningún envío', (:'off_send'::jsonb)->>'code' = 'FEATURE_DISABLED');

-- ===================================================================== borrado de cuenta
SET ROLE service_role;
SELECT rt.try(format('SELECT public.purge_account_data(%L)', rt.u(3))) AS purge3 \gset
RESET ROLE;
SELECT rt.ok('R43 borrar la cuenta borra sus reservas IA, historial y correos recibidos',
  :'purge3' = 'OK' AND NOT EXISTS (SELECT 1 FROM ai_reservations WHERE user_id = rt.u(3))
  AND NOT EXISTS (SELECT 1 FROM ai_reservation_events WHERE reservation_id = :'id3')
  AND NOT EXISTS (SELECT 1 FROM ai_reservation_inbound WHERE id = :'inb3'), :'purge3');

DROP SCHEMA rt CASCADE;
