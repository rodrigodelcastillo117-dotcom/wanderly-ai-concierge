-- Reclamos (29-oct-2026): motor de derechos y reclamaciones del "Operador IATOS".
-- Diseño y fuentes: docs/iatos/IATOS_DERECHOS_RECLAMOS.md. Lógica: supabase/functions/_shared/derechos/.
--
-- Qué guarda:
--   claims            un reclamo (a una aerolínea, hotel, traslado, agencia u organismo) con su carta, su
--                     destinatario y DE DÓNDE salió el correo del destinatario (nunca se adivina uno).
--   claim_events      historial de cada cambio (quién, cuándo, de qué estado a cuál).
--   claim_inbound     cada correo recibido (respuesta del proveedor o correo reenviado por el usuario):
--                     idempotencia por evento de Svix y por Message-ID, y la huella de la evidencia.
--   claim_forward_tokens   la dirección personal casos+<token>@reply.traveliatos.life de cada usuario.
--   forwarded_emails  correos que el usuario reenvió a su dirección personal (confirmaciones, respuestas).
--
-- Reglas que la BASE hace cumplir (no solo el código):
--   * Nadie escribe directo: un trigger exige que la escritura venga de estas funciones (claims.actor).
--   * Un correo de destinatario necesita fuente ('directorio_oficial','correo_del_proveedor','reserva',
--     'usuario_confirmado'); el canal 'correo' necesita destinatario.
--   * Un reclamo que IATOS envió por correo necesita consentimiento explícito con fecha (consent.confirmed
--     = true y consent.at) y fecha de envío.
--   * Transiciones permitidas por tabla; un solo recordatorio al proveedor; topes por usuario y día.
--   * Apagado por defecto: app_flags.reclamos_enabled = false → no sale ningún correo.
-- Idempotente.

