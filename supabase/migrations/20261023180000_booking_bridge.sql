-- IATOS Booking Bridge (grupo bridge) · intenciones de reserva con estados honestos, historial,
-- verificación de enlaces y sincronización con las solicitudes existentes. Idempotente.
-- Diseño y mapeo: docs/iatos/IATOS_BOOKING_BRIDGE.md.
--
-- Se construye SOBRE lo que ya existe, sin duplicarlo:
--  * Las ofertas NO se guardan en una tabla nueva: salen de trips.*_json, trip_quotes.line_items,
--    resultados de flights-search/hotels-search y el catálogo Privé (adaptadores en
--    supabase/functions/_shared/booking/offers.ts). Solo cuando el usuario decide continuar se guarda
--    una FOTO de la oferta (booking_intents.offer) para saber qué eligió, a qué precio y cuándo.
--  * bookings sigue siendo la constancia de una reserva CONFIRMADA (y del clic, status pending, como
--    antes). Una intención solo crea una fila confirmada en bookings con evidencia del proveedor/equipo.
--  * concierge_requests (+ ciclo Privé 20261023100300) sigue siendo la solicitud asistida; la
--    intención guarda concierge_request_id y su estado se sincroniza con un trigger.
--  * Reservas IA (grupo reservas, ai_reservations) se liga con ai_reservation_id y
--    booking_intent_apply_external() (sin llave foránea: la tabla es de otro grupo).
--
-- Seguridad (Fase 12): nadie del cliente escribe estas tablas. Solo las funciones SECURITY DEFINER
-- (ejecutables por service_role, que usa booking-bridge tras validar el JWT y la lista blanca) crean o
-- cambian intenciones; un trigger rechaza cualquier cambio de estado ilegal, incluso con la llave de
-- servicio, y escribe el historial. CONFIRMED exige evidencia (CHECK). Lo que declara el usuario queda
-- como verification = 'user_declared', nunca como confirmado.

-- ───────────────────────────── Intenciones ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_intents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  trip_id               uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  offer_id              text NOT NULL CHECK (offer_id ~ '^[0-9a-f]{16}$'),
  product_type          text NOT NULL CHECK (product_type IN ('flight','hotel','restaurant','tour','experience','transport','event')),
  provider              text NOT NULL CHECK (length(provider) BETWEEN 1 AND 60),
  provider_offer_id     text CHECK (provider_offer_id IS NULL OR length(provider_offer_id) <= 4000),
  action_kind           text NOT NULL CHECK (action_kind IN ('exact_offer','equivalent_search','official_booking_page','official_website',
                          'whatsapp','email','sms','phone','maps_listing','assisted_request','prive_request','save_for_later')),
  booking_mode          text NOT NULL CHECK (booking_mode IN ('EXACT_DEEP_LINK','PROVIDER_SEARCH','HOSTED_CHECKOUT','IN_APP_BOOKING','REQUEST','UNAVAILABLE')),
  state                 text NOT NULL DEFAULT 'SELECTED' CHECK (state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK','REDIRECTED_TO_PROVIDER',
                          'REQUESTED','PENDING_CONFIRMATION','CONFIRMED','FAILED','CANCELLED','EXPIRED')),
  verification          text NOT NULL DEFAULT 'none' CHECK (verification IN ('none','user_declared','provider_verified','team_verified')),
  title                 text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- Destino web ya validado por booking-bridge (lista blanca o fuente confiable). booking-go solo
  -- redirige aquí, nunca a una URL que mande el cliente.
  target_url            text CHECK (target_url IS NULL OR (target_url ~ '^https://' AND length(target_url) <= 4096)),
  target_host           text CHECK (target_host IS NULL OR length(target_host) <= 253),
  processor             text CHECK (processor IS NULL OR length(processor) <= 120),
  channel               text NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp','email','sms','phone','iatos_team','prive','reservas_email','none')),
  offer                 jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(offer) = 'object' AND pg_column_size(offer) <= 24576),
  price                 numeric(14,2) CHECK (price IS NULL OR price >= 0),
  currency              char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  price_checked_at      timestamptz,
  offer_expires_at      timestamptz,
  -- Lo que el usuario declara: folio, nota, documento en trip-documents, resultado. Sin datos de pago.
  user_report           jsonb CHECK (user_report IS NULL OR (jsonb_typeof(user_report) = 'object' AND pg_column_size(user_report) <= 4096)),
  confirmation_evidence jsonb CHECK (confirmation_evidence IS NULL OR jsonb_typeof(confirmation_evidence) = 'object'),
  concierge_request_id  uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  ai_reservation_id     uuid,
  booking_id            uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  idempotency_key       text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  consent_saved_at      timestamptz,
  redirected_at         timestamptz,
  redirect_count        integer NOT NULL DEFAULT 0 CHECK (redirect_count >= 0),
  state_changed_at      timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_intents_idem UNIQUE (user_id, idempotency_key),
  -- Un clic nunca es una compra: CONFIRMED solo con evidencia del proveedor o del equipo.
  CONSTRAINT booking_intents_confirmed_has_evidence CHECK (state <> 'CONFIRMED' OR (
    confirmation_evidence IS NOT NULL
    AND confirmation_evidence->>'source' IN ('provider_api','provider_webhook','team_verified','prive_request_confirmed')
    AND coalesce(length(btrim(confirmation_evidence->>'ref')), 0) > 1
    AND (confirmation_evidence->>'verified_at') IS NOT NULL)),
  CONSTRAINT booking_intents_verification_ok CHECK (
    verification NOT IN ('provider_verified','team_verified') OR state IN ('CONFIRMED','CANCELLED')),
  -- El reporte del usuario no puede traer números de tarjeta (13-19 dígitos seguidos o separados).
  CONSTRAINT booking_intents_no_card_data CHECK (user_report IS NULL OR NOT (user_report::text ~ '(\d[ -]?){13,19}')),
  CONSTRAINT booking_intents_web_has_target CHECK (channel <> 'web' OR action_kind IN ('save_for_later','assisted_request','prive_request') OR target_url IS NOT NULL
    OR (offer ? 'form'))
);

