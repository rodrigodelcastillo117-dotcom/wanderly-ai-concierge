-- Pruebas del Booking Bridge (migración 20261023180000). Cada caso imprime "OK <id> …" o "FALLA <id> …".
-- Escenarios E2E del dueño cubiertos aquí: 13 abandono, 14 regreso, 15 comprobante, 19 URL manipulada
-- (destino no https), 20 compras repetidas / estados duplicados, más aislamiento por usuario.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS bt CASCADE;
CREATE SCHEMA bt;
GRANT USAGE ON SCHEMA bt TO anon, authenticated, service_role;
CREATE FUNCTION bt.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE TABLE bt.v (k text PRIMARY KEY, j jsonb);
GRANT ALL ON bt.v TO service_role, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bt TO anon, authenticated, service_role;
CREATE FUNCTION bt.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION bt.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bt TO anon, authenticated, service_role;

INSERT INTO auth.users(id,email) VALUES
  ('b7d00000-0000-0000-0000-00000000000a','bridge-a@example.test'),
  ('b7d00000-0000-0000-0000-00000000000b','bridge-b@example.test'),
  ('b7d00000-0000-0000-0000-00000000000c','bridge-admin@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.admins(user_id) VALUES ('b7d00000-0000-0000-0000-00000000000c') ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso)
VALUES ('b7e10000-0000-0000-0000-000000000001','b7d00000-0000-0000-0000-00000000000a','Madrid',2,'2026-12-05','2026-12-10'),
       ('b7e10000-0000-0000-0000-000000000002','b7d00000-0000-0000-0000-00000000000b','Roma',1,'2026-12-05','2026-12-10')
ON CONFLICT DO NOTHING;

CREATE FUNCTION bt.payload(key text, offer text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('idempotency_key', key, 'offer_id', offer, 'trip_id', 'b7e10000-0000-0000-0000-000000000001',
    'product_type', 'flight', 'provider', 'google_flights', 'action_kind', 'equivalent_search', 'booking_mode', 'PROVIDER_SEARCH',
    'state', 'READY_TO_BOOK', 'title', 'Aeroméxico · MEX → MAD', 'target_url', 'https://www.aviasales.com/search/MEX0512MAD10122?marker=533299',
    'target_host', 'www.aviasales.com', 'processor', 'Aviasales', 'channel', 'web', 'price', 1234.5, 'currency', 'USD', 'consent', true,
    'offer', jsonb_build_object('travel_dates', jsonb_build_object('start', '2026-12-05', 'end', '2026-12-10'))) || extra $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bt TO anon, authenticated, service_role;

-- ── B1/B2: el cliente no escribe ni llama las funciones del servidor
SET ROLE authenticated; SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  INSERT INTO public.booking_intents(user_id, offer_id, product_type, provider, action_kind, booking_mode, title, idempotency_key)
  VALUES ('b7d00000-0000-0000-0000-00000000000a','0123456789abcdef','flight','x','equivalent_search','PROVIDER_SEARCH','t','abcdefgh12');
  INSERT INTO bt.v VALUES ('b1', '"inserted"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b1', '"denied"'); END $$;
SELECT bt.ok('B1 el usuario no puede insertar intenciones', (SELECT j FROM bt.v WHERE k='b1') = '"denied"', (SELECT j::text FROM bt.v WHERE k='b1'));
DO $$ BEGIN
  PERFORM public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('abcdefgh01','00000000000000a1'));
  INSERT INTO bt.v VALUES ('b2', '"called"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b2', '"denied"'); END $$;
SELECT bt.ok('B2 el usuario no puede llamar booking_intent_start (evita destinos sin validar)', (SELECT j FROM bt.v WHERE k='b2') = '"denied"', (SELECT j::text FROM bt.v WHERE k='b2'));
RESET ROLE;

-- ── B3: alta idempotente y sin duplicados (escenario 20)
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b3a', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-flight-1','00000000000000f1'));
INSERT INTO bt.v SELECT 'b3b', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-flight-1','00000000000000f1'));
INSERT INTO bt.v SELECT 'b3c', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-flight-2','00000000000000f1'));
RESET ROLE;
SELECT bt.ok('B3 alta READY_TO_BOOK', (SELECT j->'intent'->>'state' FROM bt.v WHERE k='b3a') = 'READY_TO_BOOK', (SELECT j::text FROM bt.v WHERE k='b3a'));
SELECT bt.ok('B3 reintento con la misma llave = misma intención', (SELECT (j->>'replay')::boolean AND j->'intent'->>'id' = (SELECT j->'intent'->>'id' FROM bt.v WHERE k='b3a') FROM bt.v WHERE k='b3b'));
SELECT bt.ok('B3 otra llave, misma oferta = reusa la viva (no hay dos compras)', (SELECT (j->>'existing')::boolean AND j->'intent'->>'id' = (SELECT j->'intent'->>'id' FROM bt.v WHERE k='b3a') FROM bt.v WHERE k='b3c'));
SELECT bt.ok('B3 una sola fila', (SELECT count(*) FROM public.booking_intents WHERE offer_id='00000000000000f1') = 1);

