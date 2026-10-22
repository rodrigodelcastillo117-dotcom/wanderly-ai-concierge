-- Segunda auditoría (grupo reservas) · casos adversariales A1–A9 del auditor
-- (/home/user/audit2/reservas/codigo/supabase/tests/ai_reservations_a2/a2_adversarial.sql), convertidos
-- en la ronda r2 en pruebas de REGRESIÓN: cada caso imprime "OK R2-…" o "FALLA R2-…".
-- Antes de las migraciones 20261026*_r2_reservas_* fallan; después pasan. Lo corre run.sh.
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
-- AUD-06: evidencia del correo recibido tal como la registra ai_reservation_inbound_attach (los
-- datos vienen del proveedor, no del modelo) y la confirmación completa que arma decideReply().
-- El cuerpo (huella) sale del texto, como en el servicio: dos correos con el mismo texto tienen la misma huella.
CREATE FUNCTION rt.ev(email_id text, from_addr text, auth jsonb, reply text, mid text, quoted boolean DEFAULT false,
  method text DEFAULT 'reply_token', body_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('provider', 'resend', 'provider_email_id', email_id, 'message_id', mid, 'received_at', now(),
    'from_address', from_addr, 'auth', auth, 'reply_text', reply,
    'body_sha256', coalesce(body_hash, encode(sha256(convert_to(reply, 'UTF8')), 'hex')), 'raw_sha256', repeat('b', 64),
    'raw_pointer', 'resend:emails/receiving/' || email_id, 'linkage', jsonb_build_object('method', method, 'quoted_request', quoted),
    'sender', jsonb_build_object('verified', true, 'basis', 'dmarc_aligned'))
$$;
CREATE FUNCTION rt.pass() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"spf":"pass","dkim":"pass","dmarc":"pass"}'::jsonb $$;
CREATE FUNCTION rt.conds(res uuid, basis text DEFAULT 'stated', party int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'date', jsonb_build_object('value', split_part(r.requested_local, 'T', 1), 'basis', basis),
    'time', jsonb_build_object('value', split_part(r.requested_local, 'T', 2), 'basis', basis),
    'party_size', jsonb_build_object('value', coalesce(party, r.party_size), 'basis', basis),
    'name', jsonb_build_object('value', r.customer_name, 'basis', 'reply_token'))
  FROM public.ai_reservations r WHERE r.id = res
