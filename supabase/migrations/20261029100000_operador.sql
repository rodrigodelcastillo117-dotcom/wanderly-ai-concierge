-- Operador IATOS (29-oct-2026). Pedido del dueño: un bot especializado que resuelva TODOS los problemas de los
-- viajeros, 24/7, que entienda cualquier queja, revise los derechos del viajero, mande correos y vea todo.
-- "No puede fallar"; los humanos (dueño y Carlo) son el respaldo.
--
-- El cerebro vive en _shared/operador/ (bucle de agente con Claude y herramientas). Esta migración le da lo
-- que NO puede depender del código ni de la IA:
--
--   operator_config   topes por caso (acciones, gasto en IA, búsquedas de vuelos, correos a proveedores).
--   operator_cases    estado del operador por incidente: CANDADO (un solo operador por caso), marca de agua de
--                     la bitácora (idempotente: solo trabaja lo nuevo), contadores y consentimientos.
--   operator_outbox   correos a proveedores: SIEMPRE con la fuente del correo (nunca inventado) y la hora local
--                     del proveedor (se programan para su horario de atención).
--   channel_links / channel_link_codes / channel_inbound   Telegram (y luego WhatsApp): vincular la cuenta con un
--                     código de un solo uso que muestra la app, y no procesar dos veces el mismo mensaje.
--
-- Reglas que hace cumplir la base:
--   * Bandera app_flags.operador_enabled = false: el operador no toma nada (todo va al equipo humano, como hoy).
--   * Candado por incidente con vencimiento: dos operadores nunca trabajan el mismo caso a la vez.
--   * Topes por caso: al llegar a uno, el operador se detiene y el caso pasa a una persona.
--   * Una sola búsqueda de vuelos por caso.
--   * Consentimiento solo desde un mensaje REAL del viajero en la bitácora (actor usuario, entrante).
--   * Un correo a proveedor sin fuente verificable no se guarda (CHECK).
--   * Cada mensaje del viajero o del proveedor despierta al operador (trigger); el vigilante lo recoge.
-- Idempotente. NO envía nada.

