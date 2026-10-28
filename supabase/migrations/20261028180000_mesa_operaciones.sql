-- Mesa de operaciones (28-oct-2026). Problema real: las solicitudes que Iato pasa a una persona
-- (concierge_requests: reservation, transport, pickup, alert, fixer_request, booking_assist, Privé…)
-- y las reservas IA que se atoran (ai_reservations en needs_user / venue_replied) no las atendía
-- nadie: no había pantalla del equipo y el correo al dueño podía fallar sin dejar rastro.
--
-- Qué agrega (lo mínimo; reutiliza lo que ya existe):
--   1. concierge_requests.owner_alert_*: marca del correo al dueño (FIXER_EMAIL). concierge-action
--      la reclama antes de enviar (sin duplicados) y la cierra al terminar; si falló, health-check la
--      reintenta. Las filas que ya existían quedan en NULL: no se reenvía nada viejo.
--   2. team_request_replies: lo que el equipo le responde al usuario (lo ve en la app) y el estado del
--      correo que se le manda (marca de enviado + reintento). El usuario lee SOLO las suyas (RLS).
--   3. Funciones del equipo (SECURITY DEFINER, exigen public.admins como admin_metrics):
--        admin_ops_list(_stage)  lista unificada, más reciente primero;
--        admin_ops_act(...)      Tomar / Responder / Marcar resuelta / No se pudo.
--      Las solicitudes Privé cambian SOLO con prive_request_transition y las reservas IA SOLO con
--      ai_reservation_transition (nunca escritura directa). Las demás solicitudes usan el ciclo en
--      español que ya define concierge_request_status_ok (20261028010000): solicitado →
--      pendiente_confirmacion (en proceso) → resuelto | rechazado. Cada paso queda en el historial
--      que ya existe (concierge_request_events con actor_id; ai_reservation_events con el admin en data).
--   4. my_team_requests(): lo que el usuario ve de sus solicitudes (estado real, respuestas, historial).
--   5. Funciones de servicio para los correos (solo service_role): reclamar / terminar / pendientes.
-- Idempotente.

-- ───────────────────────────── 1. Aviso al dueño: marca de enviado ─────────────────────────────
ALTER TABLE public.concierge_requests
  ADD COLUMN IF NOT EXISTS owner_alert_status text,
  ADD COLUMN IF NOT EXISTS owner_alert_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_alert_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_alert_email_id text,
  ADD COLUMN IF NOT EXISTS owner_alert_error text;
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS concierge_requests_owner_alert_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_requests_owner_alert_ok CHECK (
  (owner_alert_status IS NULL OR owner_alert_status IN ('pendiente','enviado','fallido'))
  AND (owner_alert_error IS NULL OR length(owner_alert_error) <= 300)
  AND (owner_alert_email_id IS NULL OR length(owner_alert_email_id) <= 200));
CREATE INDEX IF NOT EXISTS concierge_requests_owner_alert_due ON public.concierge_requests (created_at)
  WHERE owner_alert_status IN ('pendiente','fallido');
CREATE INDEX IF NOT EXISTS concierge_requests_ops_recent ON public.concierge_requests (created_at DESC);

