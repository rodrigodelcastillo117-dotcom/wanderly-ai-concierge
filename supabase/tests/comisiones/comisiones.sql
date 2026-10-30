-- Comisiones y reservas gestionadas (migración 20261030020000_comisiones). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS cmx CASCADE;
CREATE SCHEMA cmx;
GRANT USAGE ON SCHEMA cmx TO anon, authenticated, service_role;
CREATE FUNCTION cmx.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION cmx.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION cmx.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION cmx.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE cmx.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION cmx.v(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM cmx.r WHERE k = _k $$;
CREATE FUNCTION cmx.mb(_ref text) RETURNS public.managed_bookings LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.managed_bookings WHERE ref_code = _ref $$;
CREATE FUNCTION cmx.com(_src text, _ext text) RETURNS public.commissions LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.commissions WHERE source = _src AND external_id = _ext $$;
CREATE FUNCTION cmx.clicks(_user uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM public.affiliate_clicks WHERE user_id = _user $$;
CREATE FUNCTION cmx.req(_id uuid) RETURNS public.managed_booking_requests LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.managed_booking_requests WHERE id = _id $$;
CREATE FUNCTION cmx.msg(_inc uuid, _body text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (public.incident_add_event(_inc, jsonb_build_object('kind', 'mensaje', 'actor', 'usuario', 'direction', 'entrante', 'channel', 'app', 'body', _body))->>'event_id')::bigint $$;
CREATE FUNCTION cmx.mb_payload(_user uuid, _bid text, _env text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('user_id', _user, 'provider', 'ratehawk', 'environment', _env, 'product_type', 'hotel',
    'title', 'Hotel de prueba · Madrid', 'provider_booking_id', _bid, 'partner_order_id', _bid, 'provider_ref', '361911424',
    'status', 'confirmada', 'provider_status', 'completed', 'cancellable', true, 'changeable', false,
    'free_cancel_until', (now() + interval '10 days')::text, 'policies', jsonb_build_object('fuente', 'ratehawk order/info', 'penalizacion_actual', 0),
    'net_amount', 400, 'sell_amount', 460, 'currency', 'EUR', 'start_at', (now() + interval '20 days')::text, 'end_at', (now() + interval '23 days')::text) || extra $$;
GRANT ALL ON cmx.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cmx TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'cm-ana@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000b', 'cm-beto@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000c', 'cm-admin@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'Ana Comisiones', 'cm-ana@example.test'),
  ('0c000000-0000-0000-0000-00000000000b', 'Beto Comisiones', 'cm-beto@example.test'),
  ('0c000000-0000-0000-0000-00000000000c', 'Admin Comisiones', 'cm-admin@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.admins(user_id) VALUES ('0c000000-0000-0000-0000-00000000000c') ON CONFLICT DO NOTHING;
INSERT INTO public.trips(id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso)
VALUES ('0c100000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-00000000000a', 'Madrid', 2, '2026-12-05', '2026-12-10')
ON CONFLICT DO NOTHING;

-- ═══ Banderas ═══
SELECT cmx.ok('C1 banderas: la lectura de Travelpayouts nace prendida; reservar, ejecutar cambios y cargo por servicio nacen apagados',
  (SELECT bool_and(CASE key WHEN 'comisiones_sync_enabled' THEN value = 'true'::jsonb ELSE value = 'false'::jsonb END) AND count(*) = 4
     FROM public.app_flags WHERE key IN ('comisiones_sync_enabled','proveedores_reservas_enabled','reservas_gestionadas_cambios_enabled','cargo_servicio_enabled')));

-- ═══ Nadie del cliente lee ni escribe el libro ═══
SET ROLE authenticated; SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000a');
SELECT cmx.ok('C2 el usuario no lee commissions ni managed_bookings ni llama commissions_upsert',
  cmx.err('SELECT count(*) FROM public.commissions') LIKE '42501%' AND cmx.err('SELECT count(*) FROM public.managed_bookings') LIKE '42501%'
  AND cmx.err($q$SELECT public.commissions_upsert('manual', '[]'::jsonb)$q$) LIKE '42501%'
  AND cmx.err($q$SELECT public.managed_booking_upsert('{}'::jsonb)$q$) LIKE '42501%');

-- ═══ Clics ═══
INSERT INTO public.affiliate_clicks (user_id, proveedor, accion, url_final, origen, red, booking_intent_id)
VALUES ('0c000000-0000-0000-0000-00000000000a', 'Aviasales', 'vuelos_buscar', 'https://www.aviasales.com/search/MEX0512MAD1?marker=533299', 'booking_go', 'falsa',
        '0c900000-0000-0000-0000-000000000009');
RESET ROLE;
SELECT cmx.ok('C3 el clic del cliente se normaliza en el servidor: origen app, red travelpayouts, producto vuelo, sin ids inventados',
  (SELECT origen = 'app' AND red = 'travelpayouts' AND host = 'aviasales.com' AND producto = 'vuelo' AND booking_intent_id IS NULL
     FROM public.affiliate_clicks WHERE user_id = '0c000000-0000-0000-0000-00000000000a' AND accion = 'vuelos_buscar'));

SET ROLE authenticated; SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000a');
INSERT INTO public.bookings (user_id, category, provider, title, booking_url, status)
VALUES ('0c000000-0000-0000-0000-00000000000a', 'hotel', 'Booking.com', 'Hotel en Madrid', 'https://www.booking.com/hotel/es/x.html?aid=1', 'pending');
RESET ROLE;
SELECT cmx.ok('C4 trackBookingClick (bookings pending) queda en el libro de clics con origen reservar, producto hotel y su booking_id',
  (SELECT origen = 'reservar' AND producto = 'hotel' AND red = 'booking' AND booking_id IS NOT NULL
     FROM public.affiliate_clicks WHERE user_id = '0c000000-0000-0000-0000-00000000000a' AND url_final LIKE 'https://www.booking.com/hotel/es/x.html%'));

-- Mismo clic por dos caminos (ConciergeCards escribe affiliate_clicks y bookings): uno solo.
SET ROLE authenticated; SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000b');
INSERT INTO public.affiliate_clicks (user_id, proveedor, accion, url_final)
VALUES ('0c000000-0000-0000-0000-00000000000b', 'Viator', 'concierge_tour', 'https://www.viator.com/tours/Madrid/x/d566-1?pid=P00327354');
INSERT INTO public.bookings (user_id, category, provider, title, booking_url, status)
VALUES ('0c000000-0000-0000-0000-00000000000b', 'activity', 'Viator', 'Tour Madrid', 'https://www.viator.com/tours/Madrid/x/d566-1?pid=P00327354', 'pending');
INSERT INTO public.bookings (user_id, category, provider, title, booking_url, status)
VALUES ('0c000000-0000-0000-0000-00000000000b', 'activity', 'Viator', 'Tour confirmado', 'https://www.viator.com/tours/Madrid/y/d566-2', 'confirmed');
RESET ROLE;
SELECT cmx.ok('C5 un clic que llega por affiliate_clicks y bookings cuenta una vez (queda ligado a la visita) y una reserva confirmada no es clic',
  cmx.clicks('0c000000-0000-0000-0000-00000000000b') = 1
  AND (SELECT booking_id IS NOT NULL AND red = 'viator' AND producto = 'tour' FROM public.affiliate_clicks WHERE user_id = '0c000000-0000-0000-0000-00000000000b'),
  cmx.clicks('0c000000-0000-0000-0000-00000000000b')::text);

-- booking-go: salida firmada al proveedor.
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'bi', public.booking_intent_start('0c000000-0000-0000-0000-00000000000a', jsonb_build_object(
  'idempotency_key', 'cm-key-0001', 'offer_id', 'cc000000000000a1', 'trip_id', '0c100000-0000-0000-0000-000000000001',
  'product_type', 'hotel', 'provider', 'ratehawk', 'action_kind', 'exact_offer', 'booking_mode', 'PROVIDER_SEARCH', 'state', 'READY_TO_BOOK',
  'title', 'Hotel Madrid', 'target_url', 'https://www.booking.com/hotel/es/y.html', 'target_host', 'www.booking.com', 'channel', 'web',
  'price', 460, 'currency', 'EUR', 'consent', true));
SELECT public.booking_intent_mark_redirected((cmx.v('bi')->'intent'->>'id')::uuid, '0c000000-0000-0000-0000-00000000000a');
RESET ROLE;
SELECT cmx.ok('C6 cada salida de booking-go queda como clic con origen booking_go y la intención',
  (SELECT count(*) = 1 FROM public.affiliate_clicks WHERE origen = 'booking_go' AND booking_intent_id = (cmx.v('bi')->'intent'->>'id')::uuid));

-- ═══ Libro de comisiones ═══
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'u1', public.commissions_upsert('travelpayouts', jsonb_build_array(
  jsonb_build_object('external_id', '100:14358982146', 'campaign_id', 100, 'proveedor', 'Aviasales', 'producto', 'vuelo', 'status', 'confirmada',
    'provider_state', 'paid', 'booked_at', now()::text, 'sale_amount', 60.83, 'commission_amount', 1.52, 'currency', 'USD'),
  jsonb_build_object('external_id', '84:999', 'campaign_id', 84, 'proveedor', 'Booking.com', 'producto', 'hotel', 'status', 'pendiente',
    'provider_state', 'processing', 'booked_at', now()::text, 'sale_amount', 300, 'commission_amount', 12.5, 'currency', 'USD'),
  jsonb_build_object('external_id', '84:1000', 'proveedor', 'Booking.com', 'status', 'confirmada', 'currency', 'usd', 'commission_amount', 1),
  jsonb_build_object('external_id', '', 'status', 'confirmada', 'currency', 'USD')));
INSERT INTO cmx.r SELECT 'u2', public.commissions_upsert('travelpayouts', jsonb_build_array(
  jsonb_build_object('external_id', '100:14358982146', 'proveedor', 'Aviasales', 'status', 'confirmada', 'commission_amount', 1.52, 'sale_amount', 60.83, 'currency', 'USD')));
RESET ROLE;
SELECT cmx.ok('C7 alta del lote: 2 nuevas, 2 inválidas (moneda en minúsculas, sin id); repetir la misma no cambia nada',
  cmx.v('u1')->>'nuevas' = '2' AND cmx.v('u1')->>'invalidas' = '2' AND cmx.v('u2')->>'sin_cambio' = '1' AND cmx.v('u2')->>'nuevas' = '0',
  cmx.v('u1')::text || cmx.v('u2')::text);

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'p1', public.commissions_mark_paid('travelpayouts', '4af0c247-df4c-4873-a6b6-7bbf91afa3b9', now(), ARRAY['100:14358982146']);
INSERT INTO cmx.r SELECT 'u3', public.commissions_upsert('travelpayouts', jsonb_build_array(
  jsonb_build_object('external_id', '100:14358982146', 'proveedor', 'Aviasales', 'status', 'confirmada', 'commission_amount', 1.52, 'currency', 'USD')));
RESET ROLE;
SELECT cmx.ok('C8 un pago de Travelpayouts deja la comisión pagada y la siguiente sincronización no la regresa a confirmada',
  cmx.v('p1')->>'pagadas' = '1' AND cmx.v('u3')->>'ignoradas' = '1' AND (cmx.com('travelpayouts', '100:14358982146')).status = 'pagada'
  AND (cmx.com('travelpayouts', '100:14358982146')).payout_ref = '4af0c247-df4c-4873-a6b6-7bbf91afa3b9');

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'u4', public.commissions_upsert('travelpayouts', jsonb_build_array(
  jsonb_build_object('external_id', '84:999', 'proveedor', 'Booking.com', 'status', 'rechazada', 'provider_state', 'cancelled', 'commission_amount', 0, 'currency', 'USD')));
RESET ROLE;
SELECT cmx.ok('C9 pendiente → rechazada (el viajero canceló) con su historial',
  cmx.v('u4')->>'actualizadas' = '1' AND (cmx.com('travelpayouts', '84:999')).status = 'rechazada'
  AND (SELECT count(*) FROM public.commission_events WHERE commission_id = (cmx.com('travelpayouts', '84:999')).id) = 2);

-- ═══ Reservas gestionadas ═══
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'm1', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000a', 'po-sandbox-0001', 'sandbox'));
INSERT INTO cmx.r SELECT 'm1b', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000a', 'po-sandbox-0001', 'sandbox'));
INSERT INTO cmx.r SELECT 'm1c', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000b', 'po-sandbox-0001', 'sandbox'));
RESET ROLE;
SELECT cmx.ok('C10 alta idempotente con folio R-XXXXXX; otro usuario no puede adueñarse de la misma reserva del proveedor',
  cmx.v('m1')->'booking'->>'ref_code' ~ '^R-[A-Z0-9]{6}$' AND cmx.v('m1b')->'booking'->>'id' = cmx.v('m1')->'booking'->>'id'
  AND cmx.v('m1c')->>'code' = 'OWNER_MISMATCH', cmx.v('m1')::text);
SELECT cmx.ok('C11 una reserva de sandbox no cuenta como dinero (sin comisión en el libro)',
  (SELECT count(*) = 0 FROM public.commissions WHERE managed_booking_id = (cmx.v('m1')->'booking'->>'id')::uuid));

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'm2', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000a', 'po-prod-0002', 'produccion',
  jsonb_build_object('booking_intent_id', cmx.v('bi')->'intent'->>'id', 'trip_id', '0c100000-0000-0000-0000-000000000001')));
RESET ROLE;
SELECT cmx.ok('C12 en producción la intención del Booking Bridge queda CONFIRMED con evidencia del proveedor, hay constancia en bookings y el margen (460-400) entra pendiente al libro',
  (SELECT state = 'CONFIRMED' AND confirmation_evidence->>'source' = 'provider_api' AND confirmation_evidence->>'ref' = '361911424'
     FROM public.booking_intents WHERE id = (cmx.v('bi')->'intent'->>'id')::uuid)
  AND (cmx.mb(cmx.v('m2')->'booking'->>'ref_code')).booking_id IS NOT NULL
  AND (cmx.com('ratehawk', 'mb:' || (cmx.v('m2')->'booking'->>'id'))).status = 'pendiente'
  AND (cmx.com('ratehawk', 'mb:' || (cmx.v('m2')->'booking'->>'id'))).commission_amount = 60, cmx.v('m2')::text);

-- ═══ Operador: pedir cambio o cancelación ═══
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'inc', public.incident_create(jsonb_build_object('user_id', '0c000000-0000-0000-0000-00000000000a', 'categoria', 'hotel_problema',
  'severidad', 'media', 'origen', 'usuario', 'idem_key', 'cm:hotel-0001', 'descripcion', 'Quiero cancelar mi hotel',
  'respuesta_inmediata', 'Revisamos tu reserva.'));
RESET ROLE;
INSERT INTO public.operator_cases (request_id, lock_owner, locked_until) VALUES ((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', now() + interval '2 minutes')
ON CONFLICT (request_id) DO UPDATE SET lock_owner = excluded.lock_owner, locked_until = excluded.locked_until;
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'fc', public.managed_bookings_for_case((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01');
INSERT INTO cmx.r SELECT 'fc2', public.managed_bookings_for_case((cmx.v('inc')->>'id')::uuid, 'otro-operador-99');
RESET ROLE;
SELECT cmx.ok('C13 el operador ve las reservas gestionadas del viajero del caso, sin neto ni margen, y solo con su candado',
  jsonb_array_length(cmx.v('fc')->'reservas') = 2 AND NOT (cmx.v('fc')->'reservas'->0 ? 'net_amount') AND NOT (cmx.v('fc')->'reservas'->0 ? 'user_id')
  AND cmx.v('fc2')->>'code' = 'NOT_LOCKED', left(cmx.v('fc')::text, 300));

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'rq0', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Quiero cancelar el hotel'), '{}'::jsonb);
INSERT INTO cmx.r SELECT 'rq1', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'No, no cancela ' || (cmx.v('m2')->'booking'->>'ref_code')), '{}'::jsonb);
INSERT INTO cmx.r SELECT 'rq2', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'otro-operador-99', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Sí, cancela ' || (cmx.v('m2')->'booking'->>'ref_code')), '{}'::jsonb);
RESET ROLE;
SELECT cmx.ok('C14 sin el sí escrito con folio (o con un "no"), o sin el candado del caso, no se pide nada',
  cmx.v('rq0')->>'code' = 'CONSENT_REQUIRED' AND cmx.v('rq1')->>'code' = 'CONSENT_REQUIRED' AND cmx.v('rq2')->>'code' = 'NOT_LOCKED',
  cmx.v('rq0')::text || cmx.v('rq1')::text || cmx.v('rq2')::text);

-- Un mensaje del equipo (no del viajero) no sirve como consentimiento.
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'evq', public.incident_add_event((cmx.v('inc')->>'id')::uuid, jsonb_build_object('kind', 'mensaje', 'actor', 'equipo',
  'direction', 'saliente', 'channel', 'mesa', 'body', 'Sí, cancela ' || (cmx.v('m2')->'booking'->>'ref_code')));
INSERT INTO cmx.r SELECT 'rq3', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  (cmx.v('evq')->>'event_id')::bigint, '{}'::jsonb);
-- Folio de otro viajero: no existe para este caso.
INSERT INTO cmx.r SELECT 'mB', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000b', 'po-prod-beto', 'produccion'));
INSERT INTO cmx.r SELECT 'rq4', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('mB')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Sí, cancela ' || (cmx.v('mB')->'booking'->>'ref_code')), '{}'::jsonb);
RESET ROLE;
SELECT cmx.ok('C15 un mensaje del equipo no es consentimiento y el folio de otro viajero no existe para este caso',
  cmx.v('rq3')->>'code' = 'CONSENT_REQUIRED' AND cmx.v('rq4')->>'code' = 'NOT_FOUND', cmx.v('rq3')::text || cmx.v('rq4')::text);

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'rq5', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cambio',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Sí, cambia ' || (cmx.v('m2')->'booking'->>'ref_code') || ' al 24'), '{"nueva_fecha":"2026-12-24"}'::jsonb);
INSERT INTO cmx.r SELECT 'rq6', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Sí, cancela ' || lower(cmx.v('m2')->'booking'->>'ref_code') || ' por favor'), '{}'::jsonb);
INSERT INTO cmx.r SELECT 'rq7', public.managed_booking_request_change((cmx.v('inc')->>'id')::uuid, 'op-comisiones-01', cmx.v('m2')->'booking'->>'ref_code', 'cancelacion',
  cmx.msg((cmx.v('inc')->>'id')::uuid, 'Sí, cancela ' || (cmx.v('m2')->'booking'->>'ref_code')), '{}'::jsonb);
RESET ROLE;
SELECT cmx.ok('C16 la política manda: el cambio que el proveedor no permite por API se rechaza con el motivo; la cancelación con sí y folio queda pendiente de aprobación (gratis hasta la fecha del proveedor); repetirla no duplica',
  cmx.v('rq5')->>'code' = 'NOT_ALLOWED' AND cmx.v('rq6')->>'status' = 'pendiente_aprobacion'
  AND (cmx.v('rq6')->'politica'->>'gratis')::boolean AND (cmx.v('rq7')->>'existing')::boolean
  AND cmx.v('rq7')->>'request_id' = cmx.v('rq6')->>'request_id', cmx.v('rq5')::text || cmx.v('rq6')::text);
SELECT cmx.ok('C17 pedir NO ejecuta: la reserva sigue confirmada y la solicitud guarda el texto del viajero',
  (cmx.mb(cmx.v('m2')->'booking'->>'ref_code')).status = 'confirmada'
  AND (cmx.req((cmx.v('rq6')->>'request_id')::uuid)).consent_text ILIKE 'Sí, cancela%');

-- ═══ Aprobación humana y ejecución ═══
SET ROLE authenticated; SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000a');
INSERT INTO cmx.r SELECT 'dn', to_jsonb(cmx.err(format($q$SELECT public.admin_managed_request_decide(%L, true, 'yo apruebo')$q$, cmx.v('rq6')->>'request_id')));
SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000c');
INSERT INTO cmx.r SELECT 'd1', public.admin_managed_request_decide((cmx.v('rq6')->>'request_id')::uuid, true, 'Cancelación gratis, aprobada');
INSERT INTO cmx.r SELECT 'd2', public.admin_managed_request_decide((cmx.v('rq6')->>'request_id')::uuid, false, 'otra vez');
RESET ROLE;
SELECT cmx.ok('C18 solo un administrador aprueba, una sola vez',
  (cmx.v('dn')#>>'{}') LIKE '42501%' AND cmx.v('d1')->>'status' = 'aprobada' AND cmx.v('d2')->>'code' = 'ALREADY_DECIDED', cmx.v('dn')::text);

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'cl0', public.managed_requests_claim(5);
RESET ROLE;
SELECT cmx.ok('C19 con la bandera de ejecución apagada, la tarea no toma nada (queda aprobada)',
  (cmx.v('cl0')->>'apagado')::boolean AND (cmx.req((cmx.v('rq6')->>'request_id')::uuid)).status = 'aprobada');

UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'reservas_gestionadas_cambios_enabled';
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'cl1', public.managed_requests_claim(5);
INSERT INTO cmx.r SELECT 'cl2', public.managed_requests_claim(5);
RESET ROLE;
SELECT cmx.ok('C20 prendida: la toma una sola vez (ejecutando) con los datos internos de la reserva para el adaptador',
  jsonb_array_length(cmx.v('cl1')->'solicitudes') = 1 AND jsonb_array_length(cmx.v('cl2')->'solicitudes') = 0
  AND cmx.v('cl1')->'solicitudes'->0->'booking'->>'partner_order_id' = 'po-prod-0002'
  AND (cmx.req((cmx.v('rq6')->>'request_id')::uuid)).status = 'ejecutando', left(cmx.v('cl1')::text, 300));

SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'f1', public.managed_request_finish((cmx.v('rq6')->>'request_id')::uuid, true, '{"status":"ok"}'::jsonb);
INSERT INTO cmx.r SELECT 'a1', public.managed_booking_apply_status('ratehawk', 'produccion', 'po-prod-0002', 'cancelled', 'ejecucion', '{}'::jsonb);
INSERT INTO cmx.r SELECT 'a2', public.managed_booking_apply_status('ratehawk', 'produccion', 'po-prod-0002', 'completed', 'webhook', '{}'::jsonb);
RESET ROLE;
SELECT cmx.ok('C21 hecha: la reserva queda cancelada, la comisión rechazada y la intención del Bridge cancelada; un estado viejo no la revive',
  cmx.v('f1')->>'status' = 'hecha' AND cmx.v('a1')->>'status' = 'cancelada' AND (cmx.v('a2')->>'unchanged')::boolean
  AND (cmx.mb(cmx.v('m2')->'booking'->>'ref_code')).status = 'cancelada'
  AND (cmx.com('ratehawk', 'mb:' || (cmx.v('m2')->'booking'->>'id'))).status = 'rechazada'
  AND (SELECT state = 'CANCELLED' FROM public.booking_intents WHERE id = (cmx.v('bi')->'intent'->>'id')::uuid), cmx.v('a1')::text || cmx.v('a2')::text);

-- Atorada: no se reintenta a ciegas.
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'm3', public.managed_booking_upsert(cmx.mb_payload('0c000000-0000-0000-0000-00000000000a', 'po-prod-0003', 'produccion'));
RESET ROLE;
INSERT INTO public.managed_booking_requests (booking_id, kind, requested_by, status, started_at)
VALUES ((cmx.v('m3')->'booking'->>'id')::uuid, 'cancelacion', 'equipo', 'ejecutando', now() - interval '20 minutes');
SET ROLE service_role; SELECT cmx.as_service();
SELECT public.managed_requests_claim(5);
RESET ROLE;
SELECT cmx.ok('C22 una ejecución sin respuesta en 15 min pasa a "revisar" (una persona decide), nunca se repite sola',
  (SELECT status = 'revisar' FROM public.managed_booking_requests WHERE booking_id = (cmx.v('m3')->'booking'->>'id')::uuid));
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'reservas_gestionadas_cambios_enabled';

-- Terminó la estancia: completada y la comisión confirmada.
UPDATE public.managed_bookings SET start_at = now() - interval '5 days', end_at = now() - interval '2 days' WHERE id = (cmx.v('m3')->'booking'->>'id')::uuid;
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'cp', to_jsonb(public.managed_bookings_complete_past());
RESET ROLE;
SELECT cmx.ok('C23 al terminar el servicio la reserva queda completada y su margen pasa a confirmado',
  (cmx.v('cp')#>>'{}')::int >= 1 AND (cmx.mb(cmx.v('m3')->'booking'->>'ref_code')).status = 'completada'
  AND (cmx.com('ratehawk', 'mb:' || (cmx.v('m3')->'booking'->>'id'))).status = 'confirmada');

-- ═══ Webhooks: un token se usa una vez ═══
SET ROLE service_role; SELECT cmx.as_service();
SELECT cmx.ok('C24 token de webhook: la primera vez sí, la repetición no',
  public.provider_webhook_token_once('ratehawk', 'd3395025-1ee7-49a2-bd86-e4bd6b9908b2')
  AND NOT public.provider_webhook_token_once('ratehawk', 'd3395025-1ee7-49a2-bd86-e4bd6b9908b2'));
RESET ROLE;

-- ═══ Cargo por servicio ═══
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'sf0', public.service_fee_quote('vuelo', 5000, 1);
RESET ROLE;
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'cargo_servicio_enabled';
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'sf1', public.service_fee_quote('vuelo', 5000, 1);
RESET ROLE;
UPDATE public.service_fee_rules SET activo = true, modo = 'fijo_mas_porcentaje', monto_fijo = 150, porcentaje = 2, maximo = 400, por = 'reserva' WHERE producto = 'vuelo';
SET ROLE service_role; SELECT cmx.as_service();
INSERT INTO cmx.r SELECT 'sf2', public.service_fee_quote('vuelo', 5000, 2);
INSERT INTO cmx.r SELECT 'sf3', public.service_fee_quote('vuelo', 50000, 2);
RESET ROLE;
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'cargo_servicio_enabled';
SELECT cmx.ok('C25 cargo por servicio: apagado no cobra; prendido sin monto tampoco; con regla da monto, moneda, si es reembolsable y respeta el máximo',
  cmx.v('sf0')->>'motivo' = 'apagado' AND cmx.v('sf1')->>'motivo' = 'sin_regla'
  AND (cmx.v('sf2')->>'monto')::numeric = 250 AND cmx.v('sf2')->>'moneda' = 'MXN' AND cmx.v('sf2')->>'reembolsable' = 'false'
  AND (cmx.v('sf3')->>'monto')::numeric = 400, cmx.v('sf1')::text || cmx.v('sf2')::text || cmx.v('sf3')::text);

-- ═══ Tablero ═══
SET ROLE authenticated; SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000a');
INSERT INTO cmx.r SELECT 'tn', to_jsonb(cmx.err('SELECT public.admin_commissions_summary(NULL)'));
SELECT cmx.as_user('0c000000-0000-0000-0000-00000000000c');
INSERT INTO cmx.r SELECT 't1', public.admin_commissions_summary(NULL);
RESET ROLE;
SELECT cmx.ok('C26 el tablero es solo para administradores',
  (cmx.v('tn')#>>'{}') LIKE '42501%', cmx.v('tn')::text);
SELECT cmx.ok('C27 tablero del mes: ganado (confirmado+pagado) y pendiente por moneda, por proveedor y producto, clics por red, solicitudes y banderas',
  (SELECT (x->>'ganado')::numeric = 1.52 AND (x->>'pagado')::numeric = 1.52 FROM jsonb_array_elements(cmx.v('t1')->'totales') x WHERE x->>'moneda' = 'USD')
  AND (SELECT (x->>'ganado')::numeric = 60 FROM jsonb_array_elements(cmx.v('t1')->'totales') x WHERE x->>'moneda' = 'EUR')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(cmx.v('t1')->'por_proveedor') x WHERE x->>'proveedor' = 'Aviasales')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(cmx.v('t1')->'por_producto') x WHERE x->>'producto' = 'vuelo')
  AND (cmx.v('t1')->'clics'->>'total')::int >= 4
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(cmx.v('t1')->'clics'->'por_red') x WHERE x->>'red' = 'travelpayouts')
  AND jsonb_typeof(cmx.v('t1')->'solicitudes') = 'array' AND (cmx.v('t1')->'banderas'->>'comisiones_sync_enabled')::boolean,
  left(cmx.v('t1')::text, 600));

DROP SCHEMA cmx CASCADE;