-- Un mismo usuario no puede tener dos intenciones vivas para la misma oferta (doble clic, compras
-- repetidas): se reusa la existente.
CREATE UNIQUE INDEX IF NOT EXISTS booking_intents_one_active_per_offer
  ON public.booking_intents (user_id, offer_id) WHERE state NOT IN ('FAILED','CANCELLED','EXPIRED');
CREATE INDEX IF NOT EXISTS booking_intents_user_trip ON public.booking_intents (user_id, trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_intents_request ON public.booking_intents (concierge_request_id) WHERE concierge_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_intents_reservation ON public.booking_intents (ai_reservation_id) WHERE ai_reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.booking_intent_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id   uuid NOT NULL REFERENCES public.booking_intents(id) ON DELETE CASCADE,
  from_state  text,
  to_state    text NOT NULL,
  actor       text NOT NULL CHECK (actor IN ('usuario','sistema','equipo','proveedor')),
  actor_id    uuid,
  note        text CHECK (note IS NULL OR length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_intent_events_intent ON public.booking_intent_events (intent_id, created_at);

-- ───────────────────────────── Enlaces verificados ─────────────────────────────
-- Fecha, procedencia y caducidad de cada enlace oficial revisado (complemento, punto 7). Solo servidor.
CREATE TABLE IF NOT EXISTS public.booking_link_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash     text NOT NULL UNIQUE CHECK (url_hash ~ '^[0-9a-f]{64}$'),
  url          text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 4096),
  host         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('reservation_page','official_site','search_link','exact_link')),
  subject      text CHECK (subject IS NULL OR length(subject) <= 300),       -- lugar u oferta (nombre, slug, place_id)
  source       text NOT NULL CHECK (source IN ('prive_catalog','google_places','official_site_scan','builder','provider_api')),
  status       text NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok','broken','blocked','robots_disallowed','redirected_offsite','unknown')),
  http_status  integer,
  final_host   text,
  findings     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(findings) = 'object' AND pg_column_size(findings) <= 8192),
  checked_at   timestamptz,
  expires_at   timestamptz,
  check_count  integer NOT NULL DEFAULT 0,
  last_error   text CHECK (last_error IS NULL OR length(last_error) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_link_checks_due ON public.booking_link_checks (expires_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS booking_link_checks_host ON public.booking_link_checks (host, checked_at DESC);

-- ───────────────────────────── RLS ─────────────────────────────
ALTER TABLE public.booking_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_intent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_link_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_intents_owner_read ON public.booking_intents;
CREATE POLICY booking_intents_owner_read ON public.booking_intents FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS booking_intent_events_owner_read ON public.booking_intent_events;
CREATE POLICY booking_intent_events_owner_read ON public.booking_intent_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.booking_intents i WHERE i.id = intent_id AND i.user_id = auth.uid()));

REVOKE ALL ON public.booking_intents, public.booking_intent_events, public.booking_link_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_intents, public.booking_intent_events TO authenticated;
GRANT ALL ON public.booking_intents, public.booking_intent_events, public.booking_link_checks TO service_role;

