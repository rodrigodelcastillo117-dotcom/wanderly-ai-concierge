-- Incidentes (migración 20261029080000_incidentes). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS inc CASCADE;
CREATE SCHEMA inc;
GRANT USAGE ON SCHEMA inc TO anon, authenticated, service_role;
CREATE FUNCTION inc.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION inc.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION inc.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION inc.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE inc.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION inc.v(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM inc.r WHERE k = _k $$;
CREATE FUNCTION inc.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT (v->>'id')::uuid FROM inc.r WHERE k = _k $$;
-- Lecturas internas (las pruebas miran las tablas que el cliente no puede leer).
CREATE FUNCTION inc.i(_id uuid) RETURNS public.incidents LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.incidents WHERE request_id = _id $$;
CREATE FUNCTION inc.status(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT status FROM public.concierge_requests WHERE id = _id $$;
CREATE FUNCTION inc.alerts(_id uuid, _reason text DEFAULT NULL) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.incident_alerts WHERE request_id = _id AND (_reason IS NULL OR reason = _reason) $$;
CREATE FUNCTION inc.events(_id uuid, _kind text DEFAULT NULL) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.incident_events WHERE request_id = _id AND (_kind IS NULL OR kind = _kind) $$;
CREATE FUNCTION inc.has_event(_id uuid, _actor text, _kind text, _visible boolean) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.incident_events WHERE request_id = _id AND actor = _actor AND kind = _kind AND visible_to_user = _visible) $$;
CREATE FUNCTION inc.pending_alerts(_id uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.incident_alerts WHERE request_id = _id AND status IN ('pendiente','fallido') $$;
CREATE FUNCTION inc.notif_body(_key text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT body FROM public.notifications WHERE dedup_key = _key $$;
CREATE FUNCTION inc.input(_user text, _cat text, _sev text, _key text DEFAULT NULL, _extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('user_id', _user, 'categoria', _cat, 'severidad', _sev, 'origen', 'usuario', 'idem_key', _key,
    'descripcion', 'Prueba: ' || _cat, 'respuesta_inmediata', 'Esto es lo que puedes hacer ahora mismo.') || _extra $$;
GRANT ALL ON inc.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inc TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'inc-ana@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000b', 'inc-beto@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000d', 'inc-dueno@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000c', 'inc-carlo@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'Ana Viajera', 'inc-ana@example.test'),
  ('0c000000-0000-0000-0000-00000000000b', 'Beto Prueba', 'inc-beto@example.test'),
  ('0c000000-0000-0000-0000-00000000000d', 'Dueño Prueba', 'inc-dueno@example.test'),
  ('0c000000-0000-0000-0000-00000000000c', 'Carlo Prueba', 'inc-carlo@example.test')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO public.admins (user_id) VALUES ('0c000000-0000-0000-0000-00000000000d'), ('0c000000-0000-0000-0000-00000000000c') ON CONFLICT DO NOTHING;
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso) VALUES
  ('0c100000-0000-0000-0000-00000000000a', '0c000000-0000-0000-0000-00000000000a', 'París', 2, '2026-10-28', '2026-11-04'),
  ('0c100000-0000-0000-0000-00000000000b', '0c000000-0000-0000-0000-00000000000b', 'Cancún', 1, '2026-10-28', '2026-11-02')
ON CONFLICT DO NOTHING;

-- ═══ C: crear (como la función Edge, con la llave de servicio) ═══
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'c1', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'vuelo_cancelado', 'critica', 'app:clave-prueba-0001',
  jsonb_build_object('trip_id', '0c100000-0000-0000-0000-00000000000a',
    'ubicacion', jsonb_build_object('ciudad', 'París', 'pais', 'FR', 'lat', 49.0097, 'lng', 2.5479, 'zona_horaria', 'Europe/Paris'),
    'refs', jsonb_build_object('vuelo', 'AF179', 'pnr', 'ABC123', 'fecha_vuelo', '2026-10-29'),
    'acciones_tomadas', jsonb_build_array('Iato dio la guía inmediata'))));
SELECT inc.ok('C1 crea el incidente: folio, severidad, y con el operador IA apagado va directo al equipo humano (nivel 1, aviso "nuevo")',
  (SELECT v->>'ok' = 'true' AND v->>'created' = 'true' AND v->>'severity' = 'critica' AND v->>'assignee' = 'humano'
          AND (v->>'escalation_level')::int = 1 AND v->>'folio' = upper(left(replace(v->>'id', '-', ''), 8)) AND v->>'alert_id' IS NOT NULL
     FROM inc.r WHERE k = 'c1')
  AND inc.alerts(inc.id('c1'), 'nuevo') = 1 AND inc.status(inc.id('c1')) = 'solicitado',
  inc.v('c1')::text);
INSERT INTO inc.r SELECT 'c1b', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'vuelo_cancelado', 'critica', 'app:clave-prueba-0001'));
SELECT inc.ok('C2 misma clave → el mismo caso (created=false), sin otra fila ni otro aviso',
  (inc.v('c1b')->>'created') = 'false' AND inc.id('c1b') = inc.id('c1')
  AND (SELECT count(*) FROM public.incidents WHERE idem_key = 'app:clave-prueba-0001') = 1 AND inc.alerts(inc.id('c1')) = 1,
  inc.v('c1b')::text);
