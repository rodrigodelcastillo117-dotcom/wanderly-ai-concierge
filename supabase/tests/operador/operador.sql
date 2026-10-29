-- Operador IATOS (migración 20261029100000_operador). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS opx CASCADE;
CREATE SCHEMA opx;
GRANT USAGE ON SCHEMA opx TO anon, authenticated, service_role;
CREATE FUNCTION opx.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION opx.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION opx.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION opx.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE opx.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION opx.v(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM opx.r WHERE k = _k $$;
CREATE FUNCTION opx.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT (v->>'id')::uuid FROM opx.r WHERE k = _k $$;
CREATE FUNCTION opx.oc(_id uuid) RETURNS public.operator_cases LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.operator_cases WHERE request_id = _id $$;
CREATE FUNCTION opx.due_ids() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT coalesce(string_agg((x->>'id') || ':' || (x->>'reason'), ','), '') FROM jsonb_array_elements(public.operator_due(50)) x $$;
CREATE FUNCTION opx.last_user_event(_id uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT max(id) FROM public.incident_events WHERE request_id = _id AND actor = 'usuario' AND direction = 'entrante' $$;
CREATE FUNCTION opx.last_iato_event(_id uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT max(id) FROM public.incident_events WHERE request_id = _id AND actor <> 'usuario' $$;
CREATE FUNCTION opx.max_event(_id uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT max(id) FROM public.incident_events WHERE request_id = _id $$;
CREATE FUNCTION opx.input(_user text, _cat text, _sev text, _key text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('user_id', _user, 'categoria', _cat, 'severidad', _sev, 'origen', 'usuario', 'idem_key', _key,
    'descripcion', 'Prueba operador: ' || _cat, 'respuesta_inmediata', 'Esto es lo que puedes hacer ahora mismo.') $$;
GRANT ALL ON opx.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA opx TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0e000000-0000-0000-0000-00000000000a', 'op-ana@example.test', now()),
  ('0e000000-0000-0000-0000-00000000000b', 'op-beto@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0e000000-0000-0000-0000-00000000000a', 'Ana Operador', 'op-ana@example.test'),
  ('0e000000-0000-0000-0000-00000000000b', 'Beto Operador', 'op-beto@example.test')
ON CONFLICT (id) DO NOTHING;

-- ═══ Bandera apagada: no hace nada ═══
SELECT opx.ok('O1 la bandera operador_enabled existe y nace apagada', (SELECT value = 'false'::jsonb FROM public.app_flags WHERE key = 'operador_enabled'));
SET ROLE service_role; SELECT opx.as_service();
INSERT INTO opx.r SELECT 'off', public.incident_create(opx.input('0e000000-0000-0000-0000-00000000000a', 'equipaje', 'media', 'op:apagado-0001'));
SELECT opx.ok('O2 apagado: el incidente va directo a humanos, operator_due vacío y operator_claim responde DISABLED',
  (opx.v('off')->>'assignee') = 'humano' AND public.operator_due(10) = '[]'::jsonb
  AND public.operator_claim(opx.id('off'), 'operador-prueba-1')->>'code' = 'DISABLED', opx.v('off')::text);
RESET ROLE;

-- ═══ Prendido por la bandera del dueño (sin tocar incident_config) ═══
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'operador_enabled';
SET ROLE service_role; SELECT opx.as_service();
SELECT public.incident_operator_heartbeat();
INSERT INTO opx.r SELECT 'c1', public.incident_create(opx.input('0e000000-0000-0000-0000-00000000000a', 'vuelo_cancelado', 'alta', 'op:caso-000001'));
SELECT opx.ok('O3 con la bandera y latido, el incidente nace del operador IA (iato_ops) aunque ai_operator_enabled siga en false',
  (opx.v('c1')->>'assignee') = 'iato_ops' AND NOT (SELECT ai_operator_enabled FROM public.incident_config), opx.v('c1')::text);
SELECT opx.ok('O4 operator_due lo lista como nuevo', opx.due_ids() LIKE '%' || opx.id('c1') || ':nuevo%', opx.due_ids());

-- ═══ Candado ═══
INSERT INTO opx.r SELECT 'cl1', public.operator_claim(opx.id('c1'), 'operador-prueba-A');
SELECT opx.ok('O5 claim: candado, topes y lo de la bitácora para trabajar',
  (opx.v('cl1')->>'ok') = 'true' AND (opx.v('cl1')->'limits'->>'max_flight_searches')::int = 1
  AND jsonb_array_length(opx.v('cl1')->'events') >= 2 AND opx.v('cl1')->'incident'->>'category' = 'vuelo_cancelado'
  AND (opx.oc(opx.id('c1'))).lock_owner = 'operador-prueba-A', left(opx.v('cl1')::text, 300));
SELECT opx.ok('O6 un segundo operador no entra al mismo caso (LOCKED); el mismo dueño sí renueva',
  public.operator_claim(opx.id('c1'), 'operador-prueba-B')->>'code' = 'LOCKED'
  AND public.operator_claim(opx.id('c1'), 'operador-prueba-A')->>'ok' = 'true');
SELECT opx.ok('O7 con candado vigente no aparece en operator_due', opx.due_ids() NOT LIKE '%' || opx.id('c1') || '%', opx.due_ids());

-- ═══ Topes ═══
SELECT opx.ok('O8 una sola búsqueda de vuelos por caso: la segunda → CAP_BUSQUEDA',
  public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'vuelos')->>'ok' = 'true'
  AND public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'vuelos')->>'code' = 'CAP_BUSQUEDA'
  AND (opx.oc(opx.id('c1'))).flight_searches = 1);
SELECT opx.ok('O9 gasto en IA: se suma y al pasarse del tope → CAP_GASTO sin sumarlo',
  public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'modelo', 0.30)->>'ok' = 'true'
  AND public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'modelo', 0.60)->>'code' = 'CAP_GASTO'
  AND (opx.oc(opx.id('c1'))).spend_usd = 0.30);
SELECT opx.ok('O10 quien no tiene el candado no gasta (NOT_LOCKED); un tipo inventado → BAD_KIND',
  public.operator_spend(opx.id('c1'), 'operador-prueba-B', 'accion')->>'code' = 'NOT_LOCKED'
  AND public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'pagar')->>'code' = 'BAD_KIND');
