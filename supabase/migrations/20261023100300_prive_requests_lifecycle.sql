-- IATOS Privé (grupo catalog) · 5/9 · Ciclo de una solicitud Privé (recomendado → guardado →
-- solicitado → pendiente de confirmación → confirmado externamente → cancelado), con historial.
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §6. Se construye SOBRE 20261022146300 (IATOS-114):
-- concierge_requests sigue sin escritura para anon/authenticated; aquí no se reabre nada.
--
--  * "recomendado" = evento iato_pick_shown en prive_events; "guardado" = recomendaciones.experience_id
--    (migración 20261023100500). Ninguno es una reserva.
--  * Una solicitud Privé (type = 'prive_request') nace SOLO por prive_request_create() (con sesión Privé)
--    y cambia de estado SOLO por prive_request_transition() (equipo/servidor) o prive_request_cancel()
--    (el propio usuario, solo para cancelar). Un trigger rechaza cualquier otro cambio de estado, incluso
--    con la llave de servicio, y escribe cada transición en concierge_request_events.
--  * "confirmado_externamente" exige evidencia (quién confirmó, cuándo y folio o documento): CHECK.
--    Solo entonces se crea la constancia en bookings (status confirmed) y se puede mostrar ACCESO
--    CONFIRMADO. Antes de eso, la pantalla dice "Solicitud enviada · aún no es una reserva".
--  * Trazabilidad con Fixer: fixer_escalation_id y owner_admin_id en la solicitud; actor en cada evento.
-- Idempotente.

ALTER TABLE public.concierge_requests
  ADD COLUMN IF NOT EXISTS experience_id uuid REFERENCES public.prive_experiences(id),
  ADD COLUMN IF NOT EXISTS requested_for timestamptz,
  ADD COLUMN IF NOT EXISTS party_size int,
  ADD COLUMN IF NOT EXISTS preferences text,
  ADD COLUMN IF NOT EXISTS contact_method text,
  ADD COLUMN IF NOT EXISTS owner_admin_id uuid,
  ADD COLUMN IF NOT EXISTS external_confirmation jsonb,
  ADD COLUMN IF NOT EXISTS fixer_escalation_id uuid REFERENCES public.fixer_escalations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_group uuid,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS prive_request_fields_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT prive_request_fields_ok CHECK (
  (party_size IS NULL OR party_size BETWEEN 1 AND 30)
  AND (preferences IS NULL OR length(preferences) <= 1000)
  AND (contact_method IS NULL OR contact_method IN ('app','email','telefono','whatsapp')));
-- Solo para solicitudes Privé: los otros tipos conservan sus estados de texto libre ('pending'…).
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS prive_request_status_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT prive_request_status_ok CHECK (type <> 'prive_request' OR (
  status IN ('solicitado','pendiente_confirmacion','confirmado_externamente','cancelado','rechazado','caducado')
  AND experience_id IS NOT NULL));
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS prive_confirm_has_evidence;
ALTER TABLE public.concierge_requests ADD CONSTRAINT prive_confirm_has_evidence CHECK (
  type <> 'prive_request' OR status <> 'confirmado_externamente' OR (
    jsonb_typeof(external_confirmation) = 'object'
    AND coalesce(length(btrim(external_confirmation->>'confirmed_by')), 0) > 1
    AND (external_confirmation->>'confirmed_at') IS NOT NULL
    AND coalesce(length(btrim(coalesce(external_confirmation->>'confirmation_code', external_confirmation->>'evidence_path'))), 0) > 1));

CREATE TABLE IF NOT EXISTS public.concierge_request_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.concierge_requests(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('usuario','equipo','sistema')),
  actor_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS concierge_request_events_req ON public.concierge_request_events (request_id, created_at);
ALTER TABLE public.concierge_request_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS concierge_request_events_owner_read ON public.concierge_request_events;
CREATE POLICY concierge_request_events_owner_read ON public.concierge_request_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.concierge_requests r WHERE r.id = request_id AND r.user_id = auth.uid()));
REVOKE ALL ON public.concierge_request_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.concierge_request_events TO authenticated;
GRANT ALL ON public.concierge_request_events TO service_role;