-- ── B4: nadie confirma sin evidencia; ni la llave de servicio salta la guardia
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b4a', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'),
  'b7d00000-0000-0000-0000-00000000000a', 'CONFIRMED', 'usuario', 'intento');
DO $$ BEGIN
  UPDATE public.booking_intents SET state = 'CONFIRMED' WHERE offer_id = '00000000000000f1';
  INSERT INTO bt.v VALUES ('b4b', '"updated"');
EXCEPTION WHEN OTHERS THEN INSERT INTO bt.v VALUES ('b4b', to_jsonb(SQLERRM)); END $$;
RESET ROLE;
SELECT bt.ok('B4 el usuario no puede confirmar', (SELECT j->>'code' FROM bt.v WHERE k='b4a') = 'CONFIRMATION_REQUIRES_EVIDENCE', (SELECT j::text FROM bt.v WHERE k='b4a'));
SELECT bt.ok('B4 UPDATE directo rechazado por la guardia', (SELECT j::text FROM bt.v WHERE k='b4b') LIKE '%solo las funciones%', (SELECT j::text FROM bt.v WHERE k='b4b'));

-- ── B5: salida al proveedor (REDIRECTED) y reabrir no duplica (escenarios 13/14)
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b5a', public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'), 'b7d00000-0000-0000-0000-00000000000a');
INSERT INTO bt.v SELECT 'b5b', public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'), 'b7d00000-0000-0000-0000-00000000000a');
INSERT INTO bt.v SELECT 'b5c', public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'), 'b7d00000-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT bt.ok('B5 REDIRECTED_TO_PROVIDER con el destino guardado', (SELECT j->>'state' = 'REDIRECTED_TO_PROVIDER' AND j->>'target_url' LIKE 'https://www.aviasales.com/%' FROM bt.v WHERE k='b5a'), (SELECT j::text FROM bt.v WHERE k='b5a'));
SELECT bt.ok('B5 reabrir: mismo estado, contador 2', (SELECT state = 'REDIRECTED_TO_PROVIDER' AND redirect_count = 2 FROM public.booking_intents WHERE offer_id='00000000000000f1'));
SELECT bt.ok('B5 otro usuario no puede usar la intención', (SELECT j->>'code' FROM bt.v WHERE k='b5c') = 'NOT_FOUND');

-- ── B6: "No la completé" vuelve a READY_TO_BOOK; "Ya reservé" = declarada, no confirmada (escenario 15)
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b6a', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'),
  'b7d00000-0000-0000-0000-00000000000a', 'READY_TO_BOOK', 'usuario', 'No la completé');
SELECT public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'), 'b7d00000-0000-0000-0000-00000000000a');
INSERT INTO bt.v SELECT 'b6b', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'),
  'b7d00000-0000-0000-0000-00000000000a', 'PENDING_CONFIRMATION', 'usuario', 'Ya reservé',
  jsonb_build_object('verification', 'user_declared', 'user_report', jsonb_build_object('confirmation_code', 'ABC123', 'outcome', 'completed', 'consent', true)));
INSERT INTO bt.v SELECT 'b6c', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'),
  'b7d00000-0000-0000-0000-00000000000a', NULL, 'usuario', 'verificar', jsonb_build_object('verification', 'provider_verified'));