-- ───────────────────────────── Transiciones ─────────────────────────────
-- La misma tabla que supabase/functions/_shared/booking/states.ts (TRANSITIONS).
CREATE OR REPLACE FUNCTION public.booking_intent_transition_ok(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (_from, _to) IN (
    ('SELECTED','PRICE_RECHECK_REQUIRED'), ('SELECTED','READY_TO_BOOK'), ('SELECTED','REQUESTED'),
    ('SELECTED','CANCELLED'), ('SELECTED','EXPIRED'), ('SELECTED','FAILED'),
    ('PRICE_RECHECK_REQUIRED','READY_TO_BOOK'), ('PRICE_RECHECK_REQUIRED','FAILED'), ('PRICE_RECHECK_REQUIRED','CANCELLED'),
    ('PRICE_RECHECK_REQUIRED','EXPIRED'),
    ('READY_TO_BOOK','REDIRECTED_TO_PROVIDER'), ('READY_TO_BOOK','PRICE_RECHECK_REQUIRED'), ('READY_TO_BOOK','REQUESTED'),
    ('READY_TO_BOOK','CANCELLED'), ('READY_TO_BOOK','EXPIRED'), ('READY_TO_BOOK','FAILED'),
    ('REDIRECTED_TO_PROVIDER','PENDING_CONFIRMATION'), ('REDIRECTED_TO_PROVIDER','READY_TO_BOOK'), ('REDIRECTED_TO_PROVIDER','CONFIRMED'),
    ('REDIRECTED_TO_PROVIDER','FAILED'), ('REDIRECTED_TO_PROVIDER','CANCELLED'), ('REDIRECTED_TO_PROVIDER','EXPIRED'),
    ('REQUESTED','PENDING_CONFIRMATION'), ('REQUESTED','CONFIRMED'), ('REQUESTED','FAILED'), ('REQUESTED','CANCELLED'), ('REQUESTED','EXPIRED'),
    ('PENDING_CONFIRMATION','CONFIRMED'), ('PENDING_CONFIRMATION','FAILED'), ('PENDING_CONFIRMATION','CANCELLED'),
    ('PENDING_CONFIRMATION','EXPIRED'),
    ('CONFIRMED','CANCELLED'));
$$;

-- Guardia: estado y datos clave solo cambian dentro de las funciones de abajo (marcan booking.actor
-- en la transacción). Ni la llave de servicio puede saltarse una transición ilegal.
CREATE OR REPLACE FUNCTION public.booking_intents_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_actor text := nullif(current_setting('booking.actor', true), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'booking_intents: solo las funciones booking_intent_* escriben intenciones';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK','REQUESTED') THEN
      RAISE EXCEPTION 'booking_intents: una intención nace como SELECTED, PRICE_RECHECK_REQUIRED, READY_TO_BOOK o REQUESTED';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now(); NEW.state_changed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.product_type IS DISTINCT FROM OLD.product_type OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'booking_intents: usuario, oferta, tipo y llave no cambian';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT public.booking_intent_transition_ok(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'booking_intents: transición no permitida (% → %)', OLD.state, NEW.state;
    END IF;
    NEW.state_changed_at := now();
  END IF;
  -- La evidencia de confirmación solo la pone el equipo o el proveedor.
  IF NEW.confirmation_evidence IS DISTINCT FROM OLD.confirmation_evidence AND v_actor NOT IN ('equipo','proveedor','sistema') THEN
    RAISE EXCEPTION 'booking_intents: la confirmación la registra el equipo o el proveedor';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS booking_intents_guard ON public.booking_intents;
CREATE TRIGGER booking_intents_guard BEFORE INSERT OR UPDATE ON public.booking_intents
  FOR EACH ROW EXECUTE FUNCTION public.booking_intents_guard();

CREATE OR REPLACE FUNCTION public.booking_intents_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.verification IS DISTINCT FROM OLD.verification OR NEW.redirect_count IS DISTINCT FROM OLD.redirect_count THEN
    INSERT INTO public.booking_intent_events (intent_id, from_state, to_state, actor, actor_id, note)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.state END, NEW.state,
            coalesce(nullif(current_setting('booking.actor', true), ''), 'sistema'),
            nullif(current_setting('booking.actor_id', true), '')::uuid,
            left(nullif(current_setting('booking.note', true), ''), 1000));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS booking_intents_log ON public.booking_intents;
CREATE TRIGGER booking_intents_log AFTER INSERT OR UPDATE ON public.booking_intents
  FOR EACH ROW EXECUTE FUNCTION public.booking_intents_log();

CREATE OR REPLACE FUNCTION public.booking_set_actor(_actor text, _actor_id uuid, _note text)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('booking.actor', coalesce(_actor, ''), true), set_config('booking.actor_id', coalesce(_actor_id::text, ''), true),
         set_config('booking.note', left(coalesce(_note, ''), 1000), true);
$$;

-- Vista pública de una intención (lo que el dueño de la intención y booking-bridge leen).
CREATE OR REPLACE FUNCTION public.booking_intent_json(i public.booking_intents)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', i.id, 'trip_id', i.trip_id, 'offer_id', i.offer_id, 'product_type', i.product_type, 'provider', i.provider,
    'action_kind', i.action_kind, 'booking_mode', i.booking_mode, 'state', i.state, 'verification', i.verification, 'title', i.title,
    'target_host', i.target_host, 'processor', i.processor, 'channel', i.channel, 'price', i.price, 'currency', i.currency,
    'price_checked_at', i.price_checked_at, 'offer_expires_at', i.offer_expires_at, 'user_report', i.user_report,
    'confirmed', (i.state = 'CONFIRMED'), 'concierge_request_id', i.concierge_request_id, 'redirected_at', i.redirected_at,
    'redirect_count', i.redirect_count, 'state_changed_at', i.state_changed_at, 'created_at', i.created_at);
$$;

-- ───────────────────────────── Alta (servidor) ─────────────────────────────
-- booking-bridge la llama con service_role DESPUÉS de validar el JWT, el acceso al viaje y la lista
-- blanca del destino. Idempotente por (usuario, llave) y por oferta viva: devuelve la existente.
CREATE OR REPLACE FUNCTION public.booking_intent_start(_user uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.booking_intents; v_trip uuid; v_state text; v_rl jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'booking_intent_start: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF _user IS NULL OR _p IS NULL OR jsonb_typeof(_p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_INPUT');
  END IF;
  -- Reintento con la misma llave: misma respuesta.
  SELECT * INTO v_row FROM public.booking_intents WHERE user_id = _user AND idempotency_key = _p->>'idempotency_key';
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'replay', true, 'intent', public.booking_intent_json(v_row)); END IF;
  -- Ya hay una viva para esta oferta: se reusa (nunca dos compras de lo mismo en paralelo).
  SELECT * INTO v_row FROM public.booking_intents
   WHERE user_id = _user AND offer_id = _p->>'offer_id' AND state NOT IN ('FAILED','CANCELLED','EXPIRED');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existing', true, 'already_confirmed', v_row.state = 'CONFIRMED', 'intent', public.booking_intent_json(v_row));
  END IF;
  v_trip := nullif(_p->>'trip_id', '')::uuid;
  IF v_trip IS NOT NULL AND NOT public.has_trip_access(v_trip, _user) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  END IF;
  v_rl := public.check_rate_limit(_user::text, 'booking_intent', 40, 3600);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  v_state := coalesce(_p->>'state', 'SELECTED');
  PERFORM public.booking_set_actor('usuario', _user, coalesce(_p->>'note', 'Selección guardada por el usuario'));
  INSERT INTO public.booking_intents (user_id, trip_id, offer_id, product_type, provider, provider_offer_id, action_kind, booking_mode, state,
    title, target_url, target_host, processor, channel, offer, price, currency, price_checked_at, offer_expires_at, idempotency_key, consent_saved_at,
    concierge_request_id)
  VALUES (_user, v_trip, _p->>'offer_id', _p->>'product_type', _p->>'provider', nullif(_p->>'provider_offer_id', ''), _p->>'action_kind',
    _p->>'booking_mode', v_state, left(_p->>'title', 200), nullif(_p->>'target_url', ''), nullif(_p->>'target_host', ''), left(_p->>'processor', 120),
    coalesce(_p->>'channel', 'web'), coalesce(_p->'offer', '{}'::jsonb), nullif(_p->>'price', '')::numeric, nullif(_p->>'currency', ''),
    nullif(_p->>'price_checked_at', '')::timestamptz, nullif(_p->>'offer_expires_at', '')::timestamptz, _p->>'idempotency_key',
    CASE WHEN coalesce((_p->>'consent')::boolean, false) THEN now() END, nullif(_p->>'concierge_request_id', '')::uuid)
  RETURNING * INTO v_row;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN jsonb_build_object('ok', true, 'intent', public.booking_intent_json(v_row));