-- Transiciones legales.
CREATE OR REPLACE FUNCTION public.prive_request_transition_ok(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (_from, _to) IN (
    ('solicitado','pendiente_confirmacion'), ('solicitado','cancelado'), ('solicitado','rechazado'), ('solicitado','caducado'),
    ('pendiente_confirmacion','confirmado_externamente'), ('pendiente_confirmacion','cancelado'),
    ('pendiente_confirmacion','rechazado'), ('pendiente_confirmacion','caducado'),
    ('confirmado_externamente','cancelado'));
$$;

-- Guardia: cualquier alta o cambio de estado de una solicitud Privé tiene que venir de las funciones
-- de abajo (marcan prive.actor en la transacción). Los demás tipos no se tocan.
CREATE OR REPLACE FUNCTION public.prive_requests_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_actor text := nullif(current_setting('prive.actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'prive_request' AND (v_actor IS NULL OR NEW.status <> 'solicitado') THEN
      RAISE EXCEPTION 'prive_request: solo prive_request_create() crea solicitudes y nacen como solicitado';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.type = 'prive_request' OR NEW.type = 'prive_request' THEN
    IF NEW.type IS DISTINCT FROM OLD.type OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.experience_id IS DISTINCT FROM OLD.experience_id THEN
      RAISE EXCEPTION 'prive_request: tipo, usuario y experiencia no cambian';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'prive_request: el estado solo cambia con prive_request_transition() o prive_request_cancel()';
      END IF;
      IF NOT public.prive_request_transition_ok(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'prive_request: transición no permitida (% → %)', OLD.status, NEW.status;
      END IF;
      NEW.status_changed_at := now();
    ELSIF NEW.external_confirmation IS DISTINCT FROM OLD.external_confirmation AND v_actor IS NULL THEN
      RAISE EXCEPTION 'prive_request: la confirmación externa solo la registra el equipo';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prive_requests_guard ON public.concierge_requests;
CREATE TRIGGER prive_requests_guard BEFORE INSERT OR UPDATE ON public.concierge_requests
  FOR EACH ROW EXECUTE FUNCTION public.prive_requests_guard();

CREATE OR REPLACE FUNCTION public.prive_requests_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'prive_request' AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('prive.actor', true), ''), 'sistema'),
            nullif(current_setting('prive.actor_id', true), '')::uuid,
            nullif(current_setting('prive.note', true), ''));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS prive_requests_log ON public.concierge_requests;
CREATE TRIGGER prive_requests_log AFTER INSERT OR UPDATE ON public.concierge_requests
  FOR EACH ROW EXECUTE FUNCTION public.prive_requests_log();

-- Universo → categoría de bookings (constancia de una reserva confirmada).
CREATE OR REPLACE FUNCTION public.prive_booking_category(_universe text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _universe WHEN 'the_table' THEN 'restaurant' WHEN 'private_stays' THEN 'hotel'
                        WHEN 'after_dark' THEN 'other' WHEN 'casino_grand_nights' THEN 'other' ELSE 'activity' END;
$$;

-- Alta (usuario con sesión Privé). Valida la experiencia, el viaje y el ritmo; deja aviso honesto.
-- concierge-action la llama con el token del usuario y después avisa al equipo por correo.
CREATE OR REPLACE FUNCTION public.prive_request_create(
  _ps text, _experience_id uuid, _requested_for timestamptz DEFAULT NULL, _party_size int DEFAULT NULL,
  _preferences text DEFAULT NULL, _contact_method text DEFAULT 'app', _trip_id uuid DEFAULT NULL, _plan_group uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid; e record; v_id uuid; v_rl jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT x.*, d.name_es AS dest_name INTO e
    FROM public.prive_experiences_v x JOIN public.prive_destinations d ON d.id = x.destination_id
   WHERE x.id = _experience_id;
  IF NOT FOUND OR e.effective_state NOT IN ('VERIFICADO','CURADO','ESTIMADO') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXPERIENCE_UNAVAILABLE');
  END IF;
  IF e.age_policy <> 'todas' AND NOT EXISTS (SELECT 1 FROM public.prive_age_confirmations WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AGE_CONFIRMATION_REQUIRED');
  END IF;
  IF _trip_id IS NOT NULL AND NOT public.has_trip_access(_trip_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  END IF;
  IF _requested_for IS NOT NULL AND _requested_for < now() - interval '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_IN_PAST');
  END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_request', 10, 3600);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  PERFORM set_config('prive.actor', 'usuario', true), set_config('prive.actor_id', v_uid::text, true),
          set_config('prive.note', 'Solicitud creada por el usuario', true);
  INSERT INTO public.concierge_requests (user_id, trip_id, type, title, payload, status, experience_id, requested_for,
    party_size, preferences, contact_method, plan_group)
  VALUES (v_uid, _trip_id, 'prive_request', left(e.name, 200),
    jsonb_build_object('experience_slug', e.slug, 'destination', e.dest_name, 'universe', e.universe,
                       'booking_method', e.booking_method, 'data_state', e.effective_state),
    'solicitado', _experience_id, _requested_for, _party_size, left(_preferences, 1000), coalesce(_contact_method, 'app'), _plan_group)
  RETURNING id INTO v_id;
  PERFORM set_config('prive.actor', '', true), set_config('prive.actor_id', '', true), set_config('prive.note', '', true);
  PERFORM public.notify_once(v_uid, 'prive_request', 'Solicitud enviada · aún no es una reserva',
    'El equipo de IATOS revisará "' || left(e.name, 120) || '" con el lugar. Te avisaremos cuando el proveedor confirme o si no es posible.',
    v_id, 'prive_request_created:' || v_id);
  INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, trip_id, surface)
  VALUES (v_uid, 'request_created', _experience_id, e.destination_id, _trip_id, 'iato');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', 'solicitado', 'title', left(e.name, 200));
END $$;

-- El usuario puede cancelar lo suyo (no necesita sesión Privé: es su propia solicitud).
CREATE OR REPLACE FUNCTION public.prive_request_cancel(_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRIVE_NO_SESSION' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO r FROM public.concierge_requests WHERE id = _id AND user_id = v_uid AND type = 'prive_request' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF NOT public.prive_request_transition_ok(r.status, 'cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_CANCELLABLE', 'status', r.status);
  END IF;
  PERFORM set_config('prive.actor', 'usuario', true), set_config('prive.actor_id', v_uid::text, true),
          set_config('prive.note', left(coalesce(_note, 'Cancelada por el usuario'), 1000), true);
  UPDATE public.concierge_requests SET status = 'cancelado' WHERE id = _id;
  UPDATE public.bookings SET status = 'cancelled' WHERE user_id = v_uid AND raw_payload->>'prive_request_id' = _id::text;
  PERFORM set_config('prive.actor', '', true), set_config('prive.actor_id', '', true), set_config('prive.note', '', true);
  INSERT INTO public.prive_events (user_id, event, experience_id, surface) VALUES (v_uid, 'request_cancelled', r.experience_id, 'trip');
  RETURN jsonb_build_object('ok', true, 'id', _id, 'status', 'cancelado');
END $$;

-- Equipo (admins) o servidor (llave de servicio). Valida la transición, guarda la evidencia y avisa.
CREATE OR REPLACE FUNCTION public.prive_request_transition(
  _id uuid, _to text, _note text DEFAULT NULL, _confirmation jsonb DEFAULT NULL,
  _fixer_escalation_id uuid DEFAULT NULL, _owner_admin_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := auth.uid(); r record; e record; v_title text; v_body text;
BEGIN
  -- Ojo: dentro de SECURITY DEFINER current_user es el dueño de la función; por eso se decide con el
  -- rol del JWT (service_role) o con la tabla admins, nunca con current_user.
  IF NOT (coalesce(auth.role(), '') = 'service_role'
          OR (v_actor_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admins WHERE user_id = v_actor_id))) THEN
    RAISE EXCEPTION 'prive_request_transition: solo el equipo' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.concierge_requests WHERE id = _id AND type = 'prive_request' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF NOT public.prive_request_transition_ok(r.status, _to) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', r.status, 'to', _to);
  END IF;
  SELECT x.*, d.name_es AS dest_name, c.name_es AS country_name INTO e
    FROM public.prive_experiences x JOIN public.prive_destinations d ON d.id = x.destination_id
    LEFT JOIN public.prive_destinations c ON c.kind = 'country' AND c.iso_country = d.iso_country
   WHERE x.id = r.experience_id;
  PERFORM set_config('prive.actor', 'equipo', true), set_config('prive.actor_id', coalesce(v_actor_id::text, ''), true),
          set_config('prive.note', left(coalesce(_note, ''), 1000), true);
  UPDATE public.concierge_requests
     SET status = _to,
         external_confirmation = CASE WHEN _to = 'confirmado_externamente' THEN _confirmation ELSE external_confirmation END,
         fixer_escalation_id = coalesce(_fixer_escalation_id, fixer_escalation_id),
         owner_admin_id = coalesce(_owner_admin_id, owner_admin_id, v_actor_id)
   WHERE id = _id;   -- el CHECK prive_confirm_has_evidence rechaza una confirmación sin evidencia
  IF _to = 'confirmado_externamente' THEN
    INSERT INTO public.bookings (user_id, trip_id, category, provider, status, title, subtitle, city, country, start_at,
      confirmation_code, booking_url, raw_payload)
    VALUES (r.user_id, r.trip_id, public.prive_booking_category(e.universe), 'iatos_prive', 'confirmed', left(e.name, 200),
      'Confirmado por el proveedor · ' || (_confirmation->>'confirmed_by'), e.dest_name, e.country_name, r.requested_for,
      coalesce(_confirmation->>'confirmation_code', 'evidencia:' || (_confirmation->>'evidence_path')),
      coalesce(e.booking_url, e.website),
      jsonb_build_object('source', 'prive_request', 'prive_request_id', _id, 'experience_id', e.id, 'channel', _confirmation->>'channel'));
    INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, trip_id, surface)
    VALUES (r.user_id, 'request_confirmed', e.id, e.destination_id, r.trip_id, 'trip');
  ELSIF _to = 'cancelado' THEN
    UPDATE public.bookings SET status = 'cancelled' WHERE user_id = r.user_id AND raw_payload->>'prive_request_id' = _id::text;
    INSERT INTO public.prive_events (user_id, event, experience_id, surface) VALUES (r.user_id, 'request_cancelled', e.id, 'trip');
  END IF;
  PERFORM set_config('prive.actor', '', true), set_config('prive.actor_id', '', true), set_config('prive.note', '', true);
  v_title := CASE _to
    WHEN 'pendiente_confirmacion' THEN 'Tu solicitud está con el proveedor'
    WHEN 'confirmado_externamente' THEN 'Confirmado por el proveedor'
    WHEN 'rechazado' THEN 'El proveedor no pudo atender tu solicitud'
    WHEN 'caducado' THEN 'Tu solicitud venció sin respuesta del proveedor'
    ELSE 'Solicitud cancelada' END;
  v_body := CASE _to
    WHEN 'pendiente_confirmacion' THEN 'Aún no es una reserva: te avisaremos cuando el lugar confirme.'
    WHEN 'confirmado_externamente' THEN 'Folio o constancia: ' || coalesce(_confirmation->>'confirmation_code', 'documento en tu expediente') || '.'
    ELSE coalesce(left(_note, 300), '') END;
  PERFORM public.notify_once(r.user_id, 'prive_request', v_title, v_body, _id, 'prive_request:' || _id || ':' || _to);
  RETURN jsonb_build_object('ok', true, 'id', _id, 'status', _to);
END $$;

-- Mis solicitudes: estado honesto. Solo "confirmado_externamente" con evidencia se muestra como
-- confirmado (y con la etiqueta ACCESO CONFIRMADO); todo lo demás dice que aún no es una reserva.
CREATE OR REPLACE FUNCTION public.prive_my_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRIVE_NO_SESSION' USING ERRCODE = 'P0001'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'status', r.status, 'requested_for', r.requested_for, 'party_size', r.party_size,
      'trip_id', r.trip_id, 'experience_id', r.experience_id, 'created_at', r.created_at, 'status_changed_at', r.status_changed_at,
      'is_confirmed', (r.status = 'confirmado_externamente' AND r.external_confirmation IS NOT NULL),
      'label', CASE WHEN r.status = 'confirmado_externamente' AND r.external_confirmation IS NOT NULL THEN 'ACCESO_CONFIRMADO' END,
      'status_text', CASE r.status
        WHEN 'solicitado' THEN 'Solicitud enviada · aún no es una reserva'
        WHEN 'pendiente_confirmacion' THEN 'Pendiente de confirmación del proveedor · aún no es una reserva'
        WHEN 'confirmado_externamente' THEN 'Confirmado por el proveedor'
        WHEN 'cancelado' THEN 'Cancelada'
        WHEN 'rechazado' THEN 'El proveedor no pudo atenderla'
        WHEN 'caducado' THEN 'Venció sin respuesta del proveedor' END,
      'confirmation_code', CASE WHEN r.status = 'confirmado_externamente' THEN r.external_confirmation->>'confirmation_code' END,
      'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('from', ev.from_status, 'to', ev.to_status, 'actor', ev.actor, 'at', ev.created_at)
                    ORDER BY ev.created_at), '[]') FROM public.concierge_request_events ev WHERE ev.request_id = r.id))
    ORDER BY r.created_at DESC)
    FROM public.concierge_requests r WHERE r.user_id = v_uid AND r.type = 'prive_request'), '[]'::jsonb);
END $$;

-- Panel del equipo: solicitudes Privé abiertas con su responsable y su escalación Fixer.
CREATE OR REPLACE FUNCTION public.admin_prive_requests(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_prive_requests: solo el equipo' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'title', r.title, 'status', r.status,
      'requested_for', r.requested_for, 'party_size', r.party_size, 'contact_method', r.contact_method, 'preferences', r.preferences,
      'owner_admin_id', r.owner_admin_id, 'fixer_escalation_id', r.fixer_escalation_id, 'created_at', r.created_at) ORDER BY r.created_at)
    FROM public.concierge_requests r
   WHERE r.type = 'prive_request' AND (_status IS NULL OR r.status = _status)), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.prive_request_transition_ok(text, text), public.prive_requests_guard(), public.prive_requests_log(),
  public.prive_booking_category(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prive_request_create(text, uuid, timestamptz, int, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_request_create(text, uuid, timestamptz, int, text, text, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prive_request_cancel(uuid, text), public.prive_my_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_request_cancel(uuid, text), public.prive_my_requests() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prive_request_transition(uuid, text, text, jsonb, uuid, uuid), public.admin_prive_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_request_transition(uuid, text, text, jsonb, uuid, uuid), public.admin_prive_requests(text) TO authenticated, service_role;
