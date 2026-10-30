-- IATOS · Comisiones y reservas gestionadas (grupo comisiones). Idempotente. Todo nace APAGADO salvo la
-- lectura de estadísticas de Travelpayouts (solo lee; la tarea programada la agenda el dueño).
-- Diseño, proveedores y qué falta firmar: docs/iatos/IATOS_COMISIONES.md.
--
-- Se construye SOBRE lo que ya existe, sin duplicarlo:
--  * Clics: public.affiliate_clicks (ya la llenan ActionButton y ConciergeCards) se amplía con producto, red y
--    origen; los clics que hoy solo quedaban en bookings (trackBookingClick, status 'pending') y las salidas
--    firmadas de booking-go (booking_intents.redirect_count) se copian ahí con triggers. Un mismo clic que llega
--    por dos caminos (ConciergeCards escribe en ambos) se cuenta una vez.
--  * Ventas afiliadas: public.commissions (nueva) con estado pendiente/confirmada/pagada/rechazada; la llena
--    comisiones-sync con la API de finanzas de Travelpayouts y, para lo que IATOS reserva por API, el margen
--    de cada reserva gestionada.
--  * Reservas gestionadas: public.managed_bookings (nueva) es la reserva que IATOS tiene "en la mano" (localizador
--    y API del proveedor). Se liga a booking_intents (Booking Bridge) y a bookings (constancia) y, al confirmarse,
--    confirma la intención con evidencia del proveedor (booking_intent_confirm, source provider_api).
--  * Cambios y cancelaciones: public.managed_booking_requests. El Operador IA solo PIDE (con el sí escrito del
--    viajero en su caso); una persona del equipo aprueba en el tablero; la tarea reservas-gestionadas ejecuta
--    con el adaptador del proveedor solo si la bandera está prendida. Nadie del cliente escribe estas tablas.

-- ───────────────────────────── Banderas ─────────────────────────────
INSERT INTO public.app_flags (key, value, note) VALUES
  ('comisiones_sync_enabled', 'true'::jsonb,
   'Comisiones: comisiones-sync lee la API de finanzas de Travelpayouts (solo lectura). Corre cuando el dueño agenda la tarea.'),
  ('proveedores_reservas_enabled', 'false'::jsonb,
   'Proveedores: permite reservar, cancelar o cambiar en PRODUCCIÓN con los adaptadores (RateHawk, Viator). En sandbox no hace falta.'),
  ('reservas_gestionadas_cambios_enabled', 'false'::jsonb,
   'Reservas gestionadas: la tarea ejecuta los cambios/cancelaciones que una persona del equipo aprobó.'),
  ('cargo_servicio_enabled', 'false'::jsonb,
   'Cargo por servicio de IATOS (por ejemplo en vuelos): se cotiza y se muestra con transparencia solo si está prendido.')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────── Normalización (producto y red) ─────────────────────────────