RESET ROLE;
SELECT bt.ok('B6 abandono → READY_TO_BOOK', (SELECT j->'intent'->>'state' FROM bt.v WHERE k='b6a') = 'READY_TO_BOOK', (SELECT j::text FROM bt.v WHERE k='b6a'));
SELECT bt.ok('B6 declarada por el usuario: PENDING_CONFIRMATION + user_declared, no CONFIRMED',
  (SELECT j->'intent'->>'state' = 'PENDING_CONFIRMATION' AND j->'intent'->>'verification' = 'user_declared' AND NOT (j->'intent'->>'confirmed')::boolean FROM bt.v WHERE k='b6b'), (SELECT j::text FROM bt.v WHERE k='b6b'));
SELECT bt.ok('B6 el usuario no puede marcarla verificada', (SELECT j->>'code' FROM bt.v WHERE k='b6c') = 'CONFIRMATION_REQUIRES_EVIDENCE');

-- ── B7: aislamiento por usuario (RLS)
SET ROLE authenticated; SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000b');
SELECT bt.ok('B7 otro usuario no ve la intención ni su historial', (SELECT count(*) FROM public.booking_intents) = 0 AND (SELECT count(*) FROM public.booking_intent_events) = 0);
SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000a');
SELECT bt.ok('B7 el dueño ve su intención y su historial', (SELECT count(*) FROM public.booking_intents) = 1 AND (SELECT count(*) FROM public.booking_intent_events) >= 4);
DO $$ BEGIN
  UPDATE public.booking_intents SET state = 'CONFIRMED';
  INSERT INTO bt.v VALUES ('b7', '"updated"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b7', '"denied"'); END $$;
SELECT bt.ok('B7 el dueño no puede cambiar el estado desde el cliente', (SELECT j FROM bt.v WHERE k='b7') = '"denied"');
DO $$ BEGIN
  PERFORM public.booking_intent_confirm((SELECT id FROM public.booking_intents LIMIT 1), '{"ref":"XYZ123"}');
  INSERT INTO bt.v VALUES ('b8a', '"confirmed"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b8a', '"denied"'); END $$;
SELECT bt.ok('B8 un usuario normal no confirma', (SELECT j FROM bt.v WHERE k='b8a') = '"denied"', (SELECT j::text FROM bt.v WHERE k='b8a'));
RESET ROLE;

-- ── B8: el equipo confirma con folio → CONFIRMED + constancia en bookings
SET ROLE service_role; SELECT bt.as_service();
DO $$ BEGIN
  PERFORM public.booking_intent_confirm((SELECT id FROM public.booking_intents WHERE offer_id='00000000000000f1'), '{"source":"provider_api"}');
  INSERT INTO bt.v VALUES ('b8b', '"confirmed"');
EXCEPTION WHEN check_violation THEN INSERT INTO bt.v VALUES ('b8b', '"check"'); END $$;
RESET ROLE;
SELECT bt.ok('B8 sin folio, el CHECK lo rechaza', (SELECT j FROM bt.v WHERE k='b8b') = '"check"', (SELECT j::text FROM bt.v WHERE k='b8b'));
SET ROLE authenticated; SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000c');
INSERT INTO bt.v SELECT 'b8c', public.booking_intent_confirm((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b3a'), '{"ref":"AM-77QX","source":"provider_api"}');
RESET ROLE;
SELECT bt.ok('B8 el equipo confirma (team_verified, aunque pida provider_api)',
  (SELECT state = 'CONFIRMED' AND verification = 'team_verified' AND confirmation_evidence->>'source' = 'team_verified' FROM public.booking_intents WHERE offer_id='00000000000000f1'),
  (SELECT j::text FROM bt.v WHERE k='b8c'));
SELECT bt.ok('B8 constancia confirmada en bookings', (SELECT count(*) FROM public.bookings WHERE raw_payload->>'source' = 'booking_intent' AND status = 'confirmed' AND confirmation_code = 'AM-77QX') = 1);
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b8d', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-flight-3','00000000000000f1'));
RESET ROLE;
SELECT bt.ok('B8 volver a comprar lo ya confirmado devuelve la confirmada (no duplica)', (SELECT (j->>'already_confirmed')::boolean FROM bt.v WHERE k='b8d'), (SELECT j::text FROM bt.v WHERE k='b8d'));

-- ── B9: sin datos de tarjeta; destino no https rechazado (escenario 19)
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b9a', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-hotel-1','00000000000000b1', '{"product_type":"hotel"}'));
DO $$ BEGIN
  PERFORM public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b9a'), 'b7d00000-0000-0000-0000-00000000000a', NULL, 'usuario', 'x',
    jsonb_build_object('user_report', jsonb_build_object('note', 'pagué con 4111 1111 1111 1111')));
  INSERT INTO bt.v VALUES ('b9b', '"stored"');
