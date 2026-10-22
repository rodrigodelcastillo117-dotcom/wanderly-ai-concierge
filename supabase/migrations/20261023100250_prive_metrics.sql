-- IATOS Privé (grupo catalog) · 5/9 · Métricas (prive_events), registro desde el cliente y panel.
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §7. Las columnas de prive_events son EXACTAMENTE
-- las de §7: el grupo core crea la misma tabla con CREATE TABLE IF NOT EXISTS (prive_log_event) y las
-- dos migraciones deben poder correr en cualquier orden.
-- Privacidad: sin texto libre del usuario; al borrar la cuenta user_id queda en NULL.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.prive_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('home_view','city_view','card_impression','detail_open','save','unsave',
        'compare','external_click','request_created','request_confirmed','request_cancelled',
        'iato_pick_shown','iato_pick_opened','signature_interest','route_calc','stale_shown')),
  experience_id uuid, destination_id uuid, trip_id uuid,
  surface text CHECK (surface IN ('home','city','iato','search','trip','favoritos')),
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_events_user_time ON public.prive_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prive_events_event_time ON public.prive_events (event, created_at DESC);
ALTER TABLE public.prive_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_events TO service_role;

-- Registro desde la app (con sesión Privé). request_* e iato_pick_shown los escribe solo el servidor.
CREATE OR REPLACE FUNCTION public.prive_track(_ps text, _event text, _experience uuid DEFAULT NULL,
  _destination uuid DEFAULT NULL, _surface text DEFAULT NULL, _trip uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_rl jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _event NOT IN ('home_view','city_view','card_impression','detail_open','compare','external_click',
                    'iato_pick_opened','signature_interest','route_calc','stale_shown') THEN
    RETURN false;
  END IF;
  IF _surface IS NOT NULL AND _surface NOT IN ('home','city','iato','search','trip','favoritos') THEN _surface := NULL; END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_track', 120, 60);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN false; END IF;
  -- Una impresión de la misma tarjeta cuenta una vez cada 10 minutos.
  IF _event = 'card_impression' AND EXISTS (SELECT 1 FROM public.prive_events
       WHERE user_id = v_uid AND event = 'card_impression' AND experience_id IS NOT DISTINCT FROM _experience
         AND created_at > now() - interval '10 minutes') THEN
    RETURN true;
  END IF;
  INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, trip_id, surface, plan)
  VALUES (v_uid, _event, _experience, _destination,
          CASE WHEN _trip IS NOT NULL AND public.has_trip_access(_trip, v_uid) THEN _trip END,
          _surface, public.effective_plan(v_uid));
  RETURN true;
END $$;

-- Indicadores (solo admins): vistas, fichas, solicitudes, confirmadas CON evidencia, conversiones,
-- por destino y universo, y % de tarjetas mostradas como DESACTUALIZADO.
CREATE OR REPLACE FUNCTION public.admin_prive_metrics(_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 365)));
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_prive_metrics: solo el equipo' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'days', _days,
    'views', (SELECT count(*) FROM public.prive_events WHERE created_at >= v_since AND event IN ('home_view','city_view')),
    'detail_opens', (SELECT count(*) FROM public.prive_events WHERE created_at >= v_since AND event = 'detail_open'),
    'requests', (SELECT count(*) FROM public.concierge_requests WHERE type = 'prive_request' AND created_at >= v_since),
    'confirmed_with_evidence', (SELECT count(*) FROM public.concierge_requests WHERE type = 'prive_request'
        AND created_at >= v_since AND status = 'confirmado_externamente' AND external_confirmation IS NOT NULL),
    'stale_shown_pct', (SELECT CASE WHEN count(*) FILTER (WHERE event = 'card_impression') = 0 THEN 0
        ELSE round(100.0 * count(*) FILTER (WHERE event = 'stale_shown') / count(*) FILTER (WHERE event = 'card_impression'), 1) END
        FROM public.prive_events WHERE created_at >= v_since),
    'by_destination', (SELECT coalesce(jsonb_object_agg(slug, n), '{}') FROM (
        SELECT d.slug, count(*) n FROM public.prive_events ev JOIN public.prive_destinations d ON d.id = ev.destination_id
         WHERE ev.created_at >= v_since GROUP BY d.slug) t),
    'by_universe', (SELECT coalesce(jsonb_object_agg(universe, n), '{}') FROM (
        SELECT e.universe, count(*) n FROM public.prive_events ev JOIN public.prive_experiences e ON e.id = ev.experience_id
         WHERE ev.created_at >= v_since GROUP BY e.universe) t));
END $$;

REVOKE ALL ON FUNCTION public.prive_track(text, text, uuid, uuid, text, uuid), public.admin_prive_metrics(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_track(text, text, uuid, uuid, text, uuid), public.admin_prive_metrics(int) TO authenticated, service_role;