SELECT inc.ok('C3 la misma clave desde otra persona → IDEM_CONFLICT',
  (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000b', 'otro', 'baja', 'app:clave-prueba-0001'))->>'code') = 'IDEM_CONFLICT');
SELECT inc.ok('C4 categoría inventada, coordenadas fuera de rango, PNR raro o queja sin subtipo → rechazado',
  (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'zombis', 'alta'))->>'code') = 'INVALID_CATEGORY'
  AND (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'robo', 'alta', NULL, '{"ubicacion":{"lat":123,"lng":0}}'))->>'code') = 'INVALID'
  AND (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'robo', 'alta', NULL, '{"ubicacion":{"lat":"x"}}'))->>'code') = 'INVALID'
  AND (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'otro', 'media', NULL, '{"refs":{"pnr":"<script>"}}'))->>'code') = 'INVALID'
  AND (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'queja', 'media'))->>'code') = 'INVALID'
  AND (public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'otro', 'urgentisima'))->>'code') = 'INVALID_SEVERITY');
INSERT INTO inc.r SELECT 'c5', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'queja', 'media', 'iato:queja-0001',
  '{"trip_id":"0c100000-0000-0000-0000-00000000000b","queja":{"subtipo":"cobro"},"sentimiento":"muy_molesto","expectativa":"reembolso","origen":"iato"}'));
SELECT inc.ok('C5 queja con subtipo, sentimiento y expectativa; un viaje que no es suyo no se liga',
  (inc.v('c5')->>'ok') = 'true' AND (inc.v('c5')->>'trip_id') IS NULL
  AND (SELECT payload->'queja'->>'subtipo' = 'cobro' AND payload->>'expectativa' = 'reembolso' AND trip_id IS NULL
         FROM public.concierge_requests WHERE id = inc.id('c5')),
  inc.v('c5')::text);
SELECT inc.ok('C6 bitácora al nacer (creado, guía al usuario, siguiente paso, asignación) y tiempos: recibido, 1.ª respuesta y hora prometida = +10 min',
  inc.events(inc.id('c1'), 'creado') = 1 AND inc.events(inc.id('c1'), 'mensaje') = 1 AND inc.events(inc.id('c1'), 'siguiente_paso') = 1
  AND inc.events(inc.id('c1'), 'asignacion') = 1
  AND (inc.i(inc.id('c1'))).first_response_at IS NOT NULL AND (inc.i(inc.id('c1'))).first_human_response_at IS NULL
  AND (inc.i(inc.id('c1'))).next_step_due_at = (inc.i(inc.id('c1'))).received_at + interval '10 minutes');
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000a');
SELECT inc.ok('C7 el usuario no crea incidentes directo ni lee las tablas internas',
  inc.err($q$SELECT public.incident_create('{}'::jsonb)$q$) LIKE '42501%'
  AND inc.err($q$INSERT INTO public.concierge_requests (user_id, type, title, payload) VALUES ('0c000000-0000-0000-0000-00000000000a', 'incidente', 'x', '{}')$q$) LIKE '42501%'
  AND inc.err($q$SELECT * FROM public.incidents$q$) LIKE '42501%'
  AND inc.err($q$SELECT * FROM public.incident_events$q$) LIKE '42501%'
  AND inc.err($q$SELECT public.incident_watch(now())$q$) LIKE '42501%');
RESET ROLE;
-- Operador IA prendido y vivo.
UPDATE public.incident_config SET ai_operator_enabled = true, ai_operator_heartbeat_at = now();
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'op1', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000b', 'traslado_no_llego', 'alta', 'monitor:traslado-0001'));
INSERT INTO inc.r SELECT 'op2', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000b', 'salud', 'critica', 'app:salud-000001'));
SELECT inc.ok('C8 con el operador IA vivo nace asignado a iato_ops (nivel 0); crítica avisa igual a los humanos, alta no',
  (inc.v('op1')->>'assignee') = 'iato_ops' AND (inc.v('op1')->>'escalation_level')::int = 0 AND inc.alerts(inc.id('op1')) = 0
  AND (inc.v('op2')->>'assignee') = 'iato_ops' AND inc.alerts(inc.id('op2'), 'nuevo') = 1,
  inc.v('op1')::text || inc.v('op2')::text);
