-- Canales (30-oct-2026): Iato completo por Telegram y WhatsApp, preferencias del viajero (canal preferido y horario de
-- no molestar) y la cola de avisos diferidos.
--
--   channel_links (+ columnas)   last_inbound_at (ventana de 24 h de WhatsApp) y la última ubicación compartida.
--   channel_pending_actions      Acciones que Iato propuso por un canal (gasto, itinerario, alerta…): el botón
--                                «Confirmar» las ejecuta UNA vez, solo desde el mismo chat y solo si ese chat sigue
--                                vinculado a la misma cuenta. 24 h de vida.
--   channel_prefs                Canal preferido y horario de no molestar (los respeta el Operador y la vigilancia).
--   channel_deferred             Avisos normales que llegaron en horario de no molestar: se entregan al terminar.
--
-- Todo es solo del servidor (service_role); el viajero ve y cambia SUS preferencias por la función canales (y por
-- RLS, solo su fila). Idempotente (se puede correr dos veces).

-- ───────────────────────────── 1. Vínculos: ventana de WhatsApp y ubicación ─────────────────────────────
ALTER TABLE public.channel_links ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE public.channel_links ADD COLUMN IF NOT EXISTS last_location jsonb
  CHECK (last_location IS NULL OR (jsonb_typeof(last_location) = 'object' AND (last_location->>'lat') IS NOT NULL AND (last_location->>'lng') IS NOT NULL));
ALTER TABLE public.channel_links ADD COLUMN IF NOT EXISTS location_at timestamptz;