INSERT INTO public.app_flags (key, value, note) VALUES
  ('operador_enabled', 'false'::jsonb,
   'Operador IATOS: el bot con IA toma los incidentes primero (24/7) y pasa a una persona si duda o llega a un tope')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────── 1. Configuración (topes) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_config (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_actions          int NOT NULL DEFAULT 25 CHECK (max_actions BETWEEN 1 AND 200),
  max_spend_usd        numeric(8,4) NOT NULL DEFAULT 0.80 CHECK (max_spend_usd > 0 AND max_spend_usd <= 20),
  max_flight_searches  int NOT NULL DEFAULT 1 CHECK (max_flight_searches BETWEEN 0 AND 3),
  max_provider_emails  int NOT NULL DEFAULT 3 CHECK (max_provider_emails BETWEEN 0 AND 10),
  max_runs_per_day     int NOT NULL DEFAULT 40 CHECK (max_runs_per_day BETWEEN 1 AND 500),
  lock_seconds         int NOT NULL DEFAULT 120 CHECK (lock_seconds BETWEEN 30 AND 900),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.operator_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._operator_cfg()
RETURNS public.operator_config LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.operator_config WHERE id;
$$;

CREATE OR REPLACE FUNCTION public.operator_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.app_flag('operador_enabled');
$$;

-- ───────────────────────────── 2. Estado por caso ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_cases (
  request_id        uuid PRIMARY KEY REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'nuevo' CHECK (state IN ('nuevo','activo','esperando_usuario','esperando_proveedor','con_humano','detenido','cerrado')),
  lock_owner        text CHECK (lock_owner IS NULL OR length(lock_owner) BETWEEN 8 AND 80),
  locked_until      timestamptz,
  last_event_id     bigint NOT NULL DEFAULT 0,
  wake_at           timestamptz,
  follow_up_at      timestamptz,
  last_run_at       timestamptz,
  runs              int NOT NULL DEFAULT 0,
  runs_today        int NOT NULL DEFAULT 0,
  runs_day          date,
  actions           int NOT NULL DEFAULT 0,
  spend_usd         numeric(10,5) NOT NULL DEFAULT 0,
  flight_searches   int NOT NULL DEFAULT 0,
  provider_emails   int NOT NULL DEFAULT 0,
  consents          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(consents) = 'object' AND length(consents::text) <= 4000),
  pending           jsonb CHECK (pending IS NULL OR (jsonb_typeof(pending) = 'object' AND length(pending::text) <= 2000)),
  summary           text CHECK (summary IS NULL OR length(summary) <= 2000),
  last_error        text CHECK (last_error IS NULL OR length(last_error) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operator_cases_wake ON public.operator_cases (wake_at) WHERE state NOT IN ('cerrado','detenido');

-- ───────────────────────────── 3. Correos a proveedores ─────────────────────────────
-- Fuente obligatoria: de dónde salió el correo (sitio oficial descargado, directorio verificado, la reserva, un
-- correo del propio proveedor o lo que escribió el viajero en el caso). Sin fuente no se guarda.
CREATE TABLE IF NOT EXISTS public.operator_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  provider_name     text NOT NULL CHECK (length(provider_name) BETWEEN 2 AND 200),
  to_email          text NOT NULL CHECK (to_email ~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' AND length(to_email) <= 200),
  source            jsonb NOT NULL CHECK (
                      jsonb_typeof(source) = 'object'
                      AND source->>'kind' IN ('sitio_oficial','directorio','reserva','correo_del_proveedor','mensaje_usuario')
                      AND (coalesce(source->>'url', '') <> '' OR coalesce(source->>'event_id', '') <> '' OR coalesce(source->>'booking', '') <> '')),
  subject           text NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  body              text NOT NULL CHECK (length(body) BETWEEN 10 AND 6000),
  language          text NOT NULL DEFAULT 'es' CHECK (language IN ('es','en','fr','pt','it','de')),
  provider_tz       text CHECK (provider_tz IS NULL OR provider_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  send_after        timestamptz NOT NULL DEFAULT now(),
  reply_token       text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(12), 'hex') CHECK (reply_token ~ '^[0-9a-f]{24}$'),
  status            text NOT NULL DEFAULT 'programado' CHECK (status IN ('programado','enviando','enviado','fallido','cancelado')),
  attempts          int NOT NULL DEFAULT 0,
  claimed_at        timestamptz,
  sent_at           timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  error             text CHECK (error IS NULL OR length(error) <= 300),
  dedupe_key        text NOT NULL CHECK (length(dedupe_key) BETWEEN 4 AND 200),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS operator_outbox_due ON public.operator_outbox (send_after) WHERE status IN ('programado','fallido');

-- ───────────────────────────── 4. Canales (Telegram; luego WhatsApp) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  external_id  text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  username     text CHECK (username IS NULL OR length(username) <= 64),
  active       boolean NOT NULL DEFAULT true,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  unlinked_at  timestamptz,
  last_seen_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_links_ext ON public.channel_links (channel, external_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS channel_links_user ON public.channel_links (user_id, channel) WHERE active;

CREATE TABLE IF NOT EXISTS public.channel_link_codes (
  code_hash   text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS channel_link_codes_user ON public.channel_link_codes (user_id, channel, created_at);

CREATE TABLE IF NOT EXISTS public.channel_inbound (
  channel     text NOT NULL CHECK (channel IN ('telegram','whatsapp','sms','voz')),
  update_id   text NOT NULL CHECK (length(update_id) BETWEEN 1 AND 100),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, update_id)
);

-- Solo el servidor (service_role) toca estas tablas; el usuario las ve a través de funciones.
ALTER TABLE public.operator_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_config, public.operator_cases, public.operator_outbox, public.channel_links, public.channel_link_codes,
  public.channel_inbound FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.operator_config, public.operator_cases, public.operator_outbox, public.channel_links, public.channel_link_codes,
  public.channel_inbound TO service_role;

-- ───────────────────────────── 5. ¿Operador vivo? (la bandera del dueño cuenta) ─────────────────────────────
-- Igual que en 20261029080000_incidentes, pero la bandera operador_enabled también lo prende: el dueño solo
-- cambia una cosa. Sin latido reciente sigue contando como "caído" (→ humanos).
CREATE OR REPLACE FUNCTION public._incident_operator_alive(_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (c.ai_operator_enabled OR public.app_flag('operador_enabled')) AND c.ai_operator_heartbeat_at IS NOT NULL
     AND c.ai_operator_heartbeat_at > _now - make_interval(mins => c.operator_down_after_min)
    FROM public.incident_config c WHERE c.id;
$$;

-- ───────────────────────────── 6. Despertar: cada mensaje del viajero o del proveedor ─────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_wake_on_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.direction = 'entrante' AND NEW.actor IN ('usuario','proveedor') THEN
    INSERT INTO public.operator_cases (request_id, wake_at) VALUES (NEW.request_id, NEW.at)
    ON CONFLICT (request_id) DO UPDATE SET wake_at = greatest(coalesce(public.operator_cases.wake_at, EXCLUDED.wake_at), EXCLUDED.wake_at),
      state = CASE WHEN public.operator_cases.state IN ('esperando_usuario','esperando_proveedor') THEN 'activo' ELSE public.operator_cases.state END,
      updated_at = now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS operator_wake_on_event ON public.incident_events;
CREATE TRIGGER operator_wake_on_event AFTER INSERT ON public.incident_events
  FOR EACH ROW EXECUTE FUNCTION public.operator_wake_on_event();

-- ───────────────────────────── 7. Qué toca trabajar ─────────────────────────────
-- Casos abiertos del operador IA con algo nuevo: recién creados, mensaje nuevo del viajero o del proveedor,
-- despertados, o con su hora de seguimiento vencida. Sin los que tienen candado vigente ni los detenidos.
CREATE OR REPLACE FUNCTION public.operator_due(_limit int DEFAULT 10, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.operator_enabled() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.request_id, 'reason', x.reason) ORDER BY x.rank DESC, x.received_at)
    FROM (
      SELECT i.request_id, i.received_at, public._incident_sev_rank(i.severity) AS rank,
        CASE WHEN oc.request_id IS NULL OR oc.last_run_at IS NULL THEN 'nuevo'
             WHEN EXISTS (SELECT 1 FROM public.incident_events e WHERE e.request_id = i.request_id AND e.id > oc.last_event_id
                            AND e.direction = 'entrante' AND e.actor IN ('usuario','proveedor')) THEN 'mensaje'
             WHEN oc.wake_at IS NOT NULL AND oc.wake_at > oc.last_run_at THEN 'despertado'
             WHEN oc.follow_up_at IS NOT NULL AND oc.follow_up_at <= _now THEN 'seguimiento'
        END AS reason
        FROM public.incidents i
        JOIN public.concierge_requests cr ON cr.id = i.request_id AND cr.status IN ('solicitado','pendiente_confirmacion')
        LEFT JOIN public.operator_cases oc ON oc.request_id = i.request_id
       WHERE i.assignee = 'iato_ops' AND i.resolved_at IS NULL
         AND (oc.request_id IS NULL OR oc.state NOT IN ('detenido','cerrado','con_humano'))
         AND (oc.locked_until IS NULL OR oc.locked_until <= _now)
    ) x WHERE x.reason IS NOT NULL
    LIMIT greatest(1, least(coalesce(_limit, 10), 50))), '[]'::jsonb);
END $$;

-- ───────────────────────────── 8. Candado por incidente ─────────────────────────────
-- Toma el caso (si nadie lo tiene o el candado venció) y devuelve lo necesario para trabajarlo. Lo nuevo de la
-- bitácora es lo que tiene id > last_event_id (idempotente: un reintento no repite lo ya hecho).
CREATE OR REPLACE FUNCTION public.operator_claim(_id uuid, _owner text, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg public.operator_config := public._operator_cfg(); oc public.operator_cases; i public.incidents; cr public.concierge_requests;
BEGIN
  IF NOT public.operator_enabled() THEN RETURN jsonb_build_object('ok', false, 'code', 'DISABLED'); END IF;
  IF _owner IS NULL OR length(_owner) NOT BETWEEN 8 AND 80 THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_OWNER'); END IF;
  SELECT * INTO i FROM public.incidents WHERE request_id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id;
  IF i.assignee <> 'iato_ops' OR i.resolved_at IS NOT NULL OR cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN
    UPDATE public.operator_cases SET state = CASE WHEN i.resolved_at IS NOT NULL THEN 'cerrado' ELSE 'con_humano' END, updated_at = now()
     WHERE request_id = _id AND state NOT IN ('cerrado','con_humano');
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_MINE');
  END IF;
  INSERT INTO public.operator_cases (request_id) VALUES (_id) ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO oc FROM public.operator_cases WHERE request_id = _id FOR UPDATE;
  IF oc.state IN ('detenido','cerrado') THEN RETURN jsonb_build_object('ok', false, 'code', 'STOPPED'); END IF;
  IF oc.locked_until IS NOT NULL AND oc.locked_until > _now AND oc.lock_owner IS DISTINCT FROM _owner THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LOCKED');
  END IF;
  IF oc.runs_day IS DISTINCT FROM (_now AT TIME ZONE 'UTC')::date THEN oc.runs_today := 0; END IF;
  IF oc.runs_today >= cfg.max_runs_per_day THEN
    UPDATE public.operator_cases SET state = 'detenido', last_error = 'Tope de corridas del día', updated_at = now() WHERE request_id = _id;
    RETURN jsonb_build_object('ok', false, 'code', 'CAP_RUNS');
  END IF;
  UPDATE public.operator_cases SET lock_owner = _owner, locked_until = _now + make_interval(secs => cfg.lock_seconds),
    state = CASE WHEN state = 'nuevo' THEN 'activo' ELSE state END, runs_day = (_now AT TIME ZONE 'UTC')::date,
    runs_today = CASE WHEN runs_day IS DISTINCT FROM (_now AT TIME ZONE 'UTC')::date THEN 1 ELSE runs_today + 1 END, updated_at = now()
   WHERE request_id = _id RETURNING * INTO oc;
  RETURN jsonb_build_object('ok', true,
    'case', jsonb_build_object('state', oc.state, 'last_event_id', oc.last_event_id, 'runs', oc.runs, 'actions', oc.actions,
      'spend_usd', oc.spend_usd, 'flight_searches', oc.flight_searches, 'provider_emails', oc.provider_emails, 'consents', oc.consents,
      'pending', oc.pending, 'summary', oc.summary, 'follow_up_at', oc.follow_up_at, 'last_run_at', oc.last_run_at),
    'limits', jsonb_build_object('max_actions', cfg.max_actions, 'max_spend_usd', cfg.max_spend_usd, 'max_flight_searches', cfg.max_flight_searches,
      'max_provider_emails', cfg.max_provider_emails, 'lock_seconds', cfg.lock_seconds),
    'incident', jsonb_build_object('id', cr.id, 'user_id', cr.user_id, 'trip_id', cr.trip_id, 'title', cr.title, 'payload', cr.payload,
      'category', i.category, 'severity', i.severity, 'origin', i.origin, 'escalation_level', i.escalation_level,
      'received_at', i.received_at, 'next_step', i.next_step, 'next_step_due_at', i.next_step_due_at, 'reopen_count', i.reopen_count),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'kind', e.kind, 'actor', e.actor, 'channel', e.channel,
        'direction', e.direction, 'counterpart', e.counterpart, 'body', left(e.body, 1500), 'visible', e.visible_to_user, 'data', e.data) ORDER BY e.id)
      FROM (SELECT * FROM public.incident_events WHERE request_id = _id ORDER BY id DESC LIMIT 60) e), '[]'::jsonb));