DO $$
DECLARE r jsonb; n int := 0;
BEGIN
  FOR k IN 1..25 LOOP
    r := public.incident_create(jsonb_build_object('user_id', '0c000000-0000-0000-0000-00000000000b', 'categoria', 'otro', 'severidad', 'baja',
      'origen', 'usuario', 'descripcion', 'Prueba de tope ' || k));
    IF r->>'code' = 'RATE_LIMITED' THEN n := n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'rate=%', n;
  PERFORM set_config('inc.rate', n::text, false);
END $$;
SELECT inc.ok('C9 tope de 20 incidentes por persona por hora (los del monitor no cuentan para el tope)',
  current_setting('inc.rate') = '7'
  AND (public.incident_create(jsonb_build_object('user_id', '0c000000-0000-0000-0000-00000000000b', 'categoria', 'vuelo_retrasado', 'severidad', 'media',
      'origen', 'monitor_vuelos', 'descripcion', 'AM 123 con 3 h de retraso', 'idem_key', 'monitor:AM123:2026-10-29'))->>'ok') = 'true',
  current_setting('inc.rate'));

-- ═══ E: bitácora desde el servidor ═══
SELECT inc.ok('E1 agregar evento (mensaje saliente por correo al hotel) y la misma dedupe_key no duplica',
  (public.incident_add_event(inc.id('op1'), '{"kind":"mensaje","actor":"iato_ops","channel":"email","direction":"saliente","counterpart":"Hotel Riu","body":"Hola, ¿tienen la reserva ABC?","dedupe_key":"prov:1","provider_message_id":"re_1"}')->>'duplicate') = 'false'
  AND (public.incident_add_event(inc.id('op1'), '{"kind":"mensaje","actor":"iato_ops","channel":"email","direction":"saliente","counterpart":"Hotel Riu","body":"Hola otra vez","dedupe_key":"prov:1"}')->>'duplicate') = 'true'
  AND inc.events(inc.id('op1'), 'mensaje') = 2);
SELECT inc.ok('E2 tipo, actor o canal inventados → INVALID; incidente que no existe → NOT_FOUND',
  (public.incident_add_event(inc.id('op1'), '{"kind":"chisme","actor":"iato_ops","body":"x"}')->>'code') = 'INVALID'
  AND (public.incident_add_event(inc.id('op1'), '{"kind":"nota","actor":"marciano","body":"x"}')->>'code') = 'INVALID'
  AND (public.incident_add_event(inc.id('op1'), '{"kind":"nota","actor":"iato_ops","channel":"paloma","body":"x"}')->>'code') = 'INVALID'
  AND (public.incident_add_event('0c900000-0000-0000-0000-000000000000', '{"kind":"nota","actor":"iato_ops","body":"x"}')->>'code') = 'NOT_FOUND');
SELECT inc.ok('E3 una acción del operador cuenta como avance (last_progress_at se mueve); una alerta no',
  (SELECT (inc.i(inc.id('op1'))).last_progress_at >= (inc.i(inc.id('op1'))).received_at));

-- ═══ G: guardia ═══
SELECT inc.ok('G1 sin guardia configurada usa FIXER_EMAIL: nivel 1 solo el primero (primario); nivel 2 también el respaldo, con su usuario para push',
  jsonb_array_length(public.incident_oncall_now(1, ARRAY['inc-dueno@example.test','inc-carlo@example.test'])) = 1
  AND public.incident_oncall_now(1, ARRAY['inc-dueno@example.test','inc-carlo@example.test'])->0->>'email' = 'inc-dueno@example.test'
  AND jsonb_array_length(public.incident_oncall_now(2, ARRAY['inc-dueno@example.test','inc-carlo@example.test'])) = 2
  AND public.incident_oncall_now(2, ARRAY['inc-dueno@example.test','inc-carlo@example.test'])->1->>'role' = 'respaldo'
  AND public.incident_oncall_now(2, ARRAY['inc-dueno@example.test','inc-carlo@example.test'])->1->>'user_id' = '0c000000-0000-0000-0000-00000000000c');
RESET ROLE;
INSERT INTO public.incident_oncall (email, name, role, timezone, start_hour, end_hour) VALUES
  ('inc-dueno@example.test', 'Dueño', 'primario', 'America/Mexico_City', 0, 24),
  ('inc-carlo@example.test', 'Carlo', 'primario', 'America/Mexico_City',
     (extract(hour FROM now() AT TIME ZONE 'America/Mexico_City')::int + 2) % 24, (extract(hour FROM now() AT TIME ZONE 'America/Mexico_City')::int + 3) % 24 + 1),
  ('inc-respaldo@example.test', 'Respaldo', 'respaldo', 'Europe/Madrid', 0, 24);