RESET ROLE;
UPDATE public.operator_config SET max_actions = 2;
SET ROLE service_role; SELECT opx.as_service();
SELECT opx.ok('O11 tope de acciones: la tercera → CAP_ACCIONES',
  public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'accion')->>'ok' = 'true'
  AND public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'accion')->>'ok' = 'true'
  AND public.operator_spend(opx.id('c1'), 'operador-prueba-A', 'accion')->>'code' = 'CAP_ACCIONES');
RESET ROLE;
UPDATE public.operator_config SET max_actions = 25;
SET ROLE service_role; SELECT opx.as_service();

-- ═══ Consentimiento solo de un mensaje real del viajero ═══
SELECT opx.ok('O12 consentimiento con un mensaje que no es del viajero → NOT_USER_MESSAGE',
  public.operator_consent(opx.id('c1'), 'operador-prueba-A', 'enviar_reclamo:C-ABC123', opx.last_iato_event(opx.id('c1')), 'C-ABC123')->>'code' = 'NOT_USER_MESSAGE');
RESET ROLE;
SET ROLE authenticated; SELECT opx.as_user('0e000000-0000-0000-0000-00000000000a');
SELECT public.my_incident_message(opx.id('c1'), 'Sí, envía C-ABC123 por favor');
RESET ROLE;
SET ROLE service_role; SELECT opx.as_service();
SELECT opx.ok('O13 con el mensaje real del viajero: sin el folio exigido → TEXT_MISSING; con el folio → guardado con su evento',
  public.operator_consent(opx.id('c1'), 'operador-prueba-A', 'enviar_reclamo:C-ZZZ999', opx.last_user_event(opx.id('c1')), 'C-ZZZ999')->>'code' = 'TEXT_MISSING'
  AND public.operator_consent(opx.id('c1'), 'operador-prueba-A', 'enviar_reclamo:C-ABC123', opx.last_user_event(opx.id('c1')), 'C-ABC123')->>'ok' = 'true'
  AND ((opx.oc(opx.id('c1'))).consents->'enviar_reclamo:C-ABC123'->>'event_id')::bigint = opx.last_user_event(opx.id('c1')));
