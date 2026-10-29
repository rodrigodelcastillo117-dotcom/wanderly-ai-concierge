-- Opiniones de los usuarios (29-oct-2026). Pedido del dueño: "pon algo donde las respuestas nos lleguen a
-- nosotros" (Álvaro dio su opinión por WhatsApp porque en la app no había dónde).
--
-- Sin sistema nuevo: una opinión es una fila de concierge_requests con type 'opinion', así entra sola a
--   · la Mesa de operaciones (admin_ops_list, /admin/operaciones) con quién, cuándo y su etapa;
--   · "Mis solicitudes" del usuario (my_team_requests: solo las suyas, RLS de siempre);
--   · las respuestas del equipo (admin_ops_act 'responder' → team_request_replies → correo vía ops-desk);
--   · el aviso al equipo por correo con marca de enviado y reintento (ops_owner_alert_claim/finish, health-check).
-- La crea SOLO la función enviar-opinion (llave de servicio, límite por usuario y validación); el cliente no
-- escribe en concierge_requests (20261022146300).
--
-- Qué agrega:
--   1. CHECK de forma para las opiniones (tipo, texto 3–2000, calificación 1–5, casilla de contacto, contexto
--      corto) y tope de 10 por usuario por hora en la base (respaldo del límite de la función).
--   2. reservation_state_v no las incluye: una opinión no es una reserva y Iato no debe darla por pendiente.
--   3. Si el usuario NO quiere correo, la respuesta del equipo queda solo en la app (email_status 'sin_correo').
--   4. admin_opinion_mark(_id, 'leida' | 'resuelta'): el equipo la marca leída (en proceso) o resuelta, con
--      historial en concierge_request_events, sin avisos con texto de reserva ("todavía no es una reserva").
-- Idempotente.

-- ───────────────────────────── 1. Forma y tope ─────────────────────────────
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS concierge_requests_opinion_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_requests_opinion_ok CHECK (type IS DISTINCT FROM 'opinion' OR (
  status IN ('solicitado','pendiente_confirmacion','resuelto','rechazado','cancelado')
  AND length(title) BETWEEN 3 AND 200
  AND jsonb_typeof(payload) = 'object'
  AND coalesce(payload->>'tipo', '') IN ('no_funciona','confuso','idea','me_gusto')
  AND length(btrim(coalesce(payload->>'texto', ''))) BETWEEN 3 AND 2000
  AND CASE jsonb_typeof(payload->'calificacion') WHEN 'number' THEN (payload->>'calificacion') IN ('1','2','3','4','5')
        WHEN 'null' THEN true ELSE payload->'calificacion' IS NULL END
  AND coalesce(jsonb_typeof(payload->'contactar'), '') = 'boolean'
  AND (payload->>'ruta' IS NULL OR (left(payload->>'ruta', 1) = '/' AND length(payload->>'ruta') <= 200))
  AND (payload->>'pantalla' IS NULL OR length(payload->>'pantalla') <= 80)
  AND (payload->>'dispositivo' IS NULL OR payload->>'dispositivo' IN ('celular','escritorio'))
  AND (payload->>'version' IS NULL OR length(payload->>'version') <= 40)));

CREATE INDEX IF NOT EXISTS concierge_requests_opinion_user ON public.concierge_requests (user_id, created_at DESC)
  WHERE type = 'opinion';

-- Tope en la base: 10 opiniones por usuario por hora, venga de donde venga el insert (la función enviar-opinion
-- ya limita con check_rate_limit; esto cubre cualquier otro camino de servidor).
CREATE OR REPLACE FUNCTION public.opinion_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'opinion' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('opinion:' || NEW.user_id::text, 0));
    IF (SELECT count(*) FROM public.concierge_requests
         WHERE type = 'opinion' AND user_id = NEW.user_id AND created_at > now() - interval '1 hour') >= 10 THEN
      RAISE EXCEPTION 'OPINION_RATE_LIMIT: máximo 10 opiniones por hora' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS opinion_insert_guard ON public.concierge_requests;
CREATE TRIGGER opinion_insert_guard BEFORE INSERT ON public.concierge_requests
  FOR EACH ROW WHEN (NEW.type = 'opinion') EXECUTE FUNCTION public.opinion_insert_guard();

-- ───────────────────────────── 2. Vista canónica sin opiniones ─────────────────────────────
-- Igual que en 20261029010000_fix_iato_mesa (misma forma y columnas); solo deja fuera type 'opinion'.
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
       -- Igual que booking_reservas_status_to_intent (que el cliente no puede ejecutar).
       CASE ar.status WHEN 'draft' THEN 'SELECTED' WHEN 'awaiting_user_ok' THEN 'READY_TO_BOOK' WHEN 'sent' THEN 'REQUESTED'
            WHEN 'confirmed' THEN 'CONFIRMED' WHEN 'declined' THEN 'FAILED' WHEN 'failed' THEN 'FAILED'
            WHEN 'cancelled' THEN 'CANCELLED' WHEN 'expired' THEN 'EXPIRED' ELSE 'PENDING_CONFIRMATION' END,
       -- ai_res_confirmed_has_evidence garantiza la evidencia de cada canal.
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
         -- pendiente_confirmacion, in_progress, contacted, resuelto y 'confirmed' sin evidencia estructurada.
         ELSE 'PENDING_CONFIRMATION' END,
       -- prive_confirm_has_evidence exige quién, cuándo y folio o documento (lo registra el equipo).
       CASE WHEN cr.type = 'prive_request' AND cr.status = 'confirmado_externamente' AND cr.external_confirmation IS NOT NULL
            THEN 'verificado_proveedor' ELSE 'sin_evidencia' END,
       CASE WHEN cr.type = 'prive_request' AND cr.status = 'confirmado_externamente' THEN 'prive_request_confirmed' END,
       GREATEST(cr.updated_at, cr.status_changed_at,
                (SELECT max(e.created_at) FROM public.concierge_request_events e WHERE e.request_id = cr.id))
  FROM public.concierge_requests cr
 WHERE cr.type IS DISTINCT FROM 'ai_reservation'
   AND cr.type IS DISTINCT FROM 'opinion'      -- una opinión no es una reserva ni algo que Iato deba dar por pendiente
   AND NOT EXISTS (SELECT 1 FROM public.booking_intents bi WHERE bi.concierge_request_id = cr.id)