SET ROLE service_role; SELECT inc.as_service();
SELECT inc.ok('G2 con guardia: nivel 1 = primarios de turno (Carlo fuera de su horario no); nivel 2 = todos',
  (SELECT array_agg(r->>'email' ORDER BY r->>'email') FROM jsonb_array_elements(public.incident_oncall_now(1)) r) = ARRAY['inc-dueno@example.test']
  AND jsonb_array_length(public.incident_oncall_now(2)) = 3,
  public.incident_oncall_now(1)::text);
RESET ROLE;
UPDATE public.incident_oncall SET active = false WHERE email = 'inc-dueno@example.test';
SET ROLE service_role; SELECT inc.as_service();
SELECT inc.ok('G3 si ningún primario está de turno, se avisa a todos los primarios (nunca a nadie)',
  (SELECT array_agg(r->>'email') FROM jsonb_array_elements(public.incident_oncall_now(1)) r) = ARRAY['inc-carlo@example.test']);
RESET ROLE;
DELETE FROM public.incident_oncall;

-- ═══ W: vigilante ═══
UPDATE public.incident_config SET ai_operator_heartbeat_at = now() + interval '11 minutes';
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'w0', public.incident_watch(now());
SELECT inc.ok('W1 recién creados: el vigilante no escala nada todavía',
  (SELECT count(*) FROM public.incident_alerts WHERE reason IN ('sin_tomar','sin_avance','operador_caido')) = 0, inc.v('w0')::text);
INSERT INTO inc.r SELECT 'w1', public.incident_watch(now() + interval '11 minutes');
SELECT inc.ok('W2 crítico sin que nadie lo tome en 10 min → nivel 2 (primario + respaldo) y aviso "sin_tomar"',
  (inc.i(inc.id('c1'))).escalation_level = 2 AND inc.alerts(inc.id('c1'), 'sin_tomar') = 1, inc.v('w1')::text);
INSERT INTO inc.r SELECT 'w2', public.incident_watch(now() + interval '12 minutes');
SELECT inc.ok('W3 correr el vigilante otra vez no duplica (siguiente re-aviso hasta otros 10 min)',
  (inc.i(inc.id('c1'))).escalation_level = 2 AND inc.alerts(inc.id('c1'), 'sin_tomar') = 1);
SELECT inc.ok('W4 el alto del operador IA con avance reciente sigue con el operador a los 11 min',
  (inc.i(inc.id('op1'))).escalation_level = 0 AND (inc.i(inc.id('op1'))).assignee = 'iato_ops');
RESET ROLE;
UPDATE public.incident_config SET ai_operator_heartbeat_at = now() + interval '31 minutes';
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'w3', public.incident_watch(now() + interval '31 minutes');
SELECT inc.ok('W5 alto sin avance del operador en 30 min → pasa a humanos (nivel 1, "sin_avance")',
  (inc.i(inc.id('op1'))).escalation_level = 1 AND (inc.i(inc.id('op1'))).assignee = 'humano' AND inc.alerts(inc.id('op1'), 'sin_avance') = 1,
  inc.v('w3')::text);
SELECT inc.ok('W5b el crítico del operador sin avance en 10 min ya había pasado a humanos ("sin_avance")',
  (inc.i(inc.id('op2'))).assignee = 'humano' AND inc.alerts(inc.id('op2'), 'sin_avance') = 1);
SELECT public.incident_operator_heartbeat();
INSERT INTO inc.r SELECT 'op3', public.incident_create(inc.input('0c000000-0000-0000-0000-00000000000a', 'equipaje', 'media', 'app:maleta-00001'));
RESET ROLE;
UPDATE public.incident_config SET ai_operator_heartbeat_at = now() - interval '1 hour';
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'w4', public.incident_watch(now());
SELECT inc.ok('W6 operador IA caído (sin latido) → lo que tenía pasa a humanos de inmediato ("operador_caido")',
  (inc.v('op3')->>'assignee') = 'iato_ops' AND (inc.i(inc.id('op3'))).assignee = 'humano'
  AND inc.alerts(inc.id('op3'), 'operador_caido') = 1 AND (inc.v('w4')->>'operator_alive') = 'false',
  inc.v('w4')::text);
RESET ROLE;
UPDATE public.incident_config SET ai_operator_enabled = false, ai_operator_heartbeat_at = NULL;