-- Producto del libro de comisiones a partir de la categoría de bookings, la acción del clic o el tipo de producto.
CREATE OR REPLACE FUNCTION public.commission_product_of(_hint text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _hint IS NULL OR btrim(_hint) = '' THEN 'otro'
    WHEN lower(_hint) ~ '(flight|vuelo|aviasales|airline)' THEN 'vuelo'
    WHEN lower(_hint) ~ '(hotel|hospedaje|lodging|stay)' THEN 'hotel'
    WHEN lower(_hint) ~ '(transfer|traslado|pickup|chofer|transport)' THEN 'traslado'
    WHEN lower(_hint) ~ '(tour|activit|experienc|actividad|attraction)' THEN 'tour'
    WHEN lower(_hint) ~ '(insurance|seguro)' THEN 'seguro'
    WHEN lower(_hint) ~ '(car|auto|rental)' THEN 'auto'
    WHEN lower(_hint) ~ 'esim' THEN 'esim'
    WHEN lower(_hint) ~ '(train|tren|ferry|bus|autob)' THEN 'transporte'
    WHEN lower(_hint) ~ '(restaurant|mesa|dining)' THEN 'restaurante'
    ELSE 'otro' END;
$$;

-- Red o programa de afiliados según el dominio de destino (solo para agrupar; no es una atribución).
CREATE OR REPLACE FUNCTION public.commission_network_of(_host text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _host IS NULL OR _host = '' THEN 'desconocida'
    WHEN _host ~ '(^|\.)(aviasales\.[a-z.]+|tp\.media|tp\.st|travelpayouts\.com|jetradar\.com)$' THEN 'travelpayouts'
    WHEN _host ~ '(^|\.)viator\.com$' THEN 'viator'
    WHEN _host ~ '(^|\.)booking\.com$' THEN 'booking'
    WHEN _host ~ '(^|\.)getyourguide\.[a-z.]+$' THEN 'getyourguide'
    WHEN _host ~ '(^|\.)civitatis\.com$' THEN 'civitatis'
    WHEN _host ~ '(^|\.)welcomepickups\.com$' THEN 'welcome_pickups'
    WHEN _host ~ '(^|\.)safetywing\.com$' THEN 'safetywing'
    WHEN _host ~ '(^|\.)(ratehawk\.com|emergingtravel\.com)$' THEN 'ratehawk'
    WHEN _host ~ '(^|\.)google\.com$' THEN 'sin_afiliado'
    ELSE 'directo' END;
$$;

CREATE OR REPLACE FUNCTION public.commission_host_of(_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(lower(regexp_replace(substring(coalesce(_url, '') FROM '^https?://([^/?#:]+)'), '^www\.', '')), '');
$$;

-- ───────────────────────────── 1. Clics (affiliate_clicks ampliada) ─────────────────────────────
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS origen text;
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS producto text;
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS red text;
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS host text;
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS booking_id uuid;
ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS booking_intent_id uuid;
DO $$ BEGIN
  ALTER TABLE public.affiliate_clicks ADD CONSTRAINT affiliate_clicks_origen_ok
    CHECK (origen IS NULL OR origen IN ('app','reservar','booking_go'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_affclicks_month ON public.affiliate_clicks (clicked_at, red, producto);
CREATE INDEX IF NOT EXISTS idx_affclicks_dedupe ON public.affiliate_clicks (user_id, url_final, clicked_at DESC);

-- Normaliza cada clic (también los que inserta el cliente). El cliente no puede fijar origen, red ni ids:
-- se recalculan aquí, para que el tablero no dependa de lo que mande el navegador.
CREATE OR REPLACE FUNCTION public.affiliate_clicks_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_internal boolean := coalesce(current_setting('comisiones.click_internal', true), '') = '1';
BEGIN
  IF NOT v_internal THEN
    NEW.origen := 'app'; NEW.booking_id := NULL; NEW.booking_intent_id := NULL;
  END IF;
  NEW.host := public.commission_host_of(NEW.url_final);
  NEW.red := public.commission_network_of(NEW.host);
  IF NOT v_internal OR NEW.producto IS NULL THEN
    NEW.producto := public.commission_product_of(coalesce(NEW.payload->>'category', NEW.accion, NEW.proveedor));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS affiliate_clicks_normalize ON public.affiliate_clicks;
CREATE TRIGGER affiliate_clicks_normalize BEFORE INSERT ON public.affiliate_clicks
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_clicks_normalize();

-- Alta interna de un clic (triggers de bookings y booking_intents). Un mismo usuario y URL en 2 minutos = un clic.
CREATE OR REPLACE FUNCTION public.affiliate_click_record(_user uuid, _trip uuid, _proveedor text, _accion text, _url text,
  _producto text, _origen text, _booking uuid, _intent uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF _url IS NULL OR _url !~ '^https?://' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.affiliate_clicks
   WHERE user_id IS NOT DISTINCT FROM _user AND url_final = _url AND clicked_at > now() - interval '2 minutes'
   ORDER BY clicked_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.affiliate_clicks SET booking_id = coalesce(booking_id, _booking), booking_intent_id = coalesce(booking_intent_id, _intent)
     WHERE id = v_id;
    RETURN v_id;
  END IF;
  PERFORM set_config('comisiones.click_internal', '1', true);
  INSERT INTO public.affiliate_clicks (user_id, trip_id, proveedor, accion, url_final, origen, producto, booking_id, booking_intent_id)
  VALUES (_user, _trip, left(coalesce(nullif(_proveedor, ''), 'desconocido'), 120), left(coalesce(_accion, _origen), 120), left(_url, 4096),
          _origen, public.commission_product_of(_producto), _booking, _intent)
  RETURNING id INTO v_id;
  PERFORM set_config('comisiones.click_internal', '', true);
  RETURN v_id;
END $$;

-- trackBookingClick / logBookingClick: la visita al socio queda en bookings con status 'pending'.
CREATE OR REPLACE FUNCTION public.bookings_click_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.booking_url IS NOT NULL AND coalesce(NEW.raw_payload->>'source', '') <> 'booking_intent' THEN
    BEGIN
      PERFORM public.affiliate_click_record(NEW.user_id, NEW.trip_id, NEW.provider, 'reservar_' || NEW.category, NEW.booking_url,
        NEW.category, 'reservar', NEW.id, NULL);
    EXCEPTION WHEN OTHERS THEN
      -- El libro de clics nunca debe impedir que se guarde la visita del usuario.
      RAISE WARNING 'affiliate click ledger: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS bookings_click_to_ledger ON public.bookings;
CREATE TRIGGER bookings_click_to_ledger AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_click_to_ledger();

-- booking-go: cada salida firmada al proveedor (booking_intent_mark_redirected sube redirect_count).
CREATE OR REPLACE FUNCTION public.booking_intents_click_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.redirect_count > OLD.redirect_count AND NEW.target_url IS NOT NULL THEN
    BEGIN
      PERFORM public.affiliate_click_record(NEW.user_id, NEW.trip_id, NEW.provider, 'booking_go_' || NEW.product_type, NEW.target_url,
        NEW.product_type, 'booking_go', NEW.booking_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'affiliate click ledger: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS booking_intents_click_to_ledger ON public.booking_intents;
CREATE TRIGGER booking_intents_click_to_ledger AFTER UPDATE OF redirect_count ON public.booking_intents
  FOR EACH ROW EXECUTE FUNCTION public.booking_intents_click_to_ledger();

-- ───────────────────────────── 2. Reservas gestionadas por IATOS ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.managed_bookings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code             text NOT NULL UNIQUE CHECK (ref_code ~ '^R-[A-Z0-9]{6}$'),
  user_id              uuid NOT NULL,
  trip_id              uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  booking_intent_id    uuid REFERENCES public.booking_intents(id) ON DELETE SET NULL,
  booking_id           uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  provider             text NOT NULL CHECK (provider IN ('ratehawk','viator','traslados','manual')),
  environment          text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','produccion')),
  product_type         text NOT NULL CHECK (product_type IN ('hotel','vuelo','traslado','tour','seguro')),
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- Referencias del proveedor: localizador que ve el viajero y los ids de la API.
  provider_ref         text CHECK (provider_ref IS NULL OR length(provider_ref) <= 120),
  provider_booking_id  text NOT NULL CHECK (length(provider_booking_id) BETWEEN 1 AND 256),
  partner_order_id     text CHECK (partner_order_id IS NULL OR length(partner_order_id) <= 256),
  status               text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','confirmada','cancelada','fallida','rechazada','completada','no_show')),
  provider_status      text CHECK (provider_status IS NULL OR length(provider_status) <= 60),
  synced_at            timestamptz,
  -- Políticas normalizadas (_shared/proveedores/politicas.ts) con la fuente: lo que dijo el proveedor al reservar.
  policies             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(policies) = 'object' AND pg_column_size(policies) <= 16384),
  cancellable          boolean NOT NULL DEFAULT false,
  free_cancel_until    timestamptz,
  changeable           boolean NOT NULL DEFAULT false,
  -- Dinero: neto (lo que IATOS paga al proveedor), venta (lo que paga el viajero), comisión o margen. Nunca al cliente.
  net_amount           numeric(14,2) CHECK (net_amount IS NULL OR net_amount >= 0),
  sell_amount          numeric(14,2) CHECK (sell_amount IS NULL OR sell_amount >= 0),
  commission_amount    numeric(14,2),
  service_fee_amount   numeric(14,2) CHECK (service_fee_amount IS NULL OR service_fee_amount >= 0),
  currency             char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  start_at             timestamptz,
  end_at               timestamptz,
  lead_traveler        text CHECK (lead_traveler IS NULL OR length(lead_traveler) <= 120),
  raw                  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw) = 'object' AND pg_column_size(raw) <= 32768),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT managed_bookings_provider_id UNIQUE (provider, environment, provider_booking_id),
  CONSTRAINT managed_bookings_no_card CHECK (NOT (raw::text ~ '(\d[ -]?){13,19}'))
);
CREATE INDEX IF NOT EXISTS managed_bookings_user ON public.managed_bookings (user_id, start_at DESC);
CREATE INDEX IF NOT EXISTS managed_bookings_active ON public.managed_bookings (provider, status, synced_at NULLS FIRST)
  WHERE status IN ('pendiente','confirmada');

CREATE TABLE IF NOT EXISTS public.managed_booking_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES public.managed_bookings(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('alta','estado','sincronizacion','webhook','solicitud','aprobacion','ejecucion','nota')),
  from_status text,
  to_status   text,
  actor       text NOT NULL CHECK (actor IN ('sistema','proveedor','operador','equipo')),
  actor_id    uuid,
  note        text CHECK (note IS NULL OR length(note) <= 1000),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 8192)
);
CREATE INDEX IF NOT EXISTS managed_booking_events_b ON public.managed_booking_events (booking_id, at);

CREATE TABLE IF NOT EXISTS public.managed_booking_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES public.managed_bookings(id) ON DELETE CASCADE,
  incident_id      uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('cancelacion','cambio')),
  requested_by     text NOT NULL CHECK (requested_by IN ('operador','equipo')),
  consent_event_id bigint,
  consent_text     text CHECK (consent_text IS NULL OR length(consent_text) <= 600),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 4096),
  policy_check     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pendiente_aprobacion'
                     CHECK (status IN ('pendiente_aprobacion','aprobada','ejecutando','hecha','rechazada','fallida','revisar')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  started_at       timestamptz,
  finished_at      timestamptz,
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Consentimiento: solo un mensaje real del viajero en su caso o la decisión de una persona del equipo.
  CONSTRAINT managed_requests_consent CHECK (requested_by = 'equipo' OR (consent_event_id IS NOT NULL AND incident_id IS NOT NULL))
);
-- Una sola solicitud viva por reserva y tipo.
CREATE UNIQUE INDEX IF NOT EXISTS managed_requests_one_active ON public.managed_booking_requests (booking_id, kind)
  WHERE status IN ('pendiente_aprobacion','aprobada','ejecutando','revisar');