UNION ALL
SELECT fe.user_id, fe.trip_id, 'fixer_escalations', fe.id, coalesce(nullif(btrim(left(fe.motivo, 200)), ''), 'Fixer'), 'fixer', fe.status,
       CASE fe.status WHEN 'email_fallido' THEN 'FAILED' WHEN 'resuelto' THEN 'PENDING_CONFIRMATION' ELSE 'REQUESTED' END,
       'sin_evidencia', NULL::text, fe.created_at
  FROM public.fixer_escalations fe
 -- El espejo en concierge_requests (fixer_escalation_id) ya la muestra con el estado real de la mesa.
 WHERE NOT EXISTS (SELECT 1 FROM public.concierge_requests cr WHERE cr.fixer_escalation_id = fe.id);

-- ───────────────────────────── 3. Respuesta sin correo si el usuario no lo quiere ─────────────────────────────
CREATE OR REPLACE FUNCTION public.opinion_reply_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source = 'concierge_request' AND EXISTS (
       SELECT 1 FROM public.concierge_requests cr
        WHERE cr.id = NEW.source_id AND cr.type = 'opinion' AND cr.payload->'contactar' = 'false'::jsonb) THEN
    NEW.email_status := 'sin_correo';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS opinion_reply_contact ON public.team_request_replies;
CREATE TRIGGER opinion_reply_contact BEFORE INSERT ON public.team_request_replies
  FOR EACH ROW EXECUTE FUNCTION public.opinion_reply_contact();

-- ───────────────────────────── 4. Mesa: marcar leída / resuelta ─────────────────────────────
-- leida:    nueva → en proceso (pendiente_confirmacion) a nombre de quien la leyó.
-- resuelta: nueva o en proceso → resuelta (resuelto). Ya resuelta → ok sin cambios.
-- Para escribirle al usuario se usa admin_ops_act 'responder' (app + correo si lo permitió).
CREATE OR REPLACE FUNCTION public.admin_opinion_mark(_id uuid, _mark text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin uuid := public._ops_require_admin();
  v_label text := coalesce(public._ops_person(v_admin)->>'name', public._ops_person(v_admin)->>'email', 'Equipo IATOS');
  cr public.concierge_requests; v_to text;
BEGIN
  IF _mark IS NULL OR _mark NOT IN ('leida','resuelta') THEN RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION'); END IF;
  SELECT * INTO cr FROM public.concierge_requests WHERE id = _id AND type = 'opinion' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  v_to := CASE _mark WHEN 'leida' THEN 'pendiente_confirmacion' ELSE 'resuelto' END;
  IF cr.status = v_to OR (_mark = 'leida' AND cr.status = 'resuelto') THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'item', public._ops_request_json(_id));
  END IF;
  IF cr.status NOT IN ('solicitado','pendiente_confirmacion') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION', 'from', cr.status, 'to', v_to);
  END IF;
  UPDATE public.concierge_requests
     SET status = v_to, status_changed_at = now(),
         owner_admin_id = CASE WHEN _mark = 'leida' THEN v_admin ELSE coalesce(owner_admin_id, v_admin) END
   WHERE id = _id;
  INSERT INTO public.concierge_request_events (request_id, from_status, to_status, actor, actor_id, note)
  VALUES (_id, cr.status, v_to, 'equipo', v_admin, left(CASE _mark WHEN 'leida' THEN 'Leída por ' ELSE 'Resuelta por ' END || v_label, 500));
  RETURN jsonb_build_object('ok', true, 'id', _id, 'mark', _mark, 'item', public._ops_request_json(_id));
END $$;

-- ───────────────────────────── 5. Permisos ─────────────────────────────
REVOKE ALL ON FUNCTION public.opinion_insert_guard(), public.opinion_reply_contact(), public.admin_opinion_mark(uuid, text)
  FROM PUBLIC, anon, authenticated;
-- Cualquier sesión puede llamarla, pero adentro exige public.admins (42501 si no), como admin_ops_act.
GRANT EXECUTE ON FUNCTION public.admin_opinion_mark(uuid, text) TO authenticated;

COMMENT ON CONSTRAINT concierge_requests_opinion_ok ON public.concierge_requests IS
  'Opiniones (type opinion, función enviar-opinion): tipo, texto 3–2000, calificación 1–5, casilla de contacto y contexto corto.';