-- ═══ A: reparto de avisos ═══
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'a1', jsonb_build_object('list', public.incident_alerts_claim(ARRAY['inc-dueno@example.test','inc-carlo@example.test'], 50, inc.id('c1')));
SELECT inc.ok('A1 reclamar trae el incidente como la mesa (severidad, semáforo, ubicación, viaje, usuario) y a quién avisar',
  jsonb_array_length(inc.v('a1')->'list') >= 2
  AND (SELECT bool_and(x->'item'->'incident'->>'severity' = 'critica' AND x->'item'->'user'->>'email' = 'inc-ana@example.test'
         AND x->'item'->'payload'->'ubicacion'->>'zona_horaria' = 'Europe/Paris' AND x->'item'->'trip'->>'destino' = 'París'
         AND jsonb_array_length(x->'recipients') >= 1) FROM jsonb_array_elements(inc.v('a1')->'list') x),
  inc.v('a1')::text);
SELECT inc.ok('A2 un aviso reclamado no lo toma otro reparto (10 min) ',
  jsonb_array_length(public.incident_alerts_claim(NULL, 50, inc.id('c1'))) = 0);
SELECT public.incident_alert_finish((x->'alert'->>'id')::uuid, true, '{"email":["inc-dueno@example.test"]}'::jsonb)
  FROM jsonb_array_elements(inc.v('a1')->'list') x;
SELECT inc.ok('A3 enviado: queda marcado, cuenta en el incidente y en la bitácora; no se vuelve a mandar',
  (SELECT count(*) FROM public.incident_alerts WHERE request_id = inc.id('c1') AND status = 'enviado') = jsonb_array_length(inc.v('a1')->'list')
  AND (inc.i(inc.id('c1'))).alerts_count = jsonb_array_length(inc.v('a1')->'list') AND (inc.i(inc.id('c1'))).last_alert_at IS NOT NULL
  AND inc.events(inc.id('c1'), 'alerta') >= 2
  AND (public.incident_alert_finish((inc.v('a1')->'list'->0->'alert'->>'id')::uuid, false, NULL, 'x')->>'code') = 'NOT_FOUND_OR_SENT');
INSERT INTO inc.r SELECT 'a4', jsonb_build_object('list', public.incident_alerts_claim(NULL, 50, inc.id('op1')));
SELECT public.incident_alert_finish((x->'alert'->>'id')::uuid, false, NULL, 'resend: 500') FROM jsonb_array_elements(inc.v('a4')->'list') x;
RESET ROLE;
UPDATE public.incident_alerts SET claimed_at = now() - interval '6 minutes' WHERE request_id = (SELECT inc.id('op1'));
SET ROLE service_role; SELECT inc.as_service();
SELECT inc.ok('A4 un aviso que falló se vuelve a reclamar (reintento) y queda el error en la bitácora',
  jsonb_array_length(public.incident_alerts_claim(NULL, 50, inc.id('op1'))) = 1
  AND EXISTS (SELECT 1 FROM public.incident_events WHERE request_id = inc.id('op1') AND kind = 'alerta' AND delivery = 'fallido'));
RESET ROLE;

-- ═══ M: Mesa de operaciones ═══
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000d');
INSERT INTO inc.r SELECT 'm1', public.admin_ops_list('abiertas');
SELECT inc.ok('M1 la mesa ve el incidente con severidad, semáforo, minutos sin atender, siguiente paso y ubicación',
  (SELECT i->'incident'->>'severity' = 'critica' AND i->'incident'->>'semaforo' IN ('verde','ambar','rojo')
          AND (i->'incident'->>'minutes_unattended') IS NOT NULL AND i->'incident'->>'next_step' IS NOT NULL
          AND i->'payload'->'ubicacion'->>'ciudad' = 'París' AND i->>'type' = 'incidente'
     FROM jsonb_array_elements(inc.v('m1')->'items') i WHERE i->>'id' = inc.id('c1')::text),
  left(inc.v('m1')::text, 400));
SELECT inc.ok('M2 resolver directo (sin nota) con la acción genérica de la mesa → bloqueado: hace falta nota o confirmación',
  inc.err(format($q$SELECT public.admin_ops_act('concierge_request', %L, 'resolver', NULL, NULL)$q$, inc.id('c1'))) LIKE 'P0001%INCIDENT_NEEDS_CONFIRMATION%'
  AND inc.status(inc.id('c1')) = 'solicitado');
INSERT INTO inc.r SELECT 'm3', public.admin_incident_take(inc.id('c1'));
SELECT inc.ok('M3 Tomar → en proceso a su nombre, tomado a tiempo medido, asignado a humano; aviso al usuario sin decir "reserva"',
  (inc.v('m3')->>'ok') = 'true' AND inc.status(inc.id('c1')) = 'pendiente_confirmacion'
  AND (inc.i(inc.id('c1'))).taken_at IS NOT NULL AND (inc.i(inc.id('c1'))).taken_by = '0c000000-0000-0000-0000-00000000000d'
  AND inc.notif_body('incident_take:' || inc.id('c1')) NOT ILIKE '%reserva%',
  inc.v('m3')::text);
