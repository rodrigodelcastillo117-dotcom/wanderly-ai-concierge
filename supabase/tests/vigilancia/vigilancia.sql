-- Vigilancia proactiva (migración 20261030010000_vigilancia). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS vgx CASCADE;
CREATE SCHEMA vgx;
GRANT USAGE ON SCHEMA vgx TO anon, authenticated, service_role;
CREATE FUNCTION vgx.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION vgx.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION vgx.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION vgx.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE vgx.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION vgx.v(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM vgx.r WHERE k = _k $$;
CREATE FUNCTION vgx.vuelo(_vuelo text) RETURNS public.vigilancia_vuelos LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.vigilancia_vuelos WHERE vuelo = _vuelo ORDER BY created_at LIMIT 1 $$;
CREATE FUNCTION vgx.conf(_id text) RETURNS public.vigilancia_confirmaciones LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.vigilancia_confirmaciones WHERE origen_id = _id $$;
GRANT ALL ON vgx.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA vgx TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0f000000-0000-0000-0000-00000000000a', 'vg-ana@example.test', now()),
  ('0f000000-0000-0000-0000-00000000000b', 'vg-beto@example.test', now()),
  ('0f000000-0000-0000-0000-00000000000c', 'vg-admin@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email, ciudad_origen) VALUES
  ('0f000000-0000-0000-0000-00000000000a', 'Ana Vigilada', 'vg-ana@example.test', 'Ciudad de México'),
  ('0f000000-0000-0000-0000-00000000000b', 'Beto Vigilado', 'vg-beto@example.test', 'Madrid'),
  ('0f000000-0000-0000-0000-00000000000c', 'Admin', 'vg-admin@example.test', null)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.admins (user_id) VALUES ('0f000000-0000-0000-0000-00000000000c') ON CONFLICT DO NOTHING;
INSERT INTO public.trips (id, user_id, destino, fecha_salida, fecha_regreso, vuelos_json, status) VALUES
  ('0f100000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-00000000000a', 'Madrid', current_date + 1, current_date + 8,
   jsonb_build_array(
     jsonb_build_object('numero_vuelo', 'IB 6400', 'fecha', (current_date + 1)::text, 'hora_salida', '11:00', 'from_iata', 'MEX', 'to_iata', 'MAD', 'desde_pdf', true),
     jsonb_build_object('numero_vuelo', 'AM 1', 'fecha', (current_date + 1)::text, 'desde_pdf', false),
     jsonb_build_object('numero_vuelo', 'AM 2', 'fecha', (current_date + 30)::text, 'desde_pdf', true)), 'planeado'),
  ('0f100000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-00000000000a', 'Lima', current_date + 1, current_date + 3,
   jsonb_build_array(jsonb_build_object('numero_vuelo', 'LA 2400', 'fecha', (current_date + 1)::text, 'desde_pdf', true)), 'cancelado');
INSERT INTO public.tracked_flights (user_id, flight, flight_date, route, active) VALUES
  ('0f000000-0000-0000-0000-00000000000b', 'UX91', current_date, 'MAD-MEX', true),
  ('0f000000-0000-0000-0000-00000000000b', 'UX99', current_date + 10, 'MAD-MEX', true);

-- ═══ Bandera y configuración ═══
SELECT vgx.ok('V1 bandera vigilancia_enabled encendida y configuración por omisión (30 búsquedas/día, 3 avisos/día, 8–21 h)',
  (SELECT value = 'true'::jsonb FROM public.app_flags WHERE key = 'vigilancia_enabled')
  AND (SELECT serp_tope_diario = 30 AND avisos_tope_diario = 3 AND hora_desde = 8 AND hora_hasta = 21 AND NOT incidente_por_puerta FROM public.vigilancia_config));

SET ROLE service_role; SELECT vgx.as_service();
-- ═══ Candidatos ═══
INSERT INTO vgx.r SELECT 'cand', public.vigilancia_candidatos_vuelo(current_date - 1, current_date + 2);
SELECT vgx.ok('V2 candidatos: el seguimiento (UX91) y el vuelo leído del itinerario (IB 6400); no lo no leído, lo lejano ni el viaje cancelado',
  (SELECT count(*) FROM jsonb_array_elements(vgx.v('cand')) x WHERE x->>'vuelo' IN ('UX91', 'IB 6400')) = 2
  AND jsonb_array_length(vgx.v('cand')) = 2, vgx.v('cand')::text);

-- ═══ Alta ═══
INSERT INTO vgx.r SELECT 'up', to_jsonb(public.vigilancia_vuelo_upsert(jsonb_build_array(
    jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'trip_id', '0f100000-0000-0000-0000-000000000001', 'vuelo', 'IB6400',
      'fecha', current_date + 1, 'origen', 'MEX', 'destino', 'MAD', 'fuente', 'viaje', 'zona_origen', 'America/Mexico_City',
      'salida_at', now() + interval '20 hours', 'salida_exacta', true, 'proxima_revision_at', now() - interval '1 minute'),
    jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000b', 'vuelo', 'UX91', 'fecha', current_date, 'origen', 'MAD', 'destino', 'MEX',
      'fuente', 'seguimiento', 'salida_at', now() + interval '3 hours', 'salida_exacta', false, 'proxima_revision_at', now() - interval '1 minute'),
    jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000b', 'vuelo', 'no es vuelo', 'fecha', current_date, 'fuente', 'seguimiento'))));
SELECT vgx.ok('V3 alta: válidas se guardan, una basura se descarta sin tumbar las demás',
  vgx.v('up') = '2'::jsonb AND (SELECT count(*) FROM public.vigilancia_vuelos) = 2,
  vgx.v('up')::text || ' / ' || (SELECT string_agg(vuelo, ',') FROM public.vigilancia_vuelos));
SELECT public.vigilancia_vuelo_upsert(jsonb_build_array(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'vuelo', 'IB6400',
  'fecha', current_date + 1, 'fuente', 'seguimiento', 'salida_at', now() + interval '99 hours', 'salida_exacta', false)));
SELECT vgx.ok('V4 alta idempotente: no duplica ni pisa la salida exacta, el viaje ni la fuente "viaje"',
  (SELECT count(*) FROM public.vigilancia_vuelos WHERE vuelo = 'IB6400') = 1 AND (vgx.vuelo('IB6400')).salida_exacta
  AND (vgx.vuelo('IB6400')).salida_at < now() + interval '21 hours' AND (vgx.vuelo('IB6400')).fuente = 'viaje'
  AND (vgx.vuelo('IB6400')).trip_id = '0f100000-0000-0000-0000-000000000001');

-- ═══ Reclamo y cupo ═══
INSERT INTO vgx.r SELECT 'c1', public.vigilancia_vuelos_reclamar(10, now());
SELECT vgx.ok('V5 reclamo: los dos vencidos, primero el que sale antes, con el cupo del día',
  jsonb_array_length(vgx.v('c1')->'items') = 2 AND vgx.v('c1')->'items'->0->>'vuelo' = 'UX91'
  AND (vgx.v('c1')->>'tope')::int = 30 AND (vgx.v('c1')->>'restantes')::int = 30, vgx.v('c1')::text);
SELECT vgx.ok('V6 un vuelo reclamado no lo toma otra corrida (5 min)', jsonb_array_length(public.vigilancia_vuelos_reclamar(10, now())->'items') = 0);
SELECT vgx.ok('V7 guardar: estado, próxima revisión y suelta el reclamo; columnas fuera de la lista no se tocan',
  (public.vigilancia_vuelo_guardar((vgx.vuelo('UX91')).id, jsonb_build_object('estado', jsonb_build_object('status', 'retrasado', 'banda', 2),
     'ultimo_resultado', 'ok', 'contar', true, 'proxima_revision_at', now() - interval '1 minute', 'user_id', '0f000000-0000-0000-0000-00000000000a'))->>'ok')::boolean
  AND (vgx.vuelo('UX91')).estado->>'status' = 'retrasado' AND (vgx.vuelo('UX91')).claimed_at IS NULL AND (vgx.vuelo('UX91')).revisiones = 1
  AND (vgx.vuelo('UX91')).user_id = '0f000000-0000-0000-0000-00000000000b');
INSERT INTO public.ai_usage_log (user_id, function, provider, model, searches) VALUES (NULL, 'vigilancia-cron', 'serpapi', 'google', 30);
INSERT INTO vgx.r SELECT 'c2', public.vigilancia_vuelos_reclamar(10, now());
SELECT vgx.ok('V8 cupo diario agotado (ai_usage_log de vigilancia-cron): no se reclama nada y lo dice (sin_cupo)',
  jsonb_array_length(vgx.v('c2')->'items') = 0 AND (vgx.v('c2')->>'sin_cupo')::boolean AND (vgx.v('c2')->>'restantes')::int = 0, vgx.v('c2')::text);
DELETE FROM public.ai_usage_log WHERE function = 'vigilancia-cron';
RESET ROLE;
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'vigilancia_enabled';
SET ROLE service_role; SELECT vgx.as_service();
SELECT vgx.ok('V9 apagada: no reclama vuelos ni crea confirmaciones', (public.vigilancia_vuelos_reclamar(10, now())->>'apagado')::boolean
  AND public.vigilancia_confirmaciones_sync(now()) = 0 AND (public.vigilancia_cfg()->>'enabled')::boolean = false);
RESET ROLE;
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'vigilancia_enabled';
UPDATE public.vigilancia_vuelos SET fecha = current_date - 3 WHERE vuelo = 'UX91';
SET ROLE service_role; SELECT vgx.as_service();
SELECT public.vigilancia_vuelos_reclamar(10, now());
SELECT vgx.ok('V10 lo que ya pasó (más de 2 días) deja de vigilarse', NOT (vgx.vuelo('UX91')).activo AND (vgx.vuelo('UX91')).fin_motivo = 'fecha pasada');

-- ═══ Bitácora y avisos ═══
INSERT INTO vgx.r SELECT 'e1', public.vigilancia_evento(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'trip_id', '0f100000-0000-0000-0000-000000000001',
  'ambito', 'vuelo', 'tipo', 'vuelo_cancelado', 'clave', 'vuelo:x:cancelado', 'resumen', 'IB6400 cancelado', 'visible_viajero', true));
INSERT INTO vgx.r SELECT 'e2', public.vigilancia_evento(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'ambito', 'vuelo', 'tipo', 'vuelo_cancelado',
  'clave', 'vuelo:x:cancelado', 'resumen', 'otra vez'));