END $$;

-- Gasta del tope del caso. 'accion' (+1), 'modelo' (+USD), 'vuelos' (+1 búsqueda), 'correo_proveedor' (+1).
-- Si se pasa, NO lo cuenta y responde el tope alcanzado (el operador se detiene y pasa a una persona).
CREATE OR REPLACE FUNCTION public.operator_spend(_id uuid, _owner text, _kind text, _amount numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg public.operator_config := public._operator_cfg(); oc public.operator_cases; v numeric := coalesce(_amount, 1);
BEGIN
  SELECT * INTO oc FROM public.operator_cases WHERE request_id = _id FOR UPDATE;
  IF NOT FOUND OR oc.lock_owner IS DISTINCT FROM _owner OR oc.locked_until IS NULL OR oc.locked_until < now() - interval '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED');
  END IF;
  IF v < 0 OR v > 10 THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_AMOUNT'); END IF;
  CASE _kind
    WHEN 'accion' THEN
      IF oc.actions + 1 > cfg.max_actions THEN RETURN jsonb_build_object('ok', false, 'code', 'CAP_ACCIONES', 'used', oc.actions, 'max', cfg.max_actions); END IF;
      UPDATE public.operator_cases SET actions = actions + 1, updated_at = now() WHERE request_id = _id;
    WHEN 'modelo' THEN
      IF oc.spend_usd + v > cfg.max_spend_usd THEN RETURN jsonb_build_object('ok', false, 'code', 'CAP_GASTO', 'used', oc.spend_usd, 'max', cfg.max_spend_usd); END IF;
      UPDATE public.operator_cases SET spend_usd = spend_usd + v, updated_at = now() WHERE request_id = _id;
    WHEN 'vuelos' THEN
      IF oc.flight_searches + 1 > cfg.max_flight_searches THEN RETURN jsonb_build_object('ok', false, 'code', 'CAP_BUSQUEDA', 'used', oc.flight_searches, 'max', cfg.max_flight_searches); END IF;
      UPDATE public.operator_cases SET flight_searches = flight_searches + 1, updated_at = now() WHERE request_id = _id;
    WHEN 'correo_proveedor' THEN
      IF oc.provider_emails + 1 > cfg.max_provider_emails THEN RETURN jsonb_build_object('ok', false, 'code', 'CAP_CORREOS', 'used', oc.provider_emails, 'max', cfg.max_provider_emails); END IF;
      UPDATE public.operator_cases SET provider_emails = provider_emails + 1, updated_at = now() WHERE request_id = _id;
    ELSE RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND');
  END CASE;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Consentimiento: SOLO si el evento citado es un mensaje real del viajero (actor usuario, entrante) de ESE caso
