-- Reservas IA v1 · canal correo (grupo reservas). Diseño: docs/iatos/IATOS_RESERVAS_IA.md.
--
-- Qué resuelve: "que la IA se encargue de reservar". Iato arma la solicitud, el usuario la confirma
-- explícitamente, el servidor escribe al restaurante en su nombre desde reservas@traveliatos.life
-- con una dirección de respuesta única por reserva, lee la respuesta y avisa al usuario.
--
-- Reglas de honestidad que este esquema hace cumplir (no solo la pantalla):
--  * Una reserva es "confirmed" SOLO cuando el restaurante lo confirmó por escrito: el CHECK
--    ai_res_confirmed_has_evidence exige el id del correo recibido, una cita textual y remitente
--    verificado (o, si lo confirma el equipo a mano, quién y con qué evidencia).
--  * Patrón IATOS-114: ningún cliente escribe en estas tablas. Todo cambio pasa por funciones
--    SECURITY DEFINER que solo puede ejecutar service_role (las edge functions), y un trigger
--    rechaza cualquier INSERT/UPDATE que no venga de ellas, incluso con la llave de servicio.
--  * Apagado por defecto: app_flags.ai_reservations_enabled = false. Con la bandera apagada no se
--    crea ninguna intención ni sale ningún correo.
-- Idempotente.