SELECT vgx.ok('V11 bitácora idempotente por clave', (vgx.v('e1')->>'created')::boolean AND NOT (vgx.v('e2')->>'created')::boolean
  AND (SELECT count(*) FROM public.vigilancia_eventos WHERE clave = 'vuelo:x:cancelado') = 1, vgx.v('e1')::text || vgx.v('e2')::text);
SELECT vgx.ok('V12 evento sin persona solo del sistema; el resto se rechaza',
  (public.vigilancia_evento(jsonb_build_object('ambito', 'sistema', 'tipo', 'sin_cupo', 'clave', 'sin_cupo:hoy', 'resumen', 'Se acabó el cupo'))->>'created')::boolean
  AND public.vigilancia_evento(jsonb_build_object('ambito', 'vuelo', 'tipo', 'vuelo_cancelado', 'clave', 'vuelo:sin-user', 'resumen', 'x'))->>'code' = 'INVALID');
SELECT vgx.ok('V13 aviso una sola vez por clave; URL solo interna',
  (public.vigilancia_aviso_encolar(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'clave', 'aviso:docs:1', 'tipo', 'documentos',
     'titulo', 'Agrega tu pasaporte', 'cuerpo', 'Tu viaje sale pronto', 'url', '/dashboard/beneficios'))->>'created')::boolean
  AND NOT (public.vigilancia_aviso_encolar(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'clave', 'aviso:docs:1', 'tipo', 'documentos',
     'titulo', 'Agrega tu pasaporte', 'cuerpo', 'Otra vez'))->>'created')::boolean
  AND public.vigilancia_aviso_encolar(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'clave', 'aviso:malo:1', 'tipo', 'documentos',
     'titulo', 'x x x', 'cuerpo', 'y y y', 'url', 'https://phishing.example'))->>'code' = 'INVALID');