-- y, si se pide, contiene el texto exigido (p. ej. el folio C-XXXXXX). El modelo no puede fabricarlo.
CREATE OR REPLACE FUNCTION public.operator_consent(_id uuid, _owner text, _kind text, _event_id bigint, _must_contain text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE oc public.operator_cases; e public.incident_events;
BEGIN
  IF _kind IS NULL OR _kind !~ '^[a-z_]{3,30}(:[A-Za-z0-9-]{3,20})?$' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_KIND'); END IF;
  SELECT * INTO oc FROM public.operator_cases WHERE request_id = _id FOR UPDATE;
  IF NOT FOUND OR oc.lock_owner IS DISTINCT FROM _owner THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED'); END IF;
  SELECT * INTO e FROM public.incident_events WHERE id = _event_id AND request_id = _id;
  IF NOT FOUND OR e.actor <> 'usuario' OR e.direction <> 'entrante' OR e.kind NOT IN ('mensaje','creado') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_USER_MESSAGE');
  END IF;
  IF _must_contain IS NOT NULL AND position(lower(_must_contain) IN lower(coalesce(e.body, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TEXT_MISSING');
  END IF;
  UPDATE public.operator_cases SET consents = consents || jsonb_build_object(_kind, jsonb_build_object('event_id', e.id, 'at', e.at)), updated_at = now()
   WHERE request_id = _id;
  RETURN jsonb_build_object('ok', true, 'event_id', e.id, 'at', e.at);
END $$;

-- Suelta el candado y guarda el avance (marca de agua, estado, próxima revisión, resumen, pendiente).
CREATE OR REPLACE FUNCTION public.operator_release(_id uuid, _owner text, _patch jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE oc public.operator_cases; v_state text := _patch->>'state'; v_follow timestamptz;
BEGIN
  SELECT * INTO oc FROM public.operator_cases WHERE request_id = _id FOR UPDATE;
  IF NOT FOUND OR oc.lock_owner IS DISTINCT FROM _owner THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED'); END IF;
  IF v_state IS NOT NULL AND v_state NOT IN ('activo','esperando_usuario','esperando_proveedor','con_humano','detenido','cerrado') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATE');
  END IF;
  BEGIN v_follow := nullif(_patch->>'follow_up_at', '')::timestamptz; EXCEPTION WHEN OTHERS THEN v_follow := NULL; END;
  UPDATE public.operator_cases SET
    lock_owner = NULL, locked_until = NULL, last_run_at = now(), runs = runs + 1,
    last_event_id = greatest(last_event_id, coalesce(nullif(_patch->>'last_event_id', '')::bigint, 0)),
    state = coalesce(v_state, state),
    follow_up_at = CASE WHEN _patch ? 'follow_up_at' THEN v_follow ELSE follow_up_at END,
    summary = CASE WHEN _patch ? 'summary' THEN left(_patch->>'summary', 2000) ELSE summary END,
    pending = CASE WHEN _patch ? 'pending' THEN CASE WHEN jsonb_typeof(_patch->'pending') = 'object' THEN _patch->'pending' END ELSE pending END,
    last_error = CASE WHEN _patch ? 'error' THEN left(_patch->>'error', 300) ELSE NULL END,
    updated_at = now()
   WHERE request_id = _id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ───────────────────────────── 9. Correos a proveedores (cola con horario local) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_outbox_add(_id uuid, _owner text, _o jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE oc public.operator_cases; r public.operator_outbox; v_send timestamptz;
BEGIN
  SELECT * INTO oc FROM public.operator_cases WHERE request_id = _id FOR UPDATE;
  IF NOT FOUND OR oc.lock_owner IS DISTINCT FROM _owner THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_LOCKED'); END IF;
  BEGIN v_send := coalesce(nullif(_o->>'send_after', '')::timestamptz, now()); EXCEPTION WHEN OTHERS THEN v_send := now(); END;
  -- Una fuente "mensaje_usuario" debe ser un mensaje real del viajero en ESTE caso que contenga ese correo.
  IF _o->'source'->>'kind' = 'mensaje_usuario' AND NOT EXISTS (
       SELECT 1 FROM public.incident_events e WHERE e.request_id = _id AND e.actor = 'usuario' AND e.direction = 'entrante'
          AND e.id::text = _o->'source'->>'event_id' AND position(lower(_o->>'to_email') IN lower(coalesce(e.body, ''))) > 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SOURCE_NOT_FOUND');
  END IF;
  BEGIN
    INSERT INTO public.operator_outbox (request_id, provider_name, to_email, source, subject, body, language, provider_tz, send_after, dedupe_key)
    VALUES (_id, _o->>'provider_name', lower(btrim(_o->>'to_email')), _o->'source', _o->>'subject', _o->>'body', coalesce(_o->>'language', 'es'),
      _o->>'provider_tz', least(greatest(v_send, now()), now() + interval '3 days'), _o->>'dedupe_key')
    ON CONFLICT (request_id, dedupe_key) DO NOTHING
    RETURNING * INTO r;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
  END;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'reply_token', r.reply_token, 'send_after', r.send_after);
END $$;

-- Reclama los correos que ya pueden salir (hora del proveedor). Uno en curso no lo toma otro reparto en 5 min.
CREATE OR REPLACE FUNCTION public.operator_outbox_due(_limit int DEFAULT 10, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.operator_enabled() THEN RETURN '[]'::jsonb; END IF;
  WITH c AS (
    SELECT o.id FROM public.operator_outbox o
     WHERE o.send_after <= _now AND o.attempts < 4
       AND (o.status = 'programado' OR o.status = 'fallido' OR (o.status = 'enviando' AND o.claimed_at < _now - interval '5 minutes'))
     ORDER BY o.send_after LIMIT greatest(1, least(coalesce(_limit, 10), 50)) FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.operator_outbox o SET status = 'enviando', claimed_at = _now, attempts = attempts + 1 FROM c WHERE o.id = c.id RETURNING o.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'request_id', u.request_id, 'provider_name', u.provider_name, 'to_email', u.to_email,
    'source', u.source, 'subject', u.subject, 'body', u.body, 'language', u.language, 'reply_token', u.reply_token, 'attempt', u.attempts)), '[]'::jsonb)
    INTO v FROM u;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.operator_outbox_finish(_out_id uuid, _ok boolean, _provider_id text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.operator_outbox;
BEGIN
  UPDATE public.operator_outbox SET status = CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END, sent_at = CASE WHEN _ok THEN now() END,
    provider_message_id = left(_provider_id, 200), error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'error'), 300) END, claimed_at = NULL
   WHERE id = _out_id AND status = 'enviando' RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_SENDING'); END IF;
  PERFORM public._incident_log(r.request_id, 'mensaje', 'iato_ops', left(r.subject || E'\n\n' || r.body, 4000),
    jsonb_build_object('operador', jsonb_build_object('herramienta', 'escribir_proveedor', 'fuente', r.source, 'outbox_id', r.id)),
    'email', 'saliente', NULL, false, left(r.provider_name || ' <' || r.to_email || '>', 200), CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END,
    'outbox:' || r.id || ':' || CASE WHEN _ok THEN 'ok' ELSE r.attempts::text END, left(_provider_id, 200));
  RETURN jsonb_build_object('ok', true, 'status', r.status);
END $$;

-- Respuesta del proveedor (operador+<token>@): a qué caso va y qué correo esperábamos.
CREATE OR REPLACE FUNCTION public.operator_outbox_by_token(_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('ok', true, 'id', o.id, 'request_id', o.request_id, 'to_email', o.to_email, 'provider_name', o.provider_name,
    'website', o.source->>'url')
    FROM public.operator_outbox o WHERE o.reply_token = _token AND _token ~ '^[0-9a-f]{24}$';
$$;

-- ───────────────────────────── 10. Vincular Telegram (código de un solo uso) ─────────────────────────────
-- La app pide un código (función canales, con la sesión del usuario); el usuario lo manda al bot; el webhook lo
-- canjea. Se guarda solo el hash. 15 minutos, un solo uso, máximo 10 por hora.
CREATE OR REPLACE FUNCTION public.channel_link_code_create(_user uuid, _channel text, _code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exp timestamptz := now() + interval '15 minutes';
BEGIN
  IF _channel NOT IN ('telegram','whatsapp') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_CHANNEL'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
  IF (SELECT count(*) FROM public.channel_link_codes WHERE user_id = _user AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  UPDATE public.channel_link_codes SET used_at = now() WHERE user_id = _user AND channel = _channel AND used_at IS NULL;
  INSERT INTO public.channel_link_codes (code_hash, user_id, channel, expires_at) VALUES (_code_hash, _user, _channel, v_exp);
  RETURN jsonb_build_object('ok', true, 'expires_at', v_exp);
END $$;

CREATE OR REPLACE FUNCTION public.channel_link_redeem(_channel text, _code_hash text, _external_id text, _username text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.channel_link_codes;
BEGIN
  SELECT * INTO c FROM public.channel_link_codes WHERE code_hash = _code_hash AND channel = _channel FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_CODE'); END IF;
  IF c.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USED'); END IF;
  IF c.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED'); END IF;
  UPDATE public.channel_link_codes SET used_at = now() WHERE code_hash = _code_hash;
  -- Un chat de Telegram es de una sola cuenta, y una cuenta tiene un solo chat por canal.
  UPDATE public.channel_links SET active = false, unlinked_at = now()
   WHERE active AND channel = _channel AND (external_id = _external_id OR user_id = c.user_id);
  INSERT INTO public.channel_links (user_id, channel, external_id, username) VALUES (c.user_id, _channel, left(_external_id, 64), left(_username, 64));
  RETURN jsonb_build_object('ok', true, 'user_id', c.user_id);
END $$;

CREATE OR REPLACE FUNCTION public.channel_link_for(_channel text, _external_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  UPDATE public.channel_links SET last_seen_at = now() WHERE active AND channel = _channel AND external_id = _external_id RETURNING user_id INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.channel_links_of(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'username', username, 'linked_at', linked_at, 'external_id', external_id) ORDER BY linked_at), '[]'::jsonb)
    FROM public.channel_links WHERE user_id = _user AND active;
$$;

CREATE OR REPLACE FUNCTION public.channel_unlink(_user uuid, _channel text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (UPDATE public.channel_links SET active = false, unlinked_at = now() WHERE user_id = _user AND channel = _channel AND active RETURNING 1)
  SELECT jsonb_build_object('ok', true, 'unlinked', (SELECT count(*) FROM u));
$$;

-- Webhook idempotente: true la primera vez que llega ese update_id.
CREATE OR REPLACE FUNCTION public.channel_inbound_seen(_channel text, _update_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  INSERT INTO public.channel_inbound (channel, update_id) VALUES (_channel, left(_update_id, 100)) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v = ROW_COUNT;
  DELETE FROM public.channel_inbound WHERE received_at < now() - interval '14 days';
  RETURN v = 1;
END $$;

-- Caso abierto más reciente del usuario (para un mensaje que llega por Telegram sin folio).
CREATE OR REPLACE FUNCTION public.incident_open_for_user(_user uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cr.id FROM public.concierge_requests cr JOIN public.incidents i ON i.request_id = cr.id
   WHERE cr.user_id = _user AND cr.type = 'incidente' AND cr.status IN ('solicitado','pendiente_confirmacion') AND i.resolved_at IS NULL
   ORDER BY i.received_at DESC LIMIT 1;
$$;

-- ───────────────────────────── 11. Permisos ─────────────────────────────
REVOKE ALL ON FUNCTION public._operator_cfg(), public.operator_enabled(), public.operator_wake_on_event(), public.operator_due(int, timestamptz),
  public.operator_claim(uuid, text, timestamptz), public.operator_spend(uuid, text, text, numeric), public.operator_consent(uuid, text, text, bigint, text),
  public.operator_release(uuid, text, jsonb), public.operator_outbox_add(uuid, text, jsonb), public.operator_outbox_due(int, timestamptz),
  public.operator_outbox_finish(uuid, boolean, text, text), public.operator_outbox_by_token(text),
  public.channel_link_code_create(uuid, text, text), public.channel_link_redeem(text, text, text, text), public.channel_link_for(text, text),
  public.channel_links_of(uuid), public.channel_unlink(uuid, text), public.channel_inbound_seen(text, text), public.incident_open_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_enabled(), public.operator_due(int, timestamptz),
  public.operator_claim(uuid, text, timestamptz), public.operator_spend(uuid, text, text, numeric), public.operator_consent(uuid, text, text, bigint, text),
  public.operator_release(uuid, text, jsonb), public.operator_outbox_add(uuid, text, jsonb), public.operator_outbox_due(int, timestamptz),
  public.operator_outbox_finish(uuid, boolean, text, text), public.operator_outbox_by_token(text),
  public.channel_link_code_create(uuid, text, text), public.channel_link_redeem(text, text, text, text), public.channel_link_for(text, text),
  public.channel_links_of(uuid), public.channel_unlink(uuid, text), public.channel_inbound_seen(text, text), public.incident_open_for_user(uuid)
  TO service_role;

COMMENT ON TABLE public.operator_cases IS 'Operador IATOS: candado por incidente, marca de agua de la bitácora, topes usados y consentimientos del viajero. Solo el servidor.';
COMMENT ON TABLE public.operator_outbox IS 'Operador IATOS: correos a proveedores con la fuente del correo y la hora local del proveedor. Solo el servidor.';
COMMENT ON TABLE public.channel_links IS 'Cuentas de Telegram/WhatsApp vinculadas a una cuenta IATOS (código de un solo uso). Solo el servidor.';