$$;
CREATE FUNCTION rt.conf(res uuid, inbound uuid, email_id text, quote text, code text DEFAULT NULL, conds jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('channel', 'venue_email', 'inbound_id', inbound, 'inbound_email_id', email_id, 'quote', quote,
    'verified_sender', true, 'from_domain', 'casaoaxaca.com.mx', 'code', code, 'conditions', coalesce(conds, rt.conds(res)),
    'contradictions', '[]'::jsonb, 'linkage', jsonb_build_object('method', 'reply_token', 'quoted_request', false))
$$;
CREATE FUNCTION rt.dec(conf jsonb, model text DEFAULT 'claude-test-model') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('outcome', 'confirmed', 'excerpt', conf->>'quote', 'inbound_email_id', conf->>'inbound_email_id',
    'from_domain', 'casaoaxaca.com.mx', 'verified_sender', true, 'quotes', jsonb_build_array(conf->>'quote'), 'claude_calls', 1,
    'confirmation', conf, 'log', jsonb_build_object('model', model, 'rules_version', 'r2-v1', 'classifier', jsonb_build_object('outcome', 'confirmed')))
$$;
-- Crea y "envía" una solicitud (usuario n, lugar y correo propios para no chocar con los límites).
CREATE FUNCTION rt.sent(n int, place text, email text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  v := (public.ai_reservation_create_intent(rt.u(n), rt.intent(n, place, email)))->>'id';
  PERFORM public.ai_reservation_claim_send(v, rt.u(n), rt.consent());
  PERFORM public.ai_reservation_mark_sent(v, 'request', true, 're_' || n, NULL);
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rt TO anon, authenticated, service_role;
SELECT count(*) FROM (SELECT rt.mk_user(n) FROM generate_series(7, 12) n) t;
SELECT rt.flag(true);
SET ROLE service_role;
-- ── A1/A2 Message-ID: normalización (mayúsculas, espacios, < >) y mismo cuerpo con otro Message-ID ──
SELECT rt.sent(7, 'ChIJ_a2_place_0071', 'reservas@casa71.mx') AS id71 \gset
SELECT reply_token AS tok71 FROM ai_reservations WHERE id = :'id71' \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_71a', 'em_71a', :'tok71', 'casa71.mx'))->>'inbound_id' AS i71a \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_71b', 'em_71b', :'tok71', 'casa71.mx'))->>'inbound_id' AS i71b \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_71c', 'em_71c', :'tok71', 'casa71.mx'))->>'inbound_id' AS i71c \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_71d', 'em_71d', :'tok71', 'casa71.mx'))->>'inbound_id' AS i71d \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_71e', 'em_71e', :'tok71', 'casa71.mx'))->>'inbound_id' AS i71e \gset
SELECT public.ai_reservation_inbound_attach(:'i71a', rt.ev('em_71a', 'reservas@casa71.mx', rt.pass(), 'Confirmamos su reserva para 4 personas.', '<A1@Casa71.mx>')) AS a71a \gset
SELECT public.ai_reservation_inbound_attach(:'i71b', rt.ev('em_71b', 'reservas@casa71.mx', rt.pass(), 'Otro texto, mismo Message-ID.', ' <a1@casa71.mx> ')) AS a71b \gset
SELECT public.ai_reservation_inbound_attach(:'i71c', rt.ev('em_71c', 'reservas@casa71.mx', rt.pass(), 'Otro texto más, mismo Message-ID sin ángulos.', 'a1@casa71.mx')) AS a71c \gset
SELECT public.ai_reservation_inbound_attach(:'i71d', rt.ev('em_71d', 'reservas@casa71.mx', rt.pass(), 'Confirmamos su reserva para 4 personas.', '<otro-id@casa71.mx>')) AS a71d \gset
-- Control: un correo distinto (otro texto, otro Message-ID) del mismo remitente sí se procesa.
SELECT public.ai_reservation_inbound_attach(:'i71e', rt.ev('em_71e', 'reservas@casa71.mx', rt.pass(), 'Gracias, lo esperamos.', '<tercero@casa71.mx>')) AS a71e \gset
RESET ROLE;
SELECT rt.ok('R2-A1a Message-ID con mayúsculas y espacios → duplicate', (:'a71b'::jsonb)->>'duplicate' = 'true', :'a71b');
SELECT rt.ok('R2-A1b Message-ID sin < > → el mismo correo (duplicate)', (:'a71c'::jsonb)->>'duplicate' = 'true'
  AND (SELECT status FROM ai_reservation_inbound WHERE id = :'i71c') = 'duplicate', :'a71c');
SELECT rt.ok('R2-A2 mismo cuerpo del mismo remitente con otro Message-ID → duplicate (no se procesa otra vez)',
  (:'a71d'::jsonb)->>'duplicate' = 'true' AND (SELECT status || ':' || outcome FROM ai_reservation_inbound WHERE id = :'i71d') = 'duplicate:duplicate_body', :'a71d');
SELECT rt.ok('R2-A2b control: otro texto y otro Message-ID → no es duplicado', (:'a71e'::jsonb)->>'duplicate' = 'false', :'a71e');