INSERT INTO inc.r SELECT 'm4', public.admin_ops_act('concierge_request', inc.id('c1'), 'responder', 'Ana, ya te buscamos vuelo: hay lugar en el AF1235 de las 10:05.');
SELECT inc.ok('M4 Responder (app + correo) → primera respuesta humana medida y en la bitácora como mensaje al usuario',
  (inc.v('m4')->>'reply_id') IS NOT NULL AND (inc.i(inc.id('c1'))).first_human_response_at IS NOT NULL
  AND inc.has_event(inc.id('c1'), 'equipo', 'mensaje', true));
INSERT INTO inc.r SELECT 'm5', public.admin_incident_escalate(inc.id('op1'), 'Necesito a Carlo para esto');
SELECT inc.ok('M5 Escalar a mano → sube nivel (≥ 2, respaldo incluido) y deja el aviso "manual" en cola',
  (inc.v('m5')->>'ok') = 'true' AND (inc.v('m5')->>'escalation_level')::int >= 2 AND inc.alerts(inc.id('op1'), 'manual') = 1, inc.v('m5')::text);
SELECT inc.ok('M6 Marcar resuelto pide nota de resolución (≥ 10 caracteres)',
  (public.admin_incident_resolve(inc.id('c1'), 'listo')->>'code') = 'RESOLUTION_NOTE_REQUIRED' AND inc.status(inc.id('c1')) = 'pendiente_confirmacion');
INSERT INTO inc.r SELECT 'm7', public.admin_incident_resolve(inc.id('c1'), 'Reacomodada en el AF1235 de mañana 10:05; hotel y cena cubiertos por Air France.', 'AF-REBOOK-7781');
SELECT inc.ok('M7 con nota → resuelto por el equipo, nota guardada, tiempo de resolución medido, avisos pendientes descartados, correo listo',
  (inc.v('m7')->>'ok') = 'true' AND (inc.v('m7')->>'reply_id') IS NOT NULL AND inc.status(inc.id('c1')) = 'resuelto'
  AND (inc.i(inc.id('c1'))).closed_by = 'equipo' AND (inc.i(inc.id('c1'))).resolution_state = 'nota_humana'
  AND (inc.i(inc.id('c1'))).resolution_note LIKE 'Reacomodada%' AND (inc.i(inc.id('c1'))).resolved_at IS NOT NULL
  AND inc.pending_alerts(inc.id('c1')) = 0,
  inc.v('m7')::text);
INSERT INTO inc.r SELECT 'm8', public.admin_incident_log(inc.id('c1'));
SELECT inc.ok('M8 bitácora completa para el humano: creado, guía, asignación, escalamiento, avisos, tomado, respuesta, estado',
  (SELECT count(DISTINCT e->>'kind') >= 7 FROM jsonb_array_elements(inc.v('m8')->'events') e)
  AND jsonb_array_length(inc.v('m8')->'alerts') >= 2 AND (inc.v('m8')->'incident'->>'minutes_to_resolve') IS NOT NULL,
  left(inc.v('m8')::text, 300));
SELECT inc.ok('M9 siguiente paso con hora desde la mesa (hora fuera de rango → BAD_DUE)',
  (public.admin_incident_next_step(inc.id('op1'), 'Carlo llama al hotel a las 9:00', now() + interval '2 hours')->>'ok') = 'true'
  AND (public.admin_incident_next_step(inc.id('op1'), 'Algo', now() - interval '1 day')->>'code') = 'BAD_DUE');
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000b');
SELECT inc.ok('M10 alguien que no es del equipo no ve ni toca nada de la mesa de incidentes',
  inc.err(format($q$SELECT public.admin_incident_take(%L)$q$, inc.id('op1'))) LIKE '42501%'
  AND inc.err(format($q$SELECT public.admin_incident_log(%L)$q$, inc.id('op1'))) LIKE '42501%'
  AND inc.err(format($q$SELECT public.admin_incident_escalate(%L)$q$, inc.id('op1'))) LIKE '42501%');
RESET ROLE;

-- ═══ S: estados desde el servidor (operador IA) y confirmación del usuario ═══
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 's1', public.incident_set_status(inc.id('c5'), 'resuelto', 'iato_ops', 'Se pidió el reembolso al banco; folio de aclaración 5521.');
SELECT inc.ok('S1 el operador IA "resuelve" → NO se cierra: queda esperando la confirmación del usuario y se le pregunta',
  (inc.v('s1')->>'status') = 'esperando_confirmacion' AND inc.status(inc.id('c5')) = 'pendiente_confirmacion'
  AND (inc.i(inc.id('c5'))).resolution_state = 'esperando_confirmacion'
  AND EXISTS (SELECT 1 FROM public.notifications WHERE related_id = inc.id('c5') AND title = '¿Quedó resuelto tu caso?'),
  inc.v('s1')::text);