INSERT INTO public.app_flags (key, value, note) VALUES
  ('ai_reservations_enabled', 'false'::jsonb,
   'Reservas IA por correo: Iato escribe al restaurante en nombre del usuario (requiere Resend Receiving configurado)')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────── Tabla principal ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id             uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  request_id          uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  source              text NOT NULL DEFAULT 'iato' CHECK (source IN ('iato','usuario','booking_bridge')),
  bridge_offer_id     text CHECK (bridge_offer_id IS NULL OR length(bridge_offer_id) <= 200),
  idempotency_key     text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 120),
  ref_code            text NOT NULL UNIQUE CHECK (ref_code ~ '^R-[A-Z0-9]{6}$'),
  -- Secreto de la dirección de respuesta reservas+<token>@<dominio de recepción>. Nunca se expone al cliente.
  reply_token         text NOT NULL UNIQUE CHECK (reply_token ~ '^[0-9a-f]{24}$'),
  venue_name          text NOT NULL CHECK (length(btrim(venue_name)) BETWEEN 1 AND 160),
  venue_place_id      text CHECK (venue_place_id IS NULL OR venue_place_id ~ '^[A-Za-z0-9_-]{10,300}$'),
  venue_experience_id uuid REFERENCES public.prive_experiences(id) ON DELETE SET NULL,
  venue_address       text CHECK (venue_address IS NULL OR length(venue_address) <= 300),
  venue_city          text CHECK (venue_city IS NULL OR length(venue_city) <= 120),
  venue_country       char(2) CHECK (venue_country IS NULL OR venue_country ~ '^[A-Z]{2}$'),
  venue_timezone      text NOT NULL,
  venue_email         text CHECK (venue_email IS NULL OR (length(venue_email) <= 254 AND venue_email ~* '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  -- De dónde salió el correo: {kind: catalog|google|website, url, quote, found_at}. Nunca se adivina.
  venue_email_source  jsonb,
  venue_phone         text CHECK (venue_phone IS NULL OR length(venue_phone) <= 40),
  venue_website       text CHECK (venue_website IS NULL OR venue_website ~ '^https://'),
  venue_booking_url   text CHECK (venue_booking_url IS NULL OR venue_booking_url ~ '^https://'),
  venue_maps_url      text CHECK (venue_maps_url IS NULL OR venue_maps_url ~ '^https://'),
  venue_language      text NOT NULL DEFAULT 'es' CHECK (venue_language IN ('es','en','fr')),
  requested_local     text NOT NULL CHECK (requested_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  requested_for       timestamptz NOT NULL,
  party_size          int NOT NULL CHECK (party_size BETWEEN 1 AND 20),
  customer_name       text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 2 AND 120),
  customer_email      text CHECK (customer_email IS NULL OR length(customer_email) <= 254),
  customer_phone      text CHECK (customer_phone IS NULL OR length(customer_phone) <= 40),
  -- {share_contact, cc_user, text, at}: lo que el usuario aceptó al pulsar "Confirmar".
  consent             jsonb,
  notes               text CHECK (notes IS NULL OR length(notes) <= 500),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_user_ok','sent','venue_replied',
                        'needs_user','confirmed','declined','expired','cancelled','failed')),
  -- Por qué está en needs_user / venue_replied.
  reason              text CHECK (reason IS NULL OR reason IN ('no_contact','alternative_offered','needs_info','payment_required',
                        'sender_unverified','ambiguous_reply','send_failed','declined','no_reply')),
  user_options        jsonb,
  alternatives        jsonb CHECK (alternatives IS NULL OR jsonb_typeof(alternatives) = 'array'),
  chosen_alternative  jsonb,
  confirmation_code   text CHECK (confirmation_code IS NULL OR length(confirmation_code) <= 60),
  confirmation        jsonb,
  venue_reply_excerpt text CHECK (venue_reply_excerpt IS NULL OR length(venue_reply_excerpt) <= 800),
  evidence            jsonb NOT NULL DEFAULT '{"outbound": [], "inbound": []}'::jsonb,
  attempts            int NOT NULL DEFAULT 0,
  send_lock_at        timestamptz,
  sent_at             timestamptz,
  reminder_sent_at    timestamptz,
  venue_replied_at    timestamptz,
  confirmed_at        timestamptz,
  closed_at           timestamptz,
  expires_at          timestamptz,
  last_error          text CHECK (last_error IS NULL OR length(last_error) <= 300),
  claude_calls        int NOT NULL DEFAULT 0,
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_res_confirmed_has_evidence CHECK (status <> 'confirmed' OR (
    jsonb_typeof(confirmation) = 'object' AND (
      (confirmation->>'channel' = 'venue_email'
        AND length(coalesce(confirmation->>'inbound_email_id', '')) > 3
        AND length(btrim(coalesce(confirmation->>'quote', ''))) >= 4
        AND confirmation->>'verified_sender' = 'true')
      OR (confirmation->>'channel' = 'equipo'
        AND length(btrim(coalesce(confirmation->>'confirmed_by', ''))) > 1
        AND length(btrim(coalesce(confirmation->>'evidence', ''))) > 3)))),
  CONSTRAINT ai_res_sent_has_consent CHECK (sent_at IS NULL OR (venue_email IS NOT NULL AND (consent->>'at') IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_reservations_user ON public.ai_reservations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_reservations_active ON public.ai_reservations (status, updated_at)
  WHERE status IN ('draft','awaiting_user_ok','sent','venue_replied','needs_user');
CREATE INDEX IF NOT EXISTS ai_reservations_venue_sent ON public.ai_reservations (lower(venue_email), sent_at) WHERE sent_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_reservations_idem ON public.ai_reservations (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.ai_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_reservations_owner_read ON public.ai_reservations;
CREATE POLICY ai_reservations_owner_read ON public.ai_reservations FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.ai_reservations FROM PUBLIC, anon, authenticated;
-- Lectura por columnas: el usuario ve lo suyo, pero nunca el token de respuesta, el candado ni la
-- evidencia interna (ids de correos). Un SELECT * desde el cliente falla a propósito.
GRANT SELECT (id, user_id, trip_id, request_id, source, bridge_offer_id, ref_code, venue_name, venue_place_id,
  venue_experience_id, venue_address, venue_city, venue_country, venue_timezone, venue_email, venue_email_source,
  venue_phone, venue_website, venue_booking_url, venue_maps_url, venue_language, requested_local, requested_for,
  party_size, customer_name, customer_email, customer_phone, consent, notes, status, reason, user_options,
  alternatives, chosen_alternative, confirmation_code, confirmation, venue_reply_excerpt, attempts, sent_at,
  reminder_sent_at, venue_replied_at, confirmed_at, closed_at, expires_at, status_changed_at, created_at, updated_at)
  ON public.ai_reservations TO authenticated;
GRANT ALL ON public.ai_reservations TO service_role;

-- ───────────────────────────── Historial ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_reservation_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES public.ai_reservations(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('transition','email_out','email_in','reminder','note')),
  from_status    text,
  to_status      text,
  actor          text NOT NULL CHECK (actor IN ('usuario','sistema','restaurante','equipo')),
  note           text CHECK (note IS NULL OR length(note) <= 500),
  data           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reservation_events_res ON public.ai_reservation_events (reservation_id, created_at);
ALTER TABLE public.ai_reservation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_reservation_events_owner_read ON public.ai_reservation_events;
CREATE POLICY ai_reservation_events_owner_read ON public.ai_reservation_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_reservations r WHERE r.id = reservation_id AND r.user_id = auth.uid()));
REVOKE ALL ON public.ai_reservation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_reservation_events TO authenticated;
GRANT ALL ON public.ai_reservation_events TO service_role;

-- ───────────────────────────── Correos recibidos (idempotencia del webhook) ──────────────────────────
-- Una fila por evento de Resend (svix-id) y por correo (email_id): el mismo webhook dos veces no se
-- procesa dos veces. No guarda el contenido del correo ni la dirección completa del remitente.
CREATE TABLE IF NOT EXISTS public.ai_reservation_inbound (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  email_id          text NOT NULL UNIQUE CHECK (length(email_id) BETWEEN 1 AND 200),
  reservation_id    uuid REFERENCES public.ai_reservations(id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('processing','done','failed','unmatched','late')),
  outcome           text CHECK (outcome IS NULL OR length(outcome) <= 60),
  from_domain       text CHECK (from_domain IS NULL OR length(from_domain) <= 253),
  attempts          int NOT NULL DEFAULT 1,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
ALTER TABLE public.ai_reservation_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_reservation_inbound FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_reservation_inbound TO service_role;

-- ───────────────────────────── Reglas ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_reservation_transition_ok(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (_from, _to) IN (
    ('draft','awaiting_user_ok'), ('draft','needs_user'), ('draft','cancelled'), ('draft','failed'),
    ('awaiting_user_ok','sent'), ('awaiting_user_ok','cancelled'), ('awaiting_user_ok','expired'), ('awaiting_user_ok','failed'),
    ('sent','venue_replied'), ('sent','confirmed'), ('sent','declined'), ('sent','needs_user'), ('sent','expired'),
    ('sent','cancelled'), ('sent','failed'),
    ('venue_replied','confirmed'), ('venue_replied','declined'), ('venue_replied','needs_user'), ('venue_replied','expired'),
    ('venue_replied','cancelled'),
    ('needs_user','sent'), ('needs_user','confirmed'), ('needs_user','venue_replied'), ('needs_user','declined'),
    ('needs_user','cancelled'), ('needs_user','expired'),
    ('confirmed','cancelled'));
$$;

-- Límites por defecto; el dueño puede ajustarlos con app_flags.ai_reservations_limits (objeto JSON).
CREATE OR REPLACE FUNCTION public.ai_reservation_limits()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
      'user_sends_per_day', 5, 'user_active_max', 5, 'venue_sends_per_day', 3, 'global_sends_per_day', 200,
      'reminder_after_hours', 24, 'expire_after_hours', 48, 'intent_ttl_hours', 72,
      'min_lead_minutes', 60, 'max_days_ahead', 180)
    || coalesce((SELECT value FROM public.app_flags WHERE key = 'ai_reservations_limits' AND jsonb_typeof(value) = 'object'), '{}'::jsonb);
$$;

-- Guardia: solo las funciones de abajo (marcan aires.actor en la transacción) escriben.
CREATE OR REPLACE FUNCTION public.ai_reservations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_actor text := nullif(current_setting('aires.actor', true), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'ai_reservations: solo las funciones del servidor escriben aquí' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','awaiting_user_ok','needs_user') THEN
      RAISE EXCEPTION 'ai_reservations: una reserva nace como draft, awaiting_user_ok o needs_user';
    END IF;
    NEW.status_changed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reply_token IS DISTINCT FROM OLD.reply_token
     OR NEW.ref_code IS DISTINCT FROM OLD.ref_code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ai_reservations: usuario, token, folio y fecha de alta no cambian';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.ai_reservation_transition_ok(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'ai_reservations: transición no permitida (% → %)', OLD.status, NEW.status;
    END IF;
    NEW.status_changed_at := now();
    IF NEW.status IN ('declined','expired','cancelled','failed') THEN
      NEW.closed_at := coalesce(NEW.closed_at, now());
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_reservations_guard ON public.ai_reservations;
CREATE TRIGGER ai_reservations_guard BEFORE INSERT OR UPDATE ON public.ai_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservations_guard();

-- Textos honestos del aviso en la app por estado. Nunca "mesa confirmada" antes de la confirmación
-- escrita verificada; y aun entonces se dice quién confirmó.
CREATE OR REPLACE FUNCTION public.ai_reservation_notice(_status text, _reason text, _venue text, _local text, _party int, _code text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _status = 'sent' THEN ARRAY['Escribimos a ' || _venue || ' en tu nombre',
      'Aún no es una reserva: te avisamos en cuanto el restaurante responda por escrito.']
    WHEN _status = 'needs_user' AND _reason = 'no_contact' THEN ARRAY['No encontramos un correo de reservas de ' || _venue,
      'No inventamos direcciones. Puedes llamar, usar su enlace de reservas o pedir ayuda al Fixer.']
    WHEN _status = 'needs_user' AND _reason = 'alternative_offered' THEN ARRAY[_venue || ' propone otro horario',
      'Elige en la app si te sirve. Aún no es una reserva.']
    WHEN _status = 'needs_user' AND _reason = 'payment_required' THEN ARRAY[_venue || ' pide una garantía o pago',
      'Nunca compartimos datos de tarjeta. Revisa la respuesta y decide si sigues directamente con el restaurante. Aún no es una reserva.']
    WHEN _status = 'needs_user' THEN ARRAY[_venue || ' pide más información',
      'Revisa la respuesta en la app. Aún no es una reserva.']
    WHEN _status = 'venue_replied' THEN ARRAY[_venue || ' respondió · revisa la respuesta',
      'Aún no es una reserva confirmada: no pudimos verificar la respuesta automáticamente.']
    WHEN _status = 'confirmed' THEN ARRAY['Reserva confirmada por escrito por ' || _venue,
      replace(_local, 'T', ' ') || ' · ' || _party || CASE WHEN _party = 1 THEN ' persona' ELSE ' personas' END
        || coalesce(' · Código: ' || _code, '') || '. Te mandamos el comprobante por correo.']
    WHEN _status = 'declined' THEN ARRAY[_venue || ' no tiene lugar para tu solicitud',
      'El restaurante respondió que no puede. Te ayudamos con otra opción o con el Fixer.']
    WHEN _status = 'expired' THEN ARRAY[_venue || ' no respondió a tiempo',
      'La solicitud venció sin confirmación. Puedes llamar al restaurante o pedir ayuda al Fixer.']
    WHEN _status = 'cancelled' THEN ARRAY['Cancelaste tu solicitud a ' || _venue, 'Si ya le habíamos escrito, le avisamos al restaurante.']
    WHEN _status = 'failed' THEN ARRAY['No pudimos enviar tu solicitud a ' || _venue,
      'No se envió nada. Puedes intentarlo de nuevo, llamar o pedir ayuda al Fixer.']
  END;
$$;

-- Historial + aviso en la app (una vez por transición) + espejo del estado en concierge_requests.
CREATE OR REPLACE FUNCTION public.ai_reservations_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_notice text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.ai_reservation_events (reservation_id, kind, from_status, to_status, actor, note)
    VALUES (NEW.id, 'transition', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('aires.actor', true), ''), 'sistema'),
            left(nullif(current_setting('aires.note', true), ''), 500));
    IF NEW.request_id IS NOT NULL THEN
      UPDATE public.concierge_requests SET status = NEW.status WHERE id = NEW.request_id AND type = 'ai_reservation';
    END IF;
    v_notice := public.ai_reservation_notice(NEW.status, NEW.reason, left(NEW.venue_name, 120), NEW.requested_local,
                                             NEW.party_size, NEW.confirmation_code);
    IF v_notice IS NOT NULL THEN
      PERFORM public.notify_once(NEW.user_id, 'ai_reservation', v_notice[1], v_notice[2], NEW.id,
        'ai_res:' || NEW.id || ':' || NEW.status || ':' || coalesce(NEW.reason, '') || ':' || (extract(epoch FROM NEW.status_changed_at))::bigint);
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_reservations_log ON public.ai_reservations;
CREATE TRIGGER ai_reservations_log AFTER INSERT OR UPDATE ON public.ai_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservations_log();

-- Vista JSON segura (sin token, candado, evidencia interna ni llave de idempotencia).
CREATE OR REPLACE FUNCTION public.ai_reservation_json(_r public.ai_reservations)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(_r) - 'reply_token' - 'send_lock_at' - 'evidence' - 'idempotency_key' - 'claude_calls' - 'last_error';
$$;
-- Versión interna para las edge functions (incluye el token para armar la dirección de respuesta).
CREATE OR REPLACE FUNCTION public.ai_reservation_json_internal(_r public.ai_reservations)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(_r) - 'idempotency_key';
$$;

CREATE OR REPLACE FUNCTION public._ai_res_actor(_actor text, _note text)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('aires.actor', coalesce(_actor, ''), true), set_config('aires.note', left(coalesce(_note, ''), 500), true);
$$;

CREATE OR REPLACE FUNCTION public._ai_res_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_flag('ai_reservations_enabled');
$$;

-- ───────────────────────────── Alta de la intención ─────────────────────────────────────────────────
-- La llama la edge function ai-reservations (o el Booking Bridge desde el servidor) DESPUÉS de buscar
-- el contacto del lugar. _p: {venue:{name, place_id, experience_id, address, city, country, timezone,
-- email, email_source, phone, website, booking_url, maps_url, language}, requested_local, party_size,
-- customer:{name, email, phone}, notes, trip_id, source, bridge_offer_id, idempotency_key, user_options}.
CREATE OR REPLACE FUNCTION public.ai_reservation_create_intent(_user_id uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lim jsonb := public.ai_reservation_limits();
  v jsonb := coalesce(_p->'venue', '{}'::jsonb);
  v_tz text := nullif(btrim(v->>'timezone'), '');
  v_local text := _p->>'requested_local';
  v_for timestamptz; v_party int; v_trip uuid; v_exp uuid; v_place text; v_email text; v_status text;
  v_req uuid; v_id uuid; v_ref text; v_tok text; r public.ai_reservations; v_idem text := nullif(_p->>'idempotency_key', '');
BEGIN
  IF NOT public._ai_res_enabled() THEN RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
  END IF;
  IF v_idem IS NOT NULL THEN
    SELECT * INTO r FROM public.ai_reservations WHERE user_id = _user_id AND idempotency_key = v_idem;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'replay', true, 'id', r.id, 'status', r.status, 'reservation', public.ai_reservation_json(r)); END IF;
  END IF;
  IF length(btrim(coalesce(v->>'name', ''))) NOT BETWEEN 1 AND 160 THEN RETURN jsonb_build_object('ok', false, 'code', 'VENUE_REQUIRED'); END IF;
  v_place := nullif(btrim(v->>'place_id'), '');
  v_exp := CASE WHEN (v->>'experience_id') ~* '^[0-9a-f-]{36}$' THEN (v->>'experience_id')::uuid END;
  -- Solo lugares identificados por Google o por el catálogo Privé: así el correo destino sale de una
  -- fuente confiable y nadie puede usar IATOS para escribirle a cualquier dirección.
  IF v_place IS NULL AND v_exp IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'VENUE_ID_REQUIRED'); END IF;
  IF v_exp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prive_experiences WHERE id = v_exp) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VENUE_NOT_FOUND');
  END IF;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TIMEZONE_REQUIRED');
  END IF;
  IF v_local IS NULL OR v_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'DATETIME_INVALID'); END IF;
  BEGIN
    v_for := (v_local || ':00')::timestamp AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'code', 'DATETIME_INVALID');
  END;
  IF v_for < now() + make_interval(mins => (v_lim->>'min_lead_minutes')::int) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_TOO_SOON');
  END IF;
  IF v_for > now() + make_interval(days => (v_lim->>'max_days_ahead')::int) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_TOO_FAR');
  END IF;
  v_party := CASE WHEN (_p->>'party_size') ~ '^\d{1,2}$' THEN (_p->>'party_size')::int END;
  IF v_party IS NULL OR v_party NOT BETWEEN 1 AND 20 THEN RETURN jsonb_build_object('ok', false, 'code', 'PARTY_SIZE_INVALID'); END IF;
  IF length(btrim(coalesce(_p->'customer'->>'name', ''))) NOT BETWEEN 2 AND 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CUSTOMER_NAME_REQUIRED');
  END IF;
  IF (_p->>'trip_id') ~* '^[0-9a-f-]{36}$' THEN
    v_trip := (_p->>'trip_id')::uuid;
    IF NOT public.has_trip_access(v_trip, _user_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  END IF;
  -- Misma reserva activa (lugar + hora) → se devuelve la existente: no se duplica la solicitud.
  SELECT * INTO r FROM public.ai_reservations
   WHERE user_id = _user_id AND requested_for = v_for
     AND (venue_place_id = v_place OR venue_experience_id = v_exp)
     AND status IN ('draft','awaiting_user_ok','sent','venue_replied','needs_user','confirmed')
   LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'replay', true, 'id', r.id, 'status', r.status, 'reservation', public.ai_reservation_json(r)); END IF;
  IF (SELECT count(*) FROM public.ai_reservations WHERE user_id = _user_id
        AND status IN ('draft','awaiting_user_ok','sent','venue_replied','needs_user')) >= (v_lim->>'user_active_max')::int THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY_ACTIVE');
  END IF;

  v_email := lower(nullif(btrim(v->>'email'), ''));
  IF v_email IS NOT NULL AND (jsonb_typeof(v->'email_source') <> 'object' OR coalesce(v->'email_source'->>'kind', '') NOT IN ('catalog','google','website')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EMAIL_SOURCE_REQUIRED');
  END IF;
  v_status := CASE WHEN v_email IS NULL THEN 'needs_user' ELSE 'awaiting_user_ok' END;

  LOOP
    v_ref := 'R-' || upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1I', ''), 1, 6));
    EXIT WHEN length(v_ref) = 8 AND NOT EXISTS (SELECT 1 FROM public.ai_reservations WHERE ref_code = v_ref);
  END LOOP;
  v_tok := encode(extensions.gen_random_bytes(12), 'hex');

  INSERT INTO public.concierge_requests (user_id, trip_id, type, title, payload, status)
  VALUES (_user_id, v_trip, 'ai_reservation', left('Reserva IA · ' || btrim(v->>'name'), 200),
          jsonb_build_object('ref_code', v_ref, 'channel', 'email', 'source', coalesce(_p->>'source', 'iato')), v_status)
  RETURNING id INTO v_req;

  PERFORM public._ai_res_actor(CASE WHEN _p->>'source' = 'usuario' THEN 'usuario' ELSE 'sistema' END, 'Solicitud preparada por Iato');
  INSERT INTO public.ai_reservations (user_id, trip_id, request_id, source, bridge_offer_id, idempotency_key, ref_code, reply_token,
    venue_name, venue_place_id, venue_experience_id, venue_address, venue_city, venue_country, venue_timezone,
    venue_email, venue_email_source, venue_phone, venue_website, venue_booking_url, venue_maps_url, venue_language,
    requested_local, requested_for, party_size, customer_name, customer_email, customer_phone, notes, status, reason, user_options,
    claude_calls)
  VALUES (_user_id, v_trip, v_req,
    CASE WHEN _p->>'source' IN ('iato','usuario','booking_bridge') THEN _p->>'source' ELSE 'iato' END,
    left(nullif(_p->>'bridge_offer_id', ''), 200), v_idem, v_ref, v_tok,
    btrim(v->>'name'), v_place, v_exp, left(nullif(v->>'address', ''), 300), left(nullif(v->>'city', ''), 120),
    CASE WHEN upper(v->>'country') ~ '^[A-Z]{2}$' THEN upper(v->>'country') END, v_tz,
    v_email, CASE WHEN v_email IS NOT NULL THEN v->'email_source' END, left(nullif(v->>'phone', ''), 40),
    CASE WHEN v->>'website' ~ '^https://' THEN left(v->>'website', 500) END,
    CASE WHEN v->>'booking_url' ~ '^https://' THEN left(v->>'booking_url', 500) END,
    CASE WHEN v->>'maps_url' ~ '^https://' THEN left(v->>'maps_url', 500) END,
    CASE WHEN v->>'language' IN ('es','en','fr') THEN v->>'language' ELSE 'es' END,
    v_local, v_for, v_party, btrim(_p->'customer'->>'name'), left(nullif(btrim(_p->'customer'->>'email'), ''), 254),
    left(nullif(btrim(_p->'customer'->>'phone'), ''), 40), left(nullif(btrim(_p->>'notes'), ''), 500),
    v_status, CASE WHEN v_email IS NULL THEN 'no_contact' END,
    CASE WHEN jsonb_typeof(_p->'user_options') = 'object' THEN _p->'user_options' END,
    CASE WHEN (_p->>'claude_calls') ~ '^\d{1,2}$' THEN (_p->>'claude_calls')::int ELSE 0 END)
  RETURNING * INTO r;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'status', r.status, 'reservation', public.ai_reservation_json(r));