-- ───────────────────────────── 2. Respuestas del equipo al usuario ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_request_replies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text NOT NULL CHECK (source IN ('concierge_request','ai_reservation')),
  source_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  admin_id         uuid,
  kind             text NOT NULL CHECK (kind IN ('respuesta','resuelta','no_se_pudo')),
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 2000),
  evidence         text CHECK (evidence IS NULL OR length(evidence) <= 500),
  email_status     text NOT NULL DEFAULT 'pendiente' CHECK (email_status IN ('pendiente','enviado','fallido','sin_correo')),
  email_attempts   int NOT NULL DEFAULT 0,
  email_claimed_at timestamptz,
  email_sent_at    timestamptz,
  email_id         text CHECK (email_id IS NULL OR length(email_id) <= 200),
  email_error      text CHECK (email_error IS NULL OR length(email_error) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_request_replies_source ON public.team_request_replies (source, source_id, created_at);
CREATE INDEX IF NOT EXISTS team_request_replies_user ON public.team_request_replies (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_request_replies_email_due ON public.team_request_replies (created_at)
  WHERE email_status IN ('pendiente','fallido');
ALTER TABLE public.team_request_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_request_replies_owner_read ON public.team_request_replies;
CREATE POLICY team_request_replies_owner_read ON public.team_request_replies FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON public.team_request_replies FROM PUBLIC, anon, authenticated;
-- El usuario lee lo suyo (sin quién del equipo ni errores del proveedor de correo); nadie escribe
-- desde el cliente: solo admin_ops_act.
GRANT SELECT (id, source, source_id, user_id, kind, body, evidence, email_status, created_at)
  ON public.team_request_replies TO authenticated;
GRANT ALL ON public.team_request_replies TO service_role;

-- ───────────────────────────── 3. Utilidades internas ─────────────────────────────
-- Etapa unificada de la mesa: nueva | en_proceso | resuelta | no_se_pudo | cancelada | vencida.
CREATE OR REPLACE FUNCTION public.ops_stage(_source text, _type text, _status text, _taken boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _source = 'ai_reservation' THEN CASE
      WHEN _status = 'confirmed' THEN 'resuelta'
      WHEN _status IN ('declined','failed') THEN 'no_se_pudo'
      WHEN _status = 'cancelled' THEN 'cancelada'
      WHEN _status = 'expired' THEN 'vencida'
      WHEN coalesce(_taken, false) THEN 'en_proceso'
      ELSE 'nueva' END
    WHEN _type = 'prive_request' THEN CASE _status
      WHEN 'solicitado' THEN 'nueva' WHEN 'pendiente_confirmacion' THEN 'en_proceso'
      WHEN 'confirmado_externamente' THEN 'resuelta' WHEN 'rechazado' THEN 'no_se_pudo'
      WHEN 'cancelado' THEN 'cancelada' WHEN 'caducado' THEN 'vencida' ELSE 'nueva' END
    ELSE CASE
      WHEN _status IN ('solicitado','pending') THEN 'nueva'
      WHEN _status IN ('resuelto','confirmed') THEN 'resuelta'
      WHEN _status IN ('rechazado','rejected','failed','declined') THEN 'no_se_pudo'
      WHEN _status IN ('cancelado','cancelled') THEN 'cancelada'
      WHEN _status IN ('caducado','expired') THEN 'vencida'
      ELSE 'en_proceso' END
  END;
$$;

-- Persona (nombre y correo) para mostrar quién pidió o quién del equipo actuó.
CREATE OR REPLACE FUNCTION public._ops_person(_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', _id,
    'name', (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = _id),
    'email', coalesce((SELECT u.email FROM auth.users u WHERE u.id = _id), (SELECT p.email FROM public.profiles p WHERE p.id = _id))) END;
$$;

-- Exige que quien llama esté en public.admins (mismo criterio que admin_metrics y admin_prive_requests).
-- Dentro de SECURITY DEFINER se decide con auth.uid(), nunca con current_user.
CREATE OR REPLACE FUNCTION public._ops_require_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid := auth.uid();
BEGIN
  IF v IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = v) THEN
    RAISE EXCEPTION 'mesa de operaciones: solo administradores' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END $$;

-- Número pequeño de un texto ("4" → 4); cualquier otra cosa → NULL (sin errores de conversión).
CREATE OR REPLACE FUNCTION public._ops_small_int(_v text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(_v, '')) ~ '^\d{1,3}$' THEN btrim(_v)::int END;
$$;

-- Fecha/hora pedida en texto, de la columna o del payload (Iato manda fecha + hora; la app requested_for).
CREATE OR REPLACE FUNCTION public._ops_requested_text(_col timestamptz, _p jsonb)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    to_char(_col AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
    nullif(_p->>'requested_for', ''),
    CASE WHEN coalesce(_p->>'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$'
         THEN (_p->>'fecha') || CASE WHEN coalesce(_p->>'hora', '') ~ '^\d{1,2}:\d{2}$' THEN 'T' || lpad(_p->>'hora', 5, '0') ELSE '' END END);
$$;

-- Lo que la mesa y el correo necesitan de una solicitud de concierge_requests (sin JSON crudo en la UI).
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
  FROM public.concierge_requests cr
  LEFT JOIN public.prive_experiences x ON x.id = cr.experience_id
  LEFT JOIN public.prive_destinations d ON d.id = x.destination_id
  LEFT JOIN public.trips t ON t.id = cr.trip_id
  WHERE cr.id = _id;
$$;

-- Reservas IA que necesitan a una persona: el restaurante respondió algo que no se pudo verificar
-- (venue_replied) o falta algo (needs_user: sin correo del lugar, pide pago, más datos, otro horario).
-- Una vez que el equipo las tocó, siguen en la mesa aunque cambien de estado.
CREATE OR REPLACE FUNCTION public._ops_ai_needs_team(_r public.ai_reservations)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _r.status IN ('venue_replied','needs_user')
      OR EXISTS (SELECT 1 FROM public.ai_reservation_events e WHERE e.reservation_id = _r.id AND e.kind = 'note' AND e.data ? 'mesa')
      OR EXISTS (SELECT 1 FROM public.team_request_replies q WHERE q.source = 'ai_reservation' AND q.source_id = _r.id);
$$;

CREATE OR REPLACE FUNCTION public._ops_ai_owner(_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT nullif(e.data->>'admin_id', '')::uuid FROM public.ai_reservation_events e
   WHERE e.reservation_id = _id AND e.kind = 'note' AND e.data ? 'mesa' AND (e.data->>'admin_id') ~ '^[0-9a-f-]{36}$'
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._ops_ai_json(_r public.ai_reservations)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'source', 'ai_reservation', 'id', _r.id, 'type', 'ai_reservation', 'title', 'Reserva IA · ' || _r.venue_name, 'status', _r.status,
    'stage', public.ops_stage('ai_reservation', 'ai_reservation', _r.status, public._ops_ai_owner(_r.id) IS NOT NULL),
    'reason', _r.reason, 'ref_code', _r.ref_code,
    'created_at', _r.created_at, 'updated_at', _r.updated_at,
    'requested_for', _r.requested_local, 'party_size', _r.party_size,
    'place', _r.venue_name,
    'experience', jsonb_build_object('name', _r.venue_name, 'city', _r.venue_city, 'country', _r.venue_country, 'timezone', _r.venue_timezone,
      'source_url', coalesce(_r.venue_website, _r.venue_booking_url, _r.venue_maps_url)),
    'venue', jsonb_build_object('email', _r.venue_email, 'phone', _r.venue_phone, 'address', _r.venue_address,
      'reply_excerpt', _r.venue_reply_excerpt),
    'preferences', _r.notes, 'contact_method', NULL, 'payload', NULL,
    'trip', (SELECT jsonb_build_object('id', t.id, 'destino', t.destino, 'fecha_salida', t.fecha_salida, 'fecha_regreso', t.fecha_regreso)
               FROM public.trips t WHERE t.id = _r.trip_id),
    'user', public._ops_person(_r.user_id) || jsonb_build_object('customer_name', _r.customer_name, 'customer_email', _r.customer_email,
      'customer_phone', _r.customer_phone),
    'owner', public._ops_person(public._ops_ai_owner(_r.id)),
    'evidence', _r.confirmation,
    'alert', NULL);
$$;

CREATE OR REPLACE FUNCTION public._ops_replies(_source text, _id uuid, _for_team boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('id', q.id, 'kind', q.kind, 'body', q.body, 'evidence', q.evidence, 'at', q.created_at)
    || CASE WHEN _for_team THEN jsonb_build_object('admin', public._ops_person(q.admin_id), 'email_status', q.email_status,
         'email_error', q.email_error, 'email_attempts', q.email_attempts) ELSE '{}'::jsonb END
    ORDER BY q.created_at), '[]'::jsonb)
  FROM public.team_request_replies q WHERE q.source = _source AND q.source_id = _id;
$$;

-- Historial (quién, cuándo, de qué estado a cuál). Al usuario no se le dice quién del equipo.
CREATE OR REPLACE FUNCTION public._ops_history(_source text, _id uuid, _for_team boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _source = 'concierge_request' THEN
    (SELECT coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor)
       || CASE WHEN _for_team THEN jsonb_build_object('by', public._ops_person(e.actor_id), 'note', e.note) ELSE '{}'::jsonb END
       ORDER BY e.created_at, e.id), '[]'::jsonb)
       FROM public.concierge_request_events e WHERE e.request_id = _id)
  ELSE
    (SELECT coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor,
         'kind', e.kind, 'action', e.data->>'mesa')
       || CASE WHEN _for_team THEN jsonb_build_object('by', public._ops_person(nullif(e.data->>'admin_id', '')::uuid), 'note', e.note) ELSE '{}'::jsonb END
       ORDER BY e.created_at, e.id), '[]'::jsonb)
       FROM public.ai_reservation_events e
      WHERE e.reservation_id = _id AND (e.kind = 'transition' OR (e.kind = 'note' AND e.data ? 'mesa')))
  END;