-- ── A3 DELETE / TRUNCATE / reescritura por service_role en las tablas de evidencia ──
SET ROLE service_role;
SELECT rt.try(format('DELETE FROM public.ai_reservation_events WHERE reservation_id = %L', :'id71')) AS del_evt \gset
SELECT rt.try('TRUNCATE public.ai_reservation_events') AS trunc_evt \gset
SELECT rt.try(format('DELETE FROM public.ai_reservation_inbound WHERE id = %L', :'i71d')) AS del_inb \gset
SELECT rt.try('TRUNCATE public.ai_reservation_inbound CASCADE') AS trunc_inb \gset
SELECT rt.try(format($q$UPDATE public.ai_reservation_inbound SET status = 'done', outcome = 'reescrito', duplicate_of = NULL WHERE id = %L$q$, :'i71c')) AS upd_inb_status \gset
SELECT rt.try(format($q$SELECT public.ai_reservation_inbound_finish(%L, 'done', 'reescrito')$q$, :'i71c')) AS fin_inb_status \gset
SELECT rt.try(format('DELETE FROM public.ai_reservations WHERE id = %L', :'id71')) AS del_res \gset
SELECT rt.try('TRUNCATE public.ai_reservations CASCADE') AS trunc_res \gset
RESET ROLE;
SELECT rt.ok('R2-A3a DELETE y TRUNCATE de ai_reservation_events (service_role) → rechazados',
  :'del_evt' LIKE '42501%' AND :'trunc_evt' LIKE '42501%' AND (SELECT count(*) FROM ai_reservation_events WHERE reservation_id = :'id71') > 0,
  :'del_evt' || ' | ' || :'trunc_evt');
SELECT rt.ok('R2-A3b DELETE y TRUNCATE de ai_reservation_inbound sellado (service_role) → rechazados',
  :'del_inb' LIKE '42501%' AND :'trunc_inb' LIKE '42501%' AND EXISTS (SELECT 1 FROM ai_reservation_inbound WHERE id = :'i71d'), :'del_inb' || ' | ' || :'trunc_inb');
SELECT rt.ok('R2-A3c status/outcome/duplicate_of de un inbound sellado y terminado no se reescriben (ni directo ni por inbound_finish)',
  :'upd_inb_status' LIKE '42501%' AND :'fin_inb_status' LIKE '42501%'
  AND (SELECT status = 'duplicate' AND duplicate_of IS NOT NULL FROM ai_reservation_inbound WHERE id = :'i71c'), :'upd_inb_status' || ' | ' || :'fin_inb_status');
SELECT rt.ok('R2-A3d DELETE y TRUNCATE de ai_reservations (que borrarían la evidencia en cascada) → rechazados',
  :'del_res' LIKE '42501%' AND :'trunc_res' LIKE '42501%' AND EXISTS (SELECT 1 FROM ai_reservations WHERE id = :'id71'), :'del_res' || ' | ' || :'trunc_res');

-- ── A4/A6 decisiones: una confirmación válida y luego DELETE/TRUNCATE; una negación nunca confirma ──
SET ROLE service_role;
SELECT rt.sent(8, 'ChIJ_a2_place_0081', 'reservas@casaoaxaca.com.mx') AS id81 \gset
SELECT reply_token AS tok81 FROM ai_reservations WHERE id = :'id81' \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_81', 'em_81', :'tok81', 'casaoaxaca.com.mx'))->>'inbound_id' AS i81 \gset
SELECT public.ai_reservation_inbound_attach(:'i81', rt.ev('em_81', 'reservas@casaoaxaca.com.mx', rt.pass(), 'Confirmamos su reserva.', '<m81@casaoaxaca.com.mx>', true)) IS NOT NULL AS x \gset
SELECT rt.try(format('SELECT public.ai_reservation_apply_reply(%L, %L, %L)', :'id81', :'i81',
  rt.dec(rt.conf(:'id81', :'i81', 'em_81', 'Confirmamos su reserva.', NULL, rt.conds(:'id81', 'thread_quote'))))) AS pos81 \gset