END $$;

-- ───────────────────────────── Envío (dos fases: reservar el envío y registrar el resultado) ─────────
-- Fase 1: el usuario pulsó "Confirmar: escribiremos a <restaurante> en tu nombre". Valida dueño,
-- estado, bandera, límites por usuario/día, por restaurante/día y globales, y pone un candado de 10
-- minutos para que un doble toque no mande dos correos. Devuelve lo necesario para escribir el correo.
CREATE OR REPLACE FUNCTION public.ai_reservation_claim_send(_id uuid, _user_id uuid, _consent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lim jsonb := public.ai_reservation_limits(); r public.ai_reservations;
BEGIN
  IF NOT public._ai_res_enabled() THEN RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.status = 'sent' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SENT', 'reservation', public.ai_reservation_json(r)); END IF;
  IF r.status <> 'awaiting_user_ok' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_SENDABLE', 'status', r.status); END IF;
  IF r.venue_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_CONTACT'); END IF;
  IF jsonb_typeof(_consent) <> 'object' OR _consent->>'confirmed' <> 'true'
     OR jsonb_typeof(_consent->'share_contact') <> 'boolean' OR jsonb_typeof(_consent->'cc_user') <> 'boolean' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_REQUIRED');
  END IF;
  IF r.requested_for < now() + make_interval(mins => (v_lim->>'min_lead_minutes')::int) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_TOO_SOON');
  END IF;
  IF r.send_lock_at IS NOT NULL AND r.send_lock_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
  END IF;
  IF (SELECT count(*) FROM public.ai_reservations WHERE user_id = _user_id AND sent_at > now() - interval '1 day')
       >= (v_lim->>'user_sends_per_day')::int THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_DAILY_LIMIT');
  END IF;
  IF (SELECT count(*) FROM public.ai_reservations WHERE lower(venue_email) = lower(r.venue_email) AND sent_at > now() - interval '1 day')
       >= (v_lim->>'venue_sends_per_day')::int THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VENUE_THROTTLED');
  END IF;
  IF (SELECT count(*) FROM public.ai_reservations WHERE sent_at > now() - interval '1 day') >= (v_lim->>'global_sends_per_day')::int THEN
    RETURN jsonb_build_object('ok', false, 'code', 'GLOBAL_DAILY_LIMIT');
  END IF;
  PERFORM public._ai_res_actor('usuario', 'Envío confirmado por el usuario');
  UPDATE public.ai_reservations
     SET send_lock_at = now(),
         consent = jsonb_build_object('share_contact', (_consent->>'share_contact')::boolean, 'cc_user', (_consent->>'cc_user')::boolean,
                                      'text', left(coalesce(_consent->>'text', ''), 300), 'at', now())
   WHERE id = _id RETURNING * INTO r;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'reservation', public.ai_reservation_json_internal(r));
