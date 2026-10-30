-- Canales (migración 20261030030000_canales). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS chx CASCADE;
CREATE SCHEMA chx;
GRANT USAGE ON SCHEMA chx TO anon, authenticated, service_role;
CREATE FUNCTION chx.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION chx.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION chx.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION chx.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE chx.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION chx.v(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM chx.r WHERE k = _k $$;
CREATE FUNCTION chx.set_inbound(_ext text, _at timestamptz) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.channel_links SET last_inbound_at = _at WHERE external_id = _ext AND active $$;
CREATE FUNCTION chx.age_location(_ext text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.channel_links SET location_at = now() - interval '3 hours' WHERE external_id = _ext AND active $$;
CREATE FUNCTION chx.expire_action(_ref text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.channel_pending_actions SET expires_at = now() - interval '1 minute' WHERE replace(id::text, '-', '') = _ref $$;
GRANT ALL ON chx.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA chx TO anon, authenticated, service_role;

\set ANA '''0c000000-0000-0000-0000-00000000000a'''
\set BETO '''0c000000-0000-0000-0000-00000000000b'''
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'ch-ana@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000b', 'ch-beto@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'Ana Canales', 'ch-ana@example.test'),
  ('0c000000-0000-0000-0000-00000000000b', 'Beto Canales', 'ch-beto@example.test')
ON CONFLICT (id) DO NOTHING;

SET ROLE service_role; SELECT chx.as_service();
-- Ana: Telegram 700001 y WhatsApp +5215500000001. Beto: Telegram 700002.
SELECT public.channel_link_code_create(:ANA, 'telegram', repeat('1', 64));
SELECT public.channel_link_redeem('telegram', repeat('1', 64), '700001', 'ana');
SELECT public.channel_link_code_create(:ANA, 'whatsapp', repeat('2', 64));
SELECT public.channel_link_redeem('whatsapp', repeat('2', 64), '+5215500000001', NULL);
SELECT public.channel_link_code_create(:BETO, 'telegram', repeat('3', 64));
SELECT public.channel_link_redeem('telegram', repeat('3', 64), '700002', 'beto');

-- ═══ Vinculación por WhatsApp y ventana de 24 h ═══
SELECT chx.ok('C1 WhatsApp se vincula con el mismo código de un solo uso que Telegram',
  public.channel_link_for('whatsapp', '+5215500000001') = :ANA
  AND public.channel_link_redeem('whatsapp', repeat('2', 64), '+5215500000099', NULL)->>'code' = 'USED');
SELECT chx.ok('C2 cada mensaje del viajero abre la ventana de 24 h (channel_link_for la marca)',
  public.channel_window_open(:ANA, 'whatsapp'));
SELECT chx.set_inbound('+5215500000001', now() - interval '25 hours');
SELECT chx.ok('C3 pasadas 24 h sin que escriba, la ventana está cerrada (solo plantillas)',
  NOT public.channel_window_open(:ANA, 'whatsapp') AND NOT public.channel_window_open(:BETO, 'whatsapp'));
SELECT chx.set_inbound('+5215500000001', now() - interval '23 hours');
SELECT chx.ok('C4 a las 23 h sigue abierta', public.channel_window_open(:ANA, 'whatsapp'));

-- ═══ Ubicación compartida ═══
INSERT INTO chx.r SELECT 'loc', to_jsonb(public.channel_location_set('telegram', '700001', 19.4326077, -99.133208));
SELECT chx.ok('C5 ubicación: se guarda redondeada y se lee 2 horas; coordenadas inválidas o chat sin vincular no',
  chx.v('loc') = 'true'::jsonb
  AND public.channel_location_get('telegram', '700001') = '{"lat": 19.43261, "lng": -99.13321}'::jsonb
  AND NOT public.channel_location_set('telegram', '700001', 120, 0)
  AND NOT public.channel_location_set('telegram', '799999', 19, -99));
SELECT chx.age_location('700001');
SELECT chx.ok('C6 una ubicación de hace 3 horas ya no se usa', public.channel_location_get('telegram', '700001') IS NULL);
SELECT chx.ok('C7 la ubicación de Ana no se ve desde el chat de Beto', public.channel_location_get('telegram', '700002') IS NULL);

-- ═══ Acciones propuestas: una vez, mismo chat, misma cuenta ═══
INSERT INTO chx.r SELECT 'a1', public.channel_action_put(:ANA, 'telegram', '700001', '{"type":"add_expense","params":{"monto":450,"moneda":"MXN"},"summary":"Registrar gasto"}');
SELECT chx.ok('C8 se guarda la acción de Ana para su chat y devuelve una referencia de 32 hex',
  chx.v('a1')->>'ok' = 'true' AND chx.v('a1')->>'ref' ~ '^[0-9a-f]{32}$', chx.v('a1')::text);
SELECT chx.ok('C9 no se puede guardar una acción de Ana en el chat de Beto (NOT_LINKED)',
  public.channel_action_put(:ANA, 'telegram', '700002', '{"type":"add_expense"}')->>'code' = 'NOT_LINKED');
SELECT chx.ok('C10 Beto no puede confirmar la acción de Ana desde su chat (NOT_FOUND) ni por WhatsApp',
  public.channel_action_take(chx.v('a1')->>'ref', 'telegram', '700002')->>'code' = 'NOT_FOUND'
  AND public.channel_action_take(chx.v('a1')->>'ref', 'whatsapp', '+5215500000001')->>'code' = 'NOT_FOUND');
INSERT INTO chx.r SELECT 't1', public.channel_action_take(chx.v('a1')->>'ref', 'telegram', '700001');
SELECT chx.ok('C11 Ana la confirma desde su chat: devuelve su user_id y la acción',
  chx.v('t1')->>'ok' = 'true' AND chx.v('t1')->>'user_id' = '0c000000-0000-0000-0000-00000000000a' AND chx.v('t1')->'action'->>'type' = 'add_expense', chx.v('t1')::text);
SELECT chx.ok('C12 el mismo botón dos veces no la ejecuta otra vez (USED)',
  public.channel_action_take(chx.v('a1')->>'ref', 'telegram', '700001')->>'code' = 'USED');
INSERT INTO chx.r SELECT 'a2', public.channel_action_put(:ANA, 'whatsapp', '+5215500000001', '{"type":"track_flight","summary":"Seguir vuelo"}');
SELECT chx.ok('C13 por Twilio se confirma con los primeros 8 caracteres ("sí 4f2a9c1b")',
  public.channel_action_take(left(chx.v('a2')->>'ref', 8), 'whatsapp', '+5215500000001')->>'ok' = 'true');
INSERT INTO chx.r SELECT 'a3', public.channel_action_put(:ANA, 'telegram', '700001', '{"type":"add_itinerary_item"}');
SELECT chx.ok('C14 Cancelar la marca usada sin ejecutarla',
  public.channel_action_take(chx.v('a3')->>'ref', 'telegram', '700001', true)->>'cancelled' = 'true'
  AND public.channel_action_take(chx.v('a3')->>'ref', 'telegram', '700001')->>'outcome' = 'cancelada');
INSERT INTO chx.r SELECT 'a4', public.channel_action_put(:ANA, 'telegram', '700001', '{"type":"add_expense"}');
SELECT chx.expire_action(chx.v('a4')->>'ref');
SELECT chx.ok('C15 una acción de hace más de 24 h vence (EXPIRED)',
  public.channel_action_take(chx.v('a4')->>'ref', 'telegram', '700001')->>'code' = 'EXPIRED');
INSERT INTO chx.r SELECT 'a5', public.channel_action_put(:ANA, 'telegram', '700001', '{"type":"add_expense"}');
-- Ana desvincula y Beto vincula ESE chat de Telegram: el botón viejo de Ana ya no sirve.
SELECT public.channel_unlink(:ANA, 'telegram');
SELECT public.channel_link_code_create(:BETO, 'telegram', repeat('4', 64));
SELECT public.channel_link_redeem('telegram', repeat('4', 64), '700001', 'beto2');
SELECT chx.ok('C16 si el chat cambió de cuenta, la acción pendiente de la cuenta anterior no se ejecuta (NOT_LINKED)',
  public.channel_action_take(chx.v('a5')->>'ref', 'telegram', '700001')->>'code' = 'NOT_LINKED');
SELECT chx.ok('C17 referencias raras no encuentran nada', public.channel_action_take('xyz', 'telegram', '700001')->>'code' = 'NOT_FOUND'
  AND public.channel_action_take('%', 'telegram', '700001')->>'code' = 'NOT_FOUND');
-- Ana vuelve a vincular su Telegram (otro chat).
SELECT public.channel_link_code_create(:ANA, 'telegram', repeat('5', 64));
SELECT public.channel_link_redeem('telegram', repeat('5', 64), '700003', 'ana');

-- ═══ Preferencias ═══
SELECT chx.ok('C18 sin preferencias: app y sin horario', public.channel_prefs_get(:ANA)->>'preferido' = 'app' AND public.channel_prefs_get(:ANA)->>'noMolestarInicio' IS NULL);
INSERT INTO chx.r SELECT 'p1', public.channel_prefs_set(:ANA, 'whatsapp', '22:00', '07:30', 'America/Mexico_City');
SELECT chx.ok('C19 guarda WhatsApp como preferido y no molestar 22:00–07:30 en su zona',
  chx.v('p1')->>'ok' = 'true' AND chx.v('p1')->>'preferido' = 'whatsapp' AND chx.v('p1')->>'noMolestarInicio' = '22:00'
  AND chx.v('p1')->>'noMolestarFin' = '07:30' AND chx.v('p1')->>'tz' = 'America/Mexico_City', chx.v('p1')::text);
SELECT chx.ok('C20 valida: canal no vinculado, horas inválidas, una sola hora, misma hora y zona inexistente',
  public.channel_prefs_set(:BETO, 'whatsapp', NULL, NULL, NULL)->>'code' = 'NOT_LINKED'
  AND public.channel_prefs_set(:ANA, 'app', '25:00', '07:00', NULL)->>'code' = 'BAD_HOURS'
  AND public.channel_prefs_set(:ANA, 'app', '22:00', NULL, NULL)->>'code' = 'BAD_HOURS'
  AND public.channel_prefs_set(:ANA, 'app', '22:00', '22:00', NULL)->>'code' = 'BAD_HOURS'
  AND public.channel_prefs_set(:ANA, 'app', NULL, NULL, 'Marte/Olympus')->>'code' = 'BAD_TZ'
  AND public.channel_prefs_set(:ANA, 'sms', NULL, NULL, NULL)->>'code' = 'BAD_CHANNEL'
  AND public.channel_prefs_get(:ANA)->>'preferido' = 'whatsapp');
INSERT INTO chx.r SELECT 'tg', public.channel_targets(:ANA);
SELECT chx.ok('C21 destinos: preferencias, chats vinculados con su ventana y correo',
  chx.v('tg')->'prefs'->>'preferido' = 'whatsapp' AND chx.v('tg')->>'email' = 'ch-ana@example.test'
  AND jsonb_array_length(chx.v('tg')->'links') = 2
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(chx.v('tg')->'links') l WHERE l->>'channel' = 'whatsapp' AND (l->>'window_open')::boolean), chx.v('tg')::text);
SELECT public.channel_unlink(:ANA, 'whatsapp');
SELECT chx.ok('C22 al desvincular el canal preferido, vuelve a "app" (nunca se queda sin avisos)', public.channel_prefs_get(:ANA)->>'preferido' = 'app');

-- ═══ Avisos diferidos ═══
INSERT INTO chx.r SELECT 'd1', public.channel_deferred_add(:ANA, '{"titulo":"Vuelo","texto":"Cambio de puerta"}', now() - interval '1 minute', 'vuelo:am401:puerta');
SELECT chx.ok('C23 diferido: se encola una vez (dedupe) y no más allá de 25 h',
  chx.v('d1')->>'ok' = 'true' AND public.channel_deferred_add(:ANA, '{"x":1}', now(), 'vuelo:am401:puerta')->>'duplicate' = 'true'
  AND public.channel_deferred_add(:ANA, '{"x":1}', now() + interval '2 days', 'otro:0001')->>'code' = 'BAD_TIME');
INSERT INTO chx.r SELECT 'due', public.channel_deferred_due(10);
SELECT chx.ok('C24 vencido: se reclama una sola vez y al terminar queda enviado',
  jsonb_array_length(chx.v('due')) = 1 AND public.channel_deferred_due(10) = '[]'::jsonb
  AND public.channel_deferred_finish((chx.v('due')->0->>'id')::bigint, true) AND public.channel_deferred_due(10) = '[]'::jsonb);

-- ═══ Caso abierto para el chat ═══
INSERT INTO chx.r SELECT 'inc', public.incident_create(jsonb_build_object('user_id', '0c000000-0000-0000-0000-00000000000b', 'categoria', 'traslado_no_llego',
  'severidad', 'alta', 'origen', 'canal', 'canal', 'telegram', 'idem_key', 'ch:caso-0001', 'descripcion', 'El chofer no llegó', 'respuesta_inmediata', 'Esto puedes hacer ya.'));
SELECT public.incident_add_event((chx.v('inc')->>'id')::uuid, '{"kind":"mensaje","actor":"iato_ops","body":"¿En qué terminal estás?","channel":"app","direction":"saliente","visible_to_user":true,"counterpart":"viajero"}');
SELECT chx.ok('C25 channel_open_case: el caso de Beto y cuándo le escribió el operador; Ana no tiene caso',
  public.channel_open_case(:BETO)->>'id' = chx.v('inc')->>'id' AND public.channel_open_case(:BETO)->>'last_to_user_at' IS NOT NULL
  AND public.channel_open_case(:ANA) IS NULL, coalesce(public.channel_open_case(:BETO)::text, 'null') || ' ' || chx.v('inc')::text);
SELECT public.channel_prefs_set(:BETO, 'telegram', NULL, NULL, NULL);
RESET ROLE;

-- ═══ Permisos ═══
SET ROLE authenticated; SELECT chx.as_user('0c000000-0000-0000-0000-00000000000a');
SELECT chx.ok('C26 un usuario no llama a las funciones de canales ni ve acciones o diferidos; sí ve SOLO su preferencia',
  chx.err($q$SELECT public.channel_action_take('00000000', 'telegram', '700001')$q$) LIKE '42501%'
  AND chx.err($q$SELECT public.channel_prefs_set('0c000000-0000-0000-0000-00000000000b', 'app', NULL, NULL, NULL)$q$) LIKE '42501%'
  AND chx.err($q$SELECT public.channel_targets('0c000000-0000-0000-0000-00000000000b')$q$) LIKE '42501%'
  AND chx.err($q$SELECT * FROM public.channel_pending_actions$q$) LIKE '42501%'
  AND chx.err($q$SELECT * FROM public.channel_deferred$q$) LIKE '42501%'
  AND chx.err($q$UPDATE public.channel_prefs SET preferred = 'email'$q$) LIKE '42501%'
  AND (SELECT count(*) FROM public.channel_prefs) = 1 AND (SELECT user_id FROM public.channel_prefs) = '0c000000-0000-0000-0000-00000000000a');
RESET ROLE;
SET ROLE anon;
SELECT chx.ok('C27 anónimo tampoco', chx.err($q$SELECT public.channel_window_open('0c000000-0000-0000-0000-00000000000a', 'whatsapp')$q$) LIKE '42501%'
  AND chx.err($q$SELECT * FROM public.channel_prefs$q$) LIKE '42501%');
RESET ROLE;