EXCEPTION WHEN check_violation THEN INSERT INTO bt.v VALUES ('b9b', '"check"'); END $$;
DO $$ BEGIN
  PERFORM public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-evil-1','00000000000000e1', '{"target_url":"http://evil.example/x"}'));
  INSERT INTO bt.v VALUES ('b9c', '"stored"');
EXCEPTION WHEN check_violation THEN INSERT INTO bt.v VALUES ('b9c', '"check"'); END $$;
INSERT INTO bt.v SELECT 'b9d', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-other-1','00000000000000d1', '{"trip_id":"b7e10000-0000-0000-0000-000000000002"}'));
RESET ROLE;
SELECT bt.ok('B9 un número de tarjeta en el reporte se rechaza', (SELECT j FROM bt.v WHERE k='b9b') = '"check"');
SELECT bt.ok('B9 un destino http se rechaza', (SELECT j FROM bt.v WHERE k='b9c') = '"check"');
SELECT bt.ok('B9 no se liga a un viaje ajeno', (SELECT j->>'code' FROM bt.v WHERE k='b9d') = 'TRIP_NOT_FOUND', (SELECT j::text FROM bt.v WHERE k='b9d'));

-- ── B10: solicitud asistida ligada: su estado arrastra la intención; "confirmed" sin evidencia = pendiente
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, payload, status)
VALUES ('b7e20000-0000-0000-0000-000000000001','b7d00000-0000-0000-0000-00000000000a','b7e10000-0000-0000-0000-000000000001','booking_assist','Mesa en Botín','{}','pending');
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b10a', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-rest-1','00000000000000c1',
  '{"product_type":"restaurant","action_kind":"assisted_request","booking_mode":"REQUEST","state":"REQUESTED","channel":"iatos_team","target_url":null,"concierge_request_id":"b7e20000-0000-0000-0000-000000000001"}'));
RESET ROLE;
UPDATE public.concierge_requests SET status = 'confirmed' WHERE id = 'b7e20000-0000-0000-0000-000000000001';
SELECT bt.ok('B10 "confirmed" de una solicitud sin evidencia → PENDING_CONFIRMATION', (SELECT state FROM public.booking_intents WHERE offer_id='00000000000000c1') = 'PENDING_CONFIRMATION',
  (SELECT state || ' ' || (SELECT j::text FROM bt.v WHERE k='b10a') FROM public.booking_intents WHERE offer_id='00000000000000c1'));
UPDATE public.concierge_requests SET status = 'cancelled' WHERE id = 'b7e20000-0000-0000-0000-000000000001';
SELECT bt.ok('B10 cancelada en concierge → CANCELLED', (SELECT state FROM public.booking_intents WHERE offer_id='00000000000000c1') = 'CANCELLED');

-- ── B11: Reservas IA (otro grupo): "confirmed" sin respuesta guardada = pendiente; con folio = confirmada
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b11a', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-rest-2','00000000000000c2',
  '{"product_type":"restaurant","action_kind":"email","booking_mode":"REQUEST","state":"REQUESTED","channel":"reservas_email","target_url":null}'));