END $$;

-- El usuario acepta uno de los horarios que propuso el restaurante. Si el restaurante ya lo había
-- apartado por escrito (held, remitente verificado), queda listo para confirmarse al registrar el envío.
CREATE OR REPLACE FUNCTION public.ai_reservation_claim_alternative(_id uuid, _user_id uuid, _index int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations; v_alt jsonb; v_for timestamptz;
BEGIN
  IF NOT public._ai_res_enabled() THEN RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.status <> 'needs_user' OR r.reason <> 'alternative_offered' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_ALTERNATIVES', 'status', r.status);
  END IF;
  v_alt := r.alternatives -> _index;
  IF v_alt IS NULL OR coalesce(v_alt->>'local', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_INDEX');
  END IF;
  v_for := ((v_alt->>'local') || ':00')::timestamp AT TIME ZONE r.venue_timezone;
  IF v_for < now() + interval '30 minutes' THEN RETURN jsonb_build_object('ok', false, 'code', 'DATE_TOO_SOON'); END IF;
  IF r.send_lock_at IS NOT NULL AND r.send_lock_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IN_PROGRESS');
  END IF;
  PERFORM public._ai_res_actor('usuario', 'El usuario eligió un horario alterno');
  UPDATE public.ai_reservations
     SET send_lock_at = now(),
         evidence = CASE WHEN evidence ? 'original_request' THEN evidence
                         ELSE evidence || jsonb_build_object('original_request', jsonb_build_object('local', requested_local, 'party_size', party_size)) END,
         requested_local = v_alt->>'local', requested_for = v_for,
         chosen_alternative = v_alt || jsonb_build_object('index', _index, 'chosen_at', now())
   WHERE id = _id RETURNING * INTO r;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'held', coalesce((v_alt->>'held')::boolean, false) AND (v_alt->>'verified_sender') = 'true',
                            'reservation', public.ai_reservation_json_internal(r));
END $$;

-- Fase 2: resultado del envío. _kind: request | alternative | reminder | cancellation | thanks.
CREATE OR REPLACE FUNCTION public.ai_reservation_mark_sent(_id uuid, _kind text, _ok boolean, _provider_id text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lim jsonb := public.ai_reservation_limits(); r public.ai_reservations; v_fail int; v_alt jsonb; v_exp timestamptz;
BEGIN
  IF _kind NOT IN ('request','alternative','reminder','cancellation','thanks') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  PERFORM public._ai_res_actor('sistema', CASE WHEN _ok THEN 'Correo enviado al restaurante' ELSE 'Falló el envío del correo' END);
  INSERT INTO public.ai_reservation_events (reservation_id, kind, actor, note, data)
  VALUES (_id, CASE WHEN _kind = 'reminder' THEN 'reminder' ELSE 'email_out' END, 'sistema',
          CASE WHEN _ok THEN 'Correo enviado (' || _kind || ')' ELSE 'No se pudo enviar (' || _kind || ')' END,
          jsonb_build_object('kind', _kind, 'ok', _ok));
  IF _kind IN ('request','alternative') THEN
    IF r.status NOT IN ('awaiting_user_ok','needs_user') OR r.send_lock_at IS NULL THEN
      PERFORM public._ai_res_actor(NULL, NULL);
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_CLAIMED', 'status', r.status);
    END IF;
    IF _ok THEN
      v_exp := least(now() + make_interval(hours => (v_lim->>'expire_after_hours')::int), r.requested_for - interval '30 minutes');
      v_alt := r.chosen_alternative;
      IF _kind = 'alternative' AND coalesce((v_alt->>'held')::boolean, false) AND v_alt->>'verified_sender' = 'true'
         AND length(coalesce(v_alt->>'inbound_email_id', '')) > 3 AND length(btrim(coalesce(v_alt->>'quote', ''))) >= 4 THEN
        -- El restaurante ya había apartado este horario por escrito y el usuario lo aceptó.
        UPDATE public.ai_reservations
           SET status = 'confirmed', reason = NULL, send_lock_at = NULL, attempts = attempts + 1, sent_at = coalesce(sent_at, now()),
               confirmed_at = now(), confirmation_code = left(nullif(v_alt->>'code', ''), 60),
               confirmation = jsonb_build_object('channel', 'venue_email', 'inbound_email_id', v_alt->>'inbound_email_id',
                 'quote', v_alt->>'quote', 'verified_sender', true, 'from_domain', v_alt->>'from_domain',
                 'stated', jsonb_build_object('local', v_alt->>'local'), 'user_accepted_at', now(), 'at', now()),
               evidence = jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
                 jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now())))
         WHERE id = _id RETURNING * INTO r;
        PERFORM public._ai_res_booking(r);
      ELSE
        UPDATE public.ai_reservations
           SET status = 'sent', reason = NULL, send_lock_at = NULL, attempts = attempts + 1, sent_at = coalesce(sent_at, now()),
               reminder_sent_at = NULL, expires_at = v_exp, last_error = NULL,
               evidence = jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
                 jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now())))
         WHERE id = _id RETURNING * INTO r;
      END IF;
    ELSE
      v_fail := coalesce((r.evidence->>'send_failures')::int, 0) + 1;
      UPDATE public.ai_reservations
         SET send_lock_at = NULL, last_error = left(coalesce(_error, 'send_failed'), 300),
             evidence = evidence || jsonb_build_object('send_failures', v_fail),
             status = CASE WHEN v_fail >= 3 AND status = 'awaiting_user_ok' THEN 'failed' ELSE status END,
             reason = CASE WHEN v_fail >= 3 AND status = 'awaiting_user_ok' THEN 'send_failed' ELSE reason END
       WHERE id = _id RETURNING * INTO r;
    END IF;
  ELSE
    UPDATE public.ai_reservations
       SET attempts = attempts + CASE WHEN _ok AND _kind = 'reminder' THEN 1 ELSE 0 END,
           last_error = CASE WHEN _ok THEN last_error ELSE left(coalesce(_error, 'send_failed'), 300) END,
           evidence = CASE WHEN _ok THEN jsonb_set(evidence, '{outbound}', coalesce(evidence->'outbound', '[]') ||
             jsonb_build_array(jsonb_build_object('kind', _kind, 'id', left(_provider_id, 200), 'at', now()))) ELSE evidence END
     WHERE id = _id RETURNING * INTO r;
  END IF;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'status', r.status, 'reservation', public.ai_reservation_json(r));