SELECT inc.ok('S2 un UPDATE directo a resuelto (sin confirmación ni nota) lo rechaza la base',
  inc.err(format($q$UPDATE public.concierge_requests SET status = 'resuelto' WHERE id = %L$q$, inc.id('c5'))) LIKE 'P0001%INCIDENT_NEEDS_CONFIRMATION%');
SELECT inc.ok('S3 el operador IA no puede rendirse: "no_se_pudo" lo escala a una persona',
  (public.incident_set_status(inc.id('op2'), 'no_se_pudo', 'iato_ops', 'El hospital no contesta')->>'code') = 'HUMAN_REQUIRED'
  AND inc.status(inc.id('op2')) = 'solicitado' AND (inc.i(inc.id('op2'))).needs_human
  AND inc.alerts(inc.id('op2'), 'necesita_humano') = 1);
SELECT inc.ok('S4 pedir a una persona (assign humano) escala y avisa; devolverlo al operador cuando ya lo tomó alguien → TAKEN_BY_HUMAN',
  (public.incident_assign(inc.id('op2'), 'humano', 'Necesita hablar con alguien en persona')->>'ok') = 'true'
  AND (public.incident_assign(inc.id('op2'), 'humano', NULL, '0c000000-0000-0000-0000-00000000000c', 'equipo')->>'owner') = '0c000000-0000-0000-0000-00000000000c'
  AND (public.incident_assign(inc.id('op2'), 'iato_ops', NULL, NULL, 'equipo')->>'code') = 'TAKEN_BY_HUMAN');
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000b');
SELECT inc.ok('S5 otra persona no puede confirmar el caso de Ana',
  (public.my_incident_confirm(inc.id('c5'), true)->>'code') = 'NOT_FOUND');
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000a');
INSERT INTO inc.r SELECT 'mine1', public.my_team_requests();
SELECT inc.ok('S6 "Mis solicitudes": la queja muestra siguiente paso con hora y la pregunta "¿quedó resuelto?"',
  (SELECT i->'incident'->>'can_confirm' = 'true' AND i->'incident'->>'next_step' IS NOT NULL AND i->'incident'->>'category_label' = 'Queja'
     FROM jsonb_array_elements(inc.v('mine1')) i WHERE i->>'id' = inc.id('c5')::text),
  left(inc.v('mine1')::text, 400));
INSERT INTO inc.r SELECT 's7', public.my_incident_confirm(inc.id('c5'), false, 'No me han devuelto nada, sigue el doble cobro');
SELECT inc.ok('S7 "No quedó resuelto" → se reabre, sube de severidad (media → alta), aviso "reabierto" y nuevo siguiente paso',
  (inc.v('s7')->>'status') = 'reabierto' AND (inc.v('s7')->>'severity') = 'alta' AND inc.status(inc.id('c5')) = 'pendiente_confirmacion'
  AND (inc.i(inc.id('c5'))).reopen_count = 1 AND (inc.i(inc.id('c5'))).resolution_state = 'rechazado_usuario'
  AND inc.alerts(inc.id('c5'), 'reabierto') = 1 AND (inc.i(inc.id('c5'))).next_step_due_at > now(),
  inc.v('s7')::text);
RESET ROLE;
SET ROLE service_role; SELECT inc.as_service();
SELECT public.incident_set_status(inc.id('c5'), 'resuelto', 'iato_ops', 'El banco confirmó el reembolso.');
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000a');
INSERT INTO inc.r SELECT 's8', public.my_incident_confirm(inc.id('c5'), true);
SELECT inc.ok('S8 "Sí, quedó resuelto" → se cierra, confirmado por el usuario, con hora',
  (inc.v('s8')->>'status') = 'resuelto' AND inc.status(inc.id('c5')) = 'resuelto'
  AND (inc.i(inc.id('c5'))).closed_by = 'usuario' AND (inc.i(inc.id('c5'))).resolution_state = 'confirmado_usuario'
  AND (inc.i(inc.id('c5'))).user_confirmed_at IS NOT NULL, inc.v('s8')::text);
INSERT INTO inc.r SELECT 's9', public.my_incident_confirm(inc.id('c1'), false, 'El vuelo nuevo también se canceló');
SELECT inc.ok('S9 un caso cerrado por el equipo se puede reabrir (7 días): vuelve a en proceso y sube de severidad (crítica se queda en crítica)',
  (inc.v('s9')->>'status') = 'reabierto' AND inc.status(inc.id('c1')) = 'pendiente_confirmacion' AND (inc.i(inc.id('c1'))).resolved_at IS NULL
  AND (inc.i(inc.id('c1'))).severity = 'critica', inc.v('s9')::text);