SELECT public.vigilancia_aviso_encolar(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'clave', 'aviso:vuelo:urg', 'tipo', 'vuelo',
  'titulo', 'Vuelo cancelado', 'cuerpo', 'Tu vuelo aparece cancelado', 'urgente', true));
INSERT INTO vgx.r SELECT 'av1', public.vigilancia_avisos_reclamar(10, now());
SELECT vgx.ok('V14 reclamo de avisos: urgentes primero, con los no urgentes enviados en 24 h; no se toman dos veces',
  jsonb_array_length(vgx.v('av1')) = 2 AND vgx.v('av1')->0->>'clave' = 'aviso:vuelo:urg' AND (vgx.v('av1')->0->>'enviados_24h')::int = 0
  AND jsonb_array_length(public.vigilancia_avisos_reclamar(10, now())) = 0, vgx.v('av1')::text);
SELECT public.vigilancia_aviso_cerrar((vgx.v('av1')->0->>'id')::uuid, 'enviado', '[{"canal":"push","ok":true}]'::jsonb);
SELECT public.vigilancia_aviso_cerrar((vgx.v('av1')->1->>'id')::uuid, 'pendiente', NULL, now() + interval '5 hours');
SELECT vgx.ok('V15 cerrar: enviado con canales; reprogramado vuelve a pendiente a su hora',
  (SELECT estado = 'enviado' AND enviado_at IS NOT NULL AND canales->0->>'canal' = 'push' FROM public.vigilancia_avisos WHERE clave = 'aviso:vuelo:urg')
  AND (SELECT estado = 'pendiente' AND programado_para > now() + interval '4 hours' FROM public.vigilancia_avisos WHERE clave = 'aviso:docs:1')
  AND public.vigilancia_aviso_cerrar((vgx.v('av1')->0->>'id')::uuid, 'inventado')->>'code' = 'BAD_STATUS');

