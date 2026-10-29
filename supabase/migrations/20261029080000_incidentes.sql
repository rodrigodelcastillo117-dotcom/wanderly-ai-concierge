-- Incidentes (29-oct-2026). Pedido del dueño: "que REALMENTE alguien lo resuelva, TODOS LOS PROBLEMAS DE LOS
-- USUARIOS" y "NO PUEDE FALLAR; si es una QUEJA, que la entienda toda".
--
-- Un incidente es una fila de concierge_requests con type 'incidente' (igual que 'opinion'): así entra sola a
-- la Mesa de operaciones (admin_ops_list), a "Mis solicitudes" (my_team_requests) y a las respuestas del
-- equipo (admin_ops_act 'responder' → team_request_replies → correo vía ops-desk). Lo que es propio de un
-- incidente vive aparte, en tablas que solo toca el servidor:
--
--   incidents         estado operativo 1:1 (severidad, quién lo tiene: operador IA 'iato_ops' o 'humano',
--                     nivel de escalamiento, tiempos de servicio, siguiente paso con hora prometida, cierre).
--   incident_events   BITÁCORA completa: cada mensaje enviado o recibido por cualquier canal, cada acción,
--                     decisión, cambio de estado, asignación, escalamiento y alerta, con hora.
--   incident_alerts   cola de avisos al equipo humano (sin duplicados: clave por motivo; reintento).
--   incident_config   tiempos (configurables) y si el operador IA está prendido (+ su latido).
--   incident_oncall   guardia: quién atiende, horario y zona horaria, y el respaldo. Vacía = FIXER_EMAIL.
--
-- Reglas que la base hace cumplir (no dependen del código ni de la IA):
--   * Nunca se duplica: createIncident es idempotente por clave (un monitor no abre dos veces el mismo caso).
--   * Nunca se pierde: el vigilante (incident_watch, cron) escala si no hay avance, si nadie lo toma, si un
--     mensaje del usuario no tiene respuesta, si vence la hora prometida o si el operador IA no da señales.
--   * No se cierra sin confirmación del usuario o sin nota humana (guardia en concierge_requests). Si el
--     usuario dice que no quedó resuelto, se reabre y sube de severidad.
--   * Tiempos medidos: recibido, primera respuesta, primera respuesta humana, tomado, resuelto.
-- Idempotente. NO envía nada: los correos y push los manda el servidor (_shared/incident-alerts.ts).

-- ───────────────────────────── 0. Vocabulario ─────────────────────────────
CREATE OR REPLACE FUNCTION public.incident_categories()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['vuelo_cancelado','vuelo_retrasado','conexion_perdida','overbooking','traslado_no_llego','hotel_problema',
    'equipaje','documentos','robo','salud','seguridad','reserva_problema','cobro_reembolso','queja','otro'];
$$;