SELECT rt.sent(8, 'ChIJ_a2_place_0082', 'reservas@casa82.mx') AS id82 \gset
SELECT reply_token AS tok82 FROM ai_reservations WHERE id = :'id82' \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_82', 'em_82', :'tok82', 'casa82.mx'))->>'inbound_id' AS i82 \gset
SELECT public.ai_reservation_inbound_attach(:'i82', rt.ev('em_82', 'reservas@casa82.mx', rt.pass(), 'Su reserva aún no está confirmada.', '<m82@casa82.mx>', true)) IS NOT NULL AS x \gset
SELECT rt.try(format('SELECT public.ai_reservation_apply_reply(%L, %L, %L)', :'id82', :'i82',
  rt.dec(rt.conf(:'id82', :'i82', 'em_82', 'está confirmada', NULL, rt.conds(:'id82', 'thread_quote'))))) AS neg \gset
SELECT rt.try(format('DELETE FROM public.ai_reservation_decisions WHERE inbound_id = %L', :'i81')) AS del_dec \gset
SELECT rt.try('TRUNCATE public.ai_reservation_decisions') AS trunc_dec \gset
RESET ROLE;
SELECT rt.ok('R2-A0 control: confirmación con evidencia completa y la cita del hilo → confirmed', :'pos81' = 'OK'
  AND (SELECT status FROM ai_reservations WHERE id = :'id81') = 'confirmed', :'pos81');
SELECT rt.ok('R2-A6 negación "Su reserva aún no está confirmada." → el trigger la rechaza (reply_negated_confirmation)',
  :'neg' LIKE '23514%' AND :'neg' LIKE '%reply_negated_confirmation%' AND (SELECT status FROM ai_reservations WHERE id = :'id82') = 'sent', :'neg');
SELECT rt.ok('R2-A4a/b DELETE y TRUNCATE de ai_reservation_decisions (service_role) → rechazados', :'del_dec' LIKE '42501%' AND :'trunc_dec' LIKE '42501%',
  :'del_dec' || ' | ' || :'trunc_dec');
SELECT rt.ok('R2-A4c la reserva confirmada conserva su decisión registrada',
  (SELECT count(*) FROM ai_reservation_decisions WHERE reservation_id = :'id81') = 1 AND (SELECT status FROM ai_reservations WHERE id = :'id81') = 'confirmed');

-- ── A7 escritura directa con service_role + set_config('aires.actor') ──
SET ROLE service_role;
SELECT rt.try(format($q$SELECT set_config('aires.actor', 'sistema', false); UPDATE public.ai_reservations SET confirmation_code = 'FALSO-1', confirmation = confirmation || '{"quote":"Confirmamos todo"}', requested_local = split_part(requested_local, 'T', 1) || 'T23:45' WHERE id = %L$q$, :'id81')) AS rewrite \gset
SELECT set_config('aires.actor', '', false) IS NOT NULL AS x \gset
SELECT rt.sent(9, 'ChIJ_a2_place_0091', 'reservas@casa91.mx') AS id91 \gset
SELECT rt.try($q$SELECT set_config('aires.actor', 'equipo', false); UPDATE public.ai_reservations SET status='confirmed', confirmation='{"channel":"equipo","confirmed_by":"xx","evidence":"nada"}' WHERE venue_email = 'reservas@casa91.mx'$q$) AS eq_direct \gset
SELECT set_config('aires.actor', '', false) IS NOT NULL AS x \gset
SELECT rt.try($q$SELECT set_config('aires.actor', 'usuario', false); INSERT INTO public.ai_reservations (user_id, ref_code, reply_token, venue_name, venue_timezone, requested_local, requested_for, party_size, customer_name) VALUES (rt.u(9), 'R-ZZZ999', repeat('e', 24), 'X', 'UTC', '2027-01-01T20:00', now() + interval '30 days', 2, 'X')$q$) AS ins_direct \gset
SELECT set_config('aires.actor', '', false) IS NOT NULL AS x \gset
RESET ROLE;
SELECT rt.ok('R2-A7 service_role con aires.actor no reescribe una reserva confirmada (código, cita, hora)',
  :'rewrite' LIKE '42501%' AND (SELECT requested_local NOT LIKE '%T23:45' AND confirmation_code IS DISTINCT FROM 'FALSO-1'
    AND confirmation->>'quote' = 'Confirmamos su reserva.' FROM ai_reservations WHERE id = :'id81'), :'rewrite');