$$;

-- ───────────────────────────── 4. Mesa: lista unificada ─────────────────────────────
-- _stage: NULL (todas), 'abiertas' (nueva + en_proceso) o una etapa. Más reciente primero. Trae los
-- conteos por etapa (de todo, sin filtro) para los botones de la pantalla.
CREATE OR REPLACE FUNCTION public.admin_ops_list(_stage text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_items jsonb;
BEGIN
  PERFORM public._ops_require_admin();
  WITH base AS (
    SELECT public._ops_request_json(cr.id) || jsonb_build_object(
             'history', public._ops_history('concierge_request', cr.id, true),
             'replies', public._ops_replies('concierge_request', cr.id, true)) AS j, cr.created_at
      FROM public.concierge_requests cr
     WHERE cr.type IS DISTINCT FROM 'ai_reservation'      -- el espejo de una reserva IA se muestra como reserva IA
       AND cr.created_at > now() - interval '180 days'
    UNION ALL
    SELECT public._ops_ai_json(ar) || jsonb_build_object(
             'history', public._ops_history('ai_reservation', ar.id, true),
             'replies', public._ops_replies('ai_reservation', ar.id, true)), ar.created_at
      FROM public.ai_reservations ar
     WHERE public._ops_ai_needs_team(ar) AND ar.created_at > now() - interval '180 days'
  ), ranked AS (
    SELECT j, created_at FROM base ORDER BY created_at DESC LIMIT 500
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'counts', coalesce((SELECT jsonb_object_agg(s, n) FROM (SELECT j->>'stage' AS s, count(*) AS n FROM ranked GROUP BY 1) c), '{}'::jsonb),
    'items', coalesce((SELECT jsonb_agg(j ORDER BY created_at DESC) FROM ranked
       WHERE _stage IS NULL OR (_stage = 'abiertas' AND j->>'stage' IN ('nueva','en_proceso')) OR j->>'stage' = _stage), '[]'::jsonb))
  INTO v_items;
  RETURN v_items;
END $$;

-- ───────────────────────────── 5. Mesa: acciones ─────────────────────────────
-- _action: tomar | responder | resolver | no_se_pudo.
--   tomar       → en proceso y responsable = quien la toma (Privé: prive_request_transition; reserva IA:
--                 sin cambio de estado, queda anotado en su historial).
--   responder   → mensaje para el usuario (app + correo). No cambia el estado.
--   resolver    → resuelta. Evidencia opcional (número de confirmación, enlace); OBLIGATORIA en Privé y en
--                 reservas IA porque ahí "resuelta" crea la reserva confirmada (los CHECK de cada tabla).
--   no_se_pudo  → con motivo (obligatorio), que también se le dice al usuario.
-- Devuelve reply_id cuando hay que mandarle un correo al usuario (lo manda la función ops-desk).
CREATE OR REPLACE FUNCTION public.admin_ops_act(_source text, _id uuid, _action text, _message text DEFAULT NULL, _evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin uuid := public._ops_require_admin();
  v_label text; v_msg text := nullif(btrim(left(coalesce(_message, ''), 2000)), '');
  v_ev text := nullif(btrim(left(coalesce(_evidence, ''), 500)), '');
  cr public.concierge_requests; ar public.ai_reservations;
  v_stage text; v_to text; v_res jsonb; v_user uuid; v_reply uuid; v_kind text; v_body text; v_note text;
  v_type text;
BEGIN
  IF _action IS NULL OR _action NOT IN ('tomar','responder','resolver','no_se_pudo') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION');
  END IF;
  IF _source IS NULL OR _source NOT IN ('concierge_request','ai_reservation') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_SOURCE');
  END IF;
  IF _action = 'responder' AND coalesce(length(v_msg), 0) < 2 THEN RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_REQUIRED'); END IF;
  IF _action = 'no_se_pudo' AND coalesce(length(v_msg), 0) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED'); END IF;
  v_label := coalesce(public._ops_person(v_admin)->>'name', public._ops_person(v_admin)->>'email', 'Equipo IATOS');
  v_note := left(CASE _action
    WHEN 'tomar' THEN 'Tomada por ' || v_label
    WHEN 'resolver' THEN 'Resuelta por ' || v_label || coalesce(' · evidencia: ' || v_ev, '')
    WHEN 'no_se_pudo' THEN 'No se pudo (' || v_label || '): ' || v_msg
    ELSE 'Respuesta de ' || v_label END, 500);

  IF _source = 'concierge_request' THEN
    SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type IS DISTINCT FROM 'ai_reservation' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_user := cr.user_id; v_type := cr.type;
    v_stage := public.ops_stage('concierge_request', cr.type, cr.status);

    IF cr.type = 'prive_request' THEN
      -- Privé: solo prive_request_transition cambia el estado (valida, guarda evidencia, avisa, historial).
      IF _action = 'tomar' THEN
        IF cr.status = 'solicitado' THEN
          v_res := public.prive_request_transition(_id, 'pendiente_confirmacion', v_note, NULL, NULL, v_admin);
          IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
        ELSIF cr.status = 'pendiente_confirmacion' THEN
          UPDATE public.concierge_requests SET owner_admin_id = v_admin WHERE id = _id;
          INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
          VALUES (_id, cr.status, cr.status, 'equipo', v_admin, v_note);
        ELSE
          RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status, 'to', 'pendiente_confirmacion');
        END IF;
      ELSIF _action = 'resolver' THEN
        IF coalesce(length(v_ev), 0) < 2 THEN RETURN jsonb_build_object('ok', false, 'code', 'EVIDENCE_REQUIRED'); END IF;
        IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN
          RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status, 'to', 'confirmado_externamente');
        END IF;
        IF cr.status = 'solicitado' THEN
          v_res := public.prive_request_transition(_id, 'pendiente_confirmacion', 'Tomada por ' || v_label, NULL, NULL, v_admin);
          IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
        END IF;
        v_res := public.prive_request_transition(_id, 'confirmado_externamente', v_note,
          jsonb_build_object('confirmed_by', v_label, 'confirmed_at', now(), 'confirmation_code', left(v_ev, 120), 'evidence', v_ev,
                             'channel', 'equipo', 'admin_id', v_admin), NULL, v_admin);
        IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
      ELSIF _action = 'no_se_pudo' THEN
        v_res := public.prive_request_transition(_id, 'rechazado', v_msg, NULL, NULL, v_admin);
        IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
      END IF;
    ELSE
      -- Demás solicitudes: ciclo del equipo con historial en concierge_request_events.
      IF _action IN ('tomar','resolver','no_se_pudo') AND v_stage NOT IN ('nueva','en_proceso') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status,
          'to', CASE _action WHEN 'tomar' THEN 'pendiente_confirmacion' WHEN 'resolver' THEN 'resuelto' ELSE 'rechazado' END);
      END IF;
      IF _action <> 'responder' THEN
        v_to := CASE _action
          WHEN 'tomar' THEN CASE WHEN v_stage = 'nueva' THEN 'pendiente_confirmacion' ELSE cr.status END
          WHEN 'resolver' THEN 'resuelto' ELSE 'rechazado' END;
        UPDATE public.concierge_requests
           SET status = v_to,
               status_changed_at = CASE WHEN v_to IS DISTINCT FROM cr.status THEN now() ELSE status_changed_at END,
               owner_admin_id = CASE WHEN _action = 'tomar' THEN v_admin ELSE coalesce(owner_admin_id, v_admin) END,
               external_confirmation = CASE WHEN _action = 'resolver' THEN jsonb_strip_nulls(jsonb_build_object(
                 'confirmed_by', v_label, 'confirmed_at', now(), 'evidence', v_ev, 'channel', 'equipo', 'admin_id', v_admin))
                 ELSE external_confirmation END
         WHERE id = _id;
        INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
        VALUES (_id, cr.status, v_to, 'equipo', v_admin, v_note);
        IF _action = 'tomar' AND v_stage = 'nueva' THEN
          PERFORM public.notify_once(v_user, 'team_request', 'Una persona del equipo IATOS ya atiende tu solicitud',
            left('"' || cr.title || '" está en proceso. Verás la respuesta aquí y por correo. Todavía no es una reserva.', 300),
            _id, 'team_take:' || _id);
        END IF;
      END IF;
    END IF;

  ELSE
    SELECT * INTO ar FROM public.ai_reservations WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_user := ar.user_id; v_type := 'ai_reservation';
    IF _action = 'tomar' THEN
      IF ar.status IN ('confirmed','declined','expired','cancelled','failed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', ar.status, 'to', 'en_proceso');
      END IF;
    ELSIF _action = 'resolver' THEN
      IF coalesce(length(v_ev), 0) < 4 THEN RETURN jsonb_build_object('ok', false, 'code', 'EVIDENCE_REQUIRED'); END IF;
      -- Canal "equipo" de ai_reservation_transition: quién confirmó y con qué evidencia (CHECK de la tabla).
      v_res := public.ai_reservation_transition(_id, 'confirmed', 'equipo', NULL, v_note,
        jsonb_build_object('channel', 'equipo', 'confirmed_by', v_label, 'evidence', v_ev,
                           'code', CASE WHEN length(v_ev) <= 60 THEN v_ev END, 'admin_id', v_admin));
      IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res - 'reservation'; END IF;
    ELSIF _action = 'no_se_pudo' THEN
      v_res := public.ai_reservation_transition(_id, 'declined', 'equipo', NULL, left(v_note, 500), NULL);
      IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res - 'reservation'; END IF;
    END IF;
    -- Quién del equipo y qué hizo (ai_reservation_events no tiene actor_id: va en data).
    INSERT INTO public.ai_reservation_events (reservation_id, kind, from_status, to_status, actor, note, data)
    VALUES (_id, 'note', ar.status, (SELECT status FROM public.ai_reservations WHERE id = _id), 'equipo', v_note,
            jsonb_build_object('mesa', _action, 'admin_id', v_admin));
  END IF;

  -- Mensaje al usuario (app + correo) para responder, resolver y no se pudo.
  IF _action IN ('responder','resolver','no_se_pudo') THEN
    v_kind := CASE _action WHEN 'responder' THEN 'respuesta' WHEN 'resolver' THEN 'resuelta' ELSE 'no_se_pudo' END;
    v_body := coalesce(v_msg, CASE _action WHEN 'resolver' THEN 'Tu solicitud quedó resuelta por el equipo IATOS.' END);
    INSERT INTO public.team_request_replies (source, source_id, user_id, admin_id, kind, body, evidence)
    VALUES (_source, _id, v_user, v_admin, v_kind, v_body, CASE WHEN _action = 'resolver' THEN v_ev END)
    RETURNING id INTO v_reply;
    -- Privé y reservas IA ya avisan en la app desde su propia transición; aquí solo lo que no tiene aviso.
    IF _action = 'responder' OR (v_type NOT IN ('prive_request','ai_reservation')) THEN
      PERFORM public.notify_once(v_user, 'team_request',
        CASE v_kind WHEN 'respuesta' THEN 'Respuesta del equipo IATOS' WHEN 'resuelta' THEN 'Resuelta por el equipo IATOS'
                    ELSE 'El equipo IATOS no pudo completarla' END,
        left(v_body, 300), _id, 'team_reply:' || v_reply);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'source', _source, 'id', _id, 'action', _action, 'reply_id', v_reply,
    'item', CASE WHEN _source = 'concierge_request' THEN public._ops_request_json(_id)
                 ELSE public._ops_ai_json((SELECT a FROM public.ai_reservations a WHERE a.id = _id)) END);