CREATE OR REPLACE FUNCTION public._incident_category_label(_c text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _c
    WHEN 'vuelo_cancelado' THEN 'Vuelo cancelado' WHEN 'vuelo_retrasado' THEN 'Vuelo retrasado'
    WHEN 'conexion_perdida' THEN 'Conexión perdida' WHEN 'overbooking' THEN 'Sobreventa del vuelo'
    WHEN 'traslado_no_llego' THEN 'El traslado no llegó' WHEN 'hotel_problema' THEN 'Problema con el hotel'
    WHEN 'equipaje' THEN 'Equipaje' WHEN 'documentos' THEN 'Documentos perdidos o robados' WHEN 'robo' THEN 'Robo'
    WHEN 'salud' THEN 'Salud o emergencia médica' WHEN 'seguridad' THEN 'Seguridad'
    WHEN 'reserva_problema' THEN 'Problema con una reserva' WHEN 'cobro_reembolso' THEN 'Cobro o reembolso'
    WHEN 'queja' THEN 'Queja' ELSE 'Otro problema' END;
$$;

CREATE OR REPLACE FUNCTION public._incident_sev_rank(_s text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s WHEN 'critica' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public._incident_sev_up(_s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s WHEN 'baja' THEN 'media' WHEN 'media' THEN 'alta' ELSE 'critica' END;
$$;

-- Texto corto y de una línea (≤ _max), o NULL. Para validar campos opcionales del payload.
CREATE OR REPLACE FUNCTION public._incident_str_ok(_v jsonb, _max int)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _v IS NULL OR jsonb_typeof(_v) = 'null' OR (jsonb_typeof(_v) = 'string' AND length(_v #>> '{}') BETWEEN 1 AND _max);
$$;

-- Forma del payload de un incidente (lo opcional). Lo obligatorio va directo en el CHECK.
CREATE OR REPLACE FUNCTION public._incident_payload_ok(_p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- ubicación opcional: ciudad, país, lat/lng, zona horaria IANA
    (_p->'ubicacion' IS NULL OR (jsonb_typeof(_p->'ubicacion') = 'object'
      AND public._incident_str_ok(_p->'ubicacion'->'ciudad', 120)
      AND public._incident_str_ok(_p->'ubicacion'->'pais', 80)
      AND public._incident_str_ok(_p->'ubicacion'->'direccion', 200)
      AND (_p->'ubicacion'->'lat' IS NULL OR CASE WHEN jsonb_typeof(_p->'ubicacion'->'lat') = 'number'
            THEN (_p->'ubicacion'->>'lat')::numeric BETWEEN -90 AND 90 ELSE false END)
      AND (_p->'ubicacion'->'lng' IS NULL OR CASE WHEN jsonb_typeof(_p->'ubicacion'->'lng') = 'number'
            THEN (_p->'ubicacion'->>'lng')::numeric BETWEEN -180 AND 180 ELSE false END)
      AND (_p->'ubicacion'->'zona_horaria' IS NULL OR coalesce(_p->'ubicacion'->>'zona_horaria', '') ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$')))
    -- referencias: vuelo, PNR, proveedor, reserva, fecha del vuelo
    AND (_p->'refs' IS NULL OR (jsonb_typeof(_p->'refs') = 'object'
      AND public._incident_str_ok(_p->'refs'->'vuelo', 12)
      AND (_p->'refs'->'pnr' IS NULL OR coalesce(_p->'refs'->>'pnr', '') ~ '^[A-Za-z0-9]{5,8}$')
      AND public._incident_str_ok(_p->'refs'->'proveedor', 120)
      AND public._incident_str_ok(_p->'refs'->'reserva', 120)
      AND (_p->'refs'->'fecha_vuelo' IS NULL OR coalesce(_p->'refs'->>'fecha_vuelo', '') ~ '^\d{4}-\d{2}-\d{2}$')))
    AND public._incident_str_ok(_p->'playbook', 60)
    AND (_p->'acciones_tomadas' IS NULL OR (jsonb_typeof(_p->'acciones_tomadas') = 'array' AND jsonb_array_length(_p->'acciones_tomadas') <= 30
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_p->'acciones_tomadas') a WHERE NOT public._incident_str_ok(a, 300))))
    -- queja: obligatoria si la categoría es 'queja'; en otras categorías es opcional (alguien molesto por un vuelo)
    AND (CASE WHEN _p->>'categoria' = 'queja' THEN coalesce(jsonb_typeof(_p->'queja'), '') = 'object' ELSE _p->'queja' IS NULL OR jsonb_typeof(_p->'queja') = 'object' END)
    AND (_p->'queja' IS NULL OR coalesce(_p->'queja'->>'subtipo', '') IN ('servicio_iatos','proveedor','cobro','trato','calidad','app'))
    AND (_p->>'sentimiento' IS NULL OR _p->>'sentimiento' IN ('neutral','preocupado','molesto','muy_molesto','angustiado'))
    AND (_p->>'expectativa' IS NULL OR _p->>'expectativa' IN ('reembolso','disculpa','cambio','informacion','solucion','compensacion'))
    AND (_p->>'idioma' IS NULL OR _p->>'idioma' IN ('es','en','otro'))
    AND public._incident_str_ok(_p->'texto_original', 4000);
$$;

-- ───────────────────────────── 1. Forma del incidente en concierge_requests ─────────────────────────────
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS concierge_requests_incident_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_requests_incident_ok CHECK (type IS DISTINCT FROM 'incidente' OR (
  status IN ('solicitado','pendiente_confirmacion','resuelto','rechazado','cancelado')
  AND length(title) BETWEEN 3 AND 200
  AND jsonb_typeof(payload) = 'object'
  AND coalesce(payload->>'categoria', '') = ANY (public.incident_categories())
  AND coalesce(payload->>'severidad', '') IN ('critica','alta','media','baja')
  AND length(btrim(coalesce(payload->>'descripcion', ''))) BETWEEN 3 AND 4000
  AND coalesce(payload->>'origen', '') IN ('usuario','iato','monitor_vuelos','proveedor','equipo','canal')
  AND coalesce(public._incident_payload_ok(payload), false)));
COMMENT ON CONSTRAINT concierge_requests_incident_ok ON public.concierge_requests IS
  'Incidentes (type incidente, _shared/incidents.ts): categoría, severidad, descripción, origen y payload opcional validado.';

CREATE INDEX IF NOT EXISTS concierge_requests_incident_user ON public.concierge_requests (user_id, created_at DESC)
  WHERE type = 'incidente';

-- ───────────────────────────── 2. Tablas propias ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.incidents (
  request_id              uuid PRIMARY KEY REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  idem_key                text UNIQUE CHECK (idem_key IS NULL OR length(idem_key) BETWEEN 8 AND 200),
  category                text NOT NULL CHECK (category = ANY (public.incident_categories())),
  severity                text NOT NULL CHECK (severity IN ('critica','alta','media','baja')),
  severity_initial        text NOT NULL CHECK (severity_initial IN ('critica','alta','media','baja')),
  origin                  text NOT NULL CHECK (origin IN ('usuario','iato','monitor_vuelos','proveedor','equipo','canal')),
  assignee                text NOT NULL DEFAULT 'iato_ops' CHECK (assignee IN ('iato_ops','humano')),
  escalation_level        int NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 20),
  needs_human             boolean NOT NULL DEFAULT false,
  needs_human_reason      text CHECK (needs_human_reason IS NULL OR length(needs_human_reason) <= 500),
  received_at             timestamptz NOT NULL DEFAULT now(),
  first_response_at       timestamptz,
  first_human_response_at timestamptz,
  taken_at                timestamptz,
  taken_by                uuid,
  escalated_at            timestamptz,
  last_progress_at        timestamptz NOT NULL DEFAULT now(),
  last_alert_at           timestamptz,
  alerts_count            int NOT NULL DEFAULT 0,
  next_step               text CHECK (next_step IS NULL OR length(next_step) BETWEEN 3 AND 300),
  next_step_due_at        timestamptz,
  next_step_alerted_at    timestamptz,
  resolution_state        text CHECK (resolution_state IS NULL OR resolution_state IN ('esperando_confirmacion','confirmado_usuario','nota_humana','rechazado_usuario')),
  resolution_note         text CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  resolution_requested_at timestamptz,
  user_confirmed_at       timestamptz,
  resolved_at             timestamptz,
  closed_by               text CHECK (closed_by IS NULL OR closed_by IN ('usuario','equipo','sistema')),
  reopen_count            int NOT NULL DEFAULT 0,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_open ON public.incidents (received_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.incident_events (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id          uuid NOT NULL REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  at                  timestamptz NOT NULL DEFAULT now(),
  kind                text NOT NULL CHECK (kind IN ('creado','mensaje','accion','decision','estado','asignacion','escalamiento',
                        'alerta','nota','siguiente_paso','confirmacion','sistema')),
  actor               text NOT NULL CHECK (actor IN ('usuario','iato','iato_ops','equipo','sistema','proveedor','monitor')),
  actor_id            uuid,
  channel             text CHECK (channel IS NULL OR channel IN ('app','iato','email','push','telegram','whatsapp','sms','voz','mesa')),
  direction           text CHECK (direction IS NULL OR direction IN ('entrante','saliente','interno')),
  counterpart         text CHECK (counterpart IS NULL OR length(counterpart) <= 200),
  body                text CHECK (body IS NULL OR length(body) <= 4000),
  data                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND length(data::text) <= 8000),
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  delivery            text CHECK (delivery IS NULL OR delivery IN ('enviado','fallido','apagado','recibido')),
  visible_to_user     boolean NOT NULL DEFAULT false,
  dedupe_key          text CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200)
);
CREATE INDEX IF NOT EXISTS incident_events_req ON public.incident_events (request_id, at, id);
CREATE UNIQUE INDEX IF NOT EXISTS incident_events_dedupe ON public.incident_events (request_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.incident_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  level       int NOT NULL CHECK (level BETWEEN 0 AND 20),
  reason      text NOT NULL CHECK (reason IN ('nuevo','sin_avance','sin_tomar','necesita_humano','manual','mensaje_sin_respuesta',
                'promesa_vencida','operador_caido','reabierto','confirmacion_pendiente','canal_fallido')),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  dedupe_key  text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','fallido','descartado')),
  attempts    int NOT NULL DEFAULT 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  error       text CHECK (error IS NULL OR length(error) <= 300),
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS incident_alerts_due ON public.incident_alerts (created_at) WHERE status IN ('pendiente','fallido');

CREATE TABLE IF NOT EXISTS public.incident_config (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Operador IA (el "cerebro" con herramientas lo implementa otro módulo). Apagado = todo va directo al
  -- equipo humano desde el primer minuto; prendido sin latido reciente = "operador caído" → humanos.
  ai_operator_enabled     boolean NOT NULL DEFAULT false,
  ai_operator_heartbeat_at timestamptz,
  operator_down_after_min int NOT NULL DEFAULT 5 CHECK (operator_down_after_min BETWEEN 1 AND 120),
  -- Minutos sin avance / sin que un humano lo tome antes de escalar (crítico 10, alto 30).
  take_minutes            jsonb NOT NULL DEFAULT '{"critica":10,"alta":30,"media":120,"baja":480}'::jsonb,
  -- Minutos que puede esperar un mensaje del usuario sin respuesta antes de alertar.
  reply_minutes           jsonb NOT NULL DEFAULT '{"critica":5,"alta":10,"media":30,"baja":60}'::jsonb,
  -- Con el operador IA prendido, estas severidades avisan igual a los humanos al nacer.
  notify_on_create        text[] NOT NULL DEFAULT ARRAY['critica'],
  max_realerts            int NOT NULL DEFAULT 6 CHECK (max_realerts BETWEEN 0 AND 18),
  confirm_wait_hours      int NOT NULL DEFAULT 24 CHECK (confirm_wait_hours BETWEEN 1 AND 168),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(take_minutes) = 'object' AND jsonb_typeof(reply_minutes) = 'object')
);
INSERT INTO public.incident_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Guardia. Vacía: se usa FIXER_EMAIL (el primero es el primario, los demás el respaldo).
CREATE TABLE IF NOT EXISTS public.incident_oncall (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 200),
  name        text CHECK (name IS NULL OR length(name) <= 120),
  role        text NOT NULL DEFAULT 'primario' CHECK (role IN ('primario','respaldo')),
  timezone    text NOT NULL DEFAULT 'America/Mexico_City' CHECK (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  start_hour  int NOT NULL DEFAULT 0 CHECK (start_hour BETWEEN 0 AND 23),
  end_hour    int NOT NULL DEFAULT 24 CHECK (end_hour BETWEEN 1 AND 24),
  days        int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7] CHECK (days <@ ARRAY[1,2,3,4,5,6,7] AND cardinality(days) >= 1),
  phone       text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  channels    text[] NOT NULL DEFAULT ARRAY['email','push'] CHECK (channels <@ ARRAY['email','push','telegram','whatsapp','sms','voz'] AND cardinality(channels) >= 1),
  telegram_chat_id text CHECK (telegram_chat_id IS NULL OR telegram_chat_id ~ '^-?[0-9]{3,20}$'),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS incident_oncall_email ON public.incident_oncall (lower(email));

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_oncall ENABLE ROW LEVEL SECURITY;
-- Nadie desde el cliente: el usuario ve lo suyo con my_team_requests; el equipo con las RPC de la mesa.
REVOKE ALL ON public.incidents, public.incident_events, public.incident_alerts, public.incident_config, public.incident_oncall
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.incidents, public.incident_events, public.incident_alerts, public.incident_config, public.incident_oncall TO service_role;

-- ───────────────────────────── 3. Utilidades ─────────────────────────────
CREATE OR REPLACE FUNCTION public._incident_minutes(_cfg jsonb, _sev text, _default int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(_cfg->>_sev, '') ~ '^\d{1,5}$' THEN greatest(1, (_cfg->>_sev)::int) ELSE _default END;
$$;

CREATE OR REPLACE FUNCTION public._incident_cfg()
RETURNS public.incident_config LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c FROM public.incident_config c WHERE c.id
  UNION ALL SELECT (true, false, NULL, 5, '{"critica":10,"alta":30,"media":120,"baja":480}'::jsonb,
    '{"critica":5,"alta":10,"media":30,"baja":60}'::jsonb, ARRAY['critica'], 6, 24, now())::public.incident_config
  LIMIT 1;
$$;

-- ¿El operador IA está prendido y vivo (latido reciente)?
CREATE OR REPLACE FUNCTION public._incident_operator_alive(_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.ai_operator_enabled AND c.ai_operator_heartbeat_at IS NOT NULL
     AND c.ai_operator_heartbeat_at > _now - make_interval(mins => c.operator_down_after_min)
    FROM public._incident_cfg() c;
$$;

CREATE OR REPLACE FUNCTION public._incident_folio(_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(left(replace(_id::text, '-', ''), 8)); $$;

-- Una línea en la bitácora (la usan las funciones de abajo y los disparadores).
CREATE OR REPLACE FUNCTION public._incident_log(_id uuid, _kind text, _actor text, _body text,
  _data jsonb DEFAULT '{}'::jsonb, _channel text DEFAULT NULL, _direction text DEFAULT NULL, _actor_id uuid DEFAULT NULL,
  _visible boolean DEFAULT false, _counterpart text DEFAULT NULL, _delivery text DEFAULT NULL, _dedupe text DEFAULT NULL,
  _provider_message_id text DEFAULT NULL, _at timestamptz DEFAULT now())
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO public.incident_events (request_id, at, kind, actor, actor_id, channel, direction, counterpart, body, data,
    provider_message_id, delivery, visible_to_user, dedupe_key)
  VALUES (_id, coalesce(_at, now()), _kind, _actor, _actor_id, _channel, _direction, left(_counterpart, 200), left(_body, 4000),
    coalesce(_data, '{}'::jsonb), left(_provider_message_id, 200), _delivery, coalesce(_visible, false), left(_dedupe, 200))
  ON CONFLICT (request_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Encola un aviso al equipo humano. Sin duplicados por (incidente, clave).
CREATE OR REPLACE FUNCTION public._incident_enqueue_alert(_id uuid, _level int, _reason text, _dedupe text, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.incident_alerts (request_id, level, reason, dedupe_key, note)
  VALUES (_id, least(greatest(coalesce(_level, 1), 0), 20), _reason, left(_dedupe, 200), left(_note, 500))
  ON CONFLICT (request_id, dedupe_key) DO NOTHING
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Sube el nivel de escalamiento, lo pasa a humanos, encola el aviso y lo anota en la bitácora.
CREATE OR REPLACE FUNCTION public._incident_escalate(_id uuid, _level int, _reason text, _note text DEFAULT NULL,
  _now timestamptz DEFAULT now(), _actor text DEFAULT 'sistema', _actor_id uuid DEFAULT NULL, _dedupe text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_alert uuid; v_lvl int := least(greatest(_level, 1), 20);
BEGIN
  UPDATE public.incidents
     SET escalation_level = greatest(escalation_level, v_lvl), escalated_at = _now, assignee = 'humano',
         needs_human = needs_human OR _reason IN ('necesita_humano','operador_caido','manual'), updated_at = now()
   WHERE request_id = _id;
  v_alert := public._incident_enqueue_alert(_id, v_lvl, _reason, coalesce(_dedupe, 'esc:' || v_lvl || ':' || floor(extract(epoch FROM _now))::bigint), _note);
  PERFORM public._incident_log(_id, 'escalamiento', _actor,
    left(CASE _reason
      WHEN 'sin_avance' THEN 'Sin avance a tiempo: pasa al equipo humano'
      WHEN 'sin_tomar' THEN 'Nadie lo tomó a tiempo: se avisa también al siguiente responsable'
      WHEN 'necesita_humano' THEN 'El operador pidió a una persona del equipo'
      WHEN 'operador_caido' THEN 'El operador IA no responde: pasa al equipo humano'
      WHEN 'manual' THEN 'Escalado a mano desde la mesa'
      WHEN 'reabierto' THEN 'El usuario dice que no quedó resuelto: se reabre'
      ELSE 'Escalado' END || coalesce(' · ' || _note, ''), 1000),
    jsonb_build_object('level', v_lvl, 'reason', _reason, 'alert_id', v_alert), NULL, 'interno', _actor_id, false, NULL, NULL, NULL, NULL, _now);
  RETURN v_alert;
END $$;

-- ───────────────────────────── 4. Guardia: a quién se avisa ahora ─────────────────────────────
-- Nivel 0–1: los primarios de turno (si nadie está de turno, todos los primarios; si no hay, el respaldo).
-- Nivel ≥ 2: primarios y respaldo. _fallback: los correos de FIXER_EMAIL si la tabla está vacía.
CREATE OR REPLACE FUNCTION public.incident_oncall_now(_level int, _fallback text[] DEFAULT NULL, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_out jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.incident_oncall WHERE active) THEN
    SELECT jsonb_agg(jsonb_build_object('email', lower(o.email), 'name', o.name, 'role', o.role, 'timezone', o.timezone,
             'phone', o.phone, 'telegram_chat_id', o.telegram_chat_id, 'channels', to_jsonb(o.channels),
             'user_id', (SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(o.email) LIMIT 1),
             'on_duty', (extract(isodow FROM _now AT TIME ZONE o.timezone)::int = ANY (o.days)) AND (
               CASE WHEN o.start_hour < o.end_hour
                    THEN extract(hour FROM _now AT TIME ZONE o.timezone) >= o.start_hour AND extract(hour FROM _now AT TIME ZONE o.timezone) < o.end_hour
                    ELSE extract(hour FROM _now AT TIME ZONE o.timezone) >= o.start_hour OR extract(hour FROM _now AT TIME ZONE o.timezone) < o.end_hour END))
           ORDER BY o.role, o.created_at)
      INTO v_rows FROM public.incident_oncall o WHERE o.active;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('email', lower(e), 'name', (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p
               JOIN auth.users u ON u.id = p.id WHERE lower(u.email) = lower(e) LIMIT 1),
             'role', CASE WHEN n = 1 THEN 'primario' ELSE 'respaldo' END, 'timezone', 'America/Mexico_City', 'phone', NULL,
             'telegram_chat_id', NULL, 'channels', '["email","push"]'::jsonb,
             'user_id', (SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(e) LIMIT 1), 'on_duty', true, 'fallback', true)
           ORDER BY n)
      INTO v_rows
      FROM unnest(coalesce(_fallback, ARRAY[]::text[])) WITH ORDINALITY AS f(e, n)
     WHERE e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  END IF;
  v_rows := coalesce(v_rows, '[]'::jsonb);
  IF coalesce(_level, 1) >= 2 THEN
    RETURN v_rows;
  END IF;
  SELECT jsonb_agg(r) INTO v_out FROM jsonb_array_elements(v_rows) r WHERE r->>'role' = 'primario' AND (r->>'on_duty')::boolean;
  IF v_out IS NULL THEN SELECT jsonb_agg(r) INTO v_out FROM jsonb_array_elements(v_rows) r WHERE r->>'role' = 'primario'; END IF;
  IF v_out IS NULL THEN v_out := v_rows; END IF;
  RETURN v_out;
END $$;

-- ───────────────────────────── 5. Lo que ven el equipo y el usuario ─────────────────────────────
CREATE OR REPLACE FUNCTION public._incident_json(_id uuid, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'category', i.category, 'category_label', public._incident_category_label(i.category),
    'severity', i.severity, 'severity_initial', i.severity_initial, 'origin', i.origin,
    'assignee', i.assignee, 'escalation_level', i.escalation_level, 'needs_human', i.needs_human, 'needs_human_reason', i.needs_human_reason,
    'received_at', i.received_at, 'first_response_at', i.first_response_at, 'first_human_response_at', i.first_human_response_at,
    'taken_at', i.taken_at, 'escalated_at', i.escalated_at, 'last_progress_at', i.last_progress_at,
    'last_alert_at', i.last_alert_at, 'alerts_count', i.alerts_count,
    'next_step', i.next_step, 'next_step_due_at', i.next_step_due_at,
    'resolution_state', i.resolution_state, 'resolution_note', i.resolution_note, 'resolved_at', i.resolved_at,
    'closed_by', i.closed_by, 'reopen_count', i.reopen_count,
    'take_minutes', public._incident_minutes(c.take_minutes, i.severity, 60),
    -- Minutos sin que una persona lo tome (mientras está abierto) y semáforo contra el tiempo de su severidad.
    'minutes_unattended', CASE WHEN i.resolved_at IS NULL AND i.taken_at IS NULL
                               THEN floor(extract(epoch FROM (_now - i.received_at)) / 60)::int END,
    'semaforo', CASE
      WHEN i.resolved_at IS NOT NULL THEN 'cerrado'
      WHEN i.taken_at IS NOT NULL THEN 'atendido'
      WHEN extract(epoch FROM (_now - i.received_at)) / 60 >= public._incident_minutes(c.take_minutes, i.severity, 60) THEN 'rojo'
      WHEN extract(epoch FROM (_now - i.received_at)) / 60 >= public._incident_minutes(c.take_minutes, i.severity, 60) / 2.0 THEN 'ambar'
      ELSE 'verde' END,
    'minutes_to_first_human', CASE WHEN i.first_human_response_at IS NOT NULL
                                   THEN round(extract(epoch FROM (i.first_human_response_at - i.received_at)) / 60.0, 1) END,
    'minutes_to_resolve', CASE WHEN i.resolved_at IS NOT NULL THEN round(extract(epoch FROM (i.resolved_at - i.received_at)) / 60.0, 1) END,
    'unanswered_user_message', EXISTS (SELECT 1 FROM public.incident_events e WHERE e.request_id = i.request_id AND e.direction = 'entrante'
      AND e.actor = 'usuario' AND NOT EXISTS (SELECT 1 FROM public.incident_events s WHERE s.request_id = e.request_id
        AND s.direction = 'saliente' AND s.visible_to_user AND s.at >= e.at)),
    'events_count', (SELECT count(*) FROM public.incident_events e WHERE e.request_id = i.request_id))
  FROM public.incidents i CROSS JOIN public._incident_cfg() c WHERE i.request_id = _id;
$$;

-- Lo que ve el usuario (sin quién del equipo, sin notas internas).
CREATE OR REPLACE FUNCTION public._incident_user_json(_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'category', i.category, 'category_label', public._incident_category_label(i.category), 'severity', i.severity,
    'next_step', i.next_step, 'next_step_due_at', i.next_step_due_at,
    'resolution_state', i.resolution_state, 'resolved_at', i.resolved_at, 'reopen_count', i.reopen_count,
    'can_confirm', i.resolution_state = 'esperando_confirmacion' AND i.resolved_at IS NULL,
    'can_reopen', i.resolved_at IS NOT NULL AND i.resolved_at > now() - interval '7 days' AND cr.status = 'resuelto',
    'is_open', cr.status IN ('solicitado','pendiente_confirmacion'),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'from', CASE WHEN e.direction = 'entrante' THEN 'usuario' ELSE 'equipo' END,
        'actor', CASE e.actor WHEN 'usuario' THEN 'usuario' WHEN 'iato' THEN 'iato' ELSE 'equipo' END, 'channel', e.channel, 'body', e.body)
        ORDER BY e.at, e.id)
      FROM public.incident_events e WHERE e.request_id = i.request_id AND e.visible_to_user AND e.kind = 'mensaje'
        -- las respuestas del equipo ya llegan en "replies" (team_request_replies): aquí lo demás
        AND NOT (e.actor = 'equipo' AND e.data ? 'reply_id')), '[]'::jsonb))
  FROM public.incidents i JOIN public.concierge_requests cr ON cr.id = i.request_id WHERE i.request_id = _id;
$$;

-- Mesa: _ops_request_json igual que en 20261028180000_mesa_operaciones, más el bloque 'incident'.
CREATE OR REPLACE FUNCTION public._ops_request_json(_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'source', 'concierge_request', 'id', cr.id, 'type', cr.type, 'title', cr.title, 'status', cr.status,
    'stage', public.ops_stage('concierge_request', cr.type, cr.status),
    'created_at', cr.created_at, 'updated_at', GREATEST(cr.updated_at, cr.status_changed_at),
    'requested_for', public._ops_requested_text(cr.requested_for, cr.payload),
    'party_size', coalesce(cr.party_size, public._ops_small_int(cr.payload->>'party_size'), public._ops_small_int(cr.payload->>'personas')),
    'place', coalesce(x.name, nullif(cr.payload->>'lugar', ''), nullif(cr.payload->>'venue_name', '')),
    'experience', CASE WHEN x.id IS NULL THEN NULL ELSE jsonb_build_object('name', x.name, 'city', d.name_es, 'country', d.iso_country,
      'timezone', d.timezone, 'source_url', coalesce(x.website, x.booking_url,
        (SELECT coalesce(s->>'url', s#>>'{}') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.sources) = 'array' THEN x.sources ELSE '[]'::jsonb END) s
          WHERE coalesce(s->>'url', s#>>'{}') ~ '^https://' LIMIT 1))) END,
    'preferences', cr.preferences, 'contact_method', coalesce(cr.contact_method, nullif(cr.payload->>'contact_method', '')),
    'payload', cr.payload,
    'trip', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id, 'destino', t.destino, 'fecha_salida', t.fecha_salida, 'fecha_regreso', t.fecha_regreso) END,
    'user', public._ops_person(cr.user_id),
    'owner', public._ops_person(cr.owner_admin_id),
    'evidence', cr.external_confirmation,
    'alert', jsonb_build_object('status', cr.owner_alert_status, 'attempts', cr.owner_alert_attempts, 'sent_at', cr.owner_alert_sent_at, 'error', cr.owner_alert_error))
    -- Incidentes: severidad, semáforo, tiempos, siguiente paso y cierre (la bitácora va aparte: admin_incident_log).
    || CASE WHEN cr.type = 'incidente' THEN jsonb_build_object('incident', public._incident_json(cr.id)) ELSE '{}'::jsonb END
  FROM public.concierge_requests cr
  LEFT JOIN public.prive_experiences x ON x.id = cr.experience_id
  LEFT JOIN public.prive_destinations d ON d.id = x.destination_id
  LEFT JOIN public.trips t ON t.id = cr.trip_id
  WHERE cr.id = _id;
$$;

-- "Mis solicitudes": igual que en 20261028180000_mesa_operaciones, más el bloque 'incident' (lo que ve el
-- usuario: siguiente paso con hora, "¿quedó resuelto?", mensajes).
CREATE OR REPLACE FUNCTION public.my_team_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'my_team_requests: sin sesión' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(j ORDER BY (j->>'created_at')::timestamptz DESC) FROM (
    SELECT jsonb_build_object('source', 'concierge_request', 'id', cr.id, 'type', cr.type, 'title', cr.title, 'status', cr.status,
             'stage', public.ops_stage('concierge_request', cr.type, cr.status),
             'created_at', cr.created_at, 'updated_at', GREATEST(cr.updated_at, cr.status_changed_at),
             'requested_for', public._ops_requested_text(cr.requested_for, cr.payload),
             'party_size', coalesce(cr.party_size, public._ops_small_int(cr.payload->>'party_size'), public._ops_small_int(cr.payload->>'personas')),
             'place', coalesce(nullif(cr.payload->>'lugar', ''), nullif(cr.payload->>'venue_name', '')),
             'evidence', CASE WHEN public.ops_stage('concierge_request', cr.type, cr.status) = 'resuelta'
                              THEN coalesce(cr.external_confirmation->>'evidence', cr.external_confirmation->>'confirmation_code') END,
             'replies', public._ops_replies('concierge_request', cr.id, false),
             'history', public._ops_history('concierge_request', cr.id, false),
             'incident', CASE WHEN cr.type = 'incidente' THEN public._incident_user_json(cr.id) END) AS j
      FROM public.concierge_requests cr
     WHERE cr.user_id = v_uid AND cr.type IS DISTINCT FROM 'ai_reservation' AND cr.created_at > now() - interval '180 days'
    UNION ALL
    SELECT jsonb_build_object('source', 'ai_reservation', 'id', ar.id, 'type', 'ai_reservation', 'title', ar.venue_name, 'status', ar.status,
             'stage', public.ops_stage('ai_reservation', 'ai_reservation', ar.status, public._ops_ai_owner(ar.id) IS NOT NULL),
             'created_at', ar.created_at, 'updated_at', ar.updated_at,
             'requested_for', ar.requested_local, 'party_size', ar.party_size, 'place', ar.venue_name,
             'evidence', CASE WHEN ar.status = 'confirmed' THEN coalesce(ar.confirmation->>'evidence', ar.confirmation_code) END,
             'replies', public._ops_replies('ai_reservation', ar.id, false),
             'history', public._ops_history('ai_reservation', ar.id, false))
      FROM public.ai_reservations ar
     WHERE ar.user_id = v_uid AND ar.created_at > now() - interval '180 days'
       AND (EXISTS (SELECT 1 FROM public.ai_reservation_events e WHERE e.reservation_id = ar.id AND e.kind = 'note' AND e.data ? 'mesa')
            OR EXISTS (SELECT 1 FROM public.team_request_replies q WHERE q.source = 'ai_reservation' AND q.source_id = ar.id))
  ) s), '[]'::jsonb);
END $$;

-- ───────────────────────────── 6. Servidor: crear, bitácora, estado, asignar, siguiente paso ─────────────────────────────
-- incident_create(_input): idempotente por idem_key (misma clave = mismo caso, created=false).
-- _input: user_id, categoria, severidad, descripcion, origen, [trip_id, idem_key, ubicacion, refs, playbook,
--         acciones_tomadas, queja, sentimiento, expectativa, idioma, texto_original, siguiente_paso, respuesta_inmediata, canal]
CREATE OR REPLACE FUNCTION public.incident_create(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid; v_trip uuid; v_key text := nullif(btrim(coalesce(_input->>'idem_key', '')), '');
  v_cat text := _input->>'categoria'; v_sev text := _input->>'severidad'; v_origin text := coalesce(_input->>'origen', 'usuario');
  v_desc text := btrim(coalesce(_input->>'descripcion', '')); v_id uuid; v_existing record; v_payload jsonb;
  cfg public.incident_config := public._incident_cfg(); v_alive boolean := coalesce(public._incident_operator_alive(), false);
  v_level int; v_alert uuid; v_take int; v_step text; v_due timestamptz; v_title text; v_channel text;
BEGIN
  IF coalesce(_input->>'user_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_REQUIRED'); END IF;
  v_user := (_input->>'user_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
  IF v_cat IS NULL OR NOT (v_cat = ANY (public.incident_categories())) THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CATEGORY'); END IF;
  IF v_sev IS NULL OR v_sev NOT IN ('critica','alta','media','baja') THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SEVERITY'); END IF;
  IF length(v_desc) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'DESCRIPTION_REQUIRED'); END IF;

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('incident:' || v_key, 0));
    SELECT i.request_id, cr.user_id, i.severity, i.assignee, i.escalation_level, i.next_step, i.next_step_due_at INTO v_existing
      FROM public.incidents i JOIN public.concierge_requests cr ON cr.id = i.request_id WHERE i.idem_key = v_key;
    IF FOUND THEN
      IF v_existing.user_id <> v_user THEN RETURN jsonb_build_object('ok', false, 'code', 'IDEM_CONFLICT'); END IF;
      RETURN jsonb_build_object('ok', true, 'created', false, 'id', v_existing.request_id, 'folio', public._incident_folio(v_existing.request_id),
        'severity', v_existing.severity, 'assignee', v_existing.assignee, 'escalation_level', v_existing.escalation_level,
        'next_step', v_existing.next_step, 'next_step_due_at', v_existing.next_step_due_at);
    END IF;
  END IF;

  -- Tope por persona (solo lo que reporta la persona o Iato por ella; los monitores y el equipo no).
  IF v_origin IN ('usuario','iato','canal') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('incident_user:' || v_user::text, 0));
    IF (SELECT count(*) FROM public.concierge_requests WHERE type = 'incidente' AND user_id = v_user AND created_at > now() - interval '1 hour') >= 20 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
    END IF;
  END IF;

  IF coalesce(_input->>'trip_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT id INTO v_trip FROM public.trips WHERE id = (_input->>'trip_id')::uuid AND user_id = v_user;
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'categoria', v_cat, 'severidad', v_sev, 'descripcion', left(v_desc, 4000), 'origen', v_origin,
    'ubicacion', _input->'ubicacion', 'refs', _input->'refs', 'playbook', _input->'playbook',
    'acciones_tomadas', _input->'acciones_tomadas', 'queja', _input->'queja', 'sentimiento', _input->'sentimiento',
    'expectativa', _input->'expectativa', 'idioma', _input->'idioma', 'texto_original', _input->'texto_original'));
  v_title := left(public._incident_category_label(v_cat) || ': ' || regexp_replace(left(v_desc, 140), '\s+', ' ', 'g'), 200);

  BEGIN
    INSERT INTO public.concierge_requests (user_id, trip_id, type, title, payload, status)
    VALUES (v_user, v_trip, 'incidente', v_title, v_payload, 'solicitado')
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
  END;

  v_take := public._incident_minutes(cfg.take_minutes, v_sev, 60);
  v_due := now() + make_interval(mins => v_take);
  v_level := CASE WHEN v_alive THEN 0 ELSE 1 END;
  v_step := coalesce(nullif(btrim(left(_input->>'siguiente_paso', 300)), ''),
    CASE WHEN v_alive THEN 'El operador de IATOS está trabajando en tu caso y te escribe con el siguiente paso'
         ELSE 'Una persona del equipo IATOS revisa tu caso y te escribe con el siguiente paso' END);
  v_channel := CASE WHEN _input->>'canal' IN ('app','iato','email','telegram','whatsapp','sms','voz') THEN _input->>'canal'
                    WHEN v_origin = 'iato' THEN 'iato' WHEN v_origin = 'usuario' THEN 'app' END;

  INSERT INTO public.incidents (request_id, idem_key, category, severity, severity_initial, origin, assignee, escalation_level,
    escalated_at, next_step, next_step_due_at)
  VALUES (v_id, v_key, v_cat, v_sev, v_sev, v_origin, CASE WHEN v_alive THEN 'iato_ops' ELSE 'humano' END, v_level,
    CASE WHEN v_alive THEN NULL ELSE now() END, v_step, v_due);

  INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
  VALUES (v_id, NULL, 'solicitado', CASE v_origin WHEN 'usuario' THEN 'usuario' WHEN 'equipo' THEN 'equipo' ELSE 'sistema' END,
    CASE WHEN v_origin = 'usuario' THEN v_user END, left('Incidente ' || public._incident_category_label(v_cat) || ' · severidad ' || v_sev, 1000));
  PERFORM public._incident_log(v_id, 'creado', CASE v_origin WHEN 'usuario' THEN 'usuario' WHEN 'iato' THEN 'iato'
      WHEN 'monitor_vuelos' THEN 'monitor' WHEN 'proveedor' THEN 'proveedor' WHEN 'equipo' THEN 'equipo' ELSE 'sistema' END,
    left(v_desc, 4000), jsonb_strip_nulls(jsonb_build_object('categoria', v_cat, 'severidad', v_sev, 'origen', v_origin,
      'assignee', CASE WHEN v_alive THEN 'iato_ops' ELSE 'humano' END)),
    v_channel, CASE WHEN v_origin IN ('usuario','iato','canal') THEN 'entrante' ELSE 'interno' END, NULL, false, NULL, NULL, NULL);
  -- El mensaje del usuario cuenta como respondido por la guía inmediata (si la hubo), que también se anota.
  IF nullif(btrim(coalesce(_input->>'respuesta_inmediata', '')), '') IS NOT NULL THEN
    PERFORM public._incident_log(v_id, 'mensaje', 'iato', left(_input->>'respuesta_inmediata', 4000),
      jsonb_build_object('tipo', 'guia_inmediata'), coalesce(v_channel, 'app'), 'saliente', NULL, true, 'usuario', 'enviado');
  END IF;
  PERFORM public._incident_log(v_id, 'siguiente_paso', 'sistema', v_step, jsonb_build_object('due_at', v_due), NULL, 'interno');

  IF NOT v_alive THEN
    v_alert := public._incident_enqueue_alert(v_id, 1, 'nuevo', 'nuevo',
      CASE WHEN cfg.ai_operator_enabled THEN 'El operador IA no da señales: va directo al equipo humano' ELSE NULL END);
    PERFORM public._incident_log(v_id, 'asignacion', 'sistema',
      CASE WHEN cfg.ai_operator_enabled THEN 'Operador IA sin señales: asignado al equipo humano'
           ELSE 'Operador IA apagado: asignado directo al equipo humano' END,
      jsonb_build_object('assignee', 'humano', 'level', 1), NULL, 'interno');
  ELSIF v_sev = ANY (cfg.notify_on_create) THEN
    v_alert := public._incident_enqueue_alert(v_id, 0, 'nuevo', 'nuevo', 'Lo atiende el operador IA; aviso por severidad');
    PERFORM public._incident_log(v_id, 'asignacion', 'sistema', 'Asignado al operador IA (iato_ops); el equipo humano queda avisado',
      jsonb_build_object('assignee', 'iato_ops', 'level', 0), NULL, 'interno');
  ELSE
    PERFORM public._incident_log(v_id, 'asignacion', 'sistema', 'Asignado al operador IA (iato_ops)',
      jsonb_build_object('assignee', 'iato_ops', 'level', 0), NULL, 'interno');
  END IF;

  RETURN jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'folio', public._incident_folio(v_id), 'severity', v_sev,
    'assignee', CASE WHEN v_alive THEN 'iato_ops' ELSE 'humano' END, 'escalation_level', v_level, 'alert_id', v_alert,
    'next_step', v_step, 'next_step_due_at', v_due, 'trip_id', v_trip);
END $$;

-- incident_add_event(_id, _ev): una línea de bitácora desde el servidor (operador IA, canales, monitores).
-- _ev: kind, actor, body, [data, channel, direction, counterpart, visible_to_user, delivery, dedupe_key,
--      provider_message_id, actor_id]. Con dedupe_key repetida no se duplica (duplicate=true).
CREATE OR REPLACE FUNCTION public.incident_add_event(_id uuid, _ev jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.incidents WHERE request_id = _id) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  BEGIN
    v := public._incident_log(_id, _ev->>'kind', _ev->>'actor', _ev->>'body', coalesce(CASE WHEN jsonb_typeof(_ev->'data') = 'object' THEN _ev->'data' END, '{}'::jsonb),
      _ev->>'channel', _ev->>'direction', CASE WHEN coalesce(_ev->>'actor_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (_ev->>'actor_id')::uuid END,
      coalesce((_ev->>'visible_to_user')::boolean, false), _ev->>'counterpart', _ev->>'delivery', _ev->>'dedupe_key', _ev->>'provider_message_id');
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
  END;
  RETURN jsonb_build_object('ok', true, 'event_id', v, 'duplicate', v IS NULL);
END $$;

-- incident_set_status(_id, _status, _actor, _note, _actor_id)
--   en_proceso  : nueva → en proceso.
--   resuelto    : equipo con nota (≥ 10) → se cierra. Cualquier otro (operador IA, sistema) → NO se cierra:
--                 queda "esperando confirmación" y se le pregunta al usuario "¿quedó resuelto?".
--   no_se_pudo  : solo el equipo (con motivo). El operador IA no puede rendirse: se escala a una persona.
--   cancelado   : el usuario (ya no lo necesita) o el equipo (con nota).
CREATE OR REPLACE FUNCTION public.incident_set_status(_id uuid, _status text, _actor text DEFAULT 'iato_ops', _note text DEFAULT NULL, _actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cr public.concierge_requests; i public.incidents; v_note text := nullif(btrim(left(coalesce(_note, ''), 2000)), ''); v_to text;
BEGIN
  IF _status IS NULL OR _status NOT IN ('en_proceso','resuelto','no_se_pudo','cancelado') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS'); END IF;
  IF _actor IS NULL OR _actor NOT IN ('iato_ops','equipo','sistema','usuario') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); END IF;
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type = 'incidente' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT * INTO i FROM public.incidents WHERE request_id = _id FOR UPDATE;
  IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status, 'to', _status);
  END IF;

  IF _status = 'en_proceso' THEN
    IF cr.status = 'solicitado' THEN
      UPDATE public.concierge_requests SET status = 'pendiente_confirmacion', status_changed_at = now() WHERE id = _id;
      INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
      VALUES (_id, cr.status, 'pendiente_confirmacion', CASE WHEN _actor = 'equipo' THEN 'equipo' ELSE 'sistema' END, _actor_id,
        left(CASE _actor WHEN 'iato_ops' THEN 'Operador IA: en atención' ELSE 'En atención' END || coalesce(' · ' || v_note, ''), 1000));
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'en_proceso');
  END IF;

  IF _status = 'resuelto' THEN
    IF _actor = 'equipo' AND coalesce(length(v_note), 0) >= 10 THEN
      PERFORM set_config('incident.close', 'nota_humana', true);
      UPDATE public.incidents SET resolution_note = v_note WHERE request_id = _id;
      v_to := 'resuelto';
    ELSE
      -- Sin confirmación del usuario no se cierra: se le pregunta.
      UPDATE public.incidents SET resolution_state = 'esperando_confirmacion', resolution_requested_at = now(),
             resolution_note = coalesce(v_note, resolution_note), updated_at = now() WHERE request_id = _id;
      IF cr.status = 'solicitado' THEN
        UPDATE public.concierge_requests SET status = 'pendiente_confirmacion', status_changed_at = now() WHERE id = _id;
        INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
        VALUES (_id, cr.status, 'pendiente_confirmacion', 'sistema', _actor_id, 'Propuesto como resuelto: falta la confirmación del usuario');
      END IF;
      PERFORM public._incident_log(_id, 'confirmacion', CASE WHEN _actor = 'usuario' THEN 'sistema' ELSE _actor END,
        left('Propuesto como resuelto; se pregunta al usuario si quedó resuelto' || coalesce(' · ' || v_note, ''), 4000),
        jsonb_build_object('resolution_state', 'esperando_confirmacion'), NULL, 'interno', _actor_id);
      PERFORM public.notify_once(cr.user_id, 'team_request', '¿Quedó resuelto tu caso?',
        left(coalesce(v_note || ' · ', '') || 'Dinos en Concierge › Mis solicitudes si ya quedó resuelto o si sigue el problema.', 300),
        _id, 'incident_confirm:' || _id || ':' || (i.reopen_count)::text);
      RETURN jsonb_build_object('ok', true, 'status', 'esperando_confirmacion', 'closed', false);
    END IF;
  ELSIF _status = 'no_se_pudo' THEN
    IF _actor <> 'equipo' THEN
      PERFORM public._incident_escalate(_id, greatest(i.escalation_level, 1), 'necesita_humano',
        coalesce(v_note, 'El operador no pudo resolverlo'), now(), CASE WHEN _actor = 'usuario' THEN 'sistema' ELSE _actor END, _actor_id,
        'humano:' || (SELECT count(*) FROM public.incident_alerts a WHERE a.request_id = _id)::text);
      RETURN jsonb_build_object('ok', true, 'status', 'escalado', 'code', 'HUMAN_REQUIRED');
    END IF;
    IF coalesce(length(v_note), 0) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED'); END IF;
    v_to := 'rechazado';
  ELSE -- cancelado
    IF _actor NOT IN ('usuario','equipo') THEN RETURN jsonb_build_object('ok', false, 'code', 'HUMAN_REQUIRED'); END IF;
    IF _actor = 'equipo' AND coalesce(length(v_note), 0) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED'); END IF;
    v_to := 'cancelado';
  END IF;

  UPDATE public.concierge_requests SET status = v_to, status_changed_at = now(),
         owner_admin_id = CASE WHEN _actor = 'equipo' THEN coalesce(owner_admin_id, _actor_id) ELSE owner_admin_id END
   WHERE id = _id;
  INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
  VALUES (_id, cr.status, v_to, CASE _actor WHEN 'equipo' THEN 'equipo' WHEN 'usuario' THEN 'usuario' ELSE 'sistema' END, _actor_id, left(v_note, 1000));
  RETURN jsonb_build_object('ok', true, 'status', v_to, 'closed', true);
END $$;

-- incident_assign(_id, _assignee, _reason, _admin_id, _actor)
--   'humano'   : el operador (o el sistema) pide a una persona → escala (nivel ≥ 1) y avisa. Con _admin_id: lo toma esa persona.
--   'iato_ops' : el equipo se lo devuelve al operador IA (solo si nadie del equipo lo tomó).
CREATE OR REPLACE FUNCTION public.incident_assign(_id uuid, _assignee text, _reason text DEFAULT NULL, _admin_id uuid DEFAULT NULL, _actor text DEFAULT 'iato_ops')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i public.incidents; cr public.concierge_requests; v_alert uuid;
BEGIN
  IF _assignee IS NULL OR _assignee NOT IN ('humano','iato_ops') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ASSIGNEE'); END IF;
  IF _actor IS NULL OR _actor NOT IN ('iato_ops','equipo','sistema') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); END IF;
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type = 'incidente' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT * INTO i FROM public.incidents WHERE request_id = _id FOR UPDATE;
  IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN RETURN jsonb_build_object('ok', false, 'code', 'CLOSED'); END IF;

  IF _assignee = 'humano' THEN
    IF _admin_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = _admin_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_ADMIN'); END IF;
      UPDATE public.concierge_requests SET owner_admin_id = _admin_id,
             status = CASE WHEN status = 'solicitado' THEN 'pendiente_confirmacion' ELSE status END,
             status_changed_at = CASE WHEN status = 'solicitado' THEN now() ELSE status_changed_at END
       WHERE id = _id;
      IF cr.status = 'solicitado' THEN
        INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
        VALUES (_id, 'solicitado', 'pendiente_confirmacion', 'equipo', _admin_id, left('Tomado' || coalesce(' · ' || _reason, ''), 1000));
      END IF;
      RETURN jsonb_build_object('ok', true, 'assignee', 'humano', 'owner', _admin_id);
    END IF;
    UPDATE public.incidents SET needs_human = true, needs_human_reason = left(coalesce(_reason, needs_human_reason), 500) WHERE request_id = _id;
    v_alert := public._incident_escalate(_id, greatest(i.escalation_level, 1), 'necesita_humano', left(_reason, 500), now(), _actor, NULL,
      'humano:' || (SELECT count(*) FROM public.incident_alerts a WHERE a.request_id = _id)::text);
    RETURN jsonb_build_object('ok', true, 'assignee', 'humano', 'alert_id', v_alert, 'escalation_level', greatest(i.escalation_level, 1));
  END IF;

  IF cr.owner_admin_id IS NOT NULL OR i.taken_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'TAKEN_BY_HUMAN'); END IF;
  UPDATE public.incidents SET assignee = 'iato_ops', needs_human = false, needs_human_reason = NULL, escalation_level = 0,
         escalated_at = NULL, last_progress_at = now(), updated_at = now() WHERE request_id = _id;
  PERFORM public._incident_log(_id, 'asignacion', _actor, left('Devuelto al operador IA' || coalesce(' · ' || _reason, ''), 1000),
    jsonb_build_object('assignee', 'iato_ops'), NULL, 'interno');
  RETURN jsonb_build_object('ok', true, 'assignee', 'iato_ops');
END $$;

-- Siguiente paso visible para el usuario con la hora prometida (si vence, alerta el vigilante).
CREATE OR REPLACE FUNCTION public.incident_set_next_step(_id uuid, _text text, _due timestamptz, _actor text DEFAULT 'iato_ops', _actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v text := nullif(btrim(left(coalesce(_text, ''), 300)), '');
BEGIN
  IF v IS NULL OR length(v) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'TEXT_REQUIRED'); END IF;
  IF _due IS NULL OR _due < now() - interval '1 minute' OR _due > now() + interval '30 days' THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_DUE'); END IF;
  IF _actor IS NULL OR _actor NOT IN ('iato_ops','equipo','sistema') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); END IF;
  UPDATE public.incidents SET next_step = v, next_step_due_at = _due, next_step_alerted_at = NULL, updated_at = now() WHERE request_id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  PERFORM public._incident_log(_id, 'siguiente_paso', _actor, v, jsonb_build_object('due_at', _due), NULL, 'interno', _actor_id);
  RETURN jsonb_build_object('ok', true, 'next_step', v, 'next_step_due_at', _due);
END $$;

-- Latido del operador IA (lo manda su bucle). Sin latido reciente el vigilante lo da por caído.
CREATE OR REPLACE FUNCTION public.incident_operator_heartbeat()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.incident_config SET ai_operator_heartbeat_at = now() WHERE id RETURNING jsonb_build_object('ok', true, 'at', ai_operator_heartbeat_at, 'enabled', ai_operator_enabled);
$$;

-- ───────────────────────────── 7. Vigilante ─────────────────────────────
-- Revisa los incidentes abiertos y encola avisos (sin duplicados). No manda nada: el servidor reparte los avisos.
CREATE OR REPLACE FUNCTION public.incident_watch(_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg public.incident_config := public._incident_cfg(); v_alive boolean := coalesce(public._incident_operator_alive(_now), false);
  r record; v_take int; v_reply int; v_esc int := 0; v_alerts int := 0; v_a uuid; v_did boolean; m record;
BEGIN
  FOR r IN SELECT i.*, cr.status AS cr_status, cr.owner_admin_id
             FROM public.incidents i JOIN public.concierge_requests cr ON cr.id = i.request_id
            WHERE cr.status IN ('solicitado','pendiente_confirmacion') AND i.resolved_at IS NULL
            ORDER BY public._incident_sev_rank(i.severity) DESC, i.received_at
            FOR UPDATE OF i SKIP LOCKED
  LOOP
    v_take := public._incident_minutes(cfg.take_minutes, r.severity, 60);
    v_reply := public._incident_minutes(cfg.reply_minutes, r.severity, 30);
    v_did := false;

    IF r.resolution_state = 'esperando_confirmacion' THEN
      -- El usuario no contesta "¿quedó resuelto?": una persona tiene que cerrarlo con nota o volver a contactarlo.
      IF r.resolution_requested_at <= _now - make_interval(hours => cfg.confirm_wait_hours) THEN
        v_a := public._incident_enqueue_alert(r.request_id, greatest(r.escalation_level, 1), 'confirmacion_pendiente',
          'conf:' || floor(extract(epoch FROM r.resolution_requested_at))::bigint, 'El usuario no ha confirmado si quedó resuelto');
        IF v_a IS NOT NULL THEN v_alerts := v_alerts + 1; END IF;
      END IF;
    ELSIF r.assignee = 'iato_ops' AND r.escalation_level = 0 THEN
      IF NOT v_alive THEN
        PERFORM public._incident_escalate(r.request_id, 1, 'operador_caido', NULL, _now); v_esc := v_esc + 1; v_did := true;
      ELSIF r.needs_human OR r.last_progress_at <= _now - make_interval(mins => v_take) THEN
        PERFORM public._incident_escalate(r.request_id, 1, 'sin_avance', NULL, _now); v_esc := v_esc + 1; v_did := true;
      END IF;
    ELSIF r.taken_at IS NULL AND r.owner_admin_id IS NULL THEN
      -- Nadie del equipo lo ha tomado: cada v_take minutos se sube un nivel (nivel 2 = primario + respaldo) y se re-avisa.
      IF coalesce(r.escalated_at, r.received_at) <= _now - make_interval(mins => v_take) AND r.escalation_level < 2 + cfg.max_realerts THEN
        PERFORM public._incident_escalate(r.request_id, r.escalation_level + 1, 'sin_tomar', NULL, _now); v_esc := v_esc + 1; v_did := true;
      END IF;
    ELSIF r.last_progress_at <= _now - make_interval(mins => 2 * v_take) THEN
      -- Lo tomó una persona pero no hay avance: se le recuerda (y al respaldo).
      v_a := public._incident_enqueue_alert(r.request_id, greatest(r.escalation_level, 2), 'sin_avance',
        'humano_sin_avance:' || floor(extract(epoch FROM r.last_progress_at))::bigint, 'Lo tomó una persona pero no hay avance');
      IF v_a IS NOT NULL THEN v_alerts := v_alerts + 1; v_did := true; END IF;
    END IF;

    -- Mensaje del usuario sin respuesta.
    SELECT e.id, e.at INTO m FROM public.incident_events e
     WHERE e.request_id = r.request_id AND e.direction = 'entrante' AND e.actor = 'usuario'
       AND NOT EXISTS (SELECT 1 FROM public.incident_events s WHERE s.request_id = e.request_id AND s.direction = 'saliente'
                         AND s.visible_to_user AND s.at >= e.at)
     ORDER BY e.at DESC, e.id DESC LIMIT 1;
    IF FOUND AND m.at <= _now - make_interval(mins => v_reply) THEN
      v_a := public._incident_enqueue_alert(r.request_id, greatest(r.escalation_level, 1), 'mensaje_sin_respuesta', 'msg:' || m.id,
        'Mensaje del usuario sin respuesta');
      IF v_a IS NOT NULL THEN
        v_alerts := v_alerts + 1;
        PERFORM public._incident_log(r.request_id, 'alerta', 'sistema', 'Mensaje del usuario sin respuesta: se avisa al equipo',
          jsonb_build_object('event_id', m.id, 'alert_id', v_a), NULL, 'interno', NULL, false, NULL, NULL, NULL, NULL, _now);
      END IF;
    END IF;

    -- Hora prometida vencida (si en esta vuelta no hubo ya un escalamiento que avise).
    IF r.resolution_state IS DISTINCT FROM 'esperando_confirmacion' AND r.next_step_due_at IS NOT NULL AND r.next_step_due_at <= _now
       AND (r.next_step_alerted_at IS NULL OR r.next_step_alerted_at < r.next_step_due_at) THEN
      UPDATE public.incidents SET next_step_alerted_at = _now WHERE request_id = r.request_id;
      IF NOT v_did THEN
        v_a := public._incident_enqueue_alert(r.request_id, greatest(r.escalation_level, 1), 'promesa_vencida',
          'promesa:' || floor(extract(epoch FROM r.next_step_due_at))::bigint, left('Venció la hora prometida: ' || coalesce(r.next_step, ''), 500));
        IF v_a IS NOT NULL THEN v_alerts := v_alerts + 1; END IF;
      END IF;
      PERFORM public._incident_log(r.request_id, 'alerta', 'sistema', left('Venció la hora prometida: ' || coalesce(r.next_step, ''), 1000),
        jsonb_build_object('due_at', r.next_step_due_at), NULL, 'interno', NULL, false, NULL, NULL, NULL, NULL, _now);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'escalated', v_esc, 'alerts', v_alerts, 'operator_alive', v_alive,
    'pending_alerts', (SELECT count(*) FROM public.incident_alerts WHERE status IN ('pendiente','fallido') AND attempts < 5));
END $$;

-- ───────────────────────────── 8. Reparto de avisos (servidor) ─────────────────────────────
-- Reclama avisos pendientes (o los de un incidente). Cada uno trae el incidente (como la mesa) y a quién avisar.
CREATE OR REPLACE FUNCTION public.incident_alerts_claim(_fallback text[] DEFAULT NULL, _limit int DEFAULT 20, _request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR a IN SELECT * FROM public.incident_alerts
            WHERE status IN ('pendiente','fallido') AND attempts < 5
              AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
              AND created_at > now() - interval '3 days'
              AND (_request_id IS NULL OR request_id = _request_id)
            ORDER BY created_at LIMIT greatest(1, least(coalesce(_limit, 20), 100))
            FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.incident_alerts SET claimed_at = now(), attempts = attempts + 1 WHERE id = a.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'alert', jsonb_build_object('id', a.id, 'level', a.level, 'reason', a.reason, 'note', a.note, 'created_at', a.created_at, 'attempt', a.attempts + 1),
      'item', public._ops_request_json(a.request_id),
      'recipients', public.incident_oncall_now(a.level, _fallback)));
  END LOOP;
  RETURN v_out;
END $$;

-- Resultado del reparto: marca el aviso y lo anota en la bitácora (a quién, por qué canal, qué falló).
CREATE OR REPLACE FUNCTION public.incident_alert_finish(_alert_id uuid, _ok boolean, _result jsonb DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.incident_alerts;
BEGIN
  UPDATE public.incident_alerts
     SET status = CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END, sent_at = CASE WHEN _ok THEN now() ELSE sent_at END,
         error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'error'), 300) END, result = _result, claimed_at = NULL
   WHERE id = _alert_id AND status <> 'enviado'
  RETURNING * INTO a;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND_OR_SENT'); END IF;
  IF _ok THEN
    UPDATE public.incidents SET last_alert_at = now(), alerts_count = alerts_count + 1 WHERE request_id = a.request_id;
  END IF;
  PERFORM public._incident_log(a.request_id, 'alerta', 'sistema',
    left(CASE WHEN _ok THEN 'Aviso al equipo enviado' ELSE 'Aviso al equipo falló (se reintenta)' END || ' · ' || a.reason || ' · nivel ' || a.level
      || coalesce(' · ' || _error, ''), 1000),
    jsonb_strip_nulls(jsonb_build_object('alert_id', a.id, 'reason', a.reason, 'level', a.level, 'result', _result)),
    NULL, 'saliente', NULL, false, 'equipo', CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END);
  RETURN jsonb_build_object('ok', true, 'status', a.status);