-- Cada mensaje que ESCRIBE el viajero (incluye tocar un botón o mandar su ubicación) abre/renueva la ventana de 24 h.
CREATE OR REPLACE FUNCTION public.channel_link_for(_channel text, _external_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  UPDATE public.channel_links SET last_seen_at = now(), last_inbound_at = now()
   WHERE active AND channel = _channel AND external_id = _external_id RETURNING user_id INTO v;
  RETURN v;
END $$;

-- Ubicación compartida en el chat (sirve 2 horas para "¿qué hay cerca?" y para el caso abierto).
CREATE OR REPLACE FUNCTION public.channel_location_set(_channel text, _external_id text, _lat double precision, _lng double precision)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v int;
BEGIN
  IF _lat IS NULL OR _lng IS NULL OR _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN RETURN false; END IF;
  UPDATE public.channel_links SET last_location = jsonb_build_object('lat', round(_lat::numeric, 5), 'lng', round(_lng::numeric, 5)), location_at = now()
   WHERE active AND channel = _channel AND external_id = _external_id;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v = 1;
END $$;

CREATE OR REPLACE FUNCTION public.channel_location_get(_channel text, _external_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT last_location FROM public.channel_links
   WHERE active AND channel = _channel AND external_id = _external_id AND location_at > now() - interval '2 hours';
$$;

-- ¿Ventana de 24 h abierta para este usuario en este canal? (WhatsApp: texto libre solo si es true.)
CREATE OR REPLACE FUNCTION public.channel_window_open(_user uuid, _channel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT last_inbound_at > now() - interval '24 hours' FROM public.channel_links
                    WHERE active AND user_id = _user AND channel = _channel), false);
$$;

-- Caso abierto del viajero y cuándo le escribió por última vez el operador o el equipo (para decidir si lo que escribe
-- en el chat es la respuesta a ese caso o una pregunta para Iato).
CREATE OR REPLACE FUNCTION public.channel_open_case(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', cr.id,
           'last_to_user_at', (SELECT max(e.at) FROM public.incident_events e
                                WHERE e.request_id = cr.id AND e.visible_to_user AND e.direction = 'saliente' AND e.actor <> 'usuario' AND e.actor <> 'iato'))
    FROM public.concierge_requests cr JOIN public.incidents i ON i.request_id = cr.id
   WHERE cr.user_id = _user AND cr.type = 'incidente' AND cr.status IN ('solicitado','pendiente_confirmacion') AND i.resolved_at IS NULL
   ORDER BY i.received_at DESC LIMIT 1;
$$;

-- ───────────────────────────── 2. Acciones propuestas por un canal ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_pending_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  action      jsonb NOT NULL CHECK (jsonb_typeof(action) = 'object' AND (action->>'type') IS NOT NULL AND octet_length(action::text) <= 8192),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  used_at     timestamptz,
  outcome     text CHECK (outcome IS NULL OR outcome IN ('confirmada','cancelada'))
);
CREATE INDEX IF NOT EXISTS channel_pending_actions_chat ON public.channel_pending_actions (channel, external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_pending_actions_user ON public.channel_pending_actions (user_id, created_at DESC);

-- Guarda una acción propuesta. Solo si ese chat está vinculado HOY a esa cuenta. Máx. 60 al día por cuenta.
CREATE OR REPLACE FUNCTION public.channel_action_put(_user uuid, _channel text, _external_id text, _action jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channel_links WHERE active AND user_id = _user AND channel = _channel AND external_id = _external_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LINKED');
  END IF;
  IF jsonb_typeof(_action) IS DISTINCT FROM 'object' OR coalesce(_action->>'type', '') = '' OR octet_length(_action::text) > 8192 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION');
  END IF;
  IF (SELECT count(*) FROM public.channel_pending_actions WHERE user_id = _user AND created_at > now() - interval '1 day') >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  DELETE FROM public.channel_pending_actions WHERE expires_at < now() - interval '7 days';
  INSERT INTO public.channel_pending_actions (user_id, channel, external_id, action) VALUES (_user, _channel, _external_id, _action) RETURNING id INTO v;
  RETURN jsonb_build_object('ok', true, 'id', v, 'ref', replace(v::text, '-', ''));
END $$;

-- Toma (una sola vez) la acción que el botón nombra. _ref: el id completo (32 hex) o sus primeros 8 (WhatsApp por
-- Twilio: "sí 4f2a9c1b"). Debe ser del MISMO chat y canal, y ese chat debe seguir vinculado a la cuenta que la pidió.
CREATE OR REPLACE FUNCTION public.channel_action_take(_ref text, _channel text, _external_id text, _cancel boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.channel_pending_actions; n int; r text := lower(coalesce(_ref, ''));
BEGIN
  IF r !~ '^[0-9a-f]{8}([0-9a-f]{24})?$' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT count(*) INTO n FROM public.channel_pending_actions
   WHERE replace(id::text, '-', '') LIKE r || '%' AND channel = _channel AND external_id = _external_id AND used_at IS NULL;
  IF n > 1 THEN RETURN jsonb_build_object('ok', false, 'code', 'AMBIGUOUS'); END IF;
  SELECT * INTO a FROM public.channel_pending_actions
   WHERE replace(id::text, '-', '') LIKE r || '%' AND channel = _channel AND external_id = _external_id
   ORDER BY used_at NULLS FIRST, created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF a.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USED', 'outcome', a.outcome); END IF;
  IF a.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channel_links WHERE active AND user_id = a.user_id AND channel = _channel AND external_id = _external_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LINKED');
  END IF;
  UPDATE public.channel_pending_actions SET used_at = now(), outcome = CASE WHEN _cancel THEN 'cancelada' ELSE 'confirmada' END WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'user_id', a.user_id, 'action', a.action, 'cancelled', _cancel);
END $$;

-- ───────────────────────────── 3. Preferencias del viajero ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_prefs (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred   text NOT NULL DEFAULT 'app' CHECK (preferred IN ('app','telegram','whatsapp','email')),
  quiet_start time,
  quiet_end   time,
  tz          text CHECK (tz IS NULL OR (length(tz) BETWEEN 3 AND 64 AND tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL)),
  CHECK (quiet_start IS NULL OR quiet_start <> quiet_end)
);
ALTER TABLE public.channel_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_prefs_own_select ON public.channel_prefs;
CREATE POLICY channel_prefs_own_select ON public.channel_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.channel_prefs_get(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT jsonb_build_object('preferido', preferred, 'noMolestarInicio', to_char(quiet_start, 'HH24:MI'),
                                             'noMolestarFin', to_char(quiet_end, 'HH24:MI'), 'tz', tz, 'updated_at', updated_at)
                     FROM public.channel_prefs WHERE user_id = _user),
                  jsonb_build_object('preferido', 'app', 'noMolestarInicio', NULL, 'noMolestarFin', NULL, 'tz', NULL));
$$;

-- Guarda las preferencias. Telegram/WhatsApp como preferido solo si ese canal está vinculado.
CREATE OR REPLACE FUNCTION public.channel_prefs_set(_user uuid, _preferred text, _quiet_start text, _quiet_end text, _tz text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE qs time; qe time;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
  IF _preferred NOT IN ('app','telegram','whatsapp','email') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_CHANNEL'); END IF;
  IF _preferred IN ('telegram','whatsapp') AND NOT EXISTS (SELECT 1 FROM public.channel_links WHERE active AND user_id = _user AND channel = _preferred) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_LINKED');
  END IF;
  IF (nullif(_quiet_start, '') IS NULL) <> (nullif(_quiet_end, '') IS NULL) THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_HOURS'); END IF;
  IF nullif(_quiet_start, '') IS NOT NULL THEN
    IF _quiet_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR _quiet_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR _quiet_start = _quiet_end THEN
      RETURN jsonb_build_object('ok', false, 'code', 'BAD_HOURS');
    END IF;
    qs := _quiet_start::time; qe := _quiet_end::time;
  END IF;
  IF nullif(_tz, '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _tz) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_TZ');
  END IF;
  INSERT INTO public.channel_prefs (user_id, preferred, quiet_start, quiet_end, tz, updated_at)
  VALUES (_user, _preferred, qs, qe, nullif(_tz, ''), now())
  ON CONFLICT (user_id) DO UPDATE SET preferred = EXCLUDED.preferred, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
    tz = EXCLUDED.tz, updated_at = now();
  RETURN jsonb_build_object('ok', true) || public.channel_prefs_get(_user);
END $$;

-- Si el viajero desvincula el canal que tenía como preferido, vuelve a "app" (nunca se queda sin avisos).
CREATE OR REPLACE FUNCTION public.channel_unlink(_user uuid, _channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE public.channel_links SET active = false, unlinked_at = now() WHERE user_id = _user AND channel = _channel AND active;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.channel_prefs SET preferred = 'app', updated_at = now() WHERE user_id = _user AND preferred = _channel;
  RETURN jsonb_build_object('ok', true, 'unlinked', n);
END $$;

-- A quién y por dónde se le puede avisar (lo usa _shared/channels/entrega.ts): preferencias, chats vinculados con su
-- ventana de 24 h, correo y si tiene push.
CREATE OR REPLACE FUNCTION public.channel_targets(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'prefs', public.channel_prefs_get(_user),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('channel', channel, 'external_id', external_id,
                         'window_open', coalesce(last_inbound_at > now() - interval '24 hours', false)))
                         FROM public.channel_links WHERE active AND user_id = _user), '[]'::jsonb),
    'email', (SELECT email FROM auth.users WHERE id = _user),
    'name', (SELECT full_name FROM public.profiles WHERE id = _user));