-- ═══ Viajes en ventana (avisos de viaje) ═══
RESET ROLE;
INSERT INTO public.vault_items (user_id, section, kind, title, country_code, expires_on, number)
VALUES ('0f000000-0000-0000-0000-00000000000a', 'documento', 'pasaporte', 'Pasaporte', 'MX', current_date + 100, 'G12345678');
SET ROLE service_role; SELECT vgx.as_service();
INSERT INTO vgx.r SELECT 'win', public.vigilancia_viajes_ventana(now(), 50);
SELECT vgx.ok('V16 viajes en ventana: el de Madrid con su vuelo y documentos SIN número; no el cancelado',
  jsonb_array_length(vgx.v('win')) = 1 AND vgx.v('win')->0->>'destino' = 'Madrid'
  AND jsonb_array_length(vgx.v('win')->0->'vuelos') = 1 AND vgx.v('win')->0->'documentos'->0->>'kind' = 'pasaporte'
  AND NOT (vgx.v('win')::text LIKE '%G12345678%'), left(vgx.v('win')::text, 400));

-- ═══ Confirmaciones ═══
RESET ROLE;
ALTER TABLE public.ai_reservations DISABLE TRIGGER USER; -- solo para sembrar reservas ya confirmadas (fixture)
INSERT INTO public.ai_reservations (id, user_id, ref_code, reply_token, venue_name, venue_timezone, requested_local, requested_for, party_size, customer_name,
  venue_email, venue_email_source, status, trip_id, confirmation) SELECT x.id::uuid, x.user_id::uuid, x.ref_code, x.reply_token, x.venue_name, x.venue_timezone,
  x.requested_local, x.requested_for, x.party_size, x.customer_name, x.venue_email, x.venue_email_source::jsonb, x.status, x.trip_id::uuid, '{"channel":"venue_email","inbound_email_id":"em_123","quote":"Confirmado","verified_sender":true}'::jsonb FROM (VALUES
  ('0f200000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-00000000000a', 'R-VIG001', repeat('1', 24), 'Casa Lucio', 'Europe/Madrid', '2026-11-02T21:30',
   now() + interval '30 hours', 4, 'Ana Vigilada', 'reservas@casalucio.es', '{"url":"https://casalucio.es/contacto","quote":"reservas@casalucio.es"}', 'confirmed',
   '0f100000-0000-0000-0000-000000000001'),
  ('0f200000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-00000000000a', 'R-VIG002', repeat('2', 24), 'Sin Fuente', 'Europe/Madrid', '2026-11-02T20:00',
   now() + interval '30 hours', 2, 'Ana Vigilada', 'a@sinfuente.es', NULL, 'confirmed', NULL),
  ('0f200000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-00000000000a', 'R-VIG003', repeat('3', 24), 'Muy Lejos', 'Europe/Madrid', '2026-11-20T20:00',
   now() + interval '10 days', 2, 'Ana Vigilada', 'a@lejos.es', '{"url":"https://lejos.es"}', 'confirmed', NULL)) x(id, user_id, ref_code, reply_token,
   venue_name, venue_timezone, requested_local, requested_for, party_size, customer_name, venue_email, venue_email_source, status, trip_id);