END $$;

-- ───────────────────────────── 9. Disparadores: la mesa y las respuestas alimentan los tiempos ─────────────────────────────
-- No se cierra sin confirmación del usuario o nota humana (admin_incident_resolve / my_incident_confirm marcan la vía).
CREATE OR REPLACE FUNCTION public.incident_close_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'incidente' AND NEW.status = 'resuelto' AND OLD.status IS DISTINCT FROM 'resuelto'
     AND coalesce(current_setting('incident.close', true), '') NOT IN ('usuario','nota_humana') THEN
    RAISE EXCEPTION 'INCIDENT_NEEDS_CONFIRMATION: un incidente se cierra con la confirmación del usuario o con una nota del equipo'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS incident_close_guard ON public.concierge_requests;
CREATE TRIGGER incident_close_guard BEFORE UPDATE OF status ON public.concierge_requests
  FOR EACH ROW WHEN (NEW.type = 'incidente') EXECUTE FUNCTION public.incident_close_guard();

-- Tomar (responsable), cambios de estado y cierre → incidents + bitácora.
CREATE OR REPLACE FUNCTION public.incident_request_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_close text := coalesce(current_setting('incident.close', true), '');
BEGIN
  IF NEW.owner_admin_id IS NOT NULL AND NEW.owner_admin_id IS DISTINCT FROM OLD.owner_admin_id THEN
    UPDATE public.incidents SET taken_at = coalesce(taken_at, now()), taken_by = NEW.owner_admin_id, assignee = 'humano',
           last_progress_at = now(), updated_at = now() WHERE request_id = NEW.id;
    PERFORM public._incident_log(NEW.id, 'asignacion', 'equipo',
      left('Lo toma ' || coalesce(public._ops_person(NEW.owner_admin_id)->>'name', public._ops_person(NEW.owner_admin_id)->>'email', 'el equipo'), 1000),
      jsonb_build_object('assignee', 'humano', 'owner', NEW.owner_admin_id), 'mesa', 'interno', NEW.owner_admin_id);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public._incident_log(NEW.id, 'estado', CASE WHEN v_close = 'usuario' THEN 'usuario' WHEN NEW.owner_admin_id IS NOT NULL THEN 'equipo' ELSE 'sistema' END,
      left(OLD.status || ' → ' || NEW.status, 1000), jsonb_build_object('from', OLD.status, 'to', NEW.status), NULL, 'interno',
      CASE WHEN v_close <> 'usuario' THEN NEW.owner_admin_id END);
    IF NEW.status IN ('resuelto','rechazado','cancelado') THEN
      UPDATE public.incidents
         SET resolved_at = now(), updated_at = now(),
             closed_by = CASE WHEN v_close = 'usuario' OR (NEW.status = 'cancelado' AND NEW.owner_admin_id IS NULL) THEN 'usuario'
                              WHEN NEW.owner_admin_id IS NOT NULL OR v_close = 'nota_humana' THEN 'equipo' ELSE 'sistema' END,
             resolution_state = CASE WHEN NEW.status <> 'resuelto' THEN resolution_state
                                     WHEN v_close = 'usuario' THEN 'confirmado_usuario' ELSE 'nota_humana' END,
             user_confirmed_at = CASE WHEN v_close = 'usuario' THEN now() ELSE user_confirmed_at END,
             last_progress_at = now()
       WHERE request_id = NEW.id;
      -- Lo que quede pendiente de avisar ya no aplica.
      UPDATE public.incident_alerts SET status = 'descartado' WHERE request_id = NEW.id AND status IN ('pendiente','fallido');
    ELSIF OLD.status IN ('resuelto','rechazado','cancelado') THEN
      UPDATE public.incidents SET resolved_at = NULL, closed_by = NULL, updated_at = now() WHERE request_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS incident_request_sync ON public.concierge_requests;
