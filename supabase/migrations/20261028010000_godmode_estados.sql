-- God Mode · Fase 1 (P0): estados de reserva seguros y honestos. Idempotente.
--
-- Qué hace (sin tocar las máquinas de estados ni las RPC de booking_intents, ai_reservations y
-- prive_request):
--   1. concierge_requests de tipos que NO son Privé: 'pending' pasa a 'solicitado' (mismo vocabulario
--      que concierge-action y Privé), el valor por omisión pasa a 'solicitado' y un disparador convierte
--      cualquier 'pending' que llegue después (booking-bridge todavía inserta 'pending'), así ningún
--      insert existente se rompe. CHECK con los estados que usan el código y las migraciones.
--   2. Vista de SOLO LECTURA reservation_state_v (security_invoker: cada quien ve solo lo suyo por la
--      RLS de cada tabla) que traduce las cuatro máquinas al vocabulario canónico de booking_intents.
--      CONFIRMED solo sale de una confirmación con evidencia (la que ya exige cada tabla).
--   3. RPC my_open_reservations(_trip) para que concierge-chat lea lo vigente con el JWT del usuario.

-- ───────────── 1. concierge_requests (tipos no Privé): 'pending' → 'solicitado' + CHECK ─────────────
CREATE OR REPLACE FUNCTION public.concierge_requests_normalize_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM 'prive_request' AND NEW.status = 'pending' THEN
    NEW.status := 'solicitado';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.concierge_requests_normalize_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS concierge_requests_normalize_status ON public.concierge_requests;
CREATE TRIGGER concierge_requests_normalize_status BEFORE INSERT OR UPDATE OF status ON public.concierge_requests
  FOR EACH ROW EXECUTE FUNCTION public.concierge_requests_normalize_status();

ALTER TABLE public.concierge_requests ALTER COLUMN status SET DEFAULT 'solicitado';

-- Normalización de lo existente sin mover updated_at (no es un cambio real de la solicitud). El
-- disparador booking_intents_follow_request no cambia nada: 'pending' y 'solicitado' son REQUESTED.
DO $$
DECLARE v_trg boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.concierge_requests'::regclass
                                   AND tgname = 'trg_concierge_requests_updated' AND NOT tgisinternal);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.concierge_requests WHERE type IS DISTINCT FROM 'prive_request' AND status = 'pending') THEN
    RETURN;
  END IF;
  IF v_trg THEN ALTER TABLE public.concierge_requests DISABLE TRIGGER trg_concierge_requests_updated; END IF;
  UPDATE public.concierge_requests SET status = 'solicitado' WHERE type IS DISTINCT FROM 'prive_request' AND status = 'pending';
  IF v_trg THEN ALTER TABLE public.concierge_requests ENABLE TRIGGER trg_concierge_requests_updated; END IF;
END $$;

-- Estados permitidos fuera de Privé (Privé ya tiene prive_request_status_ok):
--   · concierge-action / Fixer / Members: solicitado; ciclo en español del equipo: pendiente_confirmacion,
--     cancelado, rechazado, caducado, resuelto.
--   · Valores que booking_intents_follow_request ya entiende (equipo por SQL): in_progress, contacted,
--     confirmed (sin evidencia = PENDING_CONFIRMATION), cancelled, rejected, failed, expired.
--   · Espejo de ai_reservations (tipo ai_reservation): draft, awaiting_user_ok, sent, venue_replied,
--     needs_user, confirmed, declined, expired, cancelled, failed.
-- NOT VALID + VALIDATE aparte: si producción tuviera un valor fuera de la lista, la migración no falla;
-- avisa y las filas nuevas o cambiadas sí quedan protegidas.
ALTER TABLE public.concierge_requests DROP CONSTRAINT IF EXISTS concierge_request_status_ok;
ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_request_status_ok CHECK (type = 'prive_request' OR status IN (
  'solicitado','pendiente_confirmacion','cancelado','rechazado','caducado','resuelto',
  'in_progress','contacted','confirmed','cancelled','rejected','failed','expired',
  'draft','awaiting_user_ok','sent','venue_replied','needs_user','declined')) NOT VALID;
DO $$
BEGIN
  ALTER TABLE public.concierge_requests VALIDATE CONSTRAINT concierge_request_status_ok;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'concierge_request_status_ok queda NOT VALID: hay solicitudes con estados fuera de la lista (%)',
    (SELECT string_agg(DISTINCT status, ', ') FROM public.concierge_requests WHERE type <> 'prive_request' AND status NOT IN (
      'solicitado','pendiente_confirmacion','cancelado','rechazado','caducado','resuelto',
      'in_progress','contacted','confirmed','cancelled','rejected','failed','expired',
      'draft','awaiting_user_ok','sent','venue_replied','needs_user','declined'));
END $$;

-- ───────────── 2. Vista canónica de solo lectura ─────────────
-- verification: verificado_proveedor | verificado_equipo | sin_evidencia (solo CONFIRMED puede estar
-- verificado). Una fila que otra representa no se repite: la solicitud o la reserva IA ligada a una
-- intención la muestra la intención; el espejo ai_reservation de concierge_requests lo muestra
-- ai_reservations.
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
   AND NOT EXISTS (SELECT 1 FROM public.booking_intents bi WHERE bi.concierge_request_id = cr.id)
UNION ALL
SELECT fe.user_id, fe.trip_id, 'fixer_escalations', fe.id, coalesce(nullif(btrim(left(fe.motivo, 200)), ''), 'Fixer'), 'fixer', fe.status,
       CASE fe.status WHEN 'email_fallido' THEN 'FAILED' WHEN 'resuelto' THEN 'PENDING_CONFIRMATION' ELSE 'REQUESTED' END,
       'sin_evidencia', NULL::text, fe.created_at
  FROM public.fixer_escalations fe;

COMMENT ON VIEW public.reservation_state_v IS
  'God Mode F1: estado canónico (vocabulario de booking_intents) de intenciones, reservas IA, solicitudes y Fixer. Solo lectura; security_invoker (RLS de cada tabla). CONFIRMED solo con evidencia.';

REVOKE ALL ON public.reservation_state_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_state_v TO authenticated, service_role;

-- ───────────── 3. RPC: lo vigente del usuario (y de un viaje) ─────────────
-- Abiertas (aún no son reserva) y confirmadas de los últimos 180 días. 'resuelto' del equipo sin
-- evidencia ya no se considera abierta. Con _trip: las de ese viaje y las que no tienen viaje.
CREATE OR REPLACE FUNCTION public.my_open_reservations(_trip uuid DEFAULT NULL)
RETURNS SETOF public.reservation_state_v
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT v.* FROM public.reservation_state_v v
   WHERE v.user_id = auth.uid()
     AND (_trip IS NULL OR v.trip_id = _trip OR v.trip_id IS NULL)
     AND ((v.canonical_state IN ('SELECTED','PRICE_RECHECK_REQUIRED','READY_TO_BOOK','REDIRECTED_TO_PROVIDER','REQUESTED','PENDING_CONFIRMATION')
           AND v.raw_status <> 'resuelto')
          OR (v.canonical_state = 'CONFIRMED' AND v.updated_at > now() - interval '180 days'))
   ORDER BY (v.trip_id IS NOT DISTINCT FROM _trip) DESC, v.updated_at DESC
   LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.my_open_reservations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_open_reservations(uuid) TO authenticated, service_role;
