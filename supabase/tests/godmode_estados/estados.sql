-- God Mode · Fase 1 (migración 20261028010000_godmode_estados). Cada caso imprime "OK <id> …" o
-- "FALLA <id> …". Se corre con -v mig=<ruta de la migración> (run.sh).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS gm CASCADE;
CREATE SCHEMA gm;
GRANT USAGE ON SCHEMA gm TO anon, authenticated, service_role;
CREATE FUNCTION gm.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION gm.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION gm.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION gm.as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'anon', false), set_config('request.jwt.claim.sub', '', false) $$;
-- Una fila de la vista como texto "estado/verificación/fuente" (para comparar en una línea).
CREATE FUNCTION gm.st(_id uuid) RETURNS text LANGUAGE sql SECURITY INVOKER AS $$
  SELECT coalesce((SELECT canonical_state || '/' || verification || '/' || coalesce(evidence_source, '-')
                     FROM public.reservation_state_v WHERE source_id = _id), 'AUSENTE') $$;
CREATE TABLE gm.snap (k text PRIMARY KEY, v text);
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA gm TO anon, authenticated, service_role;

-- Usuarios A y B; A tiene dos viajes.
INSERT INTO auth.users(id,email) VALUES
  ('6d000000-0000-0000-0000-00000000000a','gm-a@example.test'),
  ('6d000000-0000-0000-0000-00000000000b','gm-b@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO trips(id,user_id,destino,num_viajeros,fecha_salida,fecha_regreso) VALUES
  ('6d100000-0000-0000-0000-00000000000a','6d000000-0000-0000-0000-00000000000a','Madrid',2,'2026-12-05','2026-12-10'),
  ('6d100000-0000-0000-0000-0000000000a2','6d000000-0000-0000-0000-00000000000a','Lima',2,'2027-02-05','2027-02-10'),
  ('6d100000-0000-0000-0000-00000000000b','6d000000-0000-0000-0000-00000000000b','Roma',1,'2026-12-05','2026-12-10')
ON CONFLICT DO NOTHING;

-- ── N: normalización 'pending' → 'solicitado' sobre datos como los de producción (antes de la migración)
-- Se quita el CHECK para poder dejar filas viejas tal como existían y se vuelve a aplicar la migración.
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS concierge_request_status_ok;
SET session_replication_role = replica;
INSERT INTO public.concierge_requests (id, user_id, type, title, status, created_at, updated_at) VALUES
  ('6d300000-0000-0000-0000-0000000000e1','6d000000-0000-0000-0000-00000000000a','pickup','Traslado viejo','pending','2026-01-01','2026-01-01'),
  ('6d300000-0000-0000-0000-0000000000e2','6d000000-0000-0000-0000-00000000000a','jet','Valor raro','otro_estado','2026-01-01','2026-01-01');
SET session_replication_role = origin;
\i :mig
SELECT gm.ok('N1 la fila vieja "pending" queda "solicitado"', (SELECT status FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000e1') = 'solicitado');
SELECT gm.ok('N2 la normalización no mueve updated_at', (SELECT updated_at FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000e1') = '2026-01-01'::timestamptz);
SELECT gm.ok('N3 con un estado desconocido la migración no falla: el CHECK queda NOT VALID',
  (SELECT NOT convalidated FROM pg_constraint WHERE conname='concierge_request_status_ok' AND conrelid='public.concierge_requests'::regclass));
SELECT gm.ok('N4 el estado desconocido no se toca', (SELECT status FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000e2') = 'otro_estado');
DELETE FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000e2';
INSERT INTO gm.snap SELECT 'cr', md5(string_agg(id::text || status || updated_at::text, ',' ORDER BY id)) FROM public.concierge_requests;
\i :mig
SELECT gm.ok('N5 sin estados raros el CHECK queda validado',
  (SELECT convalidated FROM pg_constraint WHERE conname='concierge_request_status_ok' AND conrelid='public.concierge_requests'::regclass));
SELECT gm.ok('N6 aplicar otra vez no cambia ninguna solicitud (idempotente)',
  (SELECT md5(string_agg(id::text || status || updated_at::text, ',' ORDER BY id)) FROM public.concierge_requests) = (SELECT v FROM gm.snap WHERE k='cr'));
SELECT gm.ok('N7 el valor por omisión ya es "solicitado"',
  (SELECT column_default FROM information_schema.columns WHERE table_name='concierge_requests' AND column_name='status') LIKE '''solicitado''%');

-- ── Datos: intenciones, reservas IA y una solicitud Privé confirmada (filas que solo escriben las RPC:
-- se cargan sin disparadores; los CHECK de evidencia de cada tabla sí aplican).
SET session_replication_role = replica;
INSERT INTO public.booking_intents (id, user_id, trip_id, offer_id, product_type, provider, action_kind, booking_mode, state, verification,
  title, target_url, channel, confirmation_evidence, concierge_request_id, ai_reservation_id, idempotency_key, updated_at) VALUES
  ('6d200000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','00000000000000d1','restaurant','iatos','assisted_request','REQUEST','REQUESTED','none',
   'Mesa en Botín',NULL,'iatos_team',NULL,'6d300000-0000-0000-0000-000000000004',NULL,'gm-key-0001',now()),
  ('6d200000-0000-0000-0000-000000000002','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','00000000000000d2','hotel','booking','exact_offer','EXACT_DEEP_LINK','CONFIRMED','provider_verified',
   'Hotel Urban','https://www.booking.com/x','web','{"source":"provider_api","ref":"BK-123","verified_at":"2026-10-20T10:00:00Z"}',NULL,NULL,'gm-key-0002',now()),
  ('6d200000-0000-0000-0000-000000000003','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','00000000000000d3','flight','google_flights','equivalent_search','PROVIDER_SEARCH','REDIRECTED_TO_PROVIDER','user_declared',
   'MEX → MAD','https://www.google.com/travel/flights','web',NULL,NULL,NULL,'gm-key-0003',now()),
  ('6d200000-0000-0000-0000-000000000004','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','00000000000000d4','restaurant','iatos','email','REQUEST','CANCELLED','none',
   'Cena cancelada',NULL,'reservas_email',NULL,NULL,'6d400000-0000-0000-0000-000000000004','gm-key-0004',now()),
  ('6d200000-0000-0000-0000-000000000006','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','00000000000000d6','tour','civitatis','exact_offer','EXACT_DEEP_LINK','CONFIRMED','provider_verified',
   'Tour de 2025','https://www.civitatis.com/x','web','{"source":"provider_api","ref":"CV-1","verified_at":"2025-01-01T10:00:00Z"}',NULL,NULL,'gm-key-0006','2025-01-01'),
  ('6d200000-0000-0000-0000-0000000000b1','6d000000-0000-0000-0000-00000000000b','6d100000-0000-0000-0000-00000000000b','00000000000000b1','hotel','equipo','assisted_request','REQUEST','CONFIRMED','team_verified',
   'Hotel de B',NULL,'iatos_team','{"source":"team_verified","ref":"EQ-9","verified_at":"2026-10-20T10:00:00Z"}',NULL,NULL,'gm-key-00b1',now());
INSERT INTO public.ai_reservations (id, user_id, trip_id, ref_code, reply_token, venue_name, venue_timezone, requested_local, requested_for, party_size,
  customer_name, status, confirmation) VALUES
  ('6d400000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','R-GMAAA1','aaaaaaaaaaaaaaaaaaaaaaa1','Casa Lucio','Europe/Madrid','2026-12-06T21:00','2026-12-06T20:00:00Z',2,'Ana','sent',NULL),
  ('6d400000-0000-0000-0000-000000000002','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','R-GMAAA2','aaaaaaaaaaaaaaaaaaaaaaa2','DiverXO','Europe/Madrid','2026-12-07T21:00','2026-12-07T20:00:00Z',2,'Ana','confirmed',
   '{"channel":"venue_email","inbound_email_id":"in_12345","quote":"Confirmamos su mesa","verified_sender":"true"}'),
  ('6d400000-0000-0000-0000-000000000003','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','R-GMAAA3','aaaaaaaaaaaaaaaaaaaaaaa3','Sobrino','Europe/Madrid','2026-12-08T21:00','2026-12-08T20:00:00Z',2,'Ana','needs_user',NULL),
  ('6d400000-0000-0000-0000-000000000004','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','R-GMAAA4','aaaaaaaaaaaaaaaaaaaaaaa4','Ligada','Europe/Madrid','2026-12-09T21:00','2026-12-09T20:00:00Z',2,'Ana','cancelled',NULL);
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, status, experience_id, external_confirmation) VALUES
  ('6d300000-0000-0000-0000-000000000003','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','prive_request','Privé: cena','confirmado_externamente',
   'e0000000-0000-0000-0000-0000000000ff','{"confirmed_by":"Equipo IATOS","confirmed_at":"2026-10-20T10:00:00Z","confirmation_code":"PV-77"}');
SET session_replication_role = origin;

-- ── C: el CHECK no rompe los inserts ni los cambios reales del código (como el servidor)
SET ROLE service_role; SELECT gm.as_service();
DO $$ DECLARE t text; n int := 0; BEGIN
  -- concierge-action (tarjetas, Fixer de Iato, Members): nacen "solicitado".
  FOREACH t IN ARRAY ARRAY['reservation','alert','pickup','jet','transport','rebooking','fixer_request','members_nightlife_reservation','luggage'] LOOP
    BEGIN
      INSERT INTO public.concierge_requests (user_id, type, title, payload, status) VALUES ('6d000000-0000-0000-0000-00000000000a', t, 'C1 ' || t, '{}', 'solicitado');
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FALLA C1 insert % (%)', t, SQLERRM;
    END;
  END LOOP;
  IF n = 9 THEN RAISE NOTICE 'OK C1 concierge-action: los 9 tipos nacen "solicitado"'; END IF;
END $$;
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, payload, status) VALUES
  ('6d300000-0000-0000-0000-000000000004','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','booking_assist','Mesa en Botín','{}','pending');
SELECT gm.ok('C2 booking-bridge todavía manda "pending": se guarda y queda "solicitado"', (SELECT status FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-000000000004') = 'solicitado');
INSERT INTO public.concierge_requests (id, user_id, type, title) VALUES ('6d300000-0000-0000-0000-0000000000c3','6d000000-0000-0000-0000-00000000000a','alert','Sin estado');
SELECT gm.ok('C3 sin estado nace "solicitado"', (SELECT status FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000c3') = 'solicitado');
-- Espejo de ai_reservations (ai_reservation_create_intent + disparador de estados).
INSERT INTO public.concierge_requests (id, user_id, type, title, payload, status) VALUES
  ('6d300000-0000-0000-0000-000000000006','6d000000-0000-0000-0000-00000000000a','ai_reservation','Reserva IA · Casa Lucio','{}','needs_user');
DO $$ DECLARE s text; bad text := ''; BEGIN
  FOREACH s IN ARRAY ARRAY['draft','awaiting_user_ok','sent','venue_replied','needs_user','confirmed','declined','expired','cancelled','failed'] LOOP
    BEGIN UPDATE public.concierge_requests SET status = s WHERE id='6d300000-0000-0000-0000-000000000006';
    EXCEPTION WHEN OTHERS THEN bad := bad || s || ' '; END;
  END LOOP;
  IF bad = '' THEN RAISE NOTICE 'OK C4 el espejo de ai_reservations acepta sus 10 estados'; ELSE RAISE NOTICE 'FALLA C4 rechazó: %', bad; END IF;
END $$;
INSERT INTO public.concierge_requests (id, user_id, type, title, status) VALUES
  ('6d300000-0000-0000-0000-0000000000c5','6d000000-0000-0000-0000-00000000000a','reservation','Ciclo del equipo','solicitado');
DO $$ DECLARE s text; bad text := ''; BEGIN
  -- Lo que el equipo o booking_intents_follow_request usan para las solicitudes que no son Privé.
  FOREACH s IN ARRAY ARRAY['pendiente_confirmacion','in_progress','contacted','confirmed','resuelto','cancelado','cancelled','rechazado','rejected','failed','caducado','expired','solicitado'] LOOP
    BEGIN UPDATE public.concierge_requests SET status = s WHERE id='6d300000-0000-0000-0000-0000000000c5';
    EXCEPTION WHEN OTHERS THEN bad := bad || s || ' '; END;
  END LOOP;
  IF bad = '' THEN RAISE NOTICE 'OK C5 los 13 estados del equipo se aceptan'; ELSE RAISE NOTICE 'FALLA C5 rechazó: %', bad; END IF;
END $$;
UPDATE public.concierge_requests SET status = 'pending' WHERE id='6d300000-0000-0000-0000-0000000000c5';
SELECT gm.ok('C6 cambiar a "pending" también queda "solicitado"', (SELECT status FROM public.concierge_requests WHERE id='6d300000-0000-0000-0000-0000000000c5') = 'solicitado');
DO $$ BEGIN
  INSERT INTO public.concierge_requests (user_id, type, title, status) VALUES ('6d000000-0000-0000-0000-00000000000a','reservation','Inventada','reservado');
  RAISE NOTICE 'FALLA C7 aceptó el estado inventado "reservado"';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK C7 un estado inventado ("reservado") se rechaza';
END $$;
DO $$ BEGIN
  UPDATE public.concierge_requests SET status = 'confirmado_externamente' WHERE id='6d300000-0000-0000-0000-0000000000c5';
  RAISE NOTICE 'FALLA C8 una solicitud no Privé quedó "confirmado_externamente"';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK C8 "confirmado_externamente" sigue siendo solo de Privé (con evidencia)';
END $$;
-- Solicitudes que verá la vista: con viaje, sin viaje, en otro viaje, "confirmed" sin evidencia; y de B.
INSERT INTO public.concierge_requests (id, user_id, trip_id, type, title, status) VALUES
  ('6d300000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-00000000000a',NULL,'reservation','Mesa en Pujol','solicitado'),
  ('6d300000-0000-0000-0000-000000000002','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','jet','Jet MEX→MAD','pending'),
  ('6d300000-0000-0000-0000-000000000005','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','members_nightlife_reservation','Mesa en Medusa','solicitado'),
  ('6d300000-0000-0000-0000-000000000007','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-0000000000a2','pickup','Traslado en Lima','solicitado'),
  ('6d300000-0000-0000-0000-0000000000b1','6d000000-0000-0000-0000-00000000000b','6d100000-0000-0000-0000-00000000000b','reservation','Mesa de B','solicitado');
UPDATE public.concierge_requests SET status = 'confirmed' WHERE id='6d300000-0000-0000-0000-000000000005';
RESET ROLE;
-- Las solicitudes C1/C3/C5 no estorban: se borran (solo eran para probar el CHECK).
DELETE FROM public.concierge_requests WHERE title LIKE 'C1 %' OR id IN ('6d300000-0000-0000-0000-0000000000c3','6d300000-0000-0000-0000-0000000000c5','6d300000-0000-0000-0000-0000000000e1');
INSERT INTO public.fixer_escalations (id, user_id, trip_id, motivo, status) VALUES
  ('6d500000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','Vuelo cancelado','email_enviado'),
  ('6d500000-0000-0000-0000-000000000002','6d000000-0000-0000-0000-00000000000a','6d100000-0000-0000-0000-00000000000a','Ya resuelto','resuelto'),
  ('6d500000-0000-0000-0000-0000000000b1','6d000000-0000-0000-0000-00000000000b','6d100000-0000-0000-0000-00000000000b','Fixer de B','pendiente');

-- ── I: aislamiento (security_invoker + RLS de cada tabla)
SET ROLE authenticated; SELECT gm.as_user('6d000000-0000-0000-0000-00000000000a');
SELECT gm.ok('I1 A ve sus filas de las cuatro tablas', (SELECT count(DISTINCT source_table) FROM public.reservation_state_v) = 4,
  (SELECT string_agg(DISTINCT source_table, ',') FROM public.reservation_state_v));
SELECT gm.ok('I2 A no ve nada de B en la vista', (SELECT count(*) FROM public.reservation_state_v WHERE user_id <> '6d000000-0000-0000-0000-00000000000a') = 0);
SELECT gm.ok('I3 A no ve nada de B en my_open_reservations', (SELECT count(*) FROM public.my_open_reservations(NULL) WHERE user_id <> '6d000000-0000-0000-0000-00000000000a') = 0);
DO $$ BEGIN
  INSERT INTO public.reservation_state_v (user_id, source_table, source_id, canonical_state) VALUES (auth.uid(), 'x', gen_random_uuid(), 'CONFIRMED');
  RAISE NOTICE 'FALLA I4 la vista aceptó un insert';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'OK I4 la vista es de solo lectura';
END $$;
SELECT gm.as_user('6d000000-0000-0000-0000-00000000000b');
SELECT gm.ok('I5 B ve solo lo suyo (3 filas: intención, solicitud y Fixer)', (SELECT count(*) FROM public.reservation_state_v) = 3
  AND (SELECT bool_and(user_id = '6d000000-0000-0000-0000-00000000000b') FROM public.reservation_state_v), (SELECT count(*)::text FROM public.reservation_state_v));
SELECT gm.ok('I6 B no encuentra las filas de A ni por id', (SELECT count(*) FROM public.reservation_state_v WHERE source_id IN
  ('6d200000-0000-0000-0000-000000000002','6d400000-0000-0000-0000-000000000002','6d300000-0000-0000-0000-000000000003','6d500000-0000-0000-0000-000000000001')) = 0);
SELECT gm.ok('I7 B con el viaje de A en la RPC no recibe nada de A', (SELECT count(*) FROM public.my_open_reservations('6d100000-0000-0000-0000-00000000000a') WHERE user_id <> auth.uid()) = 0);
RESET ROLE; SET ROLE anon; SELECT gm.as_anon();
DO $$ BEGIN
  PERFORM count(*) FROM public.reservation_state_v;
  RAISE NOTICE 'FALLA I8 anon leyó la vista';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK I8 anon no lee la vista [permission denied]';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM public.my_open_reservations(NULL);
  RAISE NOTICE 'FALLA I9 anon ejecutó la RPC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK I9 anon no ejecuta my_open_reservations [permission denied]';
END $$;
RESET ROLE; SET ROLE service_role; SELECT gm.as_service();
SELECT gm.ok('I10 la llave de servicio sin usuario no recibe filas de nadie en la RPC', (SELECT count(*) FROM public.my_open_reservations(NULL)) = 0);
RESET ROLE;

-- ── M: mapeo al vocabulario canónico (vista leída como A)
SET ROLE authenticated; SELECT gm.as_user('6d000000-0000-0000-0000-00000000000a');
SELECT gm.ok('M1 intención solicitada → REQUESTED sin evidencia', gm.st('6d200000-0000-0000-0000-000000000001') = 'REQUESTED/sin_evidencia/-', gm.st('6d200000-0000-0000-0000-000000000001'));
SELECT gm.ok('M2 intención confirmada por el proveedor → CONFIRMED/verificado_proveedor', gm.st('6d200000-0000-0000-0000-000000000002') = 'CONFIRMED/verificado_proveedor/provider_api', gm.st('6d200000-0000-0000-0000-000000000002'));
SELECT gm.ok('M3 abrir el sitio del proveedor no es compra (lo declarado por el usuario no cuenta)', gm.st('6d200000-0000-0000-0000-000000000003') = 'REDIRECTED_TO_PROVIDER/sin_evidencia/-', gm.st('6d200000-0000-0000-0000-000000000003'));
SELECT gm.ok('M4 reserva IA enviada → REQUESTED', gm.st('6d400000-0000-0000-0000-000000000001') = 'REQUESTED/sin_evidencia/-', gm.st('6d400000-0000-0000-0000-000000000001'));
SELECT gm.ok('M5 reserva IA confirmada por correo del lugar → CONFIRMED/verificado_proveedor', gm.st('6d400000-0000-0000-0000-000000000002') = 'CONFIRMED/verificado_proveedor/venue_email', gm.st('6d400000-0000-0000-0000-000000000002'));
SELECT gm.ok('M6 reserva IA que necesita al usuario → PENDING_CONFIRMATION', gm.st('6d400000-0000-0000-0000-000000000003') = 'PENDING_CONFIRMATION/sin_evidencia/-', gm.st('6d400000-0000-0000-0000-000000000003'));
SELECT gm.ok('M7 solicitud del Concierge → REQUESTED con su tipo', gm.st('6d300000-0000-0000-0000-000000000001') = 'REQUESTED/sin_evidencia/-'
  AND (SELECT kind FROM public.reservation_state_v WHERE source_id='6d300000-0000-0000-0000-000000000001') = 'reservation', gm.st('6d300000-0000-0000-0000-000000000001'));
SELECT gm.ok('M8 una solicitud que llegó "pending" se ve "solicitado"', (SELECT raw_status FROM public.reservation_state_v WHERE source_id='6d300000-0000-0000-0000-000000000002') = 'solicitado');
SELECT gm.ok('M9 Privé confirmada con folio → CONFIRMED/verificado_proveedor', gm.st('6d300000-0000-0000-0000-000000000003') = 'CONFIRMED/verificado_proveedor/prive_request_confirmed', gm.st('6d300000-0000-0000-0000-000000000003'));
SELECT gm.ok('M10 "confirmed" sin evidencia en una solicitud no Privé NO es CONFIRMED', gm.st('6d300000-0000-0000-0000-000000000005') = 'PENDING_CONFIRMATION/sin_evidencia/-', gm.st('6d300000-0000-0000-0000-000000000005'));
SELECT gm.ok('M11 lo que otra fila ya representa no se repite (solicitud ligada, espejo de Reservas IA, reserva IA ligada)',
  (SELECT count(*) FROM public.reservation_state_v WHERE source_id IN ('6d300000-0000-0000-0000-000000000004','6d300000-0000-0000-0000-000000000006','6d400000-0000-0000-0000-000000000004')) = 0);
SELECT gm.ok('M12 Fixer con correo enviado → REQUESTED (kind fixer)', gm.st('6d500000-0000-0000-0000-000000000001') = 'REQUESTED/sin_evidencia/-'
  AND (SELECT kind FROM public.reservation_state_v WHERE source_id='6d500000-0000-0000-0000-000000000001') = 'fixer');
SELECT gm.ok('M13 Fixer "resuelto" sin evidencia nunca es CONFIRMED', gm.st('6d500000-0000-0000-0000-000000000002') = 'PENDING_CONFIRMATION/sin_evidencia/-', gm.st('6d500000-0000-0000-0000-000000000002'));
RESET ROLE;
SELECT gm.ok('M14 en toda la vista ningún CONFIRMED queda sin evidencia', (SELECT count(*) FROM public.reservation_state_v WHERE canonical_state = 'CONFIRMED' AND verification = 'sin_evidencia') = 0);
SELECT gm.ok('M15 solo se usa el vocabulario de booking_intents', (SELECT bool_and(canonical_state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK','REDIRECTED_TO_PROVIDER','REQUESTED',
  'PENDING_CONFIRMATION','CONFIRMED','FAILED','CANCELLED','EXPIRED')) FROM public.reservation_state_v));
SELECT gm.ok('M16 verification solo toma los tres valores', (SELECT bool_and(verification IN ('verificado_proveedor','verificado_equipo','sin_evidencia')) FROM public.reservation_state_v));
SELECT gm.ok('M17 la confirmación del equipo se ve como verificado_equipo', (SELECT verification FROM public.reservation_state_v WHERE source_id='6d200000-0000-0000-0000-0000000000b1') = 'verificado_equipo');

-- ── R: my_open_reservations (lo vigente)
SET ROLE authenticated; SELECT gm.as_user('6d000000-0000-0000-0000-00000000000a');
SELECT gm.ok('R1 con el viaje: abiertas y confirmadas recientes del viaje y las que no tienen viaje',
  (SELECT count(*) FROM public.my_open_reservations('6d100000-0000-0000-0000-00000000000a') WHERE source_id IN
    ('6d200000-0000-0000-0000-000000000001','6d200000-0000-0000-0000-000000000002','6d200000-0000-0000-0000-000000000003','6d400000-0000-0000-0000-000000000001',
     '6d400000-0000-0000-0000-000000000002','6d300000-0000-0000-0000-000000000001','6d300000-0000-0000-0000-000000000003','6d500000-0000-0000-0000-000000000001')) = 8);
SELECT gm.ok('R2 sin canceladas, sin "resuelto" y sin confirmadas de hace más de 180 días',
  (SELECT count(*) FROM public.my_open_reservations('6d100000-0000-0000-0000-00000000000a') WHERE source_id IN
    ('6d200000-0000-0000-0000-000000000004','6d500000-0000-0000-0000-000000000002','6d200000-0000-0000-0000-000000000006')) = 0);
SELECT gm.ok('R3 con el viaje no trae las de otro viaje; sin viaje sí', (SELECT count(*) FROM public.my_open_reservations('6d100000-0000-0000-0000-00000000000a') WHERE source_id = '6d300000-0000-0000-0000-000000000007') = 0
  AND (SELECT count(*) FROM public.my_open_reservations(NULL) WHERE source_id = '6d300000-0000-0000-0000-000000000007') = 1);
SELECT gm.ok('R4 primero las del viaje pedido', (SELECT trip_id FROM public.my_open_reservations('6d100000-0000-0000-0000-00000000000a') LIMIT 1) = '6d100000-0000-0000-0000-00000000000a');
RESET ROLE;
DROP SCHEMA gm CASCADE;