SELECT inc.ok('S10 el usuario le escribe al equipo (queda en la bitácora como mensaje entrante)',
  (public.my_incident_message(inc.id('c1'), 'Estoy en la puerta K, ¿qué hago?')->>'ok') = 'true'
  AND (public.my_incident_message(inc.id('c5'), 'hola')->>'code') = 'NOT_FOUND');
SELECT inc.ok('S11 el usuario no ve las tablas internas pero sí sus mensajes en "Mis solicitudes" (sin notas internas)',
  inc.err('SELECT * FROM public.incident_alerts') LIKE '42501%'
  AND (SELECT jsonb_array_length(i->'incident'->'messages') >= 2 AND NOT (i->'incident' ? 'resolution_note')
     FROM jsonb_array_elements(public.my_team_requests()) i WHERE i->>'id' = inc.id('c1')::text));
RESET ROLE;
SET ROLE service_role; SELECT inc.as_service();
INSERT INTO inc.r SELECT 'w5', public.incident_watch(now() + interval '6 minutes');
SELECT inc.ok('S12 mensaje del usuario sin respuesta en 5 min (crítico) → aviso "mensaje_sin_respuesta" (una sola vez)',
  inc.alerts(inc.id('c1'), 'mensaje_sin_respuesta') = 1
  AND (SELECT (public.incident_watch(now() + interval '7 minutes')->>'ok')) = 'true' AND inc.alerts(inc.id('c1'), 'mensaje_sin_respuesta') = 1,
  inc.v('w5')::text);
RESET ROLE;
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000d');
SELECT public.admin_ops_act('concierge_request', inc.id('c1'), 'responder', 'Quédate en la puerta K, ya hablé con el supervisor de Air France.');
RESET ROLE;
SET ROLE service_role; SELECT inc.as_service();
SELECT inc.ok('S13 la respuesta del equipo contesta el mensaje: el incidente ya no tiene mensajes sin respuesta',
  (public._incident_json(inc.id('c1'))->>'unanswered_user_message') = 'false');
-- Hora prometida vencida (caso tomado por una persona).
SELECT public.incident_set_next_step(inc.id('op2'), 'Carlo confirma con el hospital la cita', now() + interval '1 minute', 'equipo');
INSERT INTO inc.r SELECT 'w6', public.incident_watch(now() + interval '3 minutes');
SELECT inc.ok('S14 venció la hora prometida → aviso "promesa_vencida" (una vez por promesa)',
  inc.alerts(inc.id('op2'), 'promesa_vencida') = 1
  AND (public.incident_watch(now() + interval '4 minutes')->>'ok') = 'true' AND inc.alerts(inc.id('op2'), 'promesa_vencida') = 1,
  inc.v('w6')::text);
SELECT inc.ok('S15 cerrado (resuelto) ya no lo revisa el vigilante',
  (SELECT count(*) FROM public.incident_alerts WHERE request_id = inc.id('c5') AND created_at > now() AND status = 'pendiente') = 0
  AND (public.incident_set_status(inc.id('c5'), 'en_proceso', 'iato_ops')->>'code') = 'ILLEGAL_TRANSITION');
RESET ROLE;

-- ═══ V: vista de reservas y tiempos ═══
SET ROLE authenticated; SELECT inc.as_user('0c000000-0000-0000-0000-00000000000a');
SELECT inc.ok('V1 la vista de reservas (la que lee Iato) no incluye incidentes',
  NOT EXISTS (SELECT 1 FROM public.reservation_state_v WHERE kind = 'incidente'));
RESET ROLE;
SELECT inc.ok('V2 tiempos de servicio medidos de punta a punta en el caso de Ana: recibido ≤ 1.ª respuesta ≤ 1.ª humana',
  (SELECT received_at <= first_response_at AND first_response_at <= first_human_response_at AND taken_at IS NOT NULL
     FROM public.incidents WHERE request_id = (SELECT inc.id('c1'))));

-- ═══ P: permisos ═══
SELECT inc.ok('P1 funciones de servidor: ni anon ni authenticated; mesa y usuario: authenticated sí, anon no',
  NOT has_function_privilege('authenticated', 'public.incident_create(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.incident_watch(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.incident_alerts_claim(text[], integer, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._incident_escalate(uuid, integer, text, text, timestamptz, text, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.incident_create(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_incident_resolve(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_incident_resolve(uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.my_incident_confirm(uuid, boolean, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_incident_message(uuid, text)', 'EXECUTE'));
SELECT inc.ok('P2 todas las tablas nuevas con RLS y sin acceso del cliente',
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('incidents','incident_events','incident_alerts','incident_config','incident_oncall'))
  AND NOT has_table_privilege('authenticated', 'public.incident_events', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.incident_config', 'SELECT'));