SELECT rt.ok('R2-A7b service_role con aires.actor=equipo no confirma por UPDATE directo ni inserta filas',
  :'eq_direct' LIKE '42501%' AND :'ins_direct' LIKE '42501%' AND (SELECT status FROM ai_reservations WHERE id = :'id91') = 'sent',
  :'eq_direct' || ' | ' || :'ins_direct');
-- Reescritura de una confirmada incluso por una función del servidor (dueño): los datos confirmados se congelan.
SELECT rt.try(format($q$SELECT set_config('aires.actor', 'sistema', true); UPDATE public.ai_reservations SET party_size = 9 WHERE id = %L$q$, :'id81')) AS owner_rewrite \gset
SELECT rt.ok('R2-A7c una reserva confirmada no cambia fecha, personas, cita ni código (ni como dueño)', :'owner_rewrite' NOT LIKE 'OK%'
  AND (SELECT party_size FROM ai_reservations WHERE id = :'id81') = 4, :'owner_rewrite');

-- ── A5 ¿quién puede llamar apply_reply y compañía? (sin cambios: solo service_role) ──
SELECT rt.ok('R2-A5 apply_reply, attach, transition, mark_sent, claim_alternative: ni anon ni authenticated',
  bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('authenticated', f, 'EXECUTE')))
FROM unnest(ARRAY['public.ai_reservation_apply_reply(uuid,uuid,jsonb)', 'public.ai_reservation_inbound_attach(uuid,jsonb)',
  'public.ai_reservation_transition(uuid,text,text,uuid,text,jsonb)', 'public.ai_res_confirmation_failures(uuid,text,text,integer,jsonb,text)',
  'public.ai_reservation_mark_sent(uuid,text,boolean,text,text)', 'public.ai_reservation_claim_alternative(uuid,uuid,integer)']) f;

-- ── A8 remitente en SQL con buzones compartidos y valores inesperados ──
SELECT rt.ok('R2-A8a/b atacante@live.fr / wanadoo.fr / yahoo.co.uk / infinitummail.com como el restaurante del mismo proveedor → no',
  NOT public.ai_res_sender_strong('atacante@live.fr', 'resto@live.fr', rt.pass())
  AND NOT public.ai_res_sender_strong('atacante@wanadoo.fr', 'resto@wanadoo.fr', rt.pass(), 'https://www.wanadoo.fr/resto')
  AND NOT public.ai_res_sender_strong('atacante@yahoo.co.uk', 'resto@yahoo.co.uk', rt.pass())
  AND NOT public.ai_res_sender_strong('atacante@infinitummail.com', 'resto@infinitummail.com', rt.pass())
  AND NOT public.ai_res_sender_strong('atacante@buzon-nuevo.example', 'resto@buzon-nuevo.example', rt.pass(), 'https://casaoaxaca.com.mx/')
  AND public.ai_res_sender_strong('resto@live.fr', 'resto@live.fr', rt.pass()));
SELECT rt.ok('R2-A8c DMARC fuera de la lista ("failed", "permerror", "none", ausente, arreglo) → no, aun con la dirección exacta',
  NOT public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass","dmarc":"failed"}')
  AND NOT public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass","dmarc":"permerror"}')
  AND NOT public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass","dmarc":"none"}')
  AND NOT public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass"}')
  AND NOT public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass","dmarc":["pass"]}')
  AND public.ai_res_sender_strong('reservas@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"dkim":"pass","dmarc":"gray"}'));
SELECT rt.ok('R2-A8d DMARC pass solo por SPF, otro buzón: no sin dominio propio; sí con el sitio oficial en ese dominio',
  NOT public.ai_res_sender_strong('otro@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"spf":"pass","dkim":"fail","dmarc":"pass"}')
  AND public.ai_res_sender_strong('otro@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', '{"spf":"pass","dkim":"fail","dmarc":"pass"}', 'https://casaoaxaca.com.mx/')
  AND NOT public.ai_res_sender_strong('otro@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', rt.pass(), 'http://casaoaxaca.com.mx/')
  AND NOT public.ai_res_sender_strong('otro@casaoaxaca.com.mx', 'reservas@casaoaxaca.com.mx', rt.pass(), 'https://casaoaxaca.com.mx.evil.test/'));