SELECT opx.ok('O14 un consentimiento de otro caso no sirve (NOT_USER_MESSAGE)',
  public.operator_consent(opx.id('c1'), 'operador-prueba-A', 'ver_todo', (SELECT max(id) FROM public.incident_events WHERE request_id = opx.id('off')), NULL)->>'code' = 'NOT_USER_MESSAGE');

-- ═══ Soltar, idempotencia y despertar ═══
SELECT opx.ok('O15 release: marca de agua, estado, próxima revisión y suelta el candado',
  public.operator_release(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('last_event_id', opx.max_event(opx.id('c1')), 'state', 'esperando_usuario',
    'follow_up_at', (now() + interval '30 minutes')::text, 'summary', 'Esperando que el viajero confirme'))->>'ok' = 'true'
  AND (opx.oc(opx.id('c1'))).lock_owner IS NULL AND (opx.oc(opx.id('c1'))).state = 'esperando_usuario'
  AND (opx.oc(opx.id('c1'))).last_event_id = opx.max_event(opx.id('c1')));
SELECT opx.ok('O16 sin nada nuevo no vuelve a operator_due (idempotente)', opx.due_ids() NOT LIKE '%' || opx.id('c1') || '%', opx.due_ids());
SELECT opx.ok('O17 release de quien no tiene el candado → NOT_LOCKED', public.operator_release(opx.id('c1'), 'operador-prueba-B', '{}')->>'code' = 'NOT_LOCKED');
RESET ROLE;
SET ROLE authenticated; SELECT opx.as_user('0e000000-0000-0000-0000-00000000000a');
SELECT public.my_incident_message(opx.id('c1'), 'Ya estoy en el mostrador, ¿qué hago?');
RESET ROLE;
SET ROLE service_role; SELECT opx.as_service();
SELECT opx.ok('O18 un mensaje nuevo del viajero lo despierta: vuelve a operator_due como "mensaje" y el estado pasa a activo',
  opx.due_ids() LIKE '%' || opx.id('c1') || ':mensaje%' AND (opx.oc(opx.id('c1'))).state = 'activo', opx.due_ids());

-- ═══ Correos a proveedores (fuente obligatoria, horario del proveedor) ═══
SELECT public.operator_claim(opx.id('c1'), 'operador-prueba-A');
SELECT opx.ok('O19 sin fuente, o con fuente "mensaje_usuario" que no contiene ese correo → rechazado',
  public.operator_outbox_add(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('provider_name', 'Hotel Prueba', 'to_email', 'reservas@hotelprueba.test',
    'source', '{}'::jsonb, 'subject', 'Llegada tarde', 'body', 'Buenas noches, la huésped llega tarde.', 'dedupe_key', 'x1'))->>'code' = 'INVALID'
  AND public.operator_outbox_add(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('provider_name', 'Hotel Prueba', 'to_email', 'inventado@hotel.test',
    'source', jsonb_build_object('kind', 'mensaje_usuario', 'event_id', opx.last_user_event(opx.id('c1'))::text), 'subject', 'Llegada tarde',
    'body', 'Buenas noches, la huésped llega tarde.', 'dedupe_key', 'x2'))->>'code' = 'SOURCE_NOT_FOUND');
INSERT INTO opx.r SELECT 'ob1', public.operator_outbox_add(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('provider_name', 'Hotel Prueba',
  'to_email', 'Reservas@HotelPrueba.test', 'source', jsonb_build_object('kind', 'sitio_oficial', 'url', 'https://hotelprueba.test/contacto'),
  'subject', 'Llegada tarde', 'body', 'Buenas noches, la huésped llega tarde.', 'provider_tz', 'Europe/Rome', 'dedupe_key', 'llegada-tarde'));
INSERT INTO opx.r SELECT 'ob2', public.operator_outbox_add(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('provider_name', 'Tour Prueba',
  'to_email', 'hola@tourprueba.test', 'source', jsonb_build_object('kind', 'reserva', 'booking', 'TP-123'),
  'subject', 'Cambio de horario', 'body', 'Hola, ¿podemos mover el tour a mañana?', 'send_after', (now() + interval '6 hours')::text, 'dedupe_key', 'tour-1'));