ALTER TABLE public.ai_reservations ENABLE TRIGGER USER;
INSERT INTO public.bookings (id, user_id, category, provider, title, start_at, raw_payload) VALUES
  ('0f300000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-00000000000a', 'car', 'Traslados Sol', 'Aeropuerto → hotel', now() + interval '26 hours',
   '{"contacto_proveedor":{"tipo":"traslado","correo":"reservas@trasladossol.mx","fuente":{"kind":"sitio_oficial","url":"https://trasladossol.mx/contacto"},"zona_horaria":"America/Cancun","idioma":"es"}}'),
  ('0f300000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-00000000000a', 'car', 'Sin Contacto', 'x', now() + interval '26 hours', '{}');
SET ROLE service_role; SELECT vgx.as_service();
INSERT INTO vgx.r SELECT 's1', to_jsonb(public.vigilancia_confirmaciones_sync(now()));
INSERT INTO vgx.r SELECT 's2', to_jsonb(public.vigilancia_confirmaciones_sync(now()));
SELECT vgx.ok('V17 confirmaciones: solo proveedores conocidos con correo CON fuente y dentro de 48 h (mesa de Reservas IA y traslado con contacto)',
  vgx.v('s1') = '2'::jsonb AND vgx.v('s2') = '0'::jsonb AND (vgx.conf('0f200000-0000-0000-0000-000000000001')).tipo = 'restaurante'
  AND (vgx.conf('0f300000-0000-0000-0000-000000000001')).tipo = 'traslado' AND (vgx.conf('0f200000-0000-0000-0000-000000000002')).id IS NULL,
  vgx.v('s1')::text || '/' || vgx.v('s2')::text);
RESET ROLE;
SELECT vgx.ok('V18 un correo sin fuente no se puede guardar (CHECK)', vgx.err($q$INSERT INTO public.vigilancia_confirmaciones (user_id, origen, origen_id, tipo, proveedor, correo, fuente, servicio_at)
  VALUES ('0f000000-0000-0000-0000-00000000000a', 'booking', 'zz', 'tour', 'Tour X', 'x@tour.com', '{"kind":"adivinado"}', now() + interval '1 day')$q$) LIKE '23514%');
SET ROLE service_role; SELECT vgx.as_service();
INSERT INTO vgx.r SELECT 'pend', public.vigilancia_confirmaciones_pendientes(now(), 50);
SELECT vgx.ok('V19 pendientes: con consentimiento (apagado por omisión) y token para el Reply-To',
  jsonb_array_length(vgx.v('pend')) = 2 AND NOT (vgx.v('pend')->0->>'consentimiento')::boolean AND length(vgx.v('pend')->0->>'reply_token') = 24);