END $$;

-- Constancia en bookings (pantalla "Mis reservas") SOLO al confirmarse por escrito.
CREATE OR REPLACE FUNCTION public._ai_res_booking(r public.ai_reservations)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF r.status <> 'confirmed' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE user_id = r.user_id AND raw_payload->>'ai_reservation_id' = r.id::text) THEN RETURN; END IF;
  INSERT INTO public.bookings (user_id, trip_id, category, provider, status, title, subtitle, city, country, start_at,
    confirmation_code, booking_url, raw_payload)
  VALUES (r.user_id, r.trip_id, 'restaurant', 'iatos_reservas_ia', 'confirmed', left(r.venue_name, 200),
    'Confirmada por escrito por el restaurante · ' || r.party_size || CASE WHEN r.party_size = 1 THEN ' persona' ELSE ' personas' END,
    r.venue_city, r.venue_country, r.requested_for, coalesce(r.confirmation_code, r.ref_code), coalesce(r.venue_booking_url, r.venue_website),
    jsonb_build_object('source', 'ai_reservation', 'ai_reservation_id', r.id, 'channel', r.confirmation->>'channel'));
END $$;

-- ───────────────────────────── Correo recibido ───────────────────────────────────────────────────────
-- Reclama un webhook de Resend una sola vez. state: new | retry | duplicate | unmatched.
-- Se identifica por el token de la dirección de respuesta. Respaldo: si el restaurante contestó a otra
-- dirección nuestra sin token, el folio del asunto (Ref R-XXXXXX) cuenta SOLO si el remitente es
-- exactamente el correo al que le escribimos.
DROP FUNCTION IF EXISTS public.ai_reservation_inbound_claim(text, text, text, text);
CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_claim(_event_id text, _email_id text, _token text, _from_domain text,
  _ref_code text DEFAULT NULL, _from_address text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x record; r public.ai_reservations; v_id uuid;
BEGIN
  IF coalesce(_event_id, '') = '' OR coalesce(_email_id, '') = '' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_EVENT'); END IF;
  SELECT * INTO x FROM public.ai_reservation_inbound WHERE provider_event_id = _event_id OR email_id = _email_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF x.status = 'failed' AND x.attempts < 5 THEN
      UPDATE public.ai_reservation_inbound SET status = 'processing', attempts = attempts + 1 WHERE id = x.id;
      SELECT * INTO r FROM public.ai_reservations WHERE id = x.reservation_id;
      RETURN jsonb_build_object('ok', true, 'state', 'retry', 'inbound_id', x.id,
        'reservation', CASE WHEN r.id IS NOT NULL THEN public.ai_reservation_json_internal(r) END);
    END IF;
    RETURN jsonb_build_object('ok', true, 'state', 'duplicate', 'inbound_id', x.id);
  END IF;
  IF _token ~ '^[0-9a-f]{24}$' THEN
    SELECT * INTO r FROM public.ai_reservations WHERE reply_token = _token;
  ELSIF _ref_code ~ '^R-[A-Z0-9]{6}$' AND coalesce(_from_address, '') <> '' THEN
    SELECT * INTO r FROM public.ai_reservations WHERE ref_code = _ref_code AND lower(venue_email) = lower(btrim(_from_address));
  END IF;
  INSERT INTO public.ai_reservation_inbound (provider_event_id, email_id, reservation_id, status, from_domain)
  VALUES (left(_event_id, 200), left(_email_id, 200), r.id, CASE WHEN r.id IS NULL THEN 'unmatched' ELSE 'processing' END,
          left(lower(_from_domain), 253))
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'state', 'duplicate'); END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'state', 'unmatched', 'inbound_id', v_id); END IF;
  RETURN jsonb_build_object('ok', true, 'state', 'new', 'inbound_id', v_id, 'reservation', public.ai_reservation_json_internal(r));