CREATE TRIGGER incident_request_sync AFTER UPDATE OF status, owner_admin_id ON public.concierge_requests
  FOR EACH ROW WHEN (NEW.type = 'incidente') EXECUTE FUNCTION public.incident_request_sync();

-- Respuesta del equipo (admin_ops_act) → bitácora como mensaje al usuario; la nota al resolver queda como nota de resolución.
CREATE OR REPLACE FUNCTION public.incident_reply_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source = 'concierge_request' AND EXISTS (SELECT 1 FROM public.incidents WHERE request_id = NEW.source_id) THEN
    PERFORM public._incident_log(NEW.source_id, 'mensaje', 'equipo', NEW.body,
      jsonb_build_object('reply_id', NEW.id, 'kind', NEW.kind), 'app', 'saliente', NEW.admin_id, true, 'usuario', 'enviado', 'reply:' || NEW.id);
    IF NEW.kind = 'resuelta' THEN
      UPDATE public.incidents SET resolution_note = left(NEW.body, 2000) WHERE request_id = NEW.source_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS incident_reply_sync ON public.team_request_replies;
CREATE TRIGGER incident_reply_sync AFTER INSERT ON public.team_request_replies
  FOR EACH ROW EXECUTE FUNCTION public.incident_reply_sync();

-- Bitácora → tiempos: primera respuesta (cualquiera), primera respuesta humana y último avance.
CREATE OR REPLACE FUNCTION public.incident_event_times()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.incidents
     SET first_response_at = CASE WHEN NEW.direction = 'saliente' AND NEW.visible_to_user AND NEW.kind = 'mensaje'
                                  THEN coalesce(first_response_at, NEW.at) ELSE first_response_at END,
         first_human_response_at = CASE WHEN NEW.direction = 'saliente' AND NEW.visible_to_user AND NEW.kind = 'mensaje' AND NEW.actor = 'equipo'
                                        THEN coalesce(first_human_response_at, NEW.at) ELSE first_human_response_at END,
         last_progress_at = CASE WHEN NEW.actor IN ('iato_ops','equipo') AND NEW.direction IS DISTINCT FROM 'entrante'
                                   AND NEW.kind IN ('mensaje','accion','decision','estado','asignacion','siguiente_paso','confirmacion')
                                 THEN greatest(last_progress_at, NEW.at) ELSE last_progress_at END,
         updated_at = now()
   WHERE request_id = NEW.request_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS incident_event_times ON public.incident_events;