INSERT INTO public.app_flags (key, value, note) VALUES
  ('reclamos_enabled', 'false'::jsonb,
   'Reclamos: IATOS envía reclamaciones por correo en nombre del usuario (con su consentimiento) y lee las respuestas')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────── Tablas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  trip_id            uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  parent_id          uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  incident_id        text CHECK (incident_id IS NULL OR length(incident_id) <= 80),
  kind               text NOT NULL CHECK (kind IN ('vuelo','hotel','traslado','agencia','tour','otro')),
  target             text NOT NULL DEFAULT 'proveedor' CHECK (target IN ('proveedor','organismo')),
  status             text NOT NULL DEFAULT 'esperando_ok' CHECK (status IN (
                       'esperando_ok','enviando','enviado','recordado','respondido','necesita_usuario',
                       'escalable','escalado','resuelto','cerrado','cancelado','fallido')),
  ref_code           text NOT NULL UNIQUE CHECK (ref_code ~ '^C-[A-Z0-9]{6}$'),
  reply_token        text NOT NULL UNIQUE CHECK (reply_token ~ '^[0-9a-f]{24}$'),
  provider_name      text NOT NULL CHECK (length(btrim(provider_name)) BETWEEN 1 AND 200),
  provider_code      text CHECK (provider_code IS NULL OR provider_code ~ '^[A-Z0-9_]{2,20}$'),
  channel            text NOT NULL CHECK (channel IN ('correo','formulario','telefono','sitio')),
  recipient_email    text CHECK (recipient_email IS NULL OR (length(recipient_email) <= 200 AND recipient_email ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$')),
  recipient_source   jsonb,
  form_url           text CHECK (form_url IS NULL OR (form_url ~ '^https?://' AND length(form_url) <= 500)),
  language           text NOT NULL CHECK (language IN ('es','en','pt','fr')),
  subject            text NOT NULL CHECK (length(subject) BETWEEN 3 AND 300),
  body_text          text NOT NULL CHECK (length(body_text) BETWEEN 20 AND 20000),
  body_html          text NOT NULL CHECK (length(body_html) <= 60000),
  evaluation         jsonb NOT NULL DEFAULT '{}'::jsonb,
  request            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(request) = 'array'),
  response_days      int NOT NULL DEFAULT 14 CHECK (response_days BETWEEN 1 AND 90),
  escalate_days      int NOT NULL DEFAULT 30 CHECK (escalate_days BETWEEN 1 AND 120),
  consent            jsonb,
  sent_at            timestamptz,
  send_lock_at       timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  last_error         text CHECK (last_error IS NULL OR length(last_error) <= 500),
  followup_at        timestamptz,
  escalate_after     timestamptz,
  reminders_sent     int NOT NULL DEFAULT 0 CHECK (reminders_sent BETWEEN 0 AND 1),
  last_reply_at      timestamptz,
  reply              jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  -- coalesce(…, false): con recipient_source NULL la expresión daría NULL y un CHECK con NULL PASA.
  CONSTRAINT claims_email_has_source CHECK (recipient_email IS NULL OR coalesce(
    jsonb_typeof(recipient_source) = 'object'
    AND recipient_source->>'kind' IN ('directorio_oficial','correo_del_proveedor','reserva','usuario_confirmado'), false)),
  CONSTRAINT claims_correo_needs_email CHECK (channel <> 'correo' OR recipient_email IS NOT NULL),
  CONSTRAINT claims_sent_needs_consent CHECK (
    status NOT IN ('enviado','recordado') OR coalesce(
      sent_at IS NOT NULL AND jsonb_typeof(consent) = 'object' AND consent ? 'at'
      AND (consent->>'via' = 'usuario' OR (consent->>'via' = 'iatos' AND consent->>'confirmed' = 'true')), false))
);
CREATE INDEX IF NOT EXISTS claims_user ON public.claims (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS claims_due ON public.claims (status, followup_at, escalate_after) WHERE status IN ('enviado','recordado');

CREATE TABLE IF NOT EXISTS public.claim_events (
  id          bigserial PRIMARY KEY,
  claim_id    uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (length(kind) BETWEEN 2 AND 40),
  from_status text,
  to_status   text,
  actor       text NOT NULL CHECK (actor IN ('usuario','sistema','proveedor','equipo','iato')),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_events_claim ON public.claim_events (claim_id, created_at);

CREATE TABLE IF NOT EXISTS public.claim_inbound (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    text NOT NULL UNIQUE CHECK (length(event_id) BETWEEN 1 AND 200),
  email_id    text NOT NULL CHECK (length(email_id) BETWEEN 1 AND 200),
  kind        text NOT NULL CHECK (kind IN ('reclamo','caso')),
  user_id     uuid,
  claim_id    uuid REFERENCES public.claims(id) ON DELETE CASCADE,
  message_id  text CHECK (message_id IS NULL OR length(message_id) <= 998),
  status      text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done','failed','unmatched')),
  outcome     text CHECK (outcome IS NULL OR length(outcome) <= 60),
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS claim_inbound_message ON public.claim_inbound (message_id) WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.claim_forward_tokens (
  user_id    uuid PRIMARY KEY,
  token      text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{24}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.forwarded_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  claim_id      uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  inbound_id    uuid REFERENCES public.claim_inbound(id) ON DELETE SET NULL,
  from_address  text CHECK (from_address IS NULL OR length(from_address) <= 200),
  subject       text CHECK (subject IS NULL OR length(subject) <= 300),
  received_at   timestamptz,
  text_excerpt  text CHECK (text_excerpt IS NULL OR length(text_excerpt) <= 8000),
  body_sha256   text CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
  sender_verified boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forwarded_emails_user ON public.forwarded_emails (user_id, created_at DESC);

-- ───────────────────────────── RLS: el usuario lee lo suyo; nadie escribe desde el cliente ─────────────
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_forward_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forwarded_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.claims, public.claim_events, public.claim_inbound, public.claim_forward_tokens, public.forwarded_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.claims, public.claim_events, public.forwarded_emails TO authenticated;
GRANT ALL ON public.claims, public.claim_events, public.claim_inbound, public.claim_forward_tokens, public.forwarded_emails TO service_role;
GRANT USAGE ON SEQUENCE public.claim_events_id_seq TO service_role;

DROP POLICY IF EXISTS claims_select_own ON public.claims;
CREATE POLICY claims_select_own ON public.claims FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS claim_events_select_own ON public.claim_events;
CREATE POLICY claim_events_select_own ON public.claim_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.claims c WHERE c.id = claim_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS forwarded_emails_select_own ON public.forwarded_emails;
CREATE POLICY forwarded_emails_select_own ON public.forwarded_emails FOR SELECT TO authenticated USING (user_id = auth.uid());
-- El token de respuesta y el candado de envío no se exponen al cliente.
REVOKE SELECT ON public.claims FROM authenticated;
GRANT SELECT (id, user_id, trip_id, parent_id, incident_id, kind, target, status, ref_code, provider_name, provider_code, channel,
  recipient_email, recipient_source, form_url, language, subject, body_text, evaluation, request, response_days, escalate_days,
  consent, sent_at, followup_at, escalate_after, reminders_sent, last_reply_at, reply, created_at, updated_at, status_changed_at)
  ON public.claims TO authenticated;

-- ───────────────────────────── Transiciones y guardia ─────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_transition_ok(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _from
    WHEN 'esperando_ok'     THEN _to IN ('enviando','enviado','cancelado')
    WHEN 'enviando'         THEN _to IN ('enviado','fallido','esperando_ok')
    WHEN 'fallido'          THEN _to IN ('esperando_ok','enviando','cancelado')
    WHEN 'enviado'          THEN _to IN ('recordado','respondido','necesita_usuario','escalable','resuelto','cerrado','cancelado')
    WHEN 'recordado'        THEN _to IN ('respondido','necesita_usuario','escalable','resuelto','cerrado','cancelado')
    WHEN 'respondido'       THEN _to IN ('necesita_usuario','escalable','resuelto','cerrado','enviado')
    WHEN 'necesita_usuario' THEN _to IN ('enviado','respondido','escalable','resuelto','cerrado','cancelado')
    WHEN 'escalable'        THEN _to IN ('escalado','resuelto','cerrado','necesita_usuario')
    WHEN 'escalado'         THEN _to IN ('resuelto','cerrado')
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.claims_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_actor text := nullif(current_setting('claims.actor', true), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'claims: solo las funciones del servidor escriben aquí' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'esperando_ok' THEN RAISE EXCEPTION 'claims: un reclamo nace esperando el ok del usuario'; END IF;
    NEW.status_changed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reply_token IS DISTINCT FROM OLD.reply_token
     OR NEW.ref_code IS DISTINCT FROM OLD.ref_code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'claims: usuario, token, folio y fecha de alta no cambian';
  END IF;
  -- Lo que se envió no se reescribe: después del primer envío la carta queda fija.
  IF OLD.sent_at IS NOT NULL AND (NEW.body_text IS DISTINCT FROM OLD.body_text OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email) THEN
    RAISE EXCEPTION 'claims: la carta enviada y su destinatario no cambian';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.claim_transition_ok(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'claims: transición no permitida (% → %)', OLD.status, NEW.status;
    END IF;
    NEW.status_changed_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS claims_guard ON public.claims;
CREATE TRIGGER claims_guard BEFORE INSERT OR UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.claims_guard();

-- Aviso en la app por estado (una vez por transición). Textos honestos: nada se da por resuelto sin respuesta.
CREATE OR REPLACE FUNCTION public.claim_notice(_status text, _provider text, _ref text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _status
    WHEN 'enviado' THEN ARRAY['Reclamo enviado a ' || _provider, 'Folio ' || _ref || '. Te avisamos cuando respondan.']
    WHEN 'recordado' THEN ARRAY[_provider || ' no ha respondido', 'Les mandamos un recordatorio (folio ' || _ref || ').']
    WHEN 'respondido' THEN ARRAY[_provider || ' respondió tu reclamo', 'Revisa la respuesta y el siguiente paso en tu caso ' || _ref || '.']
    WHEN 'necesita_usuario' THEN ARRAY['Tu reclamo a ' || _provider || ' necesita algo de ti', 'Abre el caso ' || _ref || ' para ver qué piden.']
    WHEN 'escalable' THEN ARRAY['Podemos escalar tu reclamo a la autoridad', 'La carta está lista (caso ' || _ref || '); se envía solo si tú lo autorizas.']
    WHEN 'fallido' THEN ARRAY['No pudimos enviar tu reclamo a ' || _provider, 'No se envió nada. Puedes intentarlo de nuevo.']
    WHEN 'resuelto' THEN ARRAY['Reclamo resuelto', 'Caso ' || _ref || ' cerrado como resuelto.']
  END;
$$;

CREATE OR REPLACE FUNCTION public.claims_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_notice text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.claim_events (claim_id, kind, from_status, to_status, actor, note)
    VALUES (NEW.id, 'transicion', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('claims.actor', true), ''), 'sistema'),
            left(nullif(current_setting('claims.note', true), ''), 500));
    v_notice := public.claim_notice(NEW.status, left(NEW.provider_name, 120), NEW.ref_code);
    IF v_notice IS NOT NULL THEN
      PERFORM public.notify_once(NEW.user_id, 'reclamo', v_notice[1], v_notice[2], NEW.id,
        'claim:' || NEW.id || ':' || NEW.status || ':' || (extract(epoch FROM NEW.status_changed_at))::bigint);
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS claims_log ON public.claims;
CREATE TRIGGER claims_log AFTER INSERT OR UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.claims_log();

CREATE OR REPLACE FUNCTION public._claim_actor(_actor text, _note text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('claims.actor', _actor, true), set_config('claims.note', coalesce(_note, ''), true);
$$;

-- Vista JSON segura (sin token ni candado).
CREATE OR REPLACE FUNCTION public.claim_json(_c public.claims)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(_c) - 'reply_token' - 'send_lock_at' - 'last_error' $$;

-- ───────────────────────────── Funciones del servidor (service_role) ─────────────────────────────
-- Crear (nace esperando el ok). Topes: 10 reclamos abiertos y 20 nuevos por día por usuario.
CREATE OR REPLACE FUNCTION public.claim_create(_user_id uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_ref text; v_tok text; v_trip uuid; v_row public.claims;
BEGIN
  IF _user_id IS NULL OR _p IS NULL OR jsonb_typeof(_p) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('claims:' || _user_id::text, 0));
  IF (SELECT count(*) FROM public.claims WHERE user_id = _user_id AND status IN ('esperando_ok','enviando','enviado','recordado','respondido','necesita_usuario','escalable')) >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY_ACTIVE');
  END IF;
  IF (SELECT count(*) FROM public.claims WHERE user_id = _user_id AND created_at > now() - interval '1 day') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_DAILY_LIMIT');
  END IF;
  v_trip := nullif(_p->>'trip_id', '')::uuid;
  IF v_trip IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip AND user_id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  END IF;
  IF _p->>'parent_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.claims WHERE id = (_p->>'parent_id')::uuid AND user_id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  LOOP
    v_ref := 'C-' || upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    EXIT WHEN v_ref ~ '^C-[A-Z0-9]{6}$' AND NOT EXISTS (SELECT 1 FROM public.claims WHERE ref_code = v_ref);
  END LOOP;
  v_tok := encode(extensions.gen_random_bytes(12), 'hex');
  PERFORM public._claim_actor(coalesce(nullif(_p->>'actor', ''), 'usuario'), 'Reclamo preparado');
  INSERT INTO public.claims (user_id, trip_id, parent_id, kind, target, ref_code, reply_token, provider_name, provider_code, channel,
    recipient_email, recipient_source, form_url, language, subject, body_text, body_html, evaluation, request, response_days, escalate_days)
  VALUES (_user_id, v_trip, nullif(_p->>'parent_id', '')::uuid, _p->>'kind', coalesce(_p->>'target', 'proveedor'), v_ref, v_tok,
    _p->>'provider_name', nullif(_p->>'provider_code', ''), _p->>'channel', nullif(lower(_p->>'recipient_email'), ''),
    CASE WHEN jsonb_typeof(_p->'recipient_source') = 'object' THEN _p->'recipient_source' END, nullif(_p->>'form_url', ''),
    _p->>'language', _p->>'subject', _p->>'body_text', coalesce(_p->>'body_html', ''), coalesce(_p->'evaluation', '{}'::jsonb),
    coalesce(_p->'request', '[]'::jsonb), coalesce((_p->>'response_days')::int, 14), coalesce((_p->>'escalate_days')::int, 30))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(v_row));
EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
END $$;

-- Pone el folio definitivo en la carta antes del envío (solo mientras espera el ok y nunca después de enviada).
CREATE OR REPLACE FUNCTION public.claim_set_text(_id uuid, _user_id uuid, _subject text, _body_text text, _body_html text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  SELECT * INTO c FROM public.claims WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF c.status <> 'esperando_ok' OR c.sent_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SENT'); END IF;
  PERFORM public._claim_actor('sistema', NULL);
  UPDATE public.claims SET subject = _subject, body_text = _body_text, body_html = _body_html WHERE id = _id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(c));
EXCEPTION WHEN check_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
END $$;

-- Reservar el envío por correo con el consentimiento explícito. Bandera, canal, destinatario y tope diario.
CREATE OR REPLACE FUNCTION public.claim_claim_send(_id uuid, _user_id uuid, _consent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  IF NOT public.app_flag('reclamos_enabled') THEN RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); END IF;
  IF _consent IS NULL OR _consent->>'confirmed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_REQUIRED'); END IF;
  SELECT * INTO c FROM public.claims WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF c.channel <> 'correo' OR c.recipient_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_EMAIL'); END IF;
  IF c.status = 'enviando' AND c.send_lock_at > now() - interval '2 minutes' THEN RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS'); END IF;
  IF c.status NOT IN ('esperando_ok','fallido','enviando') THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SENT'); END IF;
  IF (SELECT count(*) FROM public.claims WHERE user_id = _user_id AND sent_at > now() - interval '1 day') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_DAILY_LIMIT');
  END IF;
  PERFORM public._claim_actor('usuario', 'El usuario autorizó el envío');
  UPDATE public.claims SET status = 'enviando', send_lock_at = now(),
         consent = jsonb_build_object('confirmed', true, 'via', 'iatos', 'at', now(), 'text', left(coalesce(_consent->>'text', ''), 300),
                                      'cc_user', coalesce((_consent->>'cc_user')::boolean, false))
   WHERE id = _id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(c), 'reply_token', c.reply_token);
END $$;

-- Resultado del envío (carta, recordatorio o respuesta en el hilo).
CREATE OR REPLACE FUNCTION public.claim_mark_sent(_id uuid, _kind text, _ok boolean, _provider_id text, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  SELECT * INTO c FROM public.claims WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF _kind = 'envio' THEN
    IF c.status <> 'enviando' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_SENDING'); END IF;
    IF _ok THEN
      PERFORM public._claim_actor('sistema', 'Carta enviada');
      UPDATE public.claims SET status = 'enviado', sent_at = now(), send_lock_at = NULL, provider_message_id = left(_provider_id, 200),
             last_error = NULL, followup_at = now() + make_interval(days => response_days + 2),
             escalate_after = now() + make_interval(days => escalate_days)
       WHERE id = _id RETURNING * INTO c;
    ELSE
      PERFORM public._claim_actor('sistema', 'Falló el envío');
      UPDATE public.claims SET status = 'fallido', send_lock_at = NULL, last_error = left(coalesce(_error, 'send_failed'), 500) WHERE id = _id RETURNING * INTO c;
    END IF;
  ELSIF _kind IN ('recordatorio','respuesta') THEN
    INSERT INTO public.claim_events (claim_id, kind, actor, note, data)
    VALUES (_id, _kind, 'sistema', CASE WHEN _ok THEN 'Enviado' ELSE 'Falló: ' || left(coalesce(_error, ''), 200) END,
            jsonb_build_object('provider_id', left(_provider_id, 200)));
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND');
  END IF;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(c));
END $$;

-- Canal formulario/teléfono: el usuario lo envió él mismo (pegó el texto). Sin correo nuestro.
CREATE OR REPLACE FUNCTION public.claim_mark_user_sent(_id uuid, _user_id uuid, _case_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  SELECT * INTO c FROM public.claims WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF c.status <> 'esperando_ok' THEN RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION'); END IF;
  PERFORM public._claim_actor('usuario', 'El usuario lo envió por el canal oficial' || coalesce(' · caso ' || left(_case_number, 60), ''));
  UPDATE public.claims SET status = 'enviado', sent_at = now(),
         consent = jsonb_build_object('via', 'usuario', 'at', now(), 'case_number', left(_case_number, 60)),
         followup_at = NULL, escalate_after = now() + make_interval(days => escalate_days)
   WHERE id = _id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(c));
END $$;

-- Transición genérica validada (usuario, equipo o sistema).
CREATE OR REPLACE FUNCTION public.claim_transition(_id uuid, _to text, _actor text, _user_id uuid, _note text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims; v_from text;
BEGIN
  SELECT * INTO c FROM public.claims WHERE id = _id AND (_user_id IS NULL OR user_id = _user_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF c.status = _to THEN RETURN jsonb_build_object('ok', true, 'noop', true, 'claim', public.claim_json(c)); END IF;
  IF NOT public.claim_transition_ok(c.status, _to) THEN RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', c.status, 'to', _to); END IF;
  v_from := c.status;
  PERFORM public._claim_actor(coalesce(_actor, 'sistema'), _note);
  UPDATE public.claims SET status = _to,
         reply = CASE WHEN _data IS NOT NULL AND _data ? 'reply' THEN _data->'reply' ELSE reply END,
         incident_id = coalesce(_data->>'incident_id', incident_id)
   WHERE id = _id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'prev_status', v_from, 'claim', public.claim_json(c));
END $$;

CREATE OR REPLACE FUNCTION public.claim_set_incident(_id uuid, _incident_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._claim_actor('sistema', 'Caso abierto en el núcleo de incidentes');
  UPDATE public.claims SET incident_id = left(_incident_id, 80) WHERE id = _id AND incident_id IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.claim_list_for_user(_user_id uuid, _id uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.claim_json(c) FROM public.claims c
   WHERE c.user_id = _user_id AND (_id IS NULL OR c.id = _id) ORDER BY c.created_at DESC LIMIT 50;
$$;

-- Seguimiento: reclamos por correo sin respuesta con el recordatorio vencido, y reclamos listos para escalar.
CREATE OR REPLACE FUNCTION public.claim_due(_limit int)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.claim_json(c) || jsonb_build_object('reply_token', c.reply_token,
           'due', CASE WHEN c.escalate_after <= now() THEN 'escalar' ELSE 'recordar' END)
    FROM public.claims c
   WHERE c.status IN ('enviado','recordado')
     AND ((c.channel = 'correo' AND c.reminders_sent = 0 AND c.followup_at <= now()) OR c.escalate_after <= now())
   ORDER BY coalesce(c.followup_at, c.escalate_after) LIMIT greatest(1, least(coalesce(_limit, 100), 500));
$$;

-- Un solo recordatorio: el primero que lo reclama lo manda.
CREATE OR REPLACE FUNCTION public.claim_claim_reminder(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  IF NOT public.app_flag('reclamos_enabled') THEN RETURN NULL; END IF;
  PERFORM public._claim_actor('sistema', 'Recordatorio al proveedor');
  UPDATE public.claims SET reminders_sent = 1, status = 'recordado'
   WHERE id = _id AND status = 'enviado' AND channel = 'correo' AND reminders_sent = 0 AND followup_at <= now()
   RETURNING * INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.claim_json(c) || jsonb_build_object('reply_token', c.reply_token);
END $$;

-- ───────────── Correo entrante ─────────────
-- _kind 'reclamo': respuesta del proveedor a reclamos+<token>; 'caso': reenvío del usuario a casos+<token>.
CREATE OR REPLACE FUNCTION public.claim_inbound_claim(_event_id text, _email_id text, _kind text, _token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_in public.claim_inbound; c public.claims; v_user uuid;
BEGIN
  IF _kind NOT IN ('reclamo','caso') OR _token IS NULL OR _token !~ '^[0-9a-f]{24}$' THEN
    RETURN jsonb_build_object('state', 'unmatched');
  END IF;
  SELECT * INTO v_in FROM public.claim_inbound WHERE event_id = _event_id FOR UPDATE;
  -- Ya procesado, o procesándose ahora mismo: no se repite. Uno 'failed' (o atorado >10 min) se reintenta.
  IF FOUND AND (v_in.status IN ('done','unmatched') OR (v_in.status = 'processing' AND v_in.updated_at > now() - interval '10 minutes')) THEN
    RETURN jsonb_build_object('state', 'duplicate');
  END IF;
  IF _kind = 'reclamo' THEN
    SELECT * INTO c FROM public.claims WHERE reply_token = _token;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unmatched'); END IF;
    v_user := c.user_id;
  ELSE
    SELECT user_id INTO v_user FROM public.claim_forward_tokens WHERE token = _token;
    IF v_user IS NULL THEN RETURN jsonb_build_object('state', 'unmatched'); END IF;
  END IF;
  INSERT INTO public.claim_inbound (event_id, email_id, kind, user_id, claim_id)
  VALUES (_event_id, left(_email_id, 200), _kind, v_user, c.id)
  ON CONFLICT (event_id) DO UPDATE SET status = 'processing', updated_at = now()
  RETURNING * INTO v_in;
  RETURN jsonb_build_object('state', 'new', 'inbound_id', v_in.id, 'user_id', v_user,
    'claim', CASE WHEN c.id IS NOT NULL THEN public.claim_json(c) || jsonb_build_object('recipient_email', c.recipient_email) END);
END $$;

-- Evidencia (antes de gastar IA). El mismo Message-ID no se procesa dos veces.
CREATE OR REPLACE FUNCTION public.claim_inbound_attach(_inbound_id uuid, _e jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mid text := nullif(left(_e->>'message_id', 998), '');
BEGIN
  IF v_mid IS NOT NULL AND EXISTS (SELECT 1 FROM public.claim_inbound WHERE message_id = v_mid AND id <> _inbound_id) THEN
    UPDATE public.claim_inbound SET status = 'done', outcome = 'duplicate_message', updated_at = now() WHERE id = _inbound_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  UPDATE public.claim_inbound SET message_id = v_mid, evidence = _e - 'text', updated_at = now() WHERE id = _inbound_id;
  RETURN jsonb_build_object('ok', FOUND);
END $$;

CREATE OR REPLACE FUNCTION public.claim_inbound_finish(_inbound_id uuid, _status text, _outcome text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.claim_inbound SET status = _status, outcome = left(_outcome, 60), updated_at = now() WHERE id = _inbound_id;
$$;

-- Aplica la lectura de la respuesta del proveedor (la decisión la toma el código; aquí se valida el estado).
CREATE OR REPLACE FUNCTION public.claim_apply_reply(_id uuid, _inbound_id uuid, _d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims; v_to text := _d->>'estado_sugerido';
BEGIN
  SELECT * INTO c FROM public.claims WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_to NOT IN ('respondido','necesita_usuario','escalable') THEN v_to := 'necesita_usuario'; END IF;
  PERFORM public._claim_actor('proveedor', left('Respuesta: ' || coalesce(_d->>'resultado_final', '?'), 500));
  IF c.status IN ('enviado','recordado','respondido','necesita_usuario') AND public.claim_transition_ok(c.status, v_to) THEN
    UPDATE public.claims SET status = v_to, reply = _d, last_reply_at = now() WHERE id = _id RETURNING * INTO c;
  ELSE
    UPDATE public.claims SET reply = _d, last_reply_at = now() WHERE id = _id RETURNING * INTO c;
  END IF;
  INSERT INTO public.claim_events (claim_id, kind, actor, note, data)
  VALUES (_id, 'respuesta', 'proveedor', left(coalesce(_d->>'resumen_es', ''), 500),
          jsonb_build_object('inbound_id', _inbound_id, 'resultado', _d->>'resultado_final', 'remitente_verificado', _d->'remitente_verificado'));
  UPDATE public.claim_inbound SET status = 'done', outcome = left(coalesce(_d->>'resultado_final', 'otro'), 60), updated_at = now() WHERE id = _inbound_id;
  RETURN jsonb_build_object('ok', true, 'claim', public.claim_json(c));
END $$;

-- Dirección personal para reenviar correos: casos+<token>@reply.traveliatos.life.
CREATE OR REPLACE FUNCTION public.claim_forward_token(_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v text;
BEGIN
  SELECT token INTO v FROM public.claim_forward_tokens WHERE user_id = _user_id;
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.claim_forward_tokens (user_id, token) VALUES (_user_id, encode(extensions.gen_random_bytes(12), 'hex'))
  ON CONFLICT (user_id) DO NOTHING;
  SELECT token INTO v FROM public.claim_forward_tokens WHERE user_id = _user_id;
  RETURN v;
END $$;

-- Guarda un correo reenviado por el usuario y lo liga a su reclamo si trae el folio C-XXXXXX.
CREATE OR REPLACE FUNCTION public.claim_store_forward(_user_id uuid, _inbound_id uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ref text := substring(coalesce(_p->>'subject', '') || ' ' || coalesce(_p->>'text', '') FROM 'C-[A-Z0-9]{6}');
        v_claim uuid; v_id uuid;
BEGIN
  IF v_ref IS NOT NULL THEN SELECT id INTO v_claim FROM public.claims WHERE ref_code = v_ref AND user_id = _user_id; END IF;
  INSERT INTO public.forwarded_emails (user_id, claim_id, inbound_id, from_address, subject, received_at, text_excerpt, body_sha256, sender_verified)
  VALUES (_user_id, v_claim, _inbound_id, left(_p->>'from', 200), left(_p->>'subject', 300), (_p->>'received_at')::timestamptz,
          left(_p->>'text', 8000), nullif(_p->>'body_sha256', ''), coalesce((_p->>'sender_verified')::boolean, false))
  RETURNING id INTO v_id;
  UPDATE public.claim_inbound SET status = 'done', outcome = CASE WHEN v_claim IS NULL THEN 'guardado' ELSE 'ligado_a_reclamo' END, claim_id = v_claim, updated_at = now()
   WHERE id = _inbound_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'claim_id', v_claim, 'ref', v_ref);
END $$;

-- ───────────── Operador (Mesa de operaciones): solo administradores, con su propia sesión ─────────────
-- Lista y detalle de reclamos para el equipo. El texto de los correos reenviados por el usuario solo se
-- muestra si están ligados a ESE reclamo (el usuario lo reenvió para su caso); el resto de su buzón no.
CREATE OR REPLACE FUNCTION public.admin_claims_list(_status text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._ops_require_admin();
  RETURN QUERY
    SELECT (public.claim_json(c) - 'body_html' - 'evaluation') || jsonb_build_object('person', public._ops_person(c.user_id))
      FROM public.claims c
     WHERE _status IS NULL OR c.status = _status
     ORDER BY c.updated_at DESC LIMIT greatest(1, least(coalesce(_limit, 100), 300));
END $$;

CREATE OR REPLACE FUNCTION public.admin_claim_view(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.claims;
BEGIN
  PERFORM public._ops_require_admin();
  SELECT * INTO c FROM public.claims WHERE id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true,
    'claim', public.claim_json(c) - 'body_html',
    'person', public._ops_person(c.user_id),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FROM public.claim_events e WHERE e.claim_id = _id), '[]'::jsonb),
    'forwarded', coalesce((SELECT jsonb_agg(jsonb_build_object('subject', f.subject, 'from', f.from_address, 'received_at', f.received_at,
                     'text', left(f.text_excerpt, 3000), 'verified', f.sender_verified) ORDER BY f.created_at)
                   FROM public.forwarded_emails f WHERE f.claim_id = _id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_claims_list(text, int), public.admin_claim_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_claims_list(text, int), public.admin_claim_view(uuid) TO authenticated;

-- ───────────────────────────── Permisos ─────────────────────────────
REVOKE ALL ON FUNCTION public.claim_transition_ok(text, text), public.claims_guard(), public.claim_notice(text, text, text), public.claims_log(),
  public._claim_actor(text, text), public.claim_json(public.claims), public.claim_create(uuid, jsonb), public.claim_set_text(uuid, uuid, text, text, text), public.claim_claim_send(uuid, uuid, jsonb),
  public.claim_mark_sent(uuid, text, boolean, text, text), public.claim_mark_user_sent(uuid, uuid, text),
  public.claim_transition(uuid, text, text, uuid, text, jsonb), public.claim_set_incident(uuid, text), public.claim_list_for_user(uuid, uuid),
  public.claim_due(int), public.claim_claim_reminder(uuid), public.claim_inbound_claim(text, text, text, text),
  public.claim_inbound_attach(uuid, jsonb), public.claim_inbound_finish(uuid, text, text), public.claim_apply_reply(uuid, uuid, jsonb),
  public.claim_forward_token(uuid), public.claim_store_forward(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_create(uuid, jsonb), public.claim_set_text(uuid, uuid, text, text, text), public.claim_claim_send(uuid, uuid, jsonb),
  public.claim_mark_sent(uuid, text, boolean, text, text), public.claim_mark_user_sent(uuid, uuid, text),
  public.claim_transition(uuid, text, text, uuid, text, jsonb), public.claim_set_incident(uuid, text), public.claim_list_for_user(uuid, uuid),
  public.claim_due(int), public.claim_claim_reminder(uuid), public.claim_inbound_claim(text, text, text, text),
  public.claim_inbound_attach(uuid, jsonb), public.claim_inbound_finish(uuid, text, text), public.claim_apply_reply(uuid, uuid, jsonb),
  public.claim_forward_token(uuid), public.claim_store_forward(uuid, uuid, jsonb), public.claim_transition_ok(text, text)
  TO service_role;

COMMENT ON TABLE public.claims IS 'Reclamos del Operador IATOS (derechos del pasajero, hotel, traslado, agencia). Ver docs/iatos/IATOS_DERECHOS_RECLAMOS.md.';