SELECT vgx.ok('V20 sin consentimiento la base NO deja enviar (SIN_CONSENTIMIENTO) y lo anota',
  public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"enviando"}')->>'code' = 'SIN_CONSENTIMIENTO'
  AND (vgx.conf('0f300000-0000-0000-0000-000000000001')).estado = 'sin_consentimiento');

-- ═══ Preferencia del viajero ═══
RESET ROLE;
SET ROLE authenticated; SELECT vgx.as_user('0f000000-0000-0000-0000-00000000000a');
SELECT vgx.ok('V21 preferencia apagada por omisión', (public.my_vigilancia_prefs()->>'contactar_proveedores')::boolean = false);
INSERT INTO vgx.r SELECT 'ps', public.my_vigilancia_prefs_set(true, 'IATOS puede escribir a mis proveedores en mi nombre para reconfirmar mis reservas.');
SELECT vgx.ok('V22 el viajero la enciende con el texto que aceptó; solo ve la suya',
  (vgx.v('ps')->>'ok')::boolean
  AND (public.my_vigilancia_prefs()->>'contactar_proveedores')::boolean
  AND (SELECT count(*) FROM public.vigilancia_preferencias) = 1);
SELECT vgx.as_user('0f000000-0000-0000-0000-00000000000b');
SELECT vgx.ok('V23 otra persona no ve la preferencia ajena (RLS) y la suya sigue apagada',
  (SELECT count(*) FROM public.vigilancia_preferencias) = 0 AND (public.my_vigilancia_prefs()->>'contactar_proveedores')::boolean = false);
RESET ROLE;
SET ROLE service_role; SELECT vgx.as_service();
SELECT public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"programada"}');
SELECT vgx.ok('V24 con consentimiento: enviando → enviada; un segundo "enviando" no pasa (sin dobles)',
  (public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"enviando"}')->>'ok')::boolean
  AND public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"enviando"}')->>'code' = 'ESTADO'
  AND (public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"enviada","provider_message_id":"re_1"}')->>'ok')::boolean
  AND (vgx.conf('0f300000-0000-0000-0000-000000000001')).enviada_at IS NOT NULL);
SELECT vgx.ok('V25 por token: la encuentra (sin exponer el token); un token raro no',
  public.vigilancia_confirmacion_por_token((vgx.conf('0f300000-0000-0000-0000-000000000001')).reply_token)->>'proveedor' = 'Traslados Sol'
  AND NOT (public.vigilancia_confirmacion_por_token((vgx.conf('0f300000-0000-0000-0000-000000000001')).reply_token) ? 'reply_token')
  AND public.vigilancia_confirmacion_por_token('x'' OR 1=1 --') IS NULL);
SELECT public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id, '{"estado":"confirmada","respuesta_resultado":"confirma"}');
SELECT vgx.ok('V26 una confirmación respondida no vuelve atrás', public.vigilancia_confirmacion_actualizar((vgx.conf('0f300000-0000-0000-0000-000000000001')).id,
  '{"estado":"programada"}')->>'code' = 'ESTADO' AND (vgx.conf('0f300000-0000-0000-0000-000000000001')).estado = 'confirmada');
SELECT public.vigilancia_confirmacion_actualizar((vgx.conf('0f200000-0000-0000-0000-000000000001')).id, '{"estado":"programada"}');
RESET ROLE;
SET ROLE authenticated; SELECT vgx.as_user('0f000000-0000-0000-0000-00000000000a');
SELECT public.my_vigilancia_prefs_set(false);
RESET ROLE;
SELECT vgx.ok('V27 si el viajero la apaga, lo programado ya no sale', (vgx.conf('0f200000-0000-0000-0000-000000000001')).estado = 'sin_consentimiento'
  AND (SELECT texto_aceptado IS NULL FROM public.vigilancia_preferencias WHERE user_id = '0f000000-0000-0000-0000-00000000000a'));

