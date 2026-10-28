-- Arreglos de la auditoría 10 (Concierge / Iato y Members Only, 28-oct-2026). Idempotente.
--
-- 1. "Hablar con una persona" (FixerButton → fixer_escalations) no aparecía en "Mis solicitudes" ni en la
--    Mesa de operaciones: my_team_requests y admin_ops_list solo leen concierge_requests (#11).
--    Solución sin tocar las firmas de la Mesa: cada fixer_escalation tiene su fila espejo en
--    concierge_requests (type 'human_help', ligada por fixer_escalation_id, única). Así la solicitud
--    entra a la Mesa (tomar, responder, resolver, no se pudo), a "Mis solicitudes" y al correo de
--    respuesta al usuario con lo que ya existe.
--    Correo al dueño SIN duplicados: el aviso lo manda el botón (enviar-email-fixer). El espejo nace con
--    owner_alert_status NULL (nadie lo reenvía); cuando el botón guarda el resultado del correo,
--    'email_enviado' → 'enviado' (nunca se repite) y 'email_fallido' → 'fallido' (health-check lo
--    reintenta una vez por intento, máximo 6, como cualquier aviso que no salió).
--    reservation_state_v ya no repite la escalación que tiene espejo (Iato veía la misma dos veces).
-- 2. Members Only: los conteos por ciudad no coincidían con la lista (#14 y Privé P1-3: "Madrid · 15
--    lugares" abría "6 lugares"). members_cities cuenta ahora exactamente lo que members_venues muestra:
--    solo lugares con fuente (lo curado o con source_url, el mismo filtro que isSourcedVenue) y con el
--    mismo alcance de ciudad (members_scope: "Los Cabos" incluye San José del Cabo). Misma firma.
--    members_teaser (el adelanto para cuentas sin PRO) cuenta lo mismo: no promete lugares que PRO no ve.

-- ───────────────────────────── 1. Espejo de "Hablar con una persona" ─────────────────────────────
ALTER TABLE public.concierge_requests ADD COLUMN IF NOT EXISTS fixer_escalation_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concierge_requests_fixer_escalation_fk') THEN
    ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_requests_fixer_escalation_fk
      FOREIGN KEY (fixer_escalation_id) REFERENCES public.fixer_escalations(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS concierge_requests_fixer_escalation_uq ON public.concierge_requests (fixer_escalation_id)
  WHERE fixer_escalation_id IS NOT NULL;

-- Título y datos que ve el equipo y el usuario (sin JSON crudo: el motivo, la urgencia y el contexto).
CREATE OR REPLACE FUNCTION public._fixer_request_title(_motivo text, _urgencia text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  -- El tipo ya se muestra como "Hablar con una persona": el título dice la urgencia y el motivo.
  SELECT left(CASE _urgencia WHEN 'critica' THEN 'Urgente' WHEN 'alta' THEN 'Importante'
    WHEN 'media' THEN 'Pregunta general' WHEN 'baja' THEN 'Pregunta general' ELSE 'Solicitud' END
    || coalesce(': ' || nullif(btrim(regexp_replace(left(_motivo, 120), '\s+', ' ', 'g')), ''), ''), 200);
$$;

CREATE OR REPLACE FUNCTION public.fixer_escalation_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.concierge_requests (user_id, trip_id, type, title, payload, status, fixer_escalation_id, owner_alert_status, created_at)
    VALUES (NEW.user_id, NEW.trip_id, 'human_help', public._fixer_request_title(NEW.motivo, NEW.urgencia),
            jsonb_strip_nulls(jsonb_build_object('origen', 'boton_hablar_con_una_persona', 'urgencia', NEW.urgencia,
              'detalle', nullif(btrim(left(NEW.motivo, 1000)), ''), 'fixer_escalation_id', NEW.id)),
            CASE WHEN NEW.status = 'resuelto' THEN 'resuelto' ELSE 'solicitado' END, NEW.id,
            CASE NEW.status WHEN 'email_enviado' THEN 'enviado' WHEN 'email_fallido' THEN 'fallido' END,
            NEW.created_at)
    ON CONFLICT (fixer_escalation_id) WHERE fixer_escalation_id IS NOT NULL DO NOTHING;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('email_enviado', 'email_fallido') THEN
    -- Resultado real del correo que mandó el botón. Un aviso ya enviado nunca vuelve a "fallido".
    UPDATE public.concierge_requests
       SET owner_alert_status = CASE WHEN NEW.status = 'email_enviado' THEN 'enviado' ELSE 'fallido' END,
           owner_alert_sent_at = CASE WHEN NEW.status = 'email_enviado' THEN coalesce(owner_alert_sent_at, now()) ELSE owner_alert_sent_at END,
           owner_alert_error = CASE WHEN NEW.status = 'email_enviado' THEN NULL ELSE 'El correo del botón Hablar con una persona no salió' END
     WHERE fixer_escalation_id = NEW.id AND owner_alert_status IS DISTINCT FROM 'enviado';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fixer_escalation_mirror(), public._fixer_request_title(text, text) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fixer_escalation_mirror_ins ON public.fixer_escalations;
CREATE TRIGGER fixer_escalation_mirror_ins AFTER INSERT ON public.fixer_escalations
  FOR EACH ROW EXECUTE FUNCTION public.fixer_escalation_mirror();
DROP TRIGGER IF EXISTS fixer_escalation_mirror_upd ON public.fixer_escalations;
CREATE TRIGGER fixer_escalation_mirror_upd AFTER UPDATE OF status ON public.fixer_escalations
  FOR EACH ROW EXECUTE FUNCTION public.fixer_escalation_mirror();

-- Las que ya existen (180 días, lo que muestran la Mesa y "Mis solicitudes"). Nunca se reenvía un aviso
-- viejo: el espejo queda 'enviado' si el correo salió y sin aviso pendiente si no.
INSERT INTO public.concierge_requests (user_id, trip_id, type, title, payload, status, fixer_escalation_id, owner_alert_status, created_at)
SELECT fe.user_id, fe.trip_id, 'human_help', public._fixer_request_title(fe.motivo, fe.urgencia),
       jsonb_strip_nulls(jsonb_build_object('origen', 'boton_hablar_con_una_persona', 'urgencia', fe.urgencia,
         'detalle', nullif(btrim(left(fe.motivo, 1000)), ''), 'fixer_escalation_id', fe.id)),
       CASE WHEN fe.status = 'resuelto' THEN 'resuelto' ELSE 'solicitado' END, fe.id,
       CASE WHEN fe.status = 'email_enviado' THEN 'enviado' END, fe.created_at
  FROM public.fixer_escalations fe
 WHERE fe.created_at > now() - interval '180 days'
   AND NOT EXISTS (SELECT 1 FROM public.concierge_requests cr WHERE cr.fixer_escalation_id = fe.id)
ON CONFLICT (fixer_escalation_id) WHERE fixer_escalation_id IS NOT NULL DO NOTHING;

-- Vista canónica: igual que en 20261028010000_godmode_estados, sin repetir la escalación con espejo.
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
  FROM public.fixer_escalations fe
 -- El espejo en concierge_requests (fixer_escalation_id) ya la muestra con el estado real de la mesa.
 WHERE NOT EXISTS (SELECT 1 FROM public.concierge_requests cr WHERE cr.fixer_escalation_id = fe.id);

-- ───────────────────────────── 2. Members Only: conteos que cuadran con la lista ─────────────────────────────
CREATE OR REPLACE FUNCTION public.members_cities()
RETURNS TABLE (ciudad text, ciudad_display text, pais text, venues int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sourced AS MATERIALIZED (
    -- Lo que la app muestra (isSourcedVenue en src/lib/membersVenues.ts y concierge-chat): con fuente.
    SELECT p.* FROM public.members_venue_pool() p
     WHERE auth.uid() IS NOT NULL AND (p.fuente = 'curaduria' OR nullif(btrim(p.source_url), '') IS NOT NULL)
  ), cities AS (
    SELECT min(p.city_key) AS city_key, min(p.ciudad_display) AS display, min(p.pais) AS pais
      FROM sourced p GROUP BY coalesce(p.city_id::text, 'k:' || public.prive_norm(p.city_key))
  )
  -- Mismo alcance que members_venues(<nombre que la app manda: ciudad_display>).
  SELECT c.city_key, c.display, c.pais, n.cnt
    FROM cities c
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS cnt
        FROM sourced p CROSS JOIN public.members_scope(c.display) s
       WHERE p.city_id = ANY (s.city_ids)
          OR (s.neighborhood_id IS NOT NULL AND p.neighborhood_id = s.neighborhood_id)
          OR (p.city_id IS NULL AND s.q <> '' AND (public.prive_norm(p.city_key) = s.q OR public.prive_norm(p.ciudad_display) = s.q))
    ) n
   WHERE n.cnt > 0
   ORDER BY n.cnt DESC, c.display;
$$;
REVOKE ALL ON FUNCTION public.members_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_cities() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.members_teaser(p_ciudad text DEFAULT NULL)
RETURNS TABLE (ciudad text, ciudad_display text, pais text, categoria text, venues int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT min(p.city_key), min(p.ciudad_display), min(p.pais), p.categoria, count(*)::int
    FROM public.members_venue_pool() p
    LEFT JOIN public.members_scope(p_ciudad) s ON p_ciudad IS NOT NULL
   WHERE auth.uid() IS NOT NULL
     -- Solo lo que la lista muestra (con fuente), igual que members_cities.
     AND (p.fuente = 'curaduria' OR nullif(btrim(p.source_url), '') IS NOT NULL)
     AND (p_ciudad IS NULL
          OR p.city_id = ANY (s.city_ids)
          OR (s.neighborhood_id IS NOT NULL AND p.neighborhood_id = s.neighborhood_id)
          OR (p.city_id IS NULL AND s.q <> '' AND (public.prive_norm(p.city_key) = s.q OR public.prive_norm(p.ciudad_display) = s.q)))
   GROUP BY coalesce(p.city_id::text, 'k:' || public.prive_norm(p.city_key)), p.categoria
   ORDER BY 1, 4;
$$;
REVOKE ALL ON FUNCTION public.members_teaser(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_teaser(text) TO authenticated, service_role;