SELECT opx.ok('O20 con fuente se guarda (correo en minúsculas, token de respuesta); la misma clave no duplica',
  (opx.v('ob1')->>'ok') = 'true' AND (opx.v('ob1')->>'reply_token') ~ '^[0-9a-f]{24}$'
  AND (SELECT to_email FROM public.operator_outbox WHERE id = opx.id('ob1')) = 'reservas@hotelprueba.test'
  AND public.operator_outbox_add(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('provider_name', 'Hotel Prueba', 'to_email', 'reservas@hotelprueba.test',
    'source', jsonb_build_object('kind', 'sitio_oficial', 'url', 'https://hotelprueba.test/contacto'), 'subject', 'Llegada tarde',
    'body', 'Buenas noches, la huésped llega tarde.', 'dedupe_key', 'llegada-tarde'))->>'duplicate' = 'true', opx.v('ob1')::text);
INSERT INTO opx.r SELECT 'due', jsonb_build_object('l', public.operator_outbox_due(10));
SELECT opx.ok('O21 solo sale lo que ya está en horario del proveedor (el programado a +6 h espera); un segundo reparto no lo toma',
  jsonb_array_length(opx.v('due')->'l') = 1 AND opx.v('due')->'l'->0->>'id' = opx.v('ob1')->>'id'
  AND public.operator_outbox_due(10) = '[]'::jsonb, opx.v('due')::text);
INSERT INTO opx.r SELECT 'fin', public.operator_outbox_finish(opx.id('ob1'), true, 'em_123', NULL);
SELECT opx.ok('O22 terminar el envío lo anota en la bitácora (correo saliente del operador, con la fuente) y lo marca enviado',
  opx.v('fin')->>'ok' = 'true'
  AND (SELECT status FROM public.operator_outbox WHERE id = opx.id('ob1')) = 'enviado'
  AND EXISTS (SELECT 1 FROM public.incident_events WHERE request_id = opx.id('c1') AND actor = 'iato_ops' AND channel = 'email'
                AND direction = 'saliente' AND delivery = 'enviado' AND data->'operador'->'fuente'->>'kind' = 'sitio_oficial'));
SELECT opx.ok('O23 la respuesta del proveedor encuentra su caso por el token',
  public.operator_outbox_by_token(opx.v('ob1')->>'reply_token')->>'request_id' = opx.id('c1')::text
  AND public.operator_outbox_by_token('zzz') IS NULL);
SELECT public.operator_release(opx.id('c1'), 'operador-prueba-A', jsonb_build_object('last_event_id', opx.max_event(opx.id('c1'))));

-- ═══ Si pasa a una persona, el operador se aparta ═══
SELECT public.incident_assign(opx.id('c1'), 'humano', 'El operador pide a una persona', NULL, 'iato_ops');
SELECT opx.ok('O24 asignado a humano: claim → NOT_MINE y ya no aparece en operator_due',
  public.operator_claim(opx.id('c1'), 'operador-prueba-A')->>'code' = 'NOT_MINE' AND opx.due_ids() NOT LIKE '%' || opx.id('c1') || '%'
  AND (opx.oc(opx.id('c1'))).state = 'con_humano');
SELECT opx.ok('O25 caso abierto más reciente del usuario (para Telegram)',
  public.incident_open_for_user('0e000000-0000-0000-0000-00000000000a') IS NOT NULL
  AND public.incident_open_for_user('0e000000-0000-0000-0000-00000000000b') IS NULL);

-- ═══ Telegram: código de un solo uso ═══
SELECT opx.ok('O26 código: se canjea una vez, liga la cuenta; otra vez → USED; inventado → BAD_CODE',
  public.channel_link_code_create('0e000000-0000-0000-0000-00000000000a', 'telegram', repeat('a', 64))->>'ok' = 'true'
  AND public.channel_link_redeem('telegram', repeat('a', 64), '555001', 'ana_viaja')->>'user_id' = '0e000000-0000-0000-0000-00000000000a'
  AND public.channel_link_for('telegram', '555001') = '0e000000-0000-0000-0000-00000000000a'
  AND public.channel_link_redeem('telegram', repeat('a', 64), '555001', 'ana_viaja')->>'code' = 'USED'
  AND public.channel_link_redeem('telegram', repeat('b', 64), '555001', NULL)->>'code' = 'BAD_CODE');