ALTER TABLE public.managed_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managed_booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managed_booking_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.managed_bookings, public.managed_booking_events, public.managed_booking_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.managed_bookings, public.managed_booking_events, public.managed_booking_requests TO service_role;

CREATE OR REPLACE FUNCTION public.managed_booking_new_ref()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE v text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
BEGIN
  LOOP
    v := 'R-';
    FOR i IN 1..6 LOOP v := v || substr(a, 1 + floor(random() * length(a))::int, 1); END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.managed_bookings WHERE ref_code = v);
  END LOOP;
  RETURN v;
END $$;

-- Estado de la comisión que sale de una reserva gestionada (margen o comisión del proveedor).
CREATE OR REPLACE FUNCTION public.managed_commission_status(_s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s WHEN 'completada' THEN 'confirmada' WHEN 'no_show' THEN 'confirmada'
                 WHEN 'cancelada' THEN 'rechazada' WHEN 'fallida' THEN 'rechazada' WHEN 'rechazada' THEN 'rechazada'
                 ELSE 'pendiente' END;
$$;

-- ───────────────────────────── 3. Libro de comisiones (ventas) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL CHECK (source IN ('travelpayouts','viator','ratehawk','traslados','manual','cargo_servicio')),
  external_id         text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  campaign_id         integer,
  proveedor           text NOT NULL CHECK (length(proveedor) BETWEEN 1 AND 80),
  producto            text NOT NULL DEFAULT 'otro',
  status              text NOT NULL CHECK (status IN ('pendiente','confirmada','pagada','rechazada')),
  provider_state      text CHECK (provider_state IS NULL OR length(provider_state) <= 40),
  booked_at           timestamptz,
  provider_updated_at timestamptz,
  sale_amount         numeric(14,2),
  commission_amount   numeric(14,4) NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sub_id              text CHECK (sub_id IS NULL OR length(sub_id) <= 200),
  click_id            uuid REFERENCES public.affiliate_clicks(id) ON DELETE SET NULL,
  managed_booking_id  uuid REFERENCES public.managed_bookings(id) ON DELETE SET NULL,
  payout_ref          text CHECK (payout_ref IS NULL OR length(payout_ref) <= 80),
  paid_at             timestamptz,
  description         text CHECK (description IS NULL OR length(description) <= 300),
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw) = 'object' AND pg_column_size(raw) <= 8192),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  synced_at           timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commissions_ext UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS commissions_month ON public.commissions (booked_at, status);
CREATE INDEX IF NOT EXISTS commissions_proveedor ON public.commissions (proveedor, producto);

CREATE TABLE IF NOT EXISTS public.commission_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES public.commissions(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  from_status   text,
  to_status     text NOT NULL,
  amount        numeric(14,4),
  note          text CHECK (note IS NULL OR length(note) <= 300)
);
CREATE INDEX IF NOT EXISTS commission_events_c ON public.commission_events (commission_id, at);

CREATE TABLE IF NOT EXISTS public.commission_sync_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text CHECK (error IS NULL OR length(error) <= 300)
);
CREATE INDEX IF NOT EXISTS commission_sync_runs_src ON public.commission_sync_runs (source, started_at DESC);

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commissions, public.commission_events, public.commission_sync_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commissions, public.commission_events, public.commission_sync_runs TO service_role;