INSERT INTO bt.v SELECT 'b11b', public.booking_intent_apply_external((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b11a'), 'reservas', 'confirmed', NULL);
INSERT INTO bt.v SELECT 'b11c', public.booking_intent_apply_external((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='b11a'), 'reservas', 'confirmed', '{"ref":"mensaje:abc123"}');
RESET ROLE;
SELECT bt.ok('B11 confirmado sin evidencia → PENDING_CONFIRMATION', (SELECT j->>'state' FROM bt.v WHERE k='b11b') = 'PENDING_CONFIRMATION', (SELECT j::text FROM bt.v WHERE k='b11b'));
SELECT bt.ok('B11 con folio/respuesta → CONFIRMED (provider_verified)', (SELECT state = 'CONFIRMED' AND verification = 'provider_verified' FROM public.booking_intents WHERE offer_id='00000000000000c2'), (SELECT j::text FROM bt.v WHERE k='b11c'));

-- ── B12: caducidad (escenario 4) y transición ilegal
DO $$ BEGIN
  UPDATE public.booking_intents SET created_at = now() - interval '20 days' WHERE offer_id = '00000000000000b1';
EXCEPTION WHEN OTHERS THEN NULL; END $$;  -- la guardia lo rechaza (se comprueba abajo)
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b12a', to_jsonb(public.booking_intents_expire());
INSERT INTO bt.v SELECT 'b12b', public.booking_intent_transition((SELECT id FROM public.booking_intents WHERE offer_id='00000000000000c1'),
  'b7d00000-0000-0000-0000-00000000000a', 'READY_TO_BOOK', 'usuario', 'revivir');
RESET ROLE;
SELECT bt.ok('B12 la fecha de alta no se puede alterar (guardia)', (SELECT created_at > now() - interval '1 hour' FROM public.booking_intents WHERE offer_id='00000000000000b1'));
SELECT bt.ok('B12 una cancelada no revive', (SELECT j->>'code' FROM bt.v WHERE k='b12b') = 'ILLEGAL_TRANSITION');
-- Simulamos el paso del tiempo sin la guardia (superusuario de la base de prueba).
ALTER TABLE public.booking_intents DISABLE TRIGGER booking_intents_guard;
UPDATE public.booking_intents SET created_at = now() - interval '20 days' WHERE offer_id = '00000000000000b1';
ALTER TABLE public.booking_intents ENABLE TRIGGER booking_intents_guard;
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'b12c', to_jsonb(public.booking_intents_expire());
RESET ROLE;
SELECT bt.ok('B12 selección vieja sin continuar → EXPIRED', (SELECT state FROM public.booking_intents WHERE offer_id='00000000000000b1') = 'EXPIRED', (SELECT j::text FROM bt.v WHERE k='b12c'));

-- ── B13: catálogo y tablas de enlaces cerradas al cliente
SET ROLE authenticated; SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  PERFORM count(*) FROM public.booking_link_checks;
  INSERT INTO bt.v VALUES ('b13a', '"read"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b13a', '"denied"'); END $$;
DO $$ BEGIN
  PERFORM public.booking_venue_lookup('Quintonil', 'Ciudad de México');
  INSERT INTO bt.v VALUES ('b13b', '"called"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('b13b', '"denied"'); END $$;
RESET ROLE;
SELECT bt.ok('B13 booking_link_checks es solo del servidor', (SELECT j FROM bt.v WHERE k='b13a') = '"denied"');
SELECT bt.ok('B13 booking_venue_lookup es solo del servidor', (SELECT j FROM bt.v WHERE k='b13b') = '"denied"');

-- ── B14: historial completo de la intención confirmada
SELECT bt.ok('B14 historial con actor por paso', (SELECT string_agg(to_state || ':' || actor, ',' ORDER BY e.id) FROM public.booking_intent_events e JOIN public.booking_intents i ON i.id = e.intent_id WHERE i.offer_id='00000000000000f1')
  = 'READY_TO_BOOK:usuario,REDIRECTED_TO_PROVIDER:usuario,REDIRECTED_TO_PROVIDER:usuario,READY_TO_BOOK:usuario,REDIRECTED_TO_PROVIDER:usuario,PENDING_CONFIRMATION:usuario,CONFIRMED:equipo',
  (SELECT string_agg(to_state || ':' || actor, ',' ORDER BY e.id) FROM public.booking_intent_events e JOIN public.booking_intents i ON i.id = e.intent_id WHERE i.offer_id='00000000000000f1'));

-- ── AUD-04 (cierre de auditoría, docs/iatos/cierre/BRIDGE.md): el destino guardado no se puede cambiar desde
--    el cliente y, cuando el servidor lo alinea antes de salir, queda en el historial.
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'a4a', public.booking_intent_start('b7d00000-0000-0000-0000-00000000000a', bt.payload('key-aud04-1','00000000000000d1'));
RESET ROLE;
SET ROLE authenticated; SELECT bt.as_user('b7d00000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  UPDATE public.booking_intents SET target_url = 'https://pagos-seguros-reserva.com/x' WHERE offer_id = '00000000000000d1';
  INSERT INTO bt.v VALUES ('a4b', '"updated"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('a4b', '"denied"'); END $$;
DO $$ BEGIN
  PERFORM public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='a4a'), 'b7d00000-0000-0000-0000-00000000000a',
    NULL, 'usuario', 'x', '{"target_url":"https://pagos-seguros-reserva.com/x"}');
  INSERT INTO bt.v VALUES ('a4c', '"called"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('a4c', '"denied"'); END $$;
DO $$ BEGIN
  PERFORM public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='a4a'), 'b7d00000-0000-0000-0000-00000000000a');
  INSERT INTO bt.v VALUES ('a4d', '"called"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('a4d', '"denied"'); END $$;
RESET ROLE;
GRANT ALL ON bt.v TO anon;
SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false);
DO $$ BEGIN
  PERFORM public.booking_intent_mark_redirected('00000000-0000-0000-0000-000000000000'::uuid, 'b7d00000-0000-0000-0000-00000000000a');
  INSERT INTO bt.v VALUES ('a4e', '"called"');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO bt.v VALUES ('a4e', '"denied"'); END $$;
RESET ROLE;
SELECT bt.ok('AUD04-1 el dueño no puede cambiar el destino guardado con UPDATE', (SELECT j FROM bt.v WHERE k='a4b') = '"denied"', (SELECT j::text FROM bt.v WHERE k='a4b'));
SELECT bt.ok('AUD04-2 el dueño no puede llamar booking_intent_transition', (SELECT j FROM bt.v WHERE k='a4c') = '"denied"', (SELECT j::text FROM bt.v WHERE k='a4c'));
SELECT bt.ok('AUD04-3 ni el dueño ni anon pueden pedir el destino (booking_intent_mark_redirected)',
  (SELECT j FROM bt.v WHERE k='a4d') = '"denied"' AND (SELECT j FROM bt.v WHERE k='a4e') = '"denied"');
SELECT bt.ok('AUD04-4 el destino sigue intacto', (SELECT target_url FROM public.booking_intents WHERE offer_id='00000000000000d1') LIKE 'https://www.aviasales.com/%');

-- El servidor alinea el destino antes de salir (otra acción de la misma oferta): queda en el historial.
SET ROLE service_role; SELECT bt.as_service();
INSERT INTO bt.v SELECT 'a4f', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='a4a'),
  'b7d00000-0000-0000-0000-00000000000a', 'READY_TO_BOOK', 'usuario', 'Cambió la forma de continuar: Ver en Google Maps',
  '{"target_url":"https://www.google.com/maps/search/?api=1&query=Madrid","target_host":"www.google.com","action_kind":"maps_listing","booking_mode":"UNAVAILABLE"}');