END $$;

CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_finish(_inbound_id uuid, _status text, _outcome text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ai_reservation_inbound
     SET status = CASE WHEN _status IN ('done','failed','unmatched','late') THEN _status ELSE status END,
         outcome = left(_outcome, 60), processed_at = now()
   WHERE id = _inbound_id;
$$;

-- Aplica la decisión ya validada en TypeScript (clasificación + reglas). La base vuelve a exigir
-- evidencia para "confirmed" (CHECK). _d: {outcome: confirmed | alternative_offered | declined |
-- needs_info | payment_required | unverified | ambiguous | ignored, excerpt, confirmation, alternatives,
-- info_requested, inbound_email_id, from_domain, verified_sender, quotes}.
CREATE OR REPLACE FUNCTION public.ai_reservation_apply_reply(_id uuid, _inbound_id uuid, _d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations; v_out text := _d->>'outcome'; v_to text; v_reason text; v_ev jsonb;
BEGIN
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_out NOT IN ('confirmed','alternative_offered','declined','needs_info','payment_required','unverified','ambiguous','ignored') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_OUTCOME');
  END IF;
  v_ev := jsonb_build_object('inbound_id', _inbound_id, 'email_id', left(_d->>'inbound_email_id', 200), 'outcome', v_out,
                             'from_domain', left(_d->>'from_domain', 253), 'verified_sender', coalesce((_d->>'verified_sender')::boolean, false),
                             'quotes', coalesce(_d->'quotes', '[]'::jsonb), 'at', now());
  PERFORM public._ai_res_actor('restaurante', left('Respuesta del restaurante: ' || v_out, 500));
  INSERT INTO public.ai_reservation_events (reservation_id, kind, actor, note, data)
  VALUES (_id, 'email_in', 'restaurante', 'Respuesta recibida (' || v_out || ')', v_ev - 'quotes');
  IF r.status NOT IN ('sent','venue_replied','needs_user') THEN
    PERFORM public.ai_reservation_inbound_finish(_inbound_id, 'late', v_out);
    UPDATE public.ai_reservations SET evidence = jsonb_set(evidence, '{inbound}', coalesce(evidence->'inbound', '[]') || jsonb_build_array(v_ev)),
           claude_calls = claude_calls + coalesce((_d->>'claude_calls')::int, 0)
     WHERE id = _id;
    PERFORM public._ai_res_actor(NULL, NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'LATE', 'status', r.status);
  END IF;
  v_to := CASE v_out
    WHEN 'confirmed' THEN 'confirmed' WHEN 'alternative_offered' THEN 'needs_user' WHEN 'declined' THEN 'declined'
    WHEN 'needs_info' THEN 'needs_user' WHEN 'payment_required' THEN 'needs_user'
    WHEN 'unverified' THEN 'venue_replied' WHEN 'ambiguous' THEN 'venue_replied' ELSE r.status END;
  v_reason := CASE v_out
    WHEN 'alternative_offered' THEN 'alternative_offered' WHEN 'needs_info' THEN 'needs_info'
    WHEN 'payment_required' THEN 'payment_required' WHEN 'unverified' THEN 'sender_unverified'
    WHEN 'ambiguous' THEN 'ambiguous_reply' WHEN 'declined' THEN 'declined' WHEN 'confirmed' THEN NULL ELSE r.reason END;
  -- needs_user → venue_replied no aplica a una respuesta dudosa que llega mientras el usuario decide: se queda en needs_user.
  IF r.status = 'needs_user' AND v_to = 'venue_replied' THEN v_to := 'needs_user'; v_reason := r.reason; END IF;
  UPDATE public.ai_reservations
     SET status = v_to, reason = v_reason,
         venue_replied_at = CASE WHEN v_out = 'ignored' THEN venue_replied_at ELSE now() END,
         venue_reply_excerpt = CASE WHEN v_out = 'ignored' THEN venue_reply_excerpt ELSE left(nullif(_d->>'excerpt', ''), 800) END,
         alternatives = CASE WHEN v_out = 'alternative_offered' AND jsonb_typeof(_d->'alternatives') = 'array' THEN _d->'alternatives' ELSE alternatives END,
         chosen_alternative = CASE WHEN v_out = 'alternative_offered' THEN NULL ELSE chosen_alternative END,
         user_options = CASE WHEN v_out IN ('needs_info','payment_required') THEN coalesce(user_options, '{}'::jsonb)
                               || jsonb_build_object('info_requested', left(_d->>'info_requested', 300)) ELSE user_options END,
         confirmation = CASE WHEN v_out = 'confirmed' THEN _d->'confirmation' ELSE confirmation END,
         confirmation_code = CASE WHEN v_out = 'confirmed' THEN left(nullif(_d->'confirmation'->>'code', ''), 60) ELSE confirmation_code END,
         confirmed_at = CASE WHEN v_out = 'confirmed' THEN now() ELSE confirmed_at END,
         claude_calls = claude_calls + coalesce((_d->>'claude_calls')::int, 0),
         evidence = jsonb_set(evidence, '{inbound}', coalesce(evidence->'inbound', '[]') || jsonb_build_array(v_ev))
   WHERE id = _id RETURNING * INTO r;   -- el CHECK ai_res_confirmed_has_evidence rechaza una confirmación sin evidencia
  IF v_out = 'confirmed' THEN PERFORM public._ai_res_booking(r); END IF;
  PERFORM public.ai_reservation_inbound_finish(_inbound_id, 'done', v_out);
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'status', r.status, 'reason', r.reason, 'reservation', public.ai_reservation_json_internal(r));
END $$;

-- ───────────────────────────── Transiciones manuales y del sistema ──────────────────────────────────
-- usuario: solo cancela lo suyo. sistema: vencer / fallar. equipo: confirmar a mano con evidencia
-- (p. ej. el restaurante respondió desde otra dirección y el equipo lo verificó por teléfono).
CREATE OR REPLACE FUNCTION public.ai_reservation_transition(_id uuid, _to text, _actor text, _user_id uuid DEFAULT NULL,
  _note text DEFAULT NULL, _confirmation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations; v_prev text;
BEGIN
  IF _actor NOT IN ('usuario','sistema','equipo') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); END IF;
  SELECT * INTO r FROM public.ai_reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR (_actor = 'usuario' AND r.user_id IS DISTINCT FROM _user_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF _actor = 'usuario' AND _to <> 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); END IF;
  IF _actor = 'sistema' AND _to NOT IN ('expired','failed','cancelled') THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); END IF;
  IF _to = 'confirmed' AND (_actor <> 'equipo' OR coalesce(_confirmation->>'channel', '') <> 'equipo') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONFIRMATION_REQUIRES_EVIDENCE');
  END IF;
  IF r.status = _to THEN RETURN jsonb_build_object('ok', true, 'noop', true, 'status', r.status, 'prev_status', r.status); END IF;
  IF NOT public.ai_reservation_transition_ok(r.status, _to) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', r.status, 'to', _to);
  END IF;
  v_prev := r.status;
  PERFORM public._ai_res_actor(_actor, coalesce(_note, CASE _to WHEN 'cancelled' THEN 'Cancelada' WHEN 'expired' THEN 'Venció sin respuesta' ELSE _to END));
  UPDATE public.ai_reservations
     SET status = _to,
         reason = CASE WHEN _to = 'expired' THEN 'no_reply' WHEN _to = 'failed' THEN coalesce(reason, 'send_failed') ELSE reason END,
         send_lock_at = NULL,
         confirmation = CASE WHEN _to = 'confirmed' THEN _confirmation || jsonb_build_object('at', now()) ELSE confirmation END,
         confirmation_code = CASE WHEN _to = 'confirmed' THEN left(nullif(_confirmation->>'code', ''), 60) ELSE confirmation_code END,
         confirmed_at = CASE WHEN _to = 'confirmed' THEN now() ELSE confirmed_at END,
         closed_at = CASE WHEN _to = 'cancelled' THEN now() ELSE closed_at END
   WHERE id = _id RETURNING * INTO r;
  IF _to = 'confirmed' THEN PERFORM public._ai_res_booking(r); END IF;
  IF _to = 'cancelled' THEN
    UPDATE public.bookings SET status = 'cancelled' WHERE user_id = r.user_id AND raw_payload->>'ai_reservation_id' = _id::text;
  END IF;
  PERFORM public._ai_res_actor(NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'status', r.status, 'prev_status', v_prev,
    -- Si ya le habíamos escrito al restaurante, hay que avisarle de la cancelación.
    'notify_venue', _to = 'cancelled' AND v_prev IN ('sent','venue_replied','needs_user','confirmed') AND r.sent_at IS NOT NULL,
    'reservation', public.ai_reservation_json_internal(r));