CREATE TRIGGER incident_event_times AFTER INSERT ON public.incident_events
  FOR EACH ROW EXECUTE FUNCTION public.incident_event_times();

-- ───────────────────────────── 10. Mesa (solo administradores) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_incident_take(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_admin uuid := public._ops_require_admin(); cr public.concierge_requests; v_label text;
BEGIN
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type = 'incidente' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status, 'to', 'pendiente_confirmacion');
  END IF;
  v_label := coalesce(public._ops_person(v_admin)->>'name', public._ops_person(v_admin)->>'email', 'Equipo IATOS');
  UPDATE public.concierge_requests SET owner_admin_id = v_admin, status = 'pendiente_confirmacion',
         status_changed_at = CASE WHEN status = 'solicitado' THEN now() ELSE status_changed_at END WHERE id = _id;
  INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
  VALUES (_id, cr.status, 'pendiente_confirmacion', 'equipo', v_admin, left('Tomado por ' || v_label, 500));
  IF cr.owner_admin_id IS NULL THEN
    PERFORM public.notify_once(cr.user_id, 'team_request', 'Una persona del equipo IATOS ya tiene tu caso',
      left('"' || cr.title || '" está en atención. Verás la respuesta aquí y por correo.', 300), _id, 'incident_take:' || _id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', _id, 'item', public._ops_request_json(_id));
END $$;

-- Escalar a mano: sube un nivel (avisa también al respaldo) y deja el aviso listo para repartir.
CREATE OR REPLACE FUNCTION public.admin_incident_escalate(_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_admin uuid := public._ops_require_admin(); i public.incidents; v_alert uuid; v_lvl int;
BEGIN
  SELECT i2.* INTO i FROM public.incidents i2 JOIN public.concierge_requests cr ON cr.id = i2.request_id
   WHERE i2.request_id = _id AND cr.status IN ('solicitado','pendiente_confirmacion') FOR UPDATE OF i2;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_lvl := greatest(i.escalation_level + 1, 2);
  v_alert := public._incident_escalate(_id, v_lvl, 'manual', nullif(btrim(left(coalesce(_note, ''), 400)), ''), now(), 'equipo', v_admin,
    'manual:' || gen_random_uuid());
  RETURN jsonb_build_object('ok', true, 'id', _id, 'alert_id', v_alert, 'escalation_level', v_lvl, 'item', public._ops_request_json(_id));
END $$;

-- Marcar resuelto con nota de resolución (obligatoria, ≥ 10): la ve el usuario (app + correo vía ops-desk).
CREATE OR REPLACE FUNCTION public.admin_incident_resolve(_id uuid, _note text, _evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_admin uuid := public._ops_require_admin(); v_note text := nullif(btrim(left(coalesce(_note, ''), 2000)), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE id = _id AND type = 'incidente') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF coalesce(length(v_note), 0) < 10 THEN RETURN jsonb_build_object('ok', false, 'code', 'RESOLUTION_NOTE_REQUIRED'); END IF;
  PERFORM set_config('incident.close', 'nota_humana', true);
  RETURN public.admin_ops_act('concierge_request', _id, 'resolver', v_note, _evidence);
END $$;

CREATE OR REPLACE FUNCTION public.admin_incident_next_step(_id uuid, _text text, _due timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_admin uuid := public._ops_require_admin();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.incidents WHERE request_id = _id) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  RETURN public.incident_set_next_step(_id, _text, _due, 'equipo', v_admin);
END $$;

-- Bitácora completa de un incidente (para el humano que lo toma).
CREATE OR REPLACE FUNCTION public.admin_incident_log(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_admin uuid := public._ops_require_admin();
BEGIN
  RETURN jsonb_build_object('incident', public._incident_json(_id), 'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'at', e.at, 'kind', e.kind, 'actor', e.actor, 'by', public._ops_person(e.actor_id), 'channel', e.channel,
      'direction', e.direction, 'counterpart', e.counterpart, 'body', e.body, 'delivery', e.delivery, 'visible_to_user', e.visible_to_user,
      'data', e.data) ORDER BY e.at, e.id) FROM public.incident_events e WHERE e.request_id = _id), '[]'::jsonb),
    'alerts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'level', a.level, 'reason', a.reason, 'status', a.status,
      'attempts', a.attempts, 'created_at', a.created_at, 'sent_at', a.sent_at, 'error', a.error, 'result', a.result) ORDER BY a.created_at)
      FROM public.incident_alerts a WHERE a.request_id = _id), '[]'::jsonb));