RESET ROLE;
INSERT INTO public.channel_link_codes (code_hash, user_id, channel, expires_at) VALUES (repeat('c', 64), '0e000000-0000-0000-0000-00000000000b', 'telegram', now() - interval '1 minute');
SET ROLE service_role; SELECT opx.as_service();
SELECT opx.ok('O27 código vencido → EXPIRED; un código nuevo invalida el anterior sin usar',
  public.channel_link_redeem('telegram', repeat('c', 64), '555002', NULL)->>'code' = 'EXPIRED'
  AND public.channel_link_code_create('0e000000-0000-0000-0000-00000000000b', 'telegram', repeat('d', 64))->>'ok' = 'true'
  AND public.channel_link_code_create('0e000000-0000-0000-0000-00000000000b', 'telegram', repeat('e', 64))->>'ok' = 'true'
  AND public.channel_link_redeem('telegram', repeat('d', 64), '555002', NULL)->>'code' = 'USED');
INSERT INTO opx.r SELECT 'rd', public.channel_link_redeem('telegram', repeat('e', 64), '555001', 'beto');
INSERT INTO opx.r SELECT 'rd_for', to_jsonb(public.channel_link_for('telegram', '555001'));
INSERT INTO opx.r SELECT 'rd_ana', public.channel_links_of('0e000000-0000-0000-0000-00000000000a');
INSERT INTO opx.r SELECT 'unl', public.channel_unlink('0e000000-0000-0000-0000-00000000000b', 'telegram');
SELECT opx.ok('O28 el mismo chat vinculado por otra cuenta deja de ser de la primera; desvincular apaga',
  opx.v('rd')->>'ok' = 'true' AND opx.v('rd_for') #>> '{}' = '0e000000-0000-0000-0000-00000000000b'
  AND opx.v('rd_ana') = '[]'::jsonb AND opx.v('unl')->>'unlinked' = '1'
  AND public.channel_link_for('telegram', '555001') IS NULL);
SELECT opx.ok('O29 webhook idempotente: el mismo update_id solo la primera vez',
  public.channel_inbound_seen('telegram', '9001') AND NOT public.channel_inbound_seen('telegram', '9001'));
RESET ROLE;

-- ═══ Permisos ═══
SET ROLE authenticated; SELECT opx.as_user('0e000000-0000-0000-0000-00000000000a');
SELECT opx.ok('O30 un usuario no toca nada del operador ni de los canales (ni tablas ni funciones)',
  opx.err($q$SELECT public.operator_claim('00000000-0000-0000-0000-000000000000', 'operador-prueba-A')$q$) LIKE '42501%'
  AND opx.err($q$SELECT public.operator_consent('00000000-0000-0000-0000-000000000000', 'x', 'ver_todo', 1, NULL)$q$) LIKE '42501%'
  AND opx.err($q$SELECT public.channel_link_redeem('telegram', 'x', '1', NULL)$q$) LIKE '42501%'
  AND opx.err($q$SELECT * FROM public.operator_cases$q$) LIKE '42501%'
  AND opx.err($q$SELECT * FROM public.operator_outbox$q$) LIKE '42501%'
  AND opx.err($q$SELECT * FROM public.channel_links$q$) LIKE '42501%'
  AND opx.err($q$UPDATE public.app_flags SET value = 'true' WHERE key = 'operador_enabled'$q$) LIKE '42501%');
RESET ROLE;
SET ROLE anon;
SELECT opx.ok('O31 anónimo tampoco', opx.err($q$SELECT public.operator_due(10)$q$) LIKE '42501%' AND opx.err($q$SELECT public.channel_inbound_seen('telegram','1')$q$) LIKE '42501%');
RESET ROLE;

-- ═══ Apagar de nuevo ═══
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'operador_enabled';
SET ROLE service_role; SELECT opx.as_service();
SELECT opx.ok('O32 al apagar la bandera no hay nada que trabajar ni correos que salgan',
  public.operator_due(10) = '[]'::jsonb AND public.operator_outbox_due(10) = '[]'::jsonb);
RESET ROLE;
DROP SCHEMA opx CASCADE;