END $$;

-- ───────────────────────────── 6. Lo que ve el usuario ─────────────────────────────
-- Sus solicitudes a una persona (no las de nadie más): estado real, respuestas del equipo e historial.
-- Las reservas IA aparecen aquí solo si el equipo intervino (las demás ya están en Mis reservas).
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
             'history', public._ops_history('concierge_request', cr.id, false)) AS j
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

-- ───────────────────────────── 7. Correos (solo el servidor) ─────────────────────────────
-- Aviso al dueño: datos para armar el correo (_shared/ops-desk.ts). Reclamar antes de enviar evita el
-- duplicado: mientras un envío está en curso (10 min) nadie más lo toma; enviado nunca se repite.
CREATE OR REPLACE FUNCTION public._ops_alert_payload(_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._ops_request_json(_id) || jsonb_build_object('attempts', cr.owner_alert_attempts)
    FROM public.concierge_requests cr WHERE cr.id = _id;
$$;

CREATE OR REPLACE FUNCTION public.ops_owner_alert_claim(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.concierge_requests;
BEGIN
  SELECT * INTO r FROM public.concierge_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.type = 'ai_reservation' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF r.owner_alert_status = 'enviado' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_SENT'); END IF;
  IF r.owner_alert_attempts >= 6 THEN RETURN jsonb_build_object('ok', false, 'code', 'GAVE_UP'); END IF;
  IF r.owner_alert_claimed_at IS NOT NULL AND r.owner_alert_claimed_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IN_FLIGHT');
  END IF;
  UPDATE public.concierge_requests
     SET owner_alert_status = CASE WHEN owner_alert_status = 'fallido' THEN 'fallido' ELSE 'pendiente' END,
         owner_alert_claimed_at = now(), owner_alert_attempts = owner_alert_attempts + 1
   WHERE id = _id;
  RETURN jsonb_build_object('ok', true, 'alert', public._ops_alert_payload(_id));
END $$;

CREATE OR REPLACE FUNCTION public.ops_owner_alert_finish(_id uuid, _ok boolean, _email_id text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.concierge_requests
     SET owner_alert_status = CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END,
         owner_alert_sent_at = CASE WHEN _ok THEN now() ELSE owner_alert_sent_at END,
         owner_alert_email_id = CASE WHEN _ok THEN left(_email_id, 200) ELSE owner_alert_email_id END,
         owner_alert_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'error'), 300) END,
         owner_alert_claimed_at = NULL
   WHERE id = _id AND owner_alert_status IS DISTINCT FROM 'enviado';
  RETURN jsonb_build_object('ok', FOUND);
END $$;

-- Reintento (health-check): solo avisos que concierge-action registró y no salieron, de los últimos 3 días.
CREATE OR REPLACE FUNCTION public.ops_owner_alerts_due(_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_out jsonb := '[]'::jsonb; v_c jsonb;
BEGIN
  FOR v_id IN SELECT id FROM public.concierge_requests
     WHERE owner_alert_status IN ('pendiente','fallido') AND owner_alert_attempts < 6
       AND (owner_alert_claimed_at IS NULL OR owner_alert_claimed_at < now() - interval '10 minutes')
       AND created_at > now() - interval '3 days' AND type IS DISTINCT FROM 'ai_reservation'
     ORDER BY created_at LIMIT greatest(1, least(coalesce(_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  LOOP
    v_c := public.ops_owner_alert_claim(v_id);
    IF coalesce((v_c->>'ok')::boolean, false) THEN v_out := v_out || jsonb_build_array(v_c->'alert'); END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- Correo al usuario con la respuesta del equipo.
CREATE OR REPLACE FUNCTION public.team_reply_email_claim(_reply_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q public.team_request_replies; v_email text; v_item jsonb;
BEGIN
  SELECT * INTO q FROM public.team_request_replies WHERE id = _reply_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF q.email_status IN ('enviado','sin_correo') THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_DONE', 'email_status', q.email_status); END IF;
  IF q.email_attempts >= 5 THEN RETURN jsonb_build_object('ok', false, 'code', 'GAVE_UP'); END IF;
  IF q.email_claimed_at IS NOT NULL AND q.email_claimed_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IN_FLIGHT');
  END IF;
  v_email := coalesce((SELECT u.email FROM auth.users u WHERE u.id = q.user_id), (SELECT p.email FROM public.profiles p WHERE p.id = q.user_id));
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    UPDATE public.team_request_replies SET email_status = 'sin_correo', email_claimed_at = NULL WHERE id = _reply_id;
    RETURN jsonb_build_object('ok', false, 'code', 'NO_EMAIL', 'email_status', 'sin_correo');
  END IF;
  UPDATE public.team_request_replies SET email_claimed_at = now(), email_attempts = email_attempts + 1 WHERE id = _reply_id;
  v_item := CASE WHEN q.source = 'concierge_request' THEN public._ops_request_json(q.source_id)
                 ELSE public._ops_ai_json((SELECT a FROM public.ai_reservations a WHERE a.id = q.source_id)) END;
  RETURN jsonb_build_object('ok', true, 'reply', jsonb_build_object('id', q.id, 'kind', q.kind, 'body', q.body, 'evidence', q.evidence,
    'created_at', q.created_at, 'source', q.source, 'source_id', q.source_id),
    'to', v_email, 'name', (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = q.user_id),
    'item', v_item - 'payload' - 'user' - 'owner' - 'alert' - 'history' - 'replies');
END $$;

CREATE OR REPLACE FUNCTION public.team_reply_email_finish(_reply_id uuid, _ok boolean, _email_id text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.team_request_replies
     SET email_status = CASE WHEN _ok THEN 'enviado' ELSE 'fallido' END,
         email_sent_at = CASE WHEN _ok THEN now() ELSE email_sent_at END,
         email_id = CASE WHEN _ok THEN left(_email_id, 200) ELSE email_id END,
         email_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'error'), 300) END,
         email_claimed_at = NULL
   WHERE id = _reply_id AND email_status NOT IN ('enviado','sin_correo');
  RETURN jsonb_build_object('ok', FOUND);
END $$;

CREATE OR REPLACE FUNCTION public.team_reply_emails_due(_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_out jsonb := '[]'::jsonb; v_c jsonb;
BEGIN
  FOR v_id IN SELECT id FROM public.team_request_replies
     WHERE email_status IN ('pendiente','fallido') AND email_attempts < 5
       AND (email_claimed_at IS NULL OR email_claimed_at < now() - interval '10 minutes')
       AND created_at > now() - interval '7 days'
     ORDER BY created_at LIMIT greatest(1, least(coalesce(_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  LOOP
    v_c := public.team_reply_email_claim(v_id);
    IF coalesce((v_c->>'ok')::boolean, false) THEN v_out := v_out || jsonb_build_array(v_c); END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- ───────────────────────────── 8. Permisos ─────────────────────────────
REVOKE ALL ON FUNCTION public.ops_stage(text, text, text, boolean), public._ops_person(uuid), public._ops_require_admin(),
  public._ops_small_int(text), public._ops_requested_text(timestamptz, jsonb), public._ops_request_json(uuid),
  public._ops_ai_needs_team(public.ai_reservations), public._ops_ai_owner(uuid), public._ops_ai_json(public.ai_reservations),
  public._ops_replies(text, uuid, boolean), public._ops_history(text, uuid, boolean), public._ops_alert_payload(uuid),
  public.admin_ops_list(text), public.admin_ops_act(text, uuid, text, text, text), public.my_team_requests(),
  public.ops_owner_alert_claim(uuid), public.ops_owner_alert_finish(uuid, boolean, text, text), public.ops_owner_alerts_due(int),
  public.team_reply_email_claim(uuid), public.team_reply_email_finish(uuid, boolean, text, text), public.team_reply_emails_due(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_stage(text, text, text, boolean) TO authenticated, service_role;
-- Mesa: cualquier sesión puede llamarlas, pero adentro exigen public.admins (42501 si no).
GRANT EXECUTE ON FUNCTION public.admin_ops_list(text), public.admin_ops_act(text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_team_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_owner_alert_claim(uuid), public.ops_owner_alert_finish(uuid, boolean, text, text),
  public.ops_owner_alerts_due(int), public.team_reply_email_claim(uuid), public.team_reply_email_finish(uuid, boolean, text, text),
  public.team_reply_emails_due(int) TO service_role;

COMMENT ON TABLE public.team_request_replies IS
  'Mesa de operaciones: respuestas del equipo al usuario (las ve en la app) y estado del correo que se le manda. Solo escribe admin_ops_act.';