EXCEPTION WHEN unique_violation THEN
  -- Carrera entre dos clics: gana el primero.
  SELECT * INTO v_row FROM public.booking_intents
   WHERE user_id = _user AND (idempotency_key = _p->>'idempotency_key' OR (offer_id = _p->>'offer_id' AND state NOT IN ('FAILED','CANCELLED','EXPIRED')))
   LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'existing', true, 'intent', public.booking_intent_json(v_row));
END $$;

-- ───────────────────────────── Transición (servidor) ─────────────────────────────
-- _user = dueño (se verifica); NULL solo para el equipo/sistema. _patch acepta: user_report,
-- verification ('none'|'user_declared'), target_url/target_host/processor (solo antes de salir),
-- price/currency/price_checked_at/offer_expires_at/offer, concierge_request_id, ai_reservation_id.
CREATE OR REPLACE FUNCTION public.booking_intent_transition(_id uuid, _user uuid, _to text, _actor text, _note text DEFAULT NULL, _patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.booking_intents; v_to text; p jsonb := coalesce(_patch, '{}'::jsonb);
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'booking_intent_transition: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF _actor NOT IN ('usuario','sistema') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); END IF;
  SELECT * INTO r FROM public.booking_intents WHERE id = _id AND (_user IS NULL OR user_id = _user) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_to := coalesce(nullif(_to, ''), r.state);
  -- El usuario nunca confirma ni verifica.
  IF v_to = 'CONFIRMED' OR p->>'verification' IN ('provider_verified','team_verified') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONFIRMATION_REQUIRES_EVIDENCE');
  END IF;
  IF v_to <> r.state AND NOT public.booking_intent_transition_ok(r.state, v_to) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', r.state, 'to', v_to, 'intent', public.booking_intent_json(r));
  END IF;
  PERFORM public.booking_set_actor(_actor, _user, _note);
  UPDATE public.booking_intents SET
    state = v_to,
    user_report = CASE WHEN p ? 'user_report' THEN p->'user_report' ELSE user_report END,
    verification = coalesce(p->>'verification', verification),
    target_url = CASE WHEN p ? 'target_url' AND r.state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK') THEN nullif(p->>'target_url', '') ELSE target_url END,
    target_host = CASE WHEN p ? 'target_host' AND r.state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK') THEN nullif(p->>'target_host', '') ELSE target_host END,
    processor = CASE WHEN p ? 'processor' THEN left(p->>'processor', 120) ELSE processor END,
    action_kind = CASE WHEN p ? 'action_kind' AND r.state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK') THEN p->>'action_kind' ELSE action_kind END,
    booking_mode = CASE WHEN p ? 'booking_mode' AND r.state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK') THEN p->>'booking_mode' ELSE booking_mode END,
    channel = CASE WHEN p ? 'channel' THEN p->>'channel' ELSE channel END,
    offer = CASE WHEN p ? 'offer' THEN p->'offer' ELSE offer END,
    price = CASE WHEN p ? 'price' THEN nullif(p->>'price', '')::numeric ELSE price END,
    currency = CASE WHEN p ? 'currency' THEN nullif(p->>'currency', '') ELSE currency END,
    price_checked_at = CASE WHEN p ? 'price_checked_at' THEN nullif(p->>'price_checked_at', '')::timestamptz ELSE price_checked_at END,
    offer_expires_at = CASE WHEN p ? 'offer_expires_at' THEN nullif(p->>'offer_expires_at', '')::timestamptz ELSE offer_expires_at END,
    concierge_request_id = coalesce(nullif(p->>'concierge_request_id', '')::uuid, concierge_request_id),
    ai_reservation_id = coalesce(nullif(p->>'ai_reservation_id', '')::uuid, ai_reservation_id),
    consent_saved_at = CASE WHEN coalesce((p->>'consent')::boolean, false) THEN coalesce(consent_saved_at, now()) ELSE consent_saved_at END
  WHERE id = _id
  RETURNING * INTO r;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN jsonb_build_object('ok', true, 'intent', public.booking_intent_json(r));
END $$;

-- booking-go: marca la salida al proveedor y devuelve el destino GUARDADO. Re-abrir no duplica.
CREATE OR REPLACE FUNCTION public.booking_intent_mark_redirected(_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.booking_intents;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'booking_intent_mark_redirected: solo el servidor' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.booking_intents WHERE id = _id AND user_id = _user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.target_url IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_TARGET'); END IF;
  IF r.state NOT IN ('READY_TO_BOOK','REDIRECTED_TO_PROVIDER','PENDING_CONFIRMATION','CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_READY', 'state', r.state);
  END IF;
  PERFORM public.booking_set_actor('usuario', _user, 'Abrió el proveedor');
  UPDATE public.booking_intents
     SET state = CASE WHEN r.state = 'READY_TO_BOOK' THEN 'REDIRECTED_TO_PROVIDER' ELSE r.state END,
         redirected_at = coalesce(redirected_at, now()), redirect_count = redirect_count + 1
   WHERE id = _id RETURNING * INTO r;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN jsonb_build_object('ok', true, 'target_url', r.target_url, 'trip_id', r.trip_id, 'state', r.state);
END $$;

-- ───────────────────────────── Confirmación con evidencia ─────────────────────────────
-- Equipo (admins) o servidor (webhook/API de un proveedor autorizado). Crea la constancia en bookings.
CREATE OR REPLACE FUNCTION public.booking_intent_confirm(_id uuid, _evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.booking_intents; v_uid uuid := auth.uid(); v_team boolean; v_ev jsonb; v_booking uuid; v_cat text;
BEGIN
  v_team := v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admins WHERE user_id = v_uid);
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR v_team) THEN
    RAISE EXCEPTION 'booking_intent_confirm: solo el equipo o el servidor' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.booking_intents WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF NOT public.booking_intent_transition_ok(r.state, 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', r.state);
  END IF;
  -- Un admin solo puede registrar team_verified; los orígenes de proveedor son del servidor.
  v_ev := coalesce(_evidence, '{}'::jsonb) || jsonb_build_object('verified_at', now(),
    'source', CASE WHEN v_team AND coalesce(auth.role(), '') <> 'service_role' THEN 'team_verified' ELSE coalesce(_evidence->>'source', 'provider_api') END,
    'verified_by', coalesce(_evidence->>'verified_by', v_uid::text, 'servidor'));
  PERFORM public.booking_set_actor(CASE WHEN v_ev->>'source' = 'team_verified' THEN 'equipo' ELSE 'proveedor' END, v_uid,
                                   'Confirmada con evidencia: ' || coalesce(v_ev->>'source', ''));
  UPDATE public.booking_intents
     SET state = 'CONFIRMED', confirmation_evidence = v_ev,
         verification = CASE WHEN v_ev->>'source' = 'team_verified' THEN 'team_verified' ELSE 'provider_verified' END
   WHERE id = _id RETURNING * INTO r;   -- el CHECK rechaza una evidencia sin folio
  v_cat := CASE r.product_type WHEN 'flight' THEN 'flight' WHEN 'hotel' THEN 'hotel' WHEN 'restaurant' THEN 'restaurant'
                               WHEN 'transport' THEN 'other' ELSE 'activity' END;
  IF r.booking_id IS NULL THEN
    INSERT INTO public.bookings (user_id, trip_id, category, provider, status, title, subtitle, start_at, price_amount, price_currency,
      confirmation_code, booking_url, raw_payload)
    VALUES (r.user_id, r.trip_id, v_cat, coalesce(r.processor, r.provider), 'confirmed', r.title,
      'Confirmada con evidencia (' || (v_ev->>'source') || ')', nullif(r.offer #>> '{travel_dates,start}', '')::timestamptz,
      r.price, coalesce(r.currency, 'USD'), v_ev->>'ref', r.target_url,
      jsonb_build_object('source', 'booking_intent', 'booking_intent_id', r.id))
    RETURNING id INTO v_booking;
    UPDATE public.booking_intents SET booking_id = v_booking WHERE id = _id;
  END IF;
  PERFORM public.booking_set_actor('', NULL, '');
  PERFORM public.notify_once(r.user_id, 'booking_intent', 'Reserva confirmada', r.title || ' · folio ' || (v_ev->>'ref'), r.id, 'booking_intent:' || r.id || ':confirmed');
  RETURN jsonb_build_object('ok', true, 'id', _id, 'state', 'CONFIRMED', 'booking_id', coalesce(v_booking, r.booking_id));
END $$;

-- ───────────────────────────── Sincronización con solicitudes ─────────────────────────────
-- Estado de reservas IA (grupo reservas) → estado de intención. Igual que states.ts reservasStatusToIntent.
CREATE OR REPLACE FUNCTION public.booking_reservas_status_to_intent(_s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(_s, ''))
    WHEN 'draft' THEN 'SELECTED' WHEN 'borrador' THEN 'SELECTED' WHEN 'awaiting_user_ok' THEN 'READY_TO_BOOK'
    WHEN 'queued' THEN 'REQUESTED' WHEN 'sent' THEN 'REQUESTED' WHEN 'enviada' THEN 'REQUESTED' WHEN 'enviado' THEN 'REQUESTED' WHEN 'requested' THEN 'REQUESTED'
    WHEN 'confirmed' THEN 'CONFIRMED' WHEN 'confirmada' THEN 'CONFIRMED'
    WHEN 'declined' THEN 'FAILED' WHEN 'rechazada' THEN 'FAILED' WHEN 'no_availability' THEN 'FAILED' WHEN 'sin_disponibilidad' THEN 'FAILED'
    WHEN 'failed' THEN 'FAILED' WHEN 'bounced' THEN 'FAILED'
    WHEN 'cancelled' THEN 'CANCELLED' WHEN 'cancelada' THEN 'CANCELLED'
    WHEN 'expired' THEN 'EXPIRED' WHEN 'vencida' THEN 'EXPIRED'
    ELSE 'PENDING_CONFIRMATION' END;
$$;

-- Aplica un estado externo (reservas IA, solicitud asistida). CONFIRMED solo con evidencia; sin ella
-- queda PENDING_CONFIRMATION. Transiciones ilegales se ignoran (no se retrocede).
CREATE OR REPLACE FUNCTION public.booking_intent_apply_external(_id uuid, _source text, _status text, _evidence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.booking_intents; v_to text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'booking_intent_apply_external: solo el servidor' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.booking_intents WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_to := CASE _source WHEN 'reservas' THEN public.booking_reservas_status_to_intent(_status) ELSE upper(_status) END;
  IF v_to = 'CONFIRMED' THEN
    IF _evidence IS NULL OR coalesce(length(btrim(_evidence->>'ref')), 0) < 2 THEN
      v_to := 'PENDING_CONFIRMATION';
    ELSE
      RETURN public.booking_intent_confirm(_id, _evidence || jsonb_build_object('source', 'provider_api', 'channel', _source));
    END IF;
  END IF;
  IF v_to = r.state OR NOT public.booking_intent_transition_ok(r.state, v_to) THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'state', r.state);
  END IF;
  PERFORM public.booking_set_actor('sistema', NULL, 'Estado de ' || coalesce(_source, 'externo') || ': ' || coalesce(_status, ''));
  UPDATE public.booking_intents SET state = v_to WHERE id = _id RETURNING * INTO r;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN jsonb_build_object('ok', true, 'state', r.state);
END $$;

-- Cuando cambia una solicitud ligada (Privé o asistida), la intención la sigue.
CREATE OR REPLACE FUNCTION public.booking_intents_follow_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i record; v_to text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  FOR i IN SELECT id, state FROM public.booking_intents WHERE concierge_request_id = NEW.id LOOP
    IF NEW.type = 'prive_request' AND NEW.status = 'confirmado_externamente' THEN
      -- Evidencia ya validada por prive_confirm_has_evidence (quién, cuándo y folio o documento).
      PERFORM public.booking_set_actor('proveedor', NULL, 'Confirmada por el proveedor (solicitud Privé)');
      IF public.booking_intent_transition_ok(i.state, 'CONFIRMED') THEN
        UPDATE public.booking_intents SET state = 'CONFIRMED', verification = 'provider_verified',
          confirmation_evidence = jsonb_build_object('source', 'prive_request_confirmed',
            'ref', coalesce(NEW.external_confirmation->>'confirmation_code', NEW.external_confirmation->>'evidence_path'),
            'verified_by', NEW.external_confirmation->>'confirmed_by', 'verified_at', coalesce(NEW.external_confirmation->>'confirmed_at', now()::text))
        WHERE id = i.id;
      END IF;
      CONTINUE;
    END IF;
    v_to := CASE NEW.status
      WHEN 'solicitado' THEN 'REQUESTED' WHEN 'pending' THEN 'REQUESTED'
      WHEN 'pendiente_confirmacion' THEN 'PENDING_CONFIRMATION' WHEN 'in_progress' THEN 'PENDING_CONFIRMATION'
      WHEN 'contacted' THEN 'PENDING_CONFIRMATION' WHEN 'confirmed' THEN 'PENDING_CONFIRMATION' -- sin evidencia estructurada: pendiente
      WHEN 'cancelado' THEN 'CANCELLED' WHEN 'cancelled' THEN 'CANCELLED'
      WHEN 'rechazado' THEN 'FAILED' WHEN 'rejected' THEN 'FAILED' WHEN 'failed' THEN 'FAILED'
      WHEN 'caducado' THEN 'EXPIRED' WHEN 'expired' THEN 'EXPIRED'
      ELSE NULL END;
    IF v_to IS NOT NULL AND v_to <> i.state AND public.booking_intent_transition_ok(i.state, v_to) THEN
      PERFORM public.booking_set_actor('sistema', NULL, 'Solicitud: ' || NEW.status);
      UPDATE public.booking_intents SET state = v_to WHERE id = i.id;
    END IF;
  END LOOP;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS booking_intents_follow_request ON public.concierge_requests;
CREATE TRIGGER booking_intents_follow_request AFTER UPDATE OF status ON public.concierge_requests
  FOR EACH ROW EXECUTE FUNCTION public.booking_intents_follow_request();

-- ───────────────────────────── Caducidad ─────────────────────────────
-- Selecciones viejas que nunca salieron al proveedor caducan (14 días); una oferta exacta vencida
-- también. Lo llama booking-links-cron.
CREATE OR REPLACE FUNCTION public.booking_intents_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'booking_intents_expire: solo el servidor' USING ERRCODE = '42501';
  END IF;
  PERFORM public.booking_set_actor('sistema', NULL, 'Vencida sin continuar');
  UPDATE public.booking_intents SET state = 'EXPIRED'
   WHERE state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK')
     AND (created_at < now() - interval '14 days'
          OR (booking_mode = 'EXACT_DEEP_LINK' AND offer_expires_at IS NOT NULL AND offer_expires_at < now() - interval '1 day'));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.booking_set_actor('', NULL, '');
  RETURN n;
END $$;

-- ───────────────────────────── Lugar del catálogo (servidor) ─────────────────────────────
-- Busca un lugar del catálogo Privé por nombre y ciudad para dar su página oficial de reservas o su
-- sitio (datos públicos curados). Devuelve solo esos campos públicos, nunca contenido Privé.
CREATE OR REPLACE FUNCTION public.booking_venue_lookup(_name text, _city text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(x) FROM (
    SELECT e.id, e.slug, e.name, e.website, e.booking_url, e.booking_method, e.google_place_id, e.verified_at,
           d.name_es AS city, d.iso_country,
           -- Última revisión del enlace de reservas (roto o redirigido a otro dominio = no se ofrece).
           (SELECT c.status FROM public.booking_link_checks c WHERE c.url = e.booking_url ORDER BY c.checked_at DESC NULLS LAST LIMIT 1) AS booking_url_status,
           -- Canales públicos encontrados en el sitio oficial (WhatsApp, correo, teléfono), con su fecha.
           (SELECT jsonb_build_object('findings', c.findings, 'checked_at', c.checked_at) FROM public.booking_link_checks c
             WHERE c.url = e.website AND c.status = 'ok' ORDER BY c.checked_at DESC LIMIT 1) AS site_scan
      FROM public.prive_experiences_v e
      JOIN public.prive_destinations d ON d.id = e.destination_id
     WHERE e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')
       AND e.dedupe_key = public.prive_dedupe_key(_name)
       AND (public.prive_norm(d.name_es) = public.prive_norm(_city) OR public.prive_norm(d.name_en) = public.prive_norm(_city)
            OR public.prive_norm(_city) LIKE public.prive_norm(d.name_es) || '%')
     ORDER BY e.verified_at DESC NULLS LAST
     LIMIT 1) x;
$$;

REVOKE ALL ON FUNCTION public.booking_intent_transition_ok(text, text), public.booking_intents_guard(), public.booking_intents_log(),
  public.booking_set_actor(text, uuid, text), public.booking_intent_json(public.booking_intents),
  public.booking_intent_start(uuid, jsonb), public.booking_intent_transition(uuid, uuid, text, text, text, jsonb),
  public.booking_intent_mark_redirected(uuid, uuid), public.booking_reservas_status_to_intent(text),
  public.booking_intent_apply_external(uuid, text, text, jsonb), public.booking_intents_follow_request(),
  public.booking_intents_expire(), public.booking_venue_lookup(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_intent_start(uuid, jsonb), public.booking_intent_transition(uuid, uuid, text, text, text, jsonb),
  public.booking_intent_mark_redirected(uuid, uuid), public.booking_intent_apply_external(uuid, text, text, jsonb),
  public.booking_intents_expire(), public.booking_venue_lookup(text, text), public.booking_intent_transition_ok(text, text),
  public.booking_reservas_status_to_intent(text)
  TO service_role;
REVOKE ALL ON FUNCTION public.booking_intent_confirm(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_intent_confirm(uuid, jsonb) TO authenticated, service_role;  -- valida admins dentro