SELECT public.booking_intent_mark_redirected((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='a4a'), 'b7d00000-0000-0000-0000-00000000000a');
-- Ya salió al proveedor: el destino ya no se reescribe.
INSERT INTO bt.v SELECT 'a4g', public.booking_intent_transition((SELECT (j->'intent'->>'id')::uuid FROM bt.v WHERE k='a4a'),
  'b7d00000-0000-0000-0000-00000000000a', NULL, 'usuario', 'x', '{"target_url":"https://www.booking.com/otro"}');
RESET ROLE;
SELECT bt.ok('AUD04-5 cambio de destino antes de salir: aplicado', (SELECT action_kind = 'maps_listing' AND target_url LIKE 'https://www.google.com/maps/%' FROM public.booking_intents WHERE offer_id='00000000000000d1'));
SELECT bt.ok('AUD04-6 el cambio de destino queda en el historial (host anterior y nuevo)',
  EXISTS (SELECT 1 FROM public.booking_intent_events e JOIN public.booking_intents i ON i.id = e.intent_id
          WHERE i.offer_id='00000000000000d1' AND e.from_state = 'READY_TO_BOOK' AND e.to_state = 'READY_TO_BOOK'
            AND e.note LIKE '%www.aviasales.com%www.google.com%'),
  (SELECT string_agg(coalesce(from_state,'∅') || '→' || to_state || ' ' || coalesce(note,''), ' | ' ORDER BY e.id) FROM public.booking_intent_events e JOIN public.booking_intents i ON i.id = e.intent_id WHERE i.offer_id='00000000000000d1'));
SELECT bt.ok('AUD04-7 después de salir al proveedor el destino ya no cambia', (SELECT target_url FROM public.booking_intents WHERE offer_id='00000000000000d1') LIKE 'https://www.google.com/maps/%');