-- Transiciones del libro: una comisión pagada no retrocede; rechazada solo vuelve si el proveedor la reconfirma.
CREATE OR REPLACE FUNCTION public.commission_transition_ok(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _from IS NULL OR _from = _to OR (_from, _to) IN (
    ('pendiente','confirmada'), ('pendiente','rechazada'), ('pendiente','pagada'),
    ('confirmada','pagada'), ('confirmada','rechazada'), ('confirmada','pendiente'),
    ('rechazada','confirmada'), ('rechazada','pendiente'));
$$;

-- Alta o actualización de un lote (comisiones-sync y reservas gestionadas). Idempotente por (source, external_id).
-- Devuelve cuántas son nuevas, cuántas cambiaron y cuántas transiciones se ignoraron (nunca se baja una pagada).
CREATE OR REPLACE FUNCTION public.commissions_upsert(_source text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; c public.commissions; v_new int := 0; v_upd int := 0; v_same int := 0; v_skip int := 0; v_bad int := 0;
  v_status text; v_amount numeric; v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'commissions_upsert: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_INPUT'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_status := r->>'status';
    BEGIN v_amount := coalesce(nullif(r->>'commission_amount', '')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_bad := v_bad + 1; CONTINUE; END;
    IF coalesce(r->>'external_id', '') = '' OR v_status NOT IN ('pendiente','confirmada','pagada','rechazada')
       OR coalesce(r->>'currency', '') !~ '^[A-Z]{3}$' THEN
      v_bad := v_bad + 1; CONTINUE;
    END IF;
    SELECT * INTO c FROM public.commissions WHERE source = _source AND external_id = r->>'external_id' FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.commissions (source, external_id, campaign_id, proveedor, producto, status, provider_state, booked_at, provider_updated_at,
        sale_amount, commission_amount, currency, sub_id, managed_booking_id, description, raw, payout_ref, paid_at)
      VALUES (_source, r->>'external_id', nullif(r->>'campaign_id', '')::int, left(coalesce(nullif(r->>'proveedor', ''), _source), 80),
        public.commission_product_of(r->>'producto'), v_status, left(r->>'provider_state', 40), nullif(r->>'booked_at', '')::timestamptz,
        nullif(r->>'provider_updated_at', '')::timestamptz, nullif(r->>'sale_amount', '')::numeric, v_amount, r->>'currency',
        left(nullif(r->>'sub_id', ''), 200), nullif(r->>'managed_booking_id', '')::uuid, left(r->>'description', 300),
        CASE WHEN jsonb_typeof(r->'raw') = 'object' THEN r->'raw' ELSE '{}'::jsonb END,
        left(nullif(r->>'payout_ref', ''), 80), nullif(r->>'paid_at', '')::timestamptz)
      RETURNING id INTO v_id;
      INSERT INTO public.commission_events (commission_id, from_status, to_status, amount, note) VALUES (v_id, NULL, v_status, v_amount, 'alta');
      v_new := v_new + 1;
      CONTINUE;
    END IF;
    IF NOT public.commission_transition_ok(c.status, v_status) THEN
      v_skip := v_skip + 1;
      UPDATE public.commissions SET synced_at = now() WHERE id = c.id;
      CONTINUE;
    END IF;
    IF c.status = v_status AND c.commission_amount = v_amount AND c.sale_amount IS NOT DISTINCT FROM nullif(r->>'sale_amount', '')::numeric THEN
      v_same := v_same + 1;
      UPDATE public.commissions SET synced_at = now() WHERE id = c.id;
      CONTINUE;
    END IF;
    UPDATE public.commissions SET status = v_status, commission_amount = v_amount,
      sale_amount = coalesce(nullif(r->>'sale_amount', '')::numeric, sale_amount),
      provider_state = coalesce(left(r->>'provider_state', 40), provider_state),
      provider_updated_at = coalesce(nullif(r->>'provider_updated_at', '')::timestamptz, provider_updated_at),
      sub_id = coalesce(left(nullif(r->>'sub_id', ''), 200), sub_id),
      payout_ref = coalesce(left(nullif(r->>'payout_ref', ''), 80), payout_ref),
      paid_at = coalesce(nullif(r->>'paid_at', '')::timestamptz, paid_at),
      raw = CASE WHEN jsonb_typeof(r->'raw') = 'object' THEN r->'raw' ELSE raw END,
      synced_at = now(), updated_at = now()
     WHERE id = c.id;
    INSERT INTO public.commission_events (commission_id, from_status, to_status, amount, note)
    VALUES (c.id, c.status, v_status, v_amount, CASE WHEN c.status = v_status THEN 'monto' ELSE 'estado' END);
    v_upd := v_upd + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'nuevas', v_new, 'actualizadas', v_upd, 'sin_cambio', v_same, 'ignoradas', v_skip, 'invalidas', v_bad);
END $$;

-- Pago del programa a IATOS: las acciones de un pago pasan a "pagada" (solo las que ya estaban confirmadas o pendientes).
CREATE OR REPLACE FUNCTION public.commissions_mark_paid(_source text, _payout_ref text, _paid_at timestamptz, _external_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'commissions_mark_paid: solo el servidor' USING ERRCODE = '42501';
  END IF;
  WITH upd AS (
    UPDATE public.commissions SET status = 'pagada', payout_ref = left(_payout_ref, 80), paid_at = coalesce(_paid_at, now()), updated_at = now()
     WHERE source = _source AND external_id = ANY(coalesce(_external_ids, '{}')) AND status IN ('pendiente','confirmada')
    RETURNING id, commission_amount)
  INSERT INTO public.commission_events (commission_id, from_status, to_status, amount, note)
  SELECT id, 'confirmada', 'pagada', commission_amount, 'pago ' || left(_payout_ref, 60) FROM upd;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'pagadas', n);
END $$;

CREATE OR REPLACE FUNCTION public.commission_sync_log(_source text, _ok boolean, _stats jsonb, _error text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'commission_sync_log: solo el servidor' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.commission_sync_runs (source, finished_at, ok, stats, error)
  VALUES (left(_source, 40), now(), _ok, coalesce(_stats, '{}'::jsonb), left(_error, 300)) RETURNING id INTO v;
  DELETE FROM public.commission_sync_runs WHERE source = _source AND started_at < now() - interval '90 days';
  RETURN v;
END $$;

-- ───────────────────────────── 4. Alta y estado de reservas gestionadas (servidor) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.managed_booking_json(m public.managed_bookings, _internal boolean)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', m.id, 'ref_code', m.ref_code, 'provider', m.provider, 'environment', m.environment,
    'product_type', m.product_type, 'title', m.title, 'provider_ref', m.provider_ref, 'status', m.status,
    'provider_status', m.provider_status, 'synced_at', m.synced_at, 'cancellable', m.cancellable,
    'free_cancel_until', m.free_cancel_until, 'changeable', m.changeable, 'policies', m.policies,
    'sell_amount', m.sell_amount, 'currency', m.currency, 'start_at', m.start_at, 'end_at', m.end_at, 'trip_id', m.trip_id)
    || CASE WHEN _internal THEN jsonb_build_object('user_id', m.user_id, 'net_amount', m.net_amount, 'commission_amount', m.commission_amount,
         'service_fee_amount', m.service_fee_amount, 'provider_booking_id', m.provider_booking_id, 'partner_order_id', m.partner_order_id,
         'booking_intent_id', m.booking_intent_id)
       ELSE '{}'::jsonb END;
$$;

-- Comisión o margen de una reserva gestionada en el libro (source = proveedor, external_id = mb:<id>).
CREATE OR REPLACE FUNCTION public.managed_booking_sync_commission(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.managed_bookings; v_amount numeric;
BEGIN
  SELECT * INTO m FROM public.managed_bookings WHERE id = _id;
  IF NOT FOUND OR m.environment <> 'produccion' OR m.currency IS NULL THEN RETURN; END IF;  -- sandbox no es dinero
  v_amount := coalesce(m.commission_amount, CASE WHEN m.sell_amount IS NOT NULL AND m.net_amount IS NOT NULL THEN m.sell_amount - m.net_amount END);
  IF v_amount IS NULL THEN RETURN; END IF;
  PERFORM public.commissions_upsert(CASE WHEN m.provider = 'manual' THEN 'manual' ELSE m.provider END, jsonb_build_array(jsonb_build_object(
    'external_id', 'mb:' || m.id, 'proveedor', m.provider, 'producto', m.product_type, 'status', public.managed_commission_status(m.status),
    'provider_state', m.status, 'booked_at', m.created_at, 'sale_amount', m.sell_amount, 'commission_amount', v_amount,
    'currency', m.currency, 'managed_booking_id', m.id, 'description', left(m.title, 300))));
END $$;

-- Alta (o reintento) de una reserva hecha por un adaptador. Idempotente por (provider, environment, provider_booking_id).
CREATE OR REPLACE FUNCTION public.managed_booking_upsert(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.managed_bookings; v_trip uuid; v_status text := coalesce(_p->>'status', 'pendiente'); v_old text; v_ev jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_booking_upsert: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR coalesce(_p->>'user_id', '') = '' OR coalesce(_p->>'provider_booking_id', '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_INPUT');
  END IF;
  v_trip := nullif(_p->>'trip_id', '')::uuid;
  IF v_trip IS NOT NULL AND NOT public.has_trip_access(v_trip, (_p->>'user_id')::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  END IF;
  SELECT * INTO m FROM public.managed_bookings
   WHERE provider = _p->>'provider' AND environment = coalesce(_p->>'environment', 'sandbox') AND provider_booking_id = _p->>'provider_booking_id' FOR UPDATE;
  IF FOUND THEN
    IF m.user_id <> (_p->>'user_id')::uuid THEN RETURN jsonb_build_object('ok', false, 'code', 'OWNER_MISMATCH'); END IF;
    v_old := m.status;
    UPDATE public.managed_bookings SET
      status = CASE WHEN v_status <> m.status AND m.status IN ('cancelada','fallida','rechazada','completada','no_show') THEN m.status ELSE v_status END,
      provider_status = coalesce(left(_p->>'provider_status', 60), provider_status),
      provider_ref = coalesce(left(nullif(_p->>'provider_ref', ''), 120), provider_ref),
      policies = CASE WHEN jsonb_typeof(_p->'policies') = 'object' THEN _p->'policies' ELSE policies END,
      cancellable = coalesce((_p->>'cancellable')::boolean, cancellable),
      changeable = coalesce((_p->>'changeable')::boolean, changeable),
      free_cancel_until = CASE WHEN _p ? 'free_cancel_until' THEN nullif(_p->>'free_cancel_until', '')::timestamptz ELSE free_cancel_until END,
      net_amount = coalesce(nullif(_p->>'net_amount', '')::numeric, net_amount),
      sell_amount = coalesce(nullif(_p->>'sell_amount', '')::numeric, sell_amount),
      commission_amount = coalesce(nullif(_p->>'commission_amount', '')::numeric, commission_amount),
      synced_at = now(), updated_at = now()
     WHERE id = m.id RETURNING * INTO m;
  ELSE
    INSERT INTO public.managed_bookings (ref_code, user_id, trip_id, booking_intent_id, provider, environment, product_type, title, provider_ref,
      provider_booking_id, partner_order_id, status, provider_status, synced_at, policies, cancellable, free_cancel_until, changeable,
      net_amount, sell_amount, commission_amount, service_fee_amount, currency, start_at, end_at, lead_traveler, raw)
    VALUES (public.managed_booking_new_ref(), (_p->>'user_id')::uuid, v_trip, nullif(_p->>'booking_intent_id', '')::uuid, _p->>'provider',
      coalesce(_p->>'environment', 'sandbox'), _p->>'product_type', left(coalesce(_p->>'title', 'Reserva'), 200), left(nullif(_p->>'provider_ref', ''), 120),
      _p->>'provider_booking_id', left(nullif(_p->>'partner_order_id', ''), 256), v_status, left(_p->>'provider_status', 60), now(),
      CASE WHEN jsonb_typeof(_p->'policies') = 'object' THEN _p->'policies' ELSE '{}'::jsonb END,
      coalesce((_p->>'cancellable')::boolean, false), nullif(_p->>'free_cancel_until', '')::timestamptz, coalesce((_p->>'changeable')::boolean, false),
      nullif(_p->>'net_amount', '')::numeric, nullif(_p->>'sell_amount', '')::numeric, nullif(_p->>'commission_amount', '')::numeric,
      nullif(_p->>'service_fee_amount', '')::numeric, nullif(_p->>'currency', ''), nullif(_p->>'start_at', '')::timestamptz,
      nullif(_p->>'end_at', '')::timestamptz, left(nullif(_p->>'lead_traveler', ''), 120),
      CASE WHEN jsonb_typeof(_p->'raw') = 'object' THEN _p->'raw' ELSE '{}'::jsonb END)
    RETURNING * INTO m;
    INSERT INTO public.managed_booking_events (booking_id, kind, to_status, actor, note)
    VALUES (m.id, 'alta', m.status, 'sistema', 'Reserva creada por API (' || m.provider || ', ' || m.environment || ')');
  END IF;
  IF v_old IS DISTINCT FROM m.status AND v_old IS NOT NULL THEN
    INSERT INTO public.managed_booking_events (booking_id, kind, from_status, to_status, actor, note)
    VALUES (m.id, 'estado', v_old, m.status, 'proveedor', 'Estado del proveedor: ' || coalesce(m.provider_status, m.status));
  END IF;
  -- Booking Bridge: la intención ligada se confirma con evidencia del proveedor (folio y fecha), nunca solo por el clic.
  IF m.status = 'confirmada' AND m.booking_intent_id IS NOT NULL AND m.environment = 'produccion' THEN
    BEGIN
      v_ev := public.booking_intent_confirm(m.booking_intent_id, jsonb_build_object('source', 'provider_api',
        'ref', coalesce(m.provider_ref, m.provider_booking_id), 'verified_by', 'managed_booking:' || m.ref_code));
    EXCEPTION WHEN OTHERS THEN
      v_ev := jsonb_build_object('ok', false, 'error', left(SQLERRM, 200));
    END;
    IF coalesce(v_ev->>'ok', 'false') = 'true' AND m.booking_id IS NULL THEN
      UPDATE public.managed_bookings SET booking_id = nullif(v_ev->>'booking_id', '')::uuid WHERE id = m.id RETURNING * INTO m;
    END IF;
  END IF;
  PERFORM public.managed_booking_sync_commission(m.id);
  RETURN jsonb_build_object('ok', true, 'booking', public.managed_booking_json(m, true));
END $$;

-- Mapea un estado del proveedor a nuestro estado (lo mismo que _shared/proveedores/estados.ts).
CREATE OR REPLACE FUNCTION public.managed_status_from_provider(_provider text, _s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(_s, ''))
    WHEN 'completed' THEN 'confirmada'   -- RateHawk: la reserva quedó hecha (no que la estancia terminó)
    WHEN 'confirmed' THEN 'confirmada' WHEN 'amended' THEN 'confirmada'
    WHEN 'ok' THEN 'confirmada'
    WHEN 'cancelled' THEN 'cancelada' WHEN 'canceled' THEN 'cancelada' WHEN 'accepted' THEN 'cancelada'
    WHEN 'customer_cancellation' THEN 'cancelada' WHEN 'cancellation' THEN 'cancelada'
    WHEN 'failed' THEN 'fallida' WHEN 'error' THEN 'fallida'
    WHEN 'rejected' THEN 'rechazada' WHEN 'rejection' THEN 'rechazada'
    WHEN 'noshow' THEN 'no_show'
    WHEN 'pending' THEN 'pendiente' WHEN 'processing' THEN 'pendiente' WHEN 'in_progress' THEN 'pendiente' WHEN 'on_hold' THEN 'pendiente'
    ELSE NULL END;
$$;

-- Estado que llega por webhook o sincronización. Nunca revive una reserva terminada; registra todo.
CREATE OR REPLACE FUNCTION public.managed_booking_apply_status(_provider text, _environment text, _provider_booking_id text,
  _provider_status text, _kind text DEFAULT 'sincronizacion', _data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.managed_bookings; v_to text; v_old text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_booking_apply_status: solo el servidor' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.managed_bookings
   WHERE provider = _provider AND environment = coalesce(_environment, 'sandbox')
     AND (provider_booking_id = _provider_booking_id OR partner_order_id = _provider_booking_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_old := m.status;
  v_to := public.managed_status_from_provider(_provider, _provider_status);
  IF v_to IS NULL OR v_to = v_old OR v_old IN ('cancelada','fallida','rechazada','completada','no_show') THEN
    UPDATE public.managed_bookings SET synced_at = now(), provider_status = coalesce(left(_provider_status, 60), provider_status) WHERE id = m.id;
    INSERT INTO public.managed_booking_events (booking_id, kind, from_status, to_status, actor, note, data)
    VALUES (m.id, CASE WHEN _kind IN ('webhook','sincronizacion','ejecucion') THEN _kind ELSE 'sincronizacion' END, v_old, v_old, 'proveedor',
            'Sin cambio (' || coalesce(_provider_status, '?') || ')', coalesce(_data, '{}'::jsonb));
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'status', v_old);
  END IF;
  UPDATE public.managed_bookings SET status = v_to, provider_status = left(_provider_status, 60), synced_at = now(), updated_at = now()
   WHERE id = m.id RETURNING * INTO m;
  INSERT INTO public.managed_booking_events (booking_id, kind, from_status, to_status, actor, note, data)
  VALUES (m.id, CASE WHEN _kind IN ('webhook','sincronizacion','ejecucion') THEN _kind ELSE 'sincronizacion' END, v_old, v_to, 'proveedor',
          'Estado del proveedor: ' || coalesce(_provider_status, ''), coalesce(_data, '{}'::jsonb));
  BEGIN
    IF v_to = 'cancelada' AND m.booking_intent_id IS NOT NULL THEN
      PERFORM public.booking_intent_apply_external(m.booking_intent_id, 'proveedor', 'CANCELLED', NULL);
    END IF;
    IF v_to = 'confirmada' AND m.booking_intent_id IS NOT NULL AND m.environment = 'produccion' THEN
      PERFORM public.booking_intent_confirm(m.booking_intent_id, jsonb_build_object('source', 'provider_webhook',
        'ref', coalesce(m.provider_ref, m.provider_booking_id), 'verified_by', 'managed_booking:' || m.ref_code));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'managed booking → booking intent: %', SQLERRM;
  END;
  PERFORM public.managed_booking_sync_commission(m.id);
  RETURN jsonb_build_object('ok', true, 'from', v_old, 'status', v_to, 'id', m.id, 'ref_code', m.ref_code);
END $$;

-- Estancias o servicios que ya terminaron: confirmada → completada (la comisión pasa a confirmada).
CREATE OR REPLACE FUNCTION public.managed_bookings_complete_past()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_bookings_complete_past: solo el servidor' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT id FROM public.managed_bookings
            WHERE status = 'confirmada' AND coalesce(end_at, start_at) < now() - interval '1 day' FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.managed_bookings SET status = 'completada', updated_at = now() WHERE id = r.id;
    INSERT INTO public.managed_booking_events (booking_id, kind, from_status, to_status, actor, note)
    VALUES (r.id, 'estado', 'confirmada', 'completada', 'sistema', 'El servicio ya ocurrió');
    PERFORM public.managed_booking_sync_commission(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Lo que el Operador IA puede ver de las reservas del viajero del caso (sin neto ni margen).
CREATE OR REPLACE FUNCTION public.managed_bookings_for_case(_incident uuid, _owner text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_trip uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_bookings_for_case: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operator_cases WHERE request_id = _incident AND lock_owner = _owner) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED');
  END IF;
  SELECT user_id, trip_id INTO v_user, v_trip FROM public.concierge_requests WHERE id = _incident;
  RETURN jsonb_build_object('ok', true, 'reservas', coalesce((
    SELECT jsonb_agg(public.managed_booking_json(m, false) ORDER BY (m.trip_id IS NOT DISTINCT FROM v_trip) DESC, m.start_at NULLS LAST)
      FROM public.managed_bookings m WHERE m.user_id = v_user AND m.status IN ('pendiente','confirmada')), '[]'::jsonb));
END $$;

-- ¿Se puede pedir este cambio o cancelación? Lo que dice la política del proveedor (guardada al reservar).
CREATE OR REPLACE FUNCTION public.managed_booking_policy_check(m public.managed_bookings, _kind text, _at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN m.status <> 'confirmada' THEN jsonb_build_object('permitido', false, 'motivo', 'La reserva no está confirmada (' || m.status || ').')
    WHEN m.start_at IS NOT NULL AND m.start_at <= _at THEN jsonb_build_object('permitido', false, 'motivo', 'El servicio ya empezó: el proveedor no permite cambios por API.')
    WHEN _kind = 'cancelacion' AND NOT m.cancellable THEN jsonb_build_object('permitido', false, 'motivo', 'El proveedor no permite cancelar esta reserva por API.')
    WHEN _kind = 'cambio' AND NOT m.changeable THEN jsonb_build_object('permitido', false, 'motivo', 'El proveedor no permite cambios por API en esta reserva; se puede cancelar (si su política lo permite) y reservar de nuevo con una persona.')
    WHEN _kind = 'cancelacion' THEN jsonb_build_object('permitido', true,
      'gratis', m.free_cancel_until IS NOT NULL AND _at < m.free_cancel_until, 'gratis_hasta', m.free_cancel_until,
      'penalizacion', m.policies->'penalizacion_actual', 'fuente', m.policies->'fuente')
    ELSE jsonb_build_object('permitido', true, 'fuente', m.policies->'fuente') END;
$$;

-- El Operador IA PIDE un cambio o cancelación. Exige: su candado sobre el caso, que la reserva sea del viajero del
-- caso y un mensaje REAL del viajero en la bitácora con "sí", el verbo y el folio (p. ej. «Sí, cancela R-AB12CD»).
-- No ejecuta nada: queda pendiente de aprobación de una persona del equipo.
CREATE OR REPLACE FUNCTION public.managed_booking_request_change(_incident uuid, _owner text, _ref_code text, _kind text,
  _consent_event bigint, _details jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.managed_bookings; e public.incident_events; v_user uuid; v_policy jsonb; v_req public.managed_booking_requests; v_verb text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_booking_request_change: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('cancelacion','cambio') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operator_cases WHERE request_id = _incident AND lock_owner = _owner) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED');
  END IF;
  SELECT user_id INTO v_user FROM public.concierge_requests WHERE id = _incident;
  SELECT * INTO m FROM public.managed_bookings WHERE ref_code = upper(coalesce(_ref_code, '')) AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT * INTO e FROM public.incident_events WHERE id = _consent_event AND request_id = _incident;
  v_verb := CASE _kind WHEN 'cancelacion' THEN 'cancel' ELSE 'cambi' END;
  IF NOT FOUND OR e.actor <> 'usuario' OR e.direction <> 'entrante' OR e.kind NOT IN ('mensaje','creado')
     OR position(lower(m.ref_code) IN lower(coalesce(e.body, ''))) = 0
     OR position(v_verb IN lower(coalesce(e.body, ''))) = 0
     OR lower(coalesce(e.body, '')) !~ '^[^a-z0-9]*s[ií]([^a-z0-9]|$)'
     OR lower(coalesce(e.body, '')) ~ '(^|[^a-z])(no|espera|espérate)([^a-z]|$)' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONSENT_REQUIRED');
  END IF;
  v_policy := public.managed_booking_policy_check(m, _kind, now());
  IF NOT coalesce((v_policy->>'permitido')::boolean, false) THEN
    INSERT INTO public.managed_booking_events (booking_id, kind, actor, note, data)
    VALUES (m.id, 'solicitud', 'operador', 'Solicitud no permitida: ' || (v_policy->>'motivo'), jsonb_build_object('kind', _kind, 'incident', _incident));
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED', 'motivo', v_policy->>'motivo');
  END IF;
  SELECT * INTO v_req FROM public.managed_booking_requests
   WHERE booking_id = m.id AND kind = _kind AND status IN ('pendiente_aprobacion','aprobada','ejecutando','revisar');
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'existing', true, 'request_id', v_req.id, 'status', v_req.status); END IF;
  INSERT INTO public.managed_booking_requests (booking_id, incident_id, kind, requested_by, consent_event_id, consent_text, details, policy_check)
  VALUES (m.id, _incident, _kind, 'operador', e.id, left(e.body, 600),
          CASE WHEN jsonb_typeof(_details) = 'object' THEN _details ELSE '{}'::jsonb END, v_policy)
  RETURNING * INTO v_req;
  INSERT INTO public.managed_booking_events (booking_id, kind, actor, note, data)
  VALUES (m.id, 'solicitud', 'operador', 'Pide ' || _kind || ' con el sí del viajero (evento ' || e.id || ')',
          jsonb_build_object('request_id', v_req.id, 'incident', _incident));
  RETURN jsonb_build_object('ok', true, 'request_id', v_req.id, 'status', v_req.status, 'politica', v_policy, 'ref_code', m.ref_code);
END $$;

-- Una persona del equipo aprueba o rechaza (tablero de administradores).
CREATE OR REPLACE FUNCTION public.admin_managed_request_decide(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.managed_booking_requests; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.managed_booking_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.status <> 'pendiente_aprobacion' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED', 'status', r.status); END IF;
  UPDATE public.managed_booking_requests SET status = CASE WHEN _approve THEN 'aprobada' ELSE 'rechazada' END,
    decided_by = v_uid, decided_at = now(), decision_note = left(_note, 500)
   WHERE id = _id RETURNING * INTO r;
  INSERT INTO public.managed_booking_events (booking_id, kind, actor, actor_id, note, data)
  VALUES (r.booking_id, 'aprobacion', 'equipo', v_uid, CASE WHEN _approve THEN 'Aprobada: ' ELSE 'Rechazada: ' END || r.kind || coalesce(' · ' || left(_note, 200), ''),
          jsonb_build_object('request_id', r.id));
  RETURN jsonb_build_object('ok', true, 'status', r.status);
END $$;

-- La tarea toma las solicitudes aprobadas (una vez: pasan a "ejecutando"). Si una quedó "ejecutando" más de
-- 15 minutos no se reintenta a ciegas (podría cancelar dos veces): pasa a "revisar" para una persona.
CREATE OR REPLACE FUNCTION public.managed_requests_claim(_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb := '[]'::jsonb; r record;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_requests_claim: solo el servidor' USING ERRCODE = '42501';
  END IF;
  UPDATE public.managed_booking_requests SET status = 'revisar', result = coalesce(result, '{}'::jsonb) || '{"motivo":"sin respuesta a tiempo"}'::jsonb
   WHERE status = 'ejecutando' AND started_at < now() - interval '15 minutes';
  IF NOT public.app_flag('reservas_gestionadas_cambios_enabled') THEN
    RETURN jsonb_build_object('ok', true, 'apagado', true, 'solicitudes', '[]'::jsonb);
  END IF;
  FOR r IN SELECT q.id FROM public.managed_booking_requests q WHERE q.status = 'aprobada' ORDER BY q.decided_at LIMIT greatest(1, least(_limit, 20))
           FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.managed_booking_requests SET status = 'ejecutando', started_at = now() WHERE id = r.id;
    out := out || (SELECT jsonb_build_object('id', q.id, 'kind', q.kind, 'details', q.details, 'booking', public.managed_booking_json(m, true))
                     FROM public.managed_booking_requests q JOIN public.managed_bookings m ON m.id = q.booking_id WHERE q.id = r.id);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'solicitudes', out);
END $$;

CREATE OR REPLACE FUNCTION public.managed_request_finish(_id uuid, _ok boolean, _result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.managed_booking_requests;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'managed_request_finish: solo el servidor' USING ERRCODE = '42501';
  END IF;
  UPDATE public.managed_booking_requests SET status = CASE WHEN _ok THEN 'hecha' ELSE 'fallida' END, finished_at = now(),
    result = coalesce(_result, '{}'::jsonb)
   WHERE id = _id AND status = 'ejecutando' RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_RUNNING'); END IF;
  INSERT INTO public.managed_booking_events (booking_id, kind, actor, note, data)
  VALUES (r.booking_id, 'ejecucion', 'sistema', CASE WHEN _ok THEN 'Hecho con el proveedor: ' ELSE 'Falló con el proveedor: ' END || r.kind,
          jsonb_build_object('request_id', r.id, 'result', left(coalesce(_result, '{}'::jsonb)::text, 2000)));
  RETURN jsonb_build_object('ok', true, 'status', r.status);
END $$;

-- Reservas activas que toca sincronizar con el proveedor (las más viejas primero).
CREATE OR REPLACE FUNCTION public.managed_bookings_due_sync(_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.managed_booking_json(m, true)), '[]'::jsonb) FROM (
    SELECT * FROM public.managed_bookings WHERE status IN ('pendiente','confirmada') AND provider IN ('ratehawk','viator')
       AND (synced_at IS NULL OR synced_at < now() - interval '50 minutes')
     ORDER BY synced_at NULLS FIRST LIMIT greatest(1, least(_limit, 100))) m;
$$;

-- Tokens de webhooks ya vistos (protección contra repetición; RateHawk lo recomienda).
CREATE TABLE IF NOT EXISTS public.provider_webhook_tokens (
  provider text NOT NULL,
  token    text NOT NULL CHECK (length(token) BETWEEN 8 AND 120),
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, token)
);
ALTER TABLE public.provider_webhook_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_webhook_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.provider_webhook_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.provider_webhook_token_once(_provider text, _token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'provider_webhook_token_once: solo el servidor' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.provider_webhook_tokens WHERE seen_at < now() - interval '30 days';
  INSERT INTO public.provider_webhook_tokens (provider, token) VALUES (_provider, _token);
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;

-- ───────────────────────────── 5. Cargo por servicio (configurable, apagado) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_fee_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto      text NOT NULL CHECK (producto IN ('vuelo','hotel','tour','traslado','seguro')),
  modo          text NOT NULL CHECK (modo IN ('fijo','porcentaje','fijo_mas_porcentaje')),
  monto_fijo    numeric(10,2) CHECK (monto_fijo IS NULL OR monto_fijo >= 0),
  porcentaje    numeric(5,2) CHECK (porcentaje IS NULL OR (porcentaje >= 0 AND porcentaje <= 30)),
  minimo        numeric(10,2) CHECK (minimo IS NULL OR minimo >= 0),
  maximo        numeric(10,2) CHECK (maximo IS NULL OR maximo >= 0),
  moneda        char(3) NOT NULL DEFAULT 'MXN' CHECK (moneda ~ '^[A-Z]{3}$'),
  por           text NOT NULL DEFAULT 'reserva' CHECK (por IN ('reserva','pasajero')),
  reembolsable  boolean NOT NULL DEFAULT false,
  etiqueta      text NOT NULL DEFAULT 'Cargo por servicio IATOS' CHECK (length(etiqueta) BETWEEN 3 AND 80),
  activo        boolean NOT NULL DEFAULT false,
  nota          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_fee_rules_producto UNIQUE (producto)
);
ALTER TABLE public.service_fee_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_fee_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.service_fee_rules TO service_role;
-- Sin montos: el dueño decide cuánto cobrar. La fila de vuelos existe para que solo haga falta llenarla.
INSERT INTO public.service_fee_rules (producto, modo, activo, nota) VALUES
  ('vuelo', 'fijo', false, 'Monto por definir por el dueño. Se muestra antes de pagar, con su monto y si es reembolsable (DOT 14 CFR 399.80(l)).')
ON CONFLICT (producto) DO NOTHING;

-- Cotiza el cargo (servidor). Apagado o sin monto: no hay cargo. Lo mismo que _shared/comisiones/cargo.ts.
CREATE OR REPLACE FUNCTION public.service_fee_quote(_producto text, _base numeric, _pasajeros int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.service_fee_rules; v numeric := 0; v_n int := greatest(1, least(coalesce(_pasajeros, 1), 9));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_fee_quote: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_flag('cargo_servicio_enabled') THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'apagado'); END IF;
  SELECT * INTO r FROM public.service_fee_rules WHERE producto = _producto AND activo;
  IF NOT FOUND THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'sin_regla'); END IF;
  IF r.modo IN ('fijo','fijo_mas_porcentaje') THEN
    IF r.monto_fijo IS NULL THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'sin_monto'); END IF;
    v := v + r.monto_fijo;
  END IF;
  IF r.modo IN ('porcentaje','fijo_mas_porcentaje') THEN
    IF r.porcentaje IS NULL OR _base IS NULL OR _base < 0 THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'sin_porcentaje_o_base'); END IF;
    v := v + round(_base * r.porcentaje / 100.0, 2);
  END IF;
  IF r.por = 'pasajero' THEN v := v * v_n; END IF;
  IF r.minimo IS NOT NULL THEN v := greatest(v, r.minimo); END IF;
  IF r.maximo IS NOT NULL THEN v := least(v, r.maximo); END IF;
  RETURN jsonb_build_object('aplica', true, 'monto', round(v, 2), 'moneda', r.moneda, 'etiqueta', r.etiqueta, 'reembolsable', r.reembolsable,
    'por', r.por);
END $$;

-- ───────────────────────────── 6. Tablero de administradores ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_commissions_summary(_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from timestamptz; v_to timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_from := date_trunc('month', coalesce(_month, (now() AT TIME ZONE 'America/Mexico_City')::date)::timestamp) AT TIME ZONE 'America/Mexico_City';
  v_to := (date_trunc('month', coalesce(_month, (now() AT TIME ZONE 'America/Mexico_City')::date)::timestamp) + interval '1 month') AT TIME ZONE 'America/Mexico_City';
  RETURN jsonb_build_object(
    'generated_at', now(),
    'mes', to_char(v_from AT TIME ZONE 'America/Mexico_City', 'YYYY-MM'),
    -- "Ganado" = confirmada + pagada. Pendiente aparte (puede caerse). Por moneda: no se suman monedas distintas.
    'totales', (SELECT coalesce(jsonb_agg(x ORDER BY x.moneda), '[]'::jsonb) FROM (
      SELECT currency AS moneda,
             round(coalesce(sum(commission_amount) FILTER (WHERE status IN ('confirmada','pagada')), 0), 2) AS ganado,
             round(coalesce(sum(commission_amount) FILTER (WHERE status = 'pagada'), 0), 2) AS pagado,
             round(coalesce(sum(commission_amount) FILTER (WHERE status = 'pendiente'), 0), 2) AS pendiente,
             round(coalesce(sum(commission_amount) FILTER (WHERE status = 'rechazada'), 0), 2) AS rechazado,
             count(*) AS ventas
        FROM public.commissions WHERE booked_at >= v_from AND booked_at < v_to GROUP BY currency) x),
    'por_proveedor', (SELECT coalesce(jsonb_agg(x ORDER BY x.ganado DESC, x.proveedor), '[]'::jsonb) FROM (
      SELECT proveedor, currency AS moneda,
             round(coalesce(sum(commission_amount) FILTER (WHERE status IN ('confirmada','pagada')), 0), 2) AS ganado,
             round(coalesce(sum(commission_amount) FILTER (WHERE status = 'pendiente'), 0), 2) AS pendiente,
             count(*) FILTER (WHERE status <> 'rechazada') AS ventas
        FROM public.commissions WHERE booked_at >= v_from AND booked_at < v_to GROUP BY 1, 2) x),
    'por_producto', (SELECT coalesce(jsonb_agg(x ORDER BY x.ganado DESC, x.producto), '[]'::jsonb) FROM (
      SELECT producto, currency AS moneda,
             round(coalesce(sum(commission_amount) FILTER (WHERE status IN ('confirmada','pagada')), 0), 2) AS ganado,
             round(coalesce(sum(commission_amount) FILTER (WHERE status = 'pendiente'), 0), 2) AS pendiente,
             count(*) FILTER (WHERE status <> 'rechazada') AS ventas
        FROM public.commissions WHERE booked_at >= v_from AND booked_at < v_to GROUP BY 1, 2) x),
    'clics', jsonb_build_object(
      'total', (SELECT count(*) FROM public.affiliate_clicks WHERE clicked_at >= v_from AND clicked_at < v_to),
      'por_red', (SELECT coalesce(jsonb_agg(x ORDER BY x.clics DESC), '[]'::jsonb) FROM (
        SELECT coalesce(red, 'desconocida') AS red, count(*) AS clics FROM public.affiliate_clicks
         WHERE clicked_at >= v_from AND clicked_at < v_to GROUP BY 1) x),
      'por_producto', (SELECT coalesce(jsonb_agg(x ORDER BY x.clics DESC), '[]'::jsonb) FROM (
        SELECT coalesce(producto, 'otro') AS producto, count(*) AS clics FROM public.affiliate_clicks
         WHERE clicked_at >= v_from AND clicked_at < v_to GROUP BY 1) x)),
    'gestionadas', (SELECT jsonb_build_object('total', count(*), 'confirmadas', count(*) FILTER (WHERE status IN ('confirmada','completada')),
        'canceladas', count(*) FILTER (WHERE status = 'cancelada'), 'sandbox', count(*) FILTER (WHERE environment = 'sandbox'))
      FROM public.managed_bookings WHERE created_at >= v_from AND created_at < v_to),
    'solicitudes', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) FROM (
      SELECT q.id, q.kind, q.status, q.created_at, q.policy_check, q.consent_text, q.incident_id,
             m.ref_code, m.title, m.provider, m.environment, m.start_at, m.sell_amount, m.currency
        FROM public.managed_booking_requests q JOIN public.managed_bookings m ON m.id = q.booking_id
       WHERE q.status IN ('pendiente_aprobacion','aprobada','ejecutando','revisar','fallida')
       ORDER BY q.created_at LIMIT 50) x),
    'sincronizacion', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT DISTINCT ON (source) source, finished_at, ok, error, stats FROM public.commission_sync_runs ORDER BY source, started_at DESC) x),
    'banderas', (SELECT coalesce(jsonb_object_agg(key, value = 'true'::jsonb), '{}'::jsonb) FROM public.app_flags
      WHERE key IN ('comisiones_sync_enabled','proveedores_reservas_enabled','reservas_gestionadas_cambios_enabled','cargo_servicio_enabled'))
  );
END $$;

-- ───────────────────────────── Permisos de funciones ─────────────────────────────
REVOKE ALL ON FUNCTION public.affiliate_clicks_normalize(), public.affiliate_click_record(uuid, uuid, text, text, text, text, text, uuid, uuid),
  public.bookings_click_to_ledger(), public.booking_intents_click_to_ledger(), public.managed_booking_new_ref(),
  public.commissions_upsert(text, jsonb), public.commissions_mark_paid(text, text, timestamptz, text[]), public.commission_sync_log(text, boolean, jsonb, text),
  public.managed_booking_json(public.managed_bookings, boolean), public.managed_booking_sync_commission(uuid), public.managed_booking_upsert(jsonb),
  public.managed_booking_apply_status(text, text, text, text, text, jsonb), public.managed_bookings_complete_past(),
  public.managed_bookings_for_case(uuid, text), public.managed_booking_policy_check(public.managed_bookings, text, timestamptz),
  public.managed_booking_request_change(uuid, text, text, text, bigint, jsonb), public.managed_requests_claim(int),
  public.managed_request_finish(uuid, boolean, jsonb), public.managed_bookings_due_sync(int), public.provider_webhook_token_once(text, text),
  public.service_fee_quote(text, numeric, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commissions_upsert(text, jsonb), public.commissions_mark_paid(text, text, timestamptz, text[]),
  public.commission_sync_log(text, boolean, jsonb, text), public.managed_booking_upsert(jsonb),
  public.managed_booking_apply_status(text, text, text, text, text, jsonb), public.managed_bookings_complete_past(),
  public.managed_bookings_for_case(uuid, text), public.managed_booking_request_change(uuid, text, text, text, bigint, jsonb),
  public.managed_requests_claim(int), public.managed_request_finish(uuid, boolean, jsonb), public.managed_bookings_due_sync(int),
  public.provider_webhook_token_once(text, text), public.service_fee_quote(text, numeric, int)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_commissions_summary(date), public.admin_managed_request_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_commissions_summary(date), public.admin_managed_request_decide(uuid, boolean, text) TO authenticated, service_role;