-- ═══ Lo que ve el viajero (RLS) ═══
SET ROLE authenticated; SELECT vgx.as_user('0f000000-0000-0000-0000-00000000000a');
SELECT vgx.ok('V28 el viajero ve sus vuelos vigilados y solo sus eventos visibles; ni avisos ni confirmaciones ajenas',
  (SELECT count(*) FROM public.vigilancia_vuelos) = 1 AND (SELECT count(*) FROM public.vigilancia_eventos) = 1
  AND vgx.err('SELECT * FROM public.vigilancia_confirmaciones') LIKE '42501%' AND vgx.err('SELECT * FROM public.vigilancia_avisos') LIKE '42501%');
SELECT vgx.ok('V29 el viajero no escribe en las tablas ni llama funciones del servidor',
  vgx.err($q$UPDATE public.vigilancia_vuelos SET activo = false$q$) LIKE '42501%'
  AND vgx.err($q$SELECT public.vigilancia_evento('{}'::jsonb)$q$) LIKE '42501%'
  AND vgx.err($q$SELECT public.vigilancia_confirmacion_actualizar(gen_random_uuid(), '{"estado":"enviando"}')$q$) LIKE '42501%'
  AND vgx.err($q$SELECT public.vigilancia_vuelos_reclamar(5, now())$q$) LIKE '42501%');
SELECT vgx.ok('V30 la Mesa (resumen de vigilancia) es solo para administradores', vgx.err('SELECT public.admin_vigilancia_resumen()') LIKE '42501%');
SELECT vgx.as_user('0f000000-0000-0000-0000-00000000000c');
INSERT INTO vgx.r SELECT 'mesa', public.admin_vigilancia_resumen();
SELECT vgx.ok('V31 administrador: vuelos vigilados con viajero y ruta, confirmaciones, eventos recientes y cupo del día',
  jsonb_array_length(vgx.v('mesa')->'vuelos') >= 1 AND vgx.v('mesa')->'vuelos'->0 ? 'ruta' AND jsonb_array_length(vgx.v('mesa')->'confirmaciones') = 2
  AND jsonb_array_length(vgx.v('mesa')->'eventos') >= 2 AND (vgx.v('mesa')->'cupo'->>'tope')::int = 30 AND (vgx.v('mesa')->>'enabled')::boolean,
  left(vgx.v('mesa')::text, 400));
RESET ROLE;
SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false), set_config('request.jwt.claim.sub', '', false);
SELECT vgx.ok('V32 anónimo: nada', vgx.err('SELECT public.my_vigilancia_prefs()') LIKE '42501%' AND vgx.err('SELECT * FROM public.vigilancia_vuelos') LIKE '42501%');
RESET ROLE;

-- ═══ Eventos del viaje (línea base de alertas) ═══
SET ROLE service_role; SELECT vgx.as_service();
SELECT public.vigilancia_evento(jsonb_build_object('user_id', '0f000000-0000-0000-0000-00000000000a', 'trip_id', '0f100000-0000-0000-0000-000000000001',
  'ambito', 'aviso', 'tipo', 'seguridad_linea_base', 'clave', 'seguridad:t1:govuk:abc', 'resumen', 'GOV.UK nivel 1', 'datos', '{"fuente":"govuk","nivel":1,"firma":"govuk|1|x"}'::jsonb));
SELECT vgx.ok('V33 historial del viaje por ámbito (línea base de alertas oficiales)',
  public.vigilancia_eventos_trip('0f100000-0000-0000-0000-000000000001', 'aviso', 10)->0->'datos'->>'firma' = 'govuk|1|x'
  AND jsonb_array_length(public.vigilancia_eventos_trip('0f100000-0000-0000-0000-000000000001', 'vuelo', 10)) = 1);
RESET ROLE;
SELECT vgx.ok('V34 toda función nueva fija search_path y ninguna la ejecuta PUBLIC',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'vigilancia%' OR p.proname IN ('my_vigilancia_prefs', 'my_vigilancia_prefs_set', 'admin_vigilancia_resumen'))
      AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
        OR (n.nspname = 'public' AND p.proname LIKE 'vigilancia%' AND has_function_privilege('anon', p.oid, 'EXECUTE'))));
DROP SCHEMA vgx CASCADE;
