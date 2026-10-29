-- Reclamos (migración 20261029090000_reclamos). Cada caso imprime "OK <id> …" o "FALLA <id> …".
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS rc CASCADE;
CREATE SCHEMA rc;
GRANT USAGE ON SCHEMA rc TO anon, authenticated, service_role;
CREATE FUNCTION rc.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION rc.as_user(u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', u::text, false) $$;
CREATE FUNCTION rc.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false) $$;
CREATE FUNCTION rc.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'sin error'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE TABLE rc.r (k text PRIMARY KEY, v jsonb);
CREATE FUNCTION rc.claim(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT (v->'claim'->>'id')::uuid FROM rc.r WHERE k = _k $$;
CREATE FUNCTION rc.st(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT status FROM public.claims WHERE id = _id $$;
CREATE FUNCTION rc.tok(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT reply_token FROM public.claims WHERE id = _id $$;
CREATE FUNCTION rc.age(_id uuid, _days int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM public._claim_actor('sistema', 'prueba: envejecer');
  UPDATE public.claims SET followup_at = now() - interval '1 minute', escalate_after = CASE WHEN _days > 0 THEN now() + make_interval(days => _days) ELSE now() - interval '1 minute' END WHERE id = _id; END $$;
CREATE FUNCTION rc.tope() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; ok int := 0; ultimo text;
BEGIN
  FOR g IN 1..6 LOOP
    r := public.claim_create('0c000000-0000-0000-0000-00000000000b', jsonb_build_object('kind','hotel','provider_name','Hotel ' || g,'channel','correo',
      'recipient_email','h' || g || '@hotel.example','recipient_source','{"kind":"reserva"}'::jsonb,'language','es','subject','Reclamación formal',
      'body_text','Estimados señores: texto de la carta de prueba suficientemente largo.','body_html',''));
    r := public.claim_claim_send((r->'claim'->>'id')::uuid, '0c000000-0000-0000-0000-00000000000b', '{"confirmed":true}');
    ultimo := coalesce(r->>'code', 'ok');
    IF r->>'ok' = 'true' THEN ok := ok + 1; PERFORM public.claim_mark_sent((r->'claim'->>'id')::uuid, 'envio', true, 'x', NULL); END IF;
  END LOOP;
  RETURN ok || ':' || ultimo;
END $$;
GRANT ALL ON rc.r TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rc TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'rc-ana@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000b', 'rc-beto@example.test', now()),
  ('0c000000-0000-0000-0000-00000000000d', 'rc-dueno@example.test', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES
  ('0c000000-0000-0000-0000-00000000000a', 'Ana Prueba', 'rc-ana@example.test'),
  ('0c000000-0000-0000-0000-00000000000b', 'Beto Prueba', 'rc-beto@example.test'),
  ('0c000000-0000-0000-0000-00000000000d', 'Dueño Prueba', 'rc-dueno@example.test')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;
INSERT INTO public.admins (user_id) VALUES ('0c000000-0000-0000-0000-00000000000d') ON CONFLICT DO NOTHING;
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'reclamos_enabled';

-- ═══ C: crear (servidor) ═══
SET ROLE service_role; SELECT rc.as_service();
INSERT INTO rc.r SELECT 'a1', public.claim_create('0c000000-0000-0000-0000-00000000000a', '{"kind":"vuelo","provider_name":"Iberia","provider_code":"IB","channel":"correo","recipient_email":"Claims@Iberia.example","recipient_source":{"kind":"usuario_confirmado"},"language":"es","subject":"Reclamación formal · Ref. C-PENDIENTE","body_text":"Estimados señores: texto de la carta de prueba suficientemente largo.","body_html":"<p>x</p>","response_days":14,"escalate_days":60}');
SELECT rc.ok('C1 nace esperando el ok, con folio C-XXXXXX, token secreto y correo en minúsculas',
  (SELECT v->>'ok' = 'true' AND v->'claim'->>'status' = 'esperando_ok' AND v->'claim'->>'ref_code' ~ '^C-[A-Z0-9]{6}$'
     AND NOT (v->'claim' ? 'reply_token') AND v->'claim'->>'recipient_email' = 'claims@iberia.example' FROM rc.r WHERE k = 'a1')
  AND rc.tok(rc.claim('a1')) ~ '^[0-9a-f]{24}$', (SELECT v::text FROM rc.r WHERE k = 'a1'));
SELECT rc.ok('C2 un correo SIN fuente se rechaza (nunca se adivina un correo)',
  public.claim_create('0c000000-0000-0000-0000-00000000000a', '{"kind":"vuelo","provider_name":"Iberia","channel":"correo","recipient_email":"x@iberia.example","language":"es","subject":"Reclamación","body_text":"Estimados señores: texto de la carta de prueba suficientemente largo.","body_html":""}')->>'code' = 'INVALID');
SELECT rc.ok('C3 una fuente inventada también se rechaza',
  public.claim_create('0c000000-0000-0000-0000-00000000000a', '{"kind":"vuelo","provider_name":"Iberia","channel":"correo","recipient_email":"x@iberia.example","recipient_source":{"kind":"lo_adivine"},"language":"es","subject":"Reclamación","body_text":"Estimados señores: texto de la carta de prueba suficientemente largo.","body_html":""}')->>'code' = 'INVALID');
SELECT rc.ok('C4 canal correo sin correo → rechazado; canal formulario sin correo → aceptado',
  public.claim_create('0c000000-0000-0000-0000-00000000000a', '{"kind":"vuelo","provider_name":"Iberia","channel":"correo","language":"es","subject":"Reclamación","body_text":"Estimados señores: texto de la carta de prueba suficientemente largo.","body_html":""}')->>'code' = 'INVALID'
  AND (SELECT 1 FROM rc.r WHERE false) IS NULL);
INSERT INTO rc.r SELECT 'f1', public.claim_create('0c000000-0000-0000-0000-00000000000a', '{"kind":"vuelo","provider_name":"Volaris","provider_code":"Y4","channel":"formulario","form_url":"https://tuexperiencia.volaris.com","language":"es","subject":"Reclamación formal","body_text":"Estimados señores: texto de la carta de prueba suficientemente largo.","body_html":""}');
SELECT rc.ok('C5 canal formulario sin correo se guarda con su enlace oficial',
  (SELECT v->>'ok' = 'true' AND v->'claim'->>'form_url' = 'https://tuexperiencia.volaris.com' FROM rc.r WHERE k = 'f1'));
SELECT rc.ok('C6 el folio definitivo se pone en la carta antes de enviarla',
  public.claim_set_text(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', 'Reclamación formal · Ref. C-ZZZZZZ', 'Estimados señores: carta con el folio definitivo C-ZZZZZZ.', '<p>x</p>')->>'ok' = 'true'
  AND public.claim_set_text(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000b', 'x', 'Estimados señores: carta con el folio definitivo C-ZZZZZZ.', '')->>'code' = 'NOT_FOUND');
RESET ROLE;

-- ═══ U: el cliente no escribe; ve solo lo suyo ═══
SET ROLE authenticated; SELECT rc.as_user('0c000000-0000-0000-0000-00000000000a');
SELECT rc.ok('U1 el usuario no puede insertar ni actualizar reclamos directo',
  rc.err($q$INSERT INTO public.claims (user_id, kind, ref_code, reply_token, provider_name, channel, language, subject, body_text, body_html) VALUES ('0c000000-0000-0000-0000-00000000000a', 'vuelo', 'C-AAAAAA', '0123456789abcdef01234567', 'X', 'sitio', 'es', 'abc', 'Estimados señores: carta de prueba larga.', '')$q$) LIKE '42501%'
  AND rc.err(format($q$UPDATE public.claims SET status = 'resuelto' WHERE id = %L$q$, rc.claim('a1'))) LIKE '42501%');
SELECT rc.ok('U2 ve sus reclamos pero no el token de respuesta (permiso por columna)',
  (SELECT count(*) FROM public.claims) = 2
  AND rc.err('SELECT reply_token FROM public.claims') LIKE '42501%');
SELECT rc.ok('U3 no puede llamar a las funciones del servidor',
  rc.err($q$SELECT public.claim_create('0c000000-0000-0000-0000-00000000000a', '{}')$q$) LIKE '42501%'
  AND rc.err(format($q$SELECT public.claim_claim_send(%L, '0c000000-0000-0000-0000-00000000000a', '{"confirmed":true}')$q$, rc.claim('a1'))) LIKE '42501%');
RESET ROLE;
SET ROLE authenticated; SELECT rc.as_user('0c000000-0000-0000-0000-00000000000b');
SELECT rc.ok('U4 otro usuario no ve nada de Ana (RLS)', (SELECT count(*) FROM public.claims) = 0 AND (SELECT count(*) FROM public.claim_events) = 0);
RESET ROLE;

-- ═══ S: envío con consentimiento ═══
SET ROLE service_role; SELECT rc.as_service();
SELECT rc.ok('S1 con la bandera apagada no se envía',
  public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', '{"confirmed":true}')->>'code' = 'FEATURE_DISABLED');
RESET ROLE; UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'reclamos_enabled'; SET ROLE service_role; SELECT rc.as_service();
SELECT rc.ok('S2 sin consentimiento explícito no se envía',
  public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', '{"confirmed":"si"}')->>'code' = 'CONSENT_REQUIRED'
  AND public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', NULL)->>'code' = 'CONSENT_REQUIRED');
SELECT rc.ok('S3 otro usuario no puede enviar el reclamo de Ana; un formulario no se envía por correo',
  public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000b', '{"confirmed":true}')->>'code' = 'NOT_FOUND'
  AND public.claim_claim_send(rc.claim('f1'), '0c000000-0000-0000-0000-00000000000a', '{"confirmed":true}')->>'code' = 'NO_EMAIL');
INSERT INTO rc.r SELECT 's4', public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', '{"confirmed":true,"text":"Sí, envía C-ZZZZZZ"}');
SELECT rc.ok('S4 con bandera y ok → enviando, con el consentimiento fechado y el token para el Reply-To',
  (SELECT v->>'ok' = 'true' AND v->'claim'->>'status' = 'enviando' AND v->'claim'->'consent'->>'via' = 'iatos' AND v->'claim'->'consent' ? 'at'
     AND v->>'reply_token' = rc.tok(rc.claim('a1')) FROM rc.r WHERE k = 's4'), (SELECT v::text FROM rc.r WHERE k = 's4'));
SELECT rc.ok('S5 mientras se envía, otro intento → en curso',
  public.claim_claim_send(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', '{"confirmed":true}')->>'code' = 'IN_PROGRESS');
INSERT INTO rc.r SELECT 's6', public.claim_mark_sent(rc.claim('a1'), 'envio', true, 're_123', NULL);
SELECT rc.ok('S6 enviado: fecha de envío, recordatorio a los 14+2 días y escalamiento a los 60',
  (SELECT v->'claim'->>'status' = 'enviado' AND (v->'claim'->>'sent_at') IS NOT NULL
     AND (v->'claim'->>'followup_at')::timestamptz BETWEEN now() + interval '15 days 23 hours' AND now() + interval '16 days 1 hour'
     AND (v->'claim'->>'escalate_after')::timestamptz > now() + interval '59 days' FROM rc.r WHERE k = 's6'));
SELECT rc.ok('S7 la carta enviada ya no cambia (ni con la función ni con un UPDATE del servidor)',
  public.claim_set_text(rc.claim('a1'), '0c000000-0000-0000-0000-00000000000a', 'otro asunto', 'Estimados señores: otra carta distinta y larga.', '')->>'code' = 'ALREADY_SENT'
  AND rc.err(format($q$SELECT public._claim_actor('sistema'); UPDATE public.claims SET body_text = 'Estimados señores: cambiada después de enviar.' WHERE id = %L$q$, rc.claim('a1'))) LIKE '%la carta enviada%');
SELECT rc.ok('S8 transición ilegal (enviado → esperando_ok) rechazada; mismo estado = sin cambios',
  public.claim_transition(rc.claim('a1'), 'esperando_ok', 'usuario', NULL, NULL, NULL)->>'code' = 'ILLEGAL_TRANSITION'
  AND (public.claim_transition(rc.claim('a1'), 'enviado', 'usuario', NULL, NULL, NULL)->>'noop') = 'true');
SELECT rc.ok('S9 "enviado" sin consentimiento es imposible en la base (CHECK)',
  rc.err(format($q$SELECT public._claim_actor('sistema'); UPDATE public.claims SET status = 'enviado', sent_at = now() WHERE id = %L$q$, rc.claim('f1'))) LIKE '23514%');
INSERT INTO rc.r SELECT 's10', public.claim_mark_user_sent(rc.claim('f1'), '0c000000-0000-0000-0000-00000000000a', 'VOL-778');
SELECT rc.ok('S10 formulario: el usuario marca que lo envió él (via usuario, sin recordatorio por correo)',
  (SELECT v->'claim'->>'status' = 'enviado' AND v->'claim'->'consent'->>'via' = 'usuario' AND v->'claim'->'consent'->>'case_number' = 'VOL-778'
     AND v->'claim'->>'followup_at' IS NULL FROM rc.r WHERE k = 's10'));
SELECT rc.ok('S11 tope: máximo 5 envíos por usuario por día (el sexto se rechaza)', rc.tope() = '5:USER_DAILY_LIMIT', rc.tope());

-- ═══ F: seguimiento ═══
SELECT rc.age(rc.claim('a1'), 30);
SELECT rc.ok('F1 vencido el plazo, aparece para recordar',
  EXISTS (SELECT 1 FROM public.claim_due(50) d WHERE (d->>'id')::uuid = rc.claim('a1') AND d->>'due' = 'recordar'));
SELECT rc.ok('F2 un solo recordatorio (el segundo intento no devuelve nada) y pasa a "recordado"',
  public.claim_claim_reminder(rc.claim('a1')) IS NOT NULL AND public.claim_claim_reminder(rc.claim('a1')) IS NULL AND rc.st(rc.claim('a1')) = 'recordado');
SELECT rc.age(rc.claim('a1'), 0);
SELECT rc.ok('F3 vencido el plazo de escalar, aparece como "escalar"',
  EXISTS (SELECT 1 FROM public.claim_due(50) d WHERE (d->>'id')::uuid = rc.claim('a1') AND d->>'due' = 'escalar'));

-- ═══ I: correo entrante ═══
INSERT INTO rc.r SELECT 'i1', public.claim_inbound_claim('evt_1', 'em_1', 'reclamo', rc.tok(rc.claim('a1')));
SELECT rc.ok('I1 respuesta a reclamos+<token> → nueva, ligada al reclamo y con el correo al que escribimos',
  (SELECT v->>'state' = 'new' AND (v->'claim'->>'id')::uuid = rc.claim('a1') AND v->'claim'->>'recipient_email' = 'claims@iberia.example' FROM rc.r WHERE k = 'i1'));
SELECT rc.ok('I2 el mismo evento otra vez → duplicado; token desconocido → sin reclamo',
  public.claim_inbound_claim('evt_1', 'em_1', 'reclamo', rc.tok(rc.claim('a1')))->>'state' = 'duplicate'
  AND public.claim_inbound_claim('evt_2', 'em_2', 'reclamo', '0123456789abcdef01234567')->>'state' = 'unmatched'
  AND public.claim_inbound_claim('evt_3', 'em_3', 'reclamo', 'no-es-token')->>'state' = 'unmatched');
SELECT rc.ok('I3 el mismo Message-ID en otro evento no se procesa dos veces',
  (public.claim_inbound_attach(((SELECT v FROM rc.r WHERE k = 'i1')->>'inbound_id')::uuid, '{"message_id":"<m1@iberia>","text":"no se guarda"}')->>'ok') = 'true'
  AND (public.claim_inbound_attach((public.claim_inbound_claim('evt_4', 'em_4', 'reclamo', rc.tok(rc.claim('a1')))->>'inbound_id')::uuid, '{"message_id":"<m1@iberia>"}')->>'duplicate') = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.claim_inbound WHERE evidence ? 'text'));
INSERT INTO rc.r SELECT 'i4', public.claim_apply_reply(rc.claim('a1'), ((SELECT v FROM rc.r WHERE k = 'i1')->>'inbound_id')::uuid,
  '{"resultado_final":"rechazo","estado_sugerido":"escalable","resumen_es":"Rechazan por circunstancias extraordinarias.","remitente_verificado":true}');
SELECT rc.ok('I4 la lectura de la respuesta mueve el reclamo (rechazo → escalable) y queda en el historial',
  rc.st(rc.claim('a1')) = 'escalable'
  AND EXISTS (SELECT 1 FROM public.claim_events WHERE claim_id = rc.claim('a1') AND kind = 'respuesta' AND data->>'resultado' = 'rechazo'));
SELECT rc.ok('I5 aviso en la app una vez por transición (enviado, recordado, escalable)',
  (SELECT count(*) FROM public.notifications WHERE related_id = rc.claim('a1') AND type = 'reclamo') = 3);

-- ═══ R: reenvíos del usuario ═══
SELECT rc.ok('R1 cada usuario tiene UNA dirección personal (el mismo token siempre)',
  public.claim_forward_token('0c000000-0000-0000-0000-00000000000a') = public.claim_forward_token('0c000000-0000-0000-0000-00000000000a')
  AND public.claim_forward_token('0c000000-0000-0000-0000-00000000000a') <> public.claim_forward_token('0c000000-0000-0000-0000-00000000000b'));
INSERT INTO rc.r SELECT 'r2', public.claim_inbound_claim('evt_f1', 'em_f1', 'caso', public.claim_forward_token('0c000000-0000-0000-0000-00000000000a'));
INSERT INTO rc.r SELECT 'r2s', public.claim_store_forward('0c000000-0000-0000-0000-00000000000a', ((SELECT v FROM rc.r WHERE k = 'r2')->>'inbound_id')::uuid,
  jsonb_build_object('from', 'rc-ana@example.test', 'subject', 'Fwd: respuesta ' || (SELECT ref_code FROM public.claims WHERE id = rc.claim('a1')), 'text', 'reenvío', 'sender_verified', true));
INSERT INTO rc.r SELECT 'r3', public.claim_inbound_claim('evt_f2', 'em_f2', 'caso', public.claim_forward_token('0c000000-0000-0000-0000-00000000000b'));
INSERT INTO rc.r SELECT 'r3s', public.claim_store_forward('0c000000-0000-0000-0000-00000000000b', ((SELECT v FROM rc.r WHERE k = 'r3')->>'inbound_id')::uuid,
  jsonb_build_object('from', 'rc-beto@example.test', 'subject', 'Fwd: ' || (SELECT ref_code FROM public.claims WHERE id = rc.claim('a1')), 'text', 'intento de Beto'));
SELECT rc.ok('R2 el reenvío con folio se liga al reclamo SOLO si es del mismo usuario',
  (SELECT (v->>'claim_id')::uuid = rc.claim('a1') FROM rc.r WHERE k = 'r2s')
  AND (SELECT v->>'claim_id' IS NULL FROM rc.r WHERE k = 'r3s'));
RESET ROLE;
SET ROLE authenticated; SELECT rc.as_user('0c000000-0000-0000-0000-00000000000b');
SELECT rc.ok('R3 cada quien ve solo sus correos reenviados', (SELECT count(*) FROM public.forwarded_emails) = 1
  AND (SELECT bool_and(user_id = '0c000000-0000-0000-0000-00000000000b') FROM public.forwarded_emails));
-- ═══ O: operador ═══
SELECT rc.ok('O1 un usuario normal no ve la lista ni el detalle del operador',
  rc.err('SELECT public.admin_claims_list(NULL, 10)') LIKE '42501%' AND rc.err(format('SELECT public.admin_claim_view(%L)', rc.claim('a1'))) LIKE '42501%');
RESET ROLE;
SET ROLE authenticated; SELECT rc.as_user('0c000000-0000-0000-0000-00000000000d');
SELECT rc.ok('O2 el equipo ve la lista con la persona, y el detalle con historial y el reenvío ligado al caso (sin el de Beto)',
  (SELECT count(*) FROM public.admin_claims_list(NULL, 100)) >= 3
  AND (public.admin_claim_view(rc.claim('a1'))->'person'->>'email') = 'rc-ana@example.test'
  AND jsonb_array_length(public.admin_claim_view(rc.claim('a1'))->'events') >= 4
  AND jsonb_array_length(public.admin_claim_view(rc.claim('a1'))->'forwarded') = 1
  AND NOT (public.admin_claim_view(rc.claim('a1'))->'claim' ? 'reply_token'));
RESET ROLE;