END $$;

-- ───────────────────────────── Cron ─────────────────────────────────────────────────────────────────
-- Candidatas activas (la decisión de recordar o vencer vive en TypeScript, probada).
CREATE OR REPLACE FUNCTION public.ai_reservation_due(_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.ai_reservation_json_internal(r) ORDER BY r.updated_at), '[]'::jsonb)
    FROM (SELECT * FROM public.ai_reservations
           WHERE status IN ('draft','awaiting_user_ok','sent','venue_replied','needs_user')
           ORDER BY updated_at LIMIT greatest(1, least(coalesce(_limit, 200), 500))) r;
$$;

-- Reclama el único recordatorio al restaurante (idempotente: devuelve null si ya se mandó).
CREATE OR REPLACE FUNCTION public.ai_reservation_claim_reminder(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_reservations;
BEGIN
  IF NOT public._ai_res_enabled() THEN RETURN NULL; END IF;
  PERFORM public._ai_res_actor('sistema', 'Recordatorio al restaurante');
  UPDATE public.ai_reservations SET reminder_sent_at = now()
   WHERE id = _id AND status = 'sent' AND reminder_sent_at IS NULL RETURNING * INTO r;
  PERFORM public._ai_res_actor(NULL, NULL);
  IF r.id IS NULL THEN RETURN NULL; END IF;
  RETURN public.ai_reservation_json_internal(r);
END $$;

-- Lo que la API devuelve al usuario: sus reservas (o una) con historial, sin datos internos.
CREATE OR REPLACE FUNCTION public.ai_reservation_list_for_user(_user_id uuid, _id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.ai_reservation_json(r) || jsonb_build_object('history',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor,
                                                    'note', e.note, 'at', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
         FROM public.ai_reservation_events e WHERE e.reservation_id = r.id)) ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM public.ai_reservations r
   WHERE r.user_id = _user_id AND (_id IS NULL OR r.id = _id);
$$;

-- Permisos: nada para anon/authenticated; todo pasa por las edge functions con service_role.
REVOKE ALL ON FUNCTION public.ai_reservation_transition_ok(text, text), public.ai_reservation_limits(), public.ai_reservations_guard(),
  public.ai_reservation_notice(text, text, text, text, int, text), public.ai_reservations_log(),
  public.ai_reservation_json(public.ai_reservations), public.ai_reservation_json_internal(public.ai_reservations),
  public._ai_res_actor(text, text), public._ai_res_enabled(), public._ai_res_booking(public.ai_reservations),
  public.ai_reservation_create_intent(uuid, jsonb), public.ai_reservation_claim_send(uuid, uuid, jsonb),
  public.ai_reservation_claim_alternative(uuid, uuid, int), public.ai_reservation_mark_sent(uuid, text, boolean, text, text),
  public.ai_reservation_inbound_claim(text, text, text, text, text, text), public.ai_reservation_inbound_finish(uuid, text, text),
  public.ai_reservation_apply_reply(uuid, uuid, jsonb), public.ai_reservation_transition(uuid, text, text, uuid, text, jsonb),
  public.ai_reservation_due(int), public.ai_reservation_claim_reminder(uuid), public.ai_reservation_list_for_user(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_reservation_transition_ok(text, text), public.ai_reservation_limits(),
  public.ai_reservation_create_intent(uuid, jsonb), public.ai_reservation_claim_send(uuid, uuid, jsonb),
  public.ai_reservation_claim_alternative(uuid, uuid, int), public.ai_reservation_mark_sent(uuid, text, boolean, text, text),
  public.ai_reservation_inbound_claim(text, text, text, text, text, text), public.ai_reservation_inbound_finish(uuid, text, text),
  public.ai_reservation_apply_reply(uuid, uuid, jsonb), public.ai_reservation_transition(uuid, text, text, uuid, text, jsonb),
  public.ai_reservation_due(int), public.ai_reservation_claim_reminder(uuid), public.ai_reservation_list_for_user(uuid, uuid)
  TO service_role;