$$;

-- ───────────────────────────── 4. Avisos diferidos (horario de no molestar) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_deferred (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  send_after  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviando','enviado','fallido')),
  attempts    int NOT NULL DEFAULT 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  error       text CHECK (error IS NULL OR length(error) <= 300),
  dedupe_key  text NOT NULL CHECK (length(dedupe_key) BETWEEN 4 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS channel_deferred_due ON public.channel_deferred (send_after) WHERE status IN ('pendiente','enviando');

CREATE OR REPLACE FUNCTION public.channel_deferred_add(_user uuid, _payload jsonb, _send_after timestamptz, _dedupe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v bigint;
BEGIN
  IF _send_after IS NULL OR _send_after > now() + interval '25 hours' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_TIME'); END IF;
  INSERT INTO public.channel_deferred (user_id, payload, send_after, dedupe_key) VALUES (_user, _payload, _send_after, left(_dedupe, 200))
  ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id INTO v;
  RETURN jsonb_build_object('ok', true, 'id', v, 'duplicate', v IS NULL);
END $$;

-- Reclama los vencidos (un envío a la vez por fila: "enviando" con candado de 5 min). Máx. 3 intentos.
CREATE OR REPLACE FUNCTION public.channel_deferred_due(_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE out jsonb;
BEGIN
  WITH c AS (
    SELECT id FROM public.channel_deferred
     WHERE send_after <= now() AND attempts < 3
       AND (status = 'pendiente' OR (status = 'enviando' AND claimed_at < now() - interval '5 minutes'))
     ORDER BY send_after LIMIT greatest(1, least(coalesce(_limit, 50), 200)) FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.channel_deferred d SET status = 'enviando', claimed_at = now(), attempts = d.attempts + 1
      FROM c WHERE d.id = c.id RETURNING d.id, d.user_id, d.payload)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'payload', payload)), '[]'::jsonb) INTO out FROM u;
  DELETE FROM public.channel_deferred WHERE status = 'enviado' AND sent_at < now() - interval '14 days';
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.channel_deferred_finish(_id bigint, _ok boolean, _error text DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.channel_deferred SET status = CASE WHEN _ok THEN 'enviado' WHEN attempts >= 3 THEN 'fallido' ELSE 'pendiente' END,
    sent_at = CASE WHEN _ok THEN now() END, error = left(_error, 300)
   WHERE id = _id AND status = 'enviando' RETURNING true;
$$;

-- ───────────────────────────── 5. Permisos ─────────────────────────────
ALTER TABLE public.channel_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_deferred ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.channel_pending_actions, public.channel_deferred, public.channel_prefs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.channel_prefs TO authenticated;
GRANT ALL ON public.channel_pending_actions, public.channel_deferred, public.channel_prefs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.channel_deferred_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.channel_link_for(text, text), public.channel_location_set(text, text, double precision, double precision),
  public.channel_location_get(text, text), public.channel_window_open(uuid, text), public.channel_open_case(uuid),
  public.channel_action_put(uuid, text, text, jsonb), public.channel_action_take(text, text, text, boolean),
  public.channel_prefs_get(uuid), public.channel_prefs_set(uuid, text, text, text, text), public.channel_unlink(uuid, text),
  public.channel_targets(uuid), public.channel_deferred_add(uuid, jsonb, timestamptz, text), public.channel_deferred_due(int),
  public.channel_deferred_finish(bigint, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_link_for(text, text), public.channel_location_set(text, text, double precision, double precision),
  public.channel_location_get(text, text), public.channel_window_open(uuid, text), public.channel_open_case(uuid),
  public.channel_action_put(uuid, text, text, jsonb), public.channel_action_take(text, text, text, boolean),
  public.channel_prefs_get(uuid), public.channel_prefs_set(uuid, text, text, text, text), public.channel_unlink(uuid, text),
  public.channel_targets(uuid), public.channel_deferred_add(uuid, jsonb, timestamptz, text), public.channel_deferred_due(int),
  public.channel_deferred_finish(bigint, boolean, text)
  TO service_role;

COMMENT ON TABLE public.channel_pending_actions IS 'Acciones que Iato propuso por Telegram/WhatsApp; se ejecutan una vez con el botón, solo desde el mismo chat vinculado. Solo el servidor.';
COMMENT ON TABLE public.channel_prefs IS 'Canal preferido y horario de no molestar del viajero (Operador y vigilancia). El viajero ve su fila; se cambia por la función canales.';
COMMENT ON TABLE public.channel_deferred IS 'Avisos normales recibidos en horario de no molestar; se entregan al terminar. Solo el servidor.';
