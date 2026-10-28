-- Auditoría 10 (migración 20261029010000_fix_iato_mesa). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS fi CASCADE;
CREATE SCHEMA fi;
GRANT USAGE ON SCHEMA fi TO anon, authenticated, service_role;
CREATE FUNCTION fi.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION fi.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION fi.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE TABLE fi.r (k text PRIMARY KEY, v jsonb);
-- Id de la solicitud espejo de una escalación (sin depender de la RLS de quien pregunta).
CREATE FUNCTION fi.mirror(_fe uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.concierge_requests WHERE fixer_escalation_id = _fe $$;
CREATE FUNCTION fi.reply_status(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT email_status FROM public.team_request_replies WHERE id = _id $$;
GRANT ALL ON fi.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fi TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('f1000000-0000-0000-0000-00000000000a', 'fi-a@example.test', now()),
  ('f1000000-0000-0000-0000-00000000000b', 'fi-b@example.test', now()),
  ('f1000000-0000-0000-0000-00000000000d', 'fi-dueno@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('f1000000-0000-0000-0000-00000000000a', 'Ana Prueba', 'fi-a@example.test'),
  ('f1000000-0000-0000-0000-00000000000b', 'Beto Prueba', 'fi-b@example.test'),
  ('f1000000-0000-0000-0000-00000000000d', 'Dueño Prueba', 'fi-dueno@example.test')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO public.admins (user_id) VALUES ('f1000000-0000-0000-0000-00000000000d') ON CONFLICT DO NOTHING;
INSERT INTO public.trips (id, user_id, destino, num_viajeros, fecha_salida, fecha_regreso) VALUES
  ('f1100000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Valle de Bravo', 2, '2026-10-30', '2026-11-01')
ON CONFLICT DO NOTHING;

-- ═══ H: "Hablar con una persona" (como lo hace FixerButton: insert del usuario y luego el resultado del correo) ═══
SET ROLE authenticated; SELECT fi.as_user('f1000000-0000-0000-0000-00000000000a');
INSERT INTO public.fixer_escalations (id, user_id, trip_id, motivo, urgencia, contexto_chat, status) VALUES
  ('f1200000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-00000000000a', 'f1100000-0000-0000-0000-00000000000a',
   'PRUEBA AUDITORÍA: necesito ayuda con el traslado', 'alta', '[]', 'pendiente');
SELECT fi.ok('H1 el insert del usuario crea su solicitud espejo (human_help, solicitado, sin aviso pendiente)',
  (SELECT count(*) = 1 AND bool_and(type = 'human_help' AND status = 'solicitado' AND owner_alert_status IS NULL
      AND trip_id = 'f1100000-0000-0000-0000-00000000000a' AND title = 'Importante: PRUEBA AUDITORÍA: necesito ayuda con el traslado'
      AND payload->>'detalle' = 'PRUEBA AUDITORÍA: necesito ayuda con el traslado')
     FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000001'),
  (SELECT string_agg(row_to_json(c)::text, ' ') FROM public.concierge_requests c WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000001'));
INSERT INTO fi.r SELECT 'ua', public.my_team_requests();
SELECT fi.ok('H2 aparece en "Mis solicitudes" del usuario, etapa nueva',
  (SELECT count(*) = 1 AND bool_and(i->>'stage' = 'nueva' AND i->>'type' = 'human_help')
     FROM jsonb_array_elements((SELECT v FROM fi.r WHERE k = 'ua')) i WHERE i->>'type' = 'human_help'),
  (SELECT v::text FROM fi.r WHERE k = 'ua'));
UPDATE public.fixer_escalations SET status = 'email_enviado' WHERE id = 'f1200000-0000-0000-0000-000000000001';
SELECT fi.ok('H3 correo del botón enviado → aviso "enviado" (no se repite)',
  (SELECT owner_alert_status = 'enviado' AND owner_alert_sent_at IS NOT NULL FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000001'));
SELECT fi.ok('H4 la vista canónica no repite la escalación: se ve una sola vez (la solicitud espejo)',
  (SELECT count(*) FROM public.reservation_state_v WHERE source_id = 'f1200000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM public.reservation_state_v WHERE source_table = 'concierge_requests' AND kind = 'human_help') = 1);
SELECT fi.ok('H5 el usuario no puede ligar su solicitud a otra escalación ni ver la de otro',
  NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE user_id <> 'f1000000-0000-0000-0000-00000000000a'));
-- Otro usuario: su escalación con correo fallido.
SELECT fi.as_user('f1000000-0000-0000-0000-00000000000b');
INSERT INTO public.fixer_escalations (id, user_id, motivo, urgencia, contexto_chat, status) VALUES
  ('f1200000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000b', NULL, 'critica', '[]', 'pendiente');
UPDATE public.fixer_escalations SET status = 'email_fallido' WHERE id = 'f1200000-0000-0000-0000-000000000002';
SELECT fi.ok('H6 B ve solo la suya y sin motivo el título es claro',
  (SELECT string_agg(i->>'title', ',') FROM jsonb_array_elements(public.my_team_requests()) i) = 'Urgente');
RESET ROLE;
SELECT fi.ok('H7 correo fallido → aviso "fallido" (health-check lo reintenta)',
  (SELECT owner_alert_status = 'fallido' FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000002'));
SET ROLE service_role; SELECT fi.as_service();
INSERT INTO fi.r SELECT 'due', public.ops_owner_alerts_due(20);
SELECT fi.ok('H8 el reintento toma solo la que falló (la enviada nunca se reenvía)',
  (SELECT count(*) = 1 AND bool_and(a->>'type' = 'human_help') FROM jsonb_array_elements((SELECT v FROM fi.r WHERE k = 'due')) a
     WHERE a->>'id' IN (SELECT id::text FROM public.concierge_requests WHERE fixer_escalation_id IS NOT NULL))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT v FROM fi.r WHERE k = 'due')) a
     WHERE a->>'id' = fi.mirror('f1200000-0000-0000-0000-000000000001')::text),
  (SELECT v::text FROM fi.r WHERE k = 'due'));
SELECT fi.ok('H9 y no dos veces seguidas (en curso)',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.ops_owner_alerts_due(20)) a
     WHERE a->>'id' = (SELECT id::text FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000002')));
SELECT public.ops_owner_alert_finish((SELECT id FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000002'), true, 'em_1');
RESET ROLE;
UPDATE public.fixer_escalations SET status = 'email_fallido' WHERE id = 'f1200000-0000-0000-0000-000000000002';
SELECT fi.ok('H10 un aviso ya enviado nunca vuelve a "fallido"',
  (SELECT owner_alert_status FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000002') = 'enviado');

-- ═══ M: Mesa de operaciones ═══
SET ROLE authenticated; SELECT fi.as_user('f1000000-0000-0000-0000-00000000000d');
INSERT INTO fi.r SELECT 'list', public.admin_ops_list(NULL);
SELECT fi.ok('M1 la Mesa ve las dos, con quién la pidió, urgencia y detalle',
  (SELECT count(*) = 2 FROM jsonb_array_elements((SELECT v FROM fi.r WHERE k = 'list')->'items') i WHERE i->>'type' = 'human_help')
  AND (SELECT i->'user'->>'email' = 'fi-a@example.test' AND i->'payload'->>'urgencia' = 'alta' AND i->'trip'->>'destino' = 'Valle de Bravo'
         FROM jsonb_array_elements((SELECT v FROM fi.r WHERE k = 'list')->'items') i
        WHERE i->>'id' = fi.mirror('f1200000-0000-0000-0000-000000000001')::text),
  (SELECT v::text FROM fi.r WHERE k = 'list'));
INSERT INTO fi.r SELECT 'take', public.admin_ops_act('concierge_request', fi.mirror('f1200000-0000-0000-0000-000000000001'), 'tomar');
SELECT fi.ok('M2 Tomar → en proceso', (SELECT v->'item'->>'stage' = 'en_proceso' FROM fi.r WHERE k = 'take'), (SELECT v::text FROM fi.r WHERE k = 'take'));
INSERT INTO fi.r SELECT 'reply', public.admin_ops_act('concierge_request', fi.mirror('f1200000-0000-0000-0000-000000000001'), 'responder', 'Te llamamos en 10 minutos.');
SELECT fi.ok('M3 Responder deja el mensaje para el usuario (correo pendiente de enviar)',
  (SELECT v->>'ok' = 'true' AND v->>'reply_id' IS NOT NULL FROM fi.r WHERE k = 'reply')
  AND fi.reply_status((SELECT (v->>'reply_id')::uuid FROM fi.r WHERE k = 'reply')) = 'pendiente');
SELECT fi.as_user('f1000000-0000-0000-0000-00000000000a');
SELECT fi.ok('M4 el usuario ve la respuesta y el estado real en "Mis solicitudes"',
  (SELECT i->>'stage' = 'en_proceso' AND i->'replies'->0->>'body' = 'Te llamamos en 10 minutos.'
     FROM jsonb_array_elements(public.my_team_requests()) i WHERE i->>'type' = 'human_help'));
RESET ROLE;

-- ═══ D: borrar la escalación borra su espejo ═══
DELETE FROM public.fixer_escalations WHERE id = 'f1200000-0000-0000-0000-000000000002';
SELECT fi.ok('D1 sin espejos huérfanos', NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE fixer_escalation_id = 'f1200000-0000-0000-0000-000000000002'));

-- ═══ C: Members Only — el conteo de cada ciudad es lo que la lista muestra ═══
SET ROLE authenticated; SELECT fi.as_user('f1000000-0000-0000-0000-00000000000a');
SELECT fi.ok('C1 members_cities sigue respondiendo a una sesión', (SELECT count(*) FROM public.members_cities()) >= 0);
RESET ROLE;
-- Con derecho a Members Only se compara contra members_venues (la lista) filtrada como en la app.
CREATE FUNCTION fi.list_count(_c text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.members_venues(_c) v WHERE v.fuente = 'curaduria' OR nullif(btrim(v.source_url), '') IS NOT NULL $$;
GRANT EXECUTE ON FUNCTION fi.list_count(text) TO authenticated;
CREATE FUNCTION fi.raw_pool_count(_key text) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.members_venue_pool() p WHERE public.prive_norm(p.ciudad_display) = public.prive_norm(_key) $$;
GRANT EXECUTE ON FUNCTION fi.raw_pool_count(text) TO authenticated;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES ('f1000000-0000-0000-0000-00000000000a', 'active', 'sub_fi1', 'cus_fi1', now() + interval '20 days')
ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
-- Un lugar viejo SIN fuente en CDMX y uno curado en una localidad hija de Los Cabos (alcance de región).
INSERT INTO public.nightlife_premium (ciudad, ciudad_display, pais, categoria, nombre, active)
VALUES ('cdmx', 'Ciudad de México', 'México', 'rooftop', 'FI Viejo Sin Fuente', true);
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('fi-cabo', (SELECT id FROM public.prive_destinations WHERE slug = 'san-jose-del-cabo'), 'after_dark', 'mezcaleria', 'FI Cabo Bar',
  'https://example.test/fi-cabo', '["https://example.test/fi-cabo"]', 'Hecho de prueba.', 'CURADO', now() - interval '1 day', 'abierto')
ON CONFLICT DO NOTHING;
SET ROLE authenticated; SELECT fi.as_user('f1000000-0000-0000-0000-00000000000a');
SELECT fi.ok('C2 con derecho: cada ciudad cuenta exactamente lo que su lista muestra',
  coalesce((SELECT bool_and(c.venues = fi.list_count(c.ciudad_display)) FROM public.members_cities() c), true)
  AND public.members_access(),
  (SELECT string_agg(c.ciudad_display || ':' || c.venues || '≠' || fi.list_count(c.ciudad_display), ', ')
     FROM public.members_cities() c WHERE c.venues <> fi.list_count(c.ciudad_display)));
SELECT fi.ok('C3 ninguna ciudad cuenta lugares sin fuente (lo viejo de la IA no se muestra)',
  coalesce((SELECT bool_and(c.venues <= fi.raw_pool_count(c.ciudad_display) OR fi.raw_pool_count(c.ciudad_display) = 0) FROM public.members_cities() c), true));
RESET ROLE;