END $$;

-- ───────────────────────────── 11. Usuario ─────────────────────────────
-- "¿Quedó resuelto?": sí → se cierra (confirmado por el usuario); no → se reabre, sube de severidad y se avisa.
CREATE OR REPLACE FUNCTION public.my_incident_confirm(_id uuid, _resolved boolean, _comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); cr public.concierge_requests; i public.incidents; v_c text := nullif(btrim(left(coalesce(_comment, ''), 1000)), '');
  v_new text; v_alert uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'my_incident_confirm: sin sesión' USING ERRCODE = '42501'; END IF;
  IF _resolved IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'ANSWER_REQUIRED'); END IF;
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type = 'incidente' AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  SELECT * INTO i FROM public.incidents WHERE request_id = _id FOR UPDATE;
  IF v_c IS NOT NULL THEN
    PERFORM public._incident_log(_id, 'mensaje', 'usuario', v_c, jsonb_build_object('tipo', 'confirmacion'), 'app', 'entrante', v_uid, true, 'equipo', 'recibido');
  END IF;

  IF _resolved THEN
    IF cr.status = 'resuelto' THEN RETURN jsonb_build_object('ok', true, 'unchanged', true); END IF;
    IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN RETURN jsonb_build_object('ok', false, 'code', 'CLOSED'); END IF;
    PERFORM set_config('incident.close', 'usuario', true);
    UPDATE public.concierge_requests SET status = 'resuelto', status_changed_at = now() WHERE id = _id;
    INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
    VALUES (_id, cr.status, 'resuelto', 'usuario', v_uid, 'El usuario confirmó que quedó resuelto');
    PERFORM public._incident_log(_id, 'confirmacion', 'usuario', 'El usuario confirmó que quedó resuelto', '{}'::jsonb, 'app', 'entrante', v_uid);
    -- Su respuesta queda contestada (no es un mensaje que espere respuesta).
    PERFORM public._incident_log(_id, 'mensaje', 'sistema', 'Gracias por confirmarlo. Cerramos tu caso; si vuelve a pasar, aquí mismo lo reabres.',
      '{}'::jsonb, 'app', 'saliente', NULL, true, 'usuario', 'enviado');
    RETURN jsonb_build_object('ok', true, 'status', 'resuelto');
  END IF;

  -- No quedó resuelto: abierto o cerrado hace menos de 7 días → se reabre y sube la severidad.
  IF cr.status IN ('rechazado','cancelado') OR (cr.status = 'resuelto' AND (i.resolved_at IS NULL OR i.resolved_at < now() - interval '7 days')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_OLD');
  END IF;
  v_new := public._incident_sev_up(i.severity);
  UPDATE public.incidents SET severity = v_new, reopen_count = reopen_count + 1, resolution_state = 'rechazado_usuario',
         resolution_requested_at = NULL, updated_at = now() WHERE request_id = _id;
  UPDATE public.concierge_requests SET payload = jsonb_set(payload, '{severidad}', to_jsonb(v_new)),
         status = CASE WHEN status = 'resuelto' THEN 'pendiente_confirmacion' ELSE status END,
         status_changed_at = CASE WHEN status = 'resuelto' THEN now() ELSE status_changed_at END
   WHERE id = _id;
  IF cr.status = 'resuelto' THEN
    INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
    VALUES (_id, 'resuelto', 'pendiente_confirmacion', 'usuario', v_uid, 'El usuario dice que no quedó resuelto: se reabre');
  END IF;
  PERFORM public._incident_log(_id, 'confirmacion', 'usuario', 'El usuario dice que NO quedó resuelto', jsonb_build_object('severity', v_new), 'app', 'entrante', v_uid);
  v_alert := public._incident_escalate(_id, greatest(i.escalation_level, 1) + 1, 'reabierto', coalesce(v_c, 'Sin comentario'), now(), 'sistema', NULL,
    'reabierto:' || (i.reopen_count + 1));
  -- Siguiente paso nuevo con hora (la severidad nueva manda).
  UPDATE public.incidents SET next_step = 'Una persona del equipo IATOS retoma tu caso y te escribe con el siguiente paso',
         next_step_due_at = now() + make_interval(mins => public._incident_minutes((public._incident_cfg()).take_minutes, v_new, 60)),
         next_step_alerted_at = NULL WHERE request_id = _id;
  RETURN jsonb_build_object('ok', true, 'status', 'reabierto', 'severity', v_new, 'alert_id', v_alert);
END $$;

-- Escribirle al equipo sobre su incidente (queda en la bitácora; si nadie contesta a tiempo, el vigilante avisa).
CREATE OR REPLACE FUNCTION public.my_incident_message(_id uuid, _text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v text := nullif(btrim(left(coalesce(_text, ''), 2000)), ''); v_ev bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'my_incident_message: sin sesión' USING ERRCODE = '42501'; END IF;
  IF v IS NULL OR length(v) < 2 THEN RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE id = _id AND type = 'incidente' AND user_id = v_uid
                  AND status IN ('solicitado','pendiente_confirmacion')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF (SELECT count(*) FROM public.incident_events WHERE request_id = _id AND actor = 'usuario' AND direction = 'entrante' AND at > now() - interval '1 hour') >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  v_ev := public._incident_log(_id, 'mensaje', 'usuario', v, '{}'::jsonb, 'app', 'entrante', v_uid, true, 'equipo', 'recibido');
  RETURN jsonb_build_object('ok', true, 'event_id', v_ev);
END $$;

-- ───────────────────────────── 12. Vista canónica sin incidentes ─────────────────────────────
-- Igual que en 20261029060000_opiniones; un incidente no es una reserva (Iato no debe darlo por pendiente de reservar).
CREATE OR REPLACE VIEW public.reservation_state_v WITH (security_invoker = true) AS
SELECT bi.user_id, bi.trip_id, 'booking_intents'::text AS source_table, bi.id AS source_id,
       bi.title, bi.product_type AS kind, bi.state AS raw_status, bi.state AS canonical_state,
       CASE WHEN bi.state = 'CONFIRMED' AND bi.verification = 'provider_verified' THEN 'verificado_proveedor'
            WHEN bi.state = 'CONFIRMED' AND bi.verification = 'team_verified' THEN 'verificado_equipo'
            ELSE 'sin_evidencia' END AS verification,
       CASE WHEN bi.state = 'CONFIRMED' THEN bi.confirmation_evidence->>'source' END AS evidence_source,
       bi.updated_at
  FROM public.booking_intents bi
UNION ALL
SELECT ar.user_id, ar.trip_id, 'ai_reservations', ar.id, ar.venue_name, 'restaurant', ar.status,
       CASE ar.status WHEN 'draft' THEN 'SELECTED' WHEN 'awaiting_user_ok' THEN 'READY_TO_BOOK' WHEN 'sent' THEN 'REQUESTED'
            WHEN 'confirmed' THEN 'CONFIRMED' WHEN 'declined' THEN 'FAILED' WHEN 'failed' THEN 'FAILED'
            WHEN 'cancelled' THEN 'CANCELLED' WHEN 'expired' THEN 'EXPIRED' ELSE 'PENDING_CONFIRMATION' END,
       CASE WHEN ar.status = 'confirmed' AND ar.confirmation->>'channel' = 'venue_email' THEN 'verificado_proveedor'
            WHEN ar.status = 'confirmed' AND ar.confirmation->>'channel' = 'equipo' THEN 'verificado_equipo'
            ELSE 'sin_evidencia' END,
       CASE WHEN ar.status = 'confirmed' THEN ar.confirmation->>'channel' END,
       ar.updated_at
  FROM public.ai_reservations ar
 WHERE NOT EXISTS (SELECT 1 FROM public.booking_intents bi WHERE bi.ai_reservation_id = ar.id)
UNION ALL
SELECT cr.user_id, cr.trip_id, 'concierge_requests', cr.id, cr.title, cr.type, cr.status,
       CASE cr.status
         WHEN 'solicitado' THEN 'REQUESTED' WHEN 'pending' THEN 'REQUESTED'
         WHEN 'confirmado_externamente' THEN CASE WHEN cr.type = 'prive_request' THEN 'CONFIRMED' ELSE 'PENDING_CONFIRMATION' END
         WHEN 'cancelado' THEN 'CANCELLED' WHEN 'cancelled' THEN 'CANCELLED'
         WHEN 'rechazado' THEN 'FAILED' WHEN 'rejected' THEN 'FAILED' WHEN 'failed' THEN 'FAILED'
         WHEN 'caducado' THEN 'EXPIRED' WHEN 'expired' THEN 'EXPIRED'
         ELSE 'PENDING_CONFIRMATION' END,
       CASE WHEN cr.type = 'prive_request' AND cr.status = 'confirmado_externamente' AND cr.external_confirmation IS NOT NULL
            THEN 'verificado_proveedor' ELSE 'sin_evidencia' END,
       CASE WHEN cr.type = 'prive_request' AND cr.status = 'confirmado_externamente' THEN 'prive_request_confirmed' END,
       GREATEST(cr.updated_at, cr.status_changed_at,
                (SELECT max(e.created_at) FROM public.concierge_request_events e WHERE e.request_id = cr.id))
  FROM public.concierge_requests cr
 WHERE cr.type IS DISTINCT FROM 'ai_reservation'
   AND cr.type IS DISTINCT FROM 'opinion'      -- una opinión no es una reserva ni algo que Iato deba dar por pendiente
   AND cr.type IS DISTINCT FROM 'incidente'    -- un incidente tampoco (lo sigue la Mesa y "Mis solicitudes")
   AND NOT EXISTS (SELECT 1 FROM public.booking_intents bi WHERE bi.concierge_request_id = cr.id)
UNION ALL
SELECT fe.user_id, fe.trip_id, 'fixer_escalations', fe.id, coalesce(nullif(btrim(left(fe.motivo, 200)), ''), 'Fixer'), 'fixer', fe.status,
       CASE fe.status WHEN 'email_fallido' THEN 'FAILED' WHEN 'resuelto' THEN 'PENDING_CONFIRMATION' ELSE 'REQUESTED' END,
       'sin_evidencia', NULL::text, fe.created_at
  FROM public.fixer_escalations fe
 WHERE NOT EXISTS (SELECT 1 FROM public.concierge_requests cr WHERE cr.fixer_escalation_id = fe.id);

-- ───────────────────────────── 13. Permisos ─────────────────────────────
-- Las puras (incident_categories, _incident_category_label, _incident_sev_rank, _incident_sev_up, _incident_str_ok,
-- _incident_payload_ok, _incident_minutes, _incident_folio) quedan con el permiso por defecto: el CHECK de
-- concierge_requests las llama con el rol de quien escribe en la tabla.
REVOKE ALL ON FUNCTION public._incident_cfg(), public._incident_operator_alive(timestamptz),
  public._incident_log(uuid, text, text, text, jsonb, text, text, uuid, boolean, text, text, text, text, timestamptz),
  public._incident_enqueue_alert(uuid, int, text, text, text),
  public._incident_escalate(uuid, int, text, text, timestamptz, text, uuid, text),
  public.incident_oncall_now(int, text[], timestamptz), public._incident_json(uuid, timestamptz), public._incident_user_json(uuid),
  public.incident_create(jsonb), public.incident_add_event(uuid, jsonb), public.incident_set_status(uuid, text, text, text, uuid),
  public.incident_assign(uuid, text, text, uuid, text), public.incident_set_next_step(uuid, text, timestamptz, text, uuid),
  public.incident_operator_heartbeat(), public.incident_watch(timestamptz), public.incident_alerts_claim(text[], int, uuid),
  public.incident_alert_finish(uuid, boolean, jsonb, text), public.incident_close_guard(), public.incident_request_sync(),
  public.incident_reply_sync(), public.incident_event_times(),
  public.admin_incident_take(uuid), public.admin_incident_escalate(uuid, text), public.admin_incident_resolve(uuid, text, text),
  public.admin_incident_next_step(uuid, text, timestamptz), public.admin_incident_log(uuid),
  public.my_incident_confirm(uuid, boolean, text), public.my_incident_message(uuid, text)
  FROM PUBLIC, anon, authenticated;
-- Servidor (funciones Edge con la llave de servicio): _shared/incidents.ts y _shared/incident-alerts.ts.
GRANT EXECUTE ON FUNCTION public.incident_create(jsonb), public.incident_add_event(uuid, jsonb), public.incident_set_status(uuid, text, text, text, uuid),
  public.incident_assign(uuid, text, text, uuid, text), public.incident_set_next_step(uuid, text, timestamptz, text, uuid),
  public.incident_operator_heartbeat(), public.incident_watch(timestamptz), public.incident_alerts_claim(text[], int, uuid),
  public.incident_alert_finish(uuid, boolean, jsonb, text), public.incident_oncall_now(int, text[], timestamptz) TO service_role;
-- Mesa: cualquier sesión puede llamarlas, pero adentro exigen public.admins (42501 si no).
GRANT EXECUTE ON FUNCTION public.admin_incident_take(uuid), public.admin_incident_escalate(uuid, text), public.admin_incident_resolve(uuid, text, text),
  public.admin_incident_next_step(uuid, text, timestamptz), public.admin_incident_log(uuid) TO authenticated;
-- Usuario: solo lo suyo (auth.uid()).
GRANT EXECUTE ON FUNCTION public.my_incident_confirm(uuid, boolean, text), public.my_incident_message(uuid, text) TO authenticated;

COMMENT ON TABLE public.incidents IS 'Incidentes: estado operativo 1:1 con concierge_requests type incidente (severidad, asignación operador IA/humano, escalamiento, tiempos, siguiente paso, cierre). Solo el servidor.';
COMMENT ON TABLE public.incident_events IS 'Bitácora de cada incidente: mensajes por cualquier canal, acciones, decisiones, estados, escalamientos y avisos, con hora.';
COMMENT ON TABLE public.incident_alerts IS 'Cola de avisos al equipo humano por incidente (sin duplicados por clave; reintento hasta 5).';
COMMENT ON TABLE public.incident_config IS 'Tiempos de escalamiento y respuesta por severidad y estado del operador IA (prendido + latido).';
COMMENT ON TABLE public.incident_oncall IS 'Guardia de incidentes: quién atiende (primario/respaldo), horario, zona horaria y canales. Vacía = FIXER_EMAIL.';