-- ── A9 el mismo inbound no sirve para una segunda decisión ──
SET ROLE service_role;
SELECT rt.sent(10, 'ChIJ_a2_place_0101', 'reservas@casa101.mx') AS id101 \gset
SELECT reply_token AS tok101 FROM ai_reservations WHERE id = :'id101' \gset
SELECT (public.ai_reservation_inbound_claim('a2_evt_101', 'em_101', :'tok101', 'casa101.mx'))->>'inbound_id' AS i101 \gset
SELECT public.ai_reservation_inbound_attach(:'i101', rt.ev('em_101', 'reservas@casa101.mx', rt.pass(), 'Confirmamos su reserva para 4 personas.', '<m101@casa101.mx>', true)) IS NOT NULL AS x \gset
SELECT (public.ai_reservation_apply_reply(:'id101', :'i101', jsonb_build_object('outcome','ambiguous','excerpt','x','inbound_email_id','em_101','log',jsonb_build_object('model','m'))))->>'status' AS first \gset
SELECT rt.try(format('SELECT public.ai_reservation_apply_reply(%L, %L, %L)', :'id101', :'i101',
  rt.dec(rt.conf(:'id101', :'i101', 'em_101', 'Confirmamos su reserva para 4 personas')))) AS second \gset
RESET ROLE;
SELECT rt.ok('R2-A9 un inbound ya decidido no admite otra decisión (ambiguous y luego confirmed → rechazado)',
  :'first' = 'venue_replied' AND :'second' NOT LIKE 'OK%' AND (SELECT status FROM ai_reservations WHERE id = :'id101') = 'venue_replied'
  AND (SELECT count(*) FROM ai_reservation_decisions WHERE inbound_id = :'i101') = 1, :'second');

-- ── A10 vetos léxicos en SQL (mismas frases que Vitest) ──
SELECT rt.ok('R2-A10 negaciones y cancelaciones (es/en/fr/pt) se vetan en SQL; las confirmaciones reales no',
  bool_and(cardinality(public.ai_res_reply_vetoes(t)) > 0) FILTER (WHERE neg)
  AND bool_and(cardinality(public.ai_res_reply_vetoes(t)) = 0) FILTER (WHERE NOT neg),
  string_agg(CASE WHEN (cardinality(public.ai_res_reply_vetoes(t)) > 0) <> neg THEN t END, ' | '))
FROM (VALUES
  ('Su reserva aún no está confirmada.', true), ('No hemos reservado su mesa todavía.', true), ('No le hemos apartado la mesa.', true),
  ('Su reserva confirmada fue cancelada.', true), ('Your reservation is not confirmed yet.', true), ('We have not confirmed your booking.', true),
  ('Your confirmed booking has been cancelled.', true), ('Sua reserva não está confirmada.', true), ('Não confirmamos a reserva.', true),
  ('Votre réservation n''est pas encore confirmée.', true), ('Nous n''avons pas réservé votre table.', true), ('Votre réservation confirmée a été annulée.', true),
  ('A sua reserva confirmada foi cancelada.', true), ('We haven''t booked your table yet.', true), ('Todavía no está confirmada.', true),
  ('Confirmamos su reserva para 4 personas.', false), ('Confirmado. No dude en escribirnos si tiene alguna duda.', false),
  ('Confirmado. Si necesita cancelar, avísenos con anticipación.', false), ('Confirmed. Our cancellation policy applies.', false),
  ('Confirmado, sin problema.', false), ('A las 20:30 no hay lugar. Les apartamos una mesa a las 21:15 para 4 personas.', false),
  ('Nous confirmons votre table. En cas d''annulation, merci de nous prévenir.', false)) v(t, neg);
DROP SCHEMA rt CASCADE;
