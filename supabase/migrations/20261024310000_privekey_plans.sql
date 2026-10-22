-- THE PRIVÉ KEY (equipo privekey) · planes guardados, seguimiento honesto, viaje del recorrido y gustos rápidos.
-- Doc B §2 (guardar el plan, integrarlo al itinerario, seguimiento sin inventar reservas), §3 (medir el recorrido
-- "Your World is Ready": ≤ 2 minutos para abrir una experiencia) y §17 (costo).
-- Reglas:
--  * Toda RPC empieza con prive_require(_ps): sin sesión Privé válida no se guarda ni se lee nada.
--  * Un plan guardado solo conserva REFERENCIAS (experience_id, horas, paso): nombres, estado y enlaces se
--    vuelven a leer del catálogo al mostrarlo, así que un cliente no puede guardar "Confirmado" ni inventar un lugar.
--  * "Agregar al viaje" reutiliza prive_add_to_trip (bookings con trip_id, status 'pending'): el plan aparece en el
--    itinerario existente; nunca se crea un 'confirmed' aquí.
--  * Seguimiento: el estado de cada paso sale de lo que existe (solicitud Privé con su estado, elemento en el viaje
--    y si el proveedor lo confirmó CON evidencia). Nada más.
--  * Métricas sin texto libre (prive_key_events), panel solo para el equipo.
--  * Corrige prive_save_progress: descartaba onboarding.dna_consent, así que el Travel DNA nunca se podía activar
--    aunque el miembro dijera que sí (prive_user_signals lo lee de ahí).
-- Idempotente. REQUIERE AUTORIZACIÓN para aplicarse en producción.

-- ─────────────────────────────── Planes guardados ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.prive_key_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('key', 'h48', 'surprise')),
  tier text NOT NULL CHECK (tier IN ('signature', 'insider', 'unexpected')),
  wish text CHECK (wish IS NULL OR length(wish) <= 600),
  destination_slug text CHECK (destination_slug IS NULL OR destination_slug ~ '^[a-z0-9-]{2,80}$'),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 12),
  party_size int CHECK (party_size IS NULL OR party_size BETWEEN 1 AND 30),
  budget jsonb,
  trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  plan_group uuid,
  status text NOT NULL DEFAULT 'guardado' CHECK (status IN ('guardado', 'en_viaje', 'archivado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_key_plans_user ON public.prive_key_plans (user_id, created_at DESC);
ALTER TABLE public.prive_key_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_key_plans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_key_plans TO service_role;
-- Lectura directa de lo propio (por si una pantalla lo necesita); escribir, solo con las RPC.
GRANT SELECT ON public.prive_key_plans TO authenticated;
DROP POLICY IF EXISTS prive_key_plans_own_select ON public.prive_key_plans;
CREATE POLICY prive_key_plans_own_select ON public.prive_key_plans FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ─────────────────────────────── Recorrido (sin texto libre) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.prive_key_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('key_open', 'wish_submitted', 'questions_shown', 'proposals_shown', 'first_option', 'proposal_opened',
    'plan_saved', 'plan_added_to_trip', 'booking_opened', 'request_started', 'ask_iato', 'surprise_shown', 'surprise_another', 'surprise_love',
    'world_ready_shown', 'world_ready_open', 'taste_saved', 'limit_reached', 'no_coverage')),
  mode text CHECK (mode IS NULL OR mode IN ('key', 'h48', 'surprise')),
  tier text CHECK (tier IS NULL OR tier IN ('signature', 'insider', 'unexpected')),
  ms int CHECK (ms IS NULL OR ms BETWEEN 0 AND 86400000),
  destination_slug text CHECK (destination_slug IS NULL OR destination_slug ~ '^[a-z0-9-]{2,80}$'),
  plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_key_events_event_time ON public.prive_key_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS prive_key_events_user_time ON public.prive_key_events (user_id, created_at DESC);
ALTER TABLE public.prive_key_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_key_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_key_events TO service_role;

CREATE OR REPLACE FUNCTION public.prive_key_track(_ps text, _event text, _props jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_rl jsonb; p jsonb := coalesce(_props, '{}'::jsonb); v_ms int; v_plan uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _event NOT IN ('key_open', 'wish_submitted', 'questions_shown', 'proposals_shown', 'first_option', 'proposal_opened', 'plan_saved',
    'plan_added_to_trip', 'booking_opened', 'request_started', 'ask_iato', 'surprise_shown', 'surprise_another', 'surprise_love',
    'world_ready_shown', 'world_ready_open', 'taste_saved', 'limit_reached', 'no_coverage') THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN p := '{}'::jsonb; END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_key_track', 120, 60);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN false; END IF;
  v_ms := CASE WHEN (p->>'ms') ~ '^\d{1,8}$' AND (p->>'ms')::bigint <= 86400000 THEN (p->>'ms')::int END;
  v_plan := CASE WHEN (p->>'plan_id') ~ '^[0-9a-f-]{36}$' THEN (p->>'plan_id')::uuid END;
  INSERT INTO public.prive_key_events (user_id, event, mode, tier, ms, destination_slug, plan_id)
  VALUES (v_uid, _event,
    CASE WHEN p->>'mode' IN ('key', 'h48', 'surprise') THEN p->>'mode' END,
    CASE WHEN p->>'tier' IN ('signature', 'insider', 'unexpected') THEN p->>'tier' END,
    v_ms,
    CASE WHEN (p->>'destination') ~ '^[a-z0-9-]{2,80}$' THEN p->>'destination' END,
    CASE WHEN v_plan IS NOT NULL AND EXISTS (SELECT 1 FROM public.prive_key_plans k WHERE k.id = v_plan AND k.user_id = v_uid) THEN v_plan END);
  RETURN true;
END $$;

-- ─────────────────────────────── Guardar un plan ───────────────────────────────
-- _plan: { mode, tier, wish?, destination?, party_size?, budget?, steps:[{experience_id, date?, start?, end?, start_iso?, intent?, transfer_min?}] }
CREATE OR REPLACE FUNCTION public.prive_key_save(_ps text, _plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_rl jsonb; s jsonb; v_steps jsonb := '[]'; v_id uuid; v_budget jsonb; n_active int;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _plan IS NULL OR jsonb_typeof(_plan) <> 'object' OR length(_plan::text) > 60000 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  IF coalesce(_plan->>'mode', '') NOT IN ('key', 'h48', 'surprise') OR coalesce(_plan->>'tier', '') NOT IN ('signature', 'insider', 'unexpected')
     OR jsonb_typeof(_plan->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(_plan->'steps') NOT BETWEEN 1 AND 12 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_key_save', 30, 3600);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED'); END IF;
  SELECT count(*) INTO n_active FROM public.prive_key_plans WHERE user_id = v_uid AND status <> 'archivado';
  IF n_active >= 50 THEN RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY_PLANS'); END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(_plan->'steps') LOOP
    -- Solo experiencias publicables del catálogo (lo mismo que puede verse y pedirse).
    IF NOT ((s->>'experience_id') ~ '^[0-9a-f-]{36}$' AND EXISTS (SELECT 1 FROM public.prive_experiences_v e
             WHERE e.id = (s->>'experience_id')::uuid AND e.effective_state IN ('VERIFICADO', 'CURADO', 'ESTIMADO'))) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'UNKNOWN_EXPERIENCE');
    END IF;
    v_steps := v_steps || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'experience_id', s->>'experience_id',
      'date', CASE WHEN (s->>'date') ~ '^\d{4}-\d{2}-\d{2}$' THEN s->>'date' END,
      'start', CASE WHEN (s->>'start') ~ '^\d{2}:\d{2}$' THEN s->>'start' END,
      'end', CASE WHEN (s->>'end') ~ '^\d{2}:\d{2}$' THEN s->>'end' END,
      'start_iso', CASE WHEN (s->>'start_iso') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$' THEN s->>'start_iso' END,
      'intent', CASE WHEN (s->>'intent') ~ '^[a-z_]{2,30}$' THEN s->>'intent' END,
      'time_status', CASE WHEN s->>'time_status' IN ('horario_por_confirmar', 'segun_horario_publicado') THEN s->>'time_status' END,
      'transfer_min', CASE WHEN (s->>'transfer_min') ~ '^\d{1,3}$' THEN (s->>'transfer_min')::int END)));
  END LOOP;
  v_budget := CASE WHEN jsonb_typeof(_plan->'budget') = 'object' AND (_plan->'budget'->>'amount') ~ '^\d{1,8}$'
                    AND (_plan->'budget'->>'currency') ~ '^[A-Z]{3}$'
                   THEN jsonb_build_object('amount', (_plan->'budget'->>'amount')::int, 'currency', _plan->'budget'->>'currency') END;
  INSERT INTO public.prive_key_plans (user_id, mode, tier, wish, destination_slug, steps, party_size, budget)
  VALUES (v_uid, _plan->>'mode', _plan->>'tier', left(nullif(btrim(_plan->>'wish'), ''), 600),
    CASE WHEN (_plan->>'destination') ~ '^[a-z0-9-]{2,80}$' THEN _plan->>'destination' END, v_steps,
    CASE WHEN (_plan->>'party_size') ~ '^\d{1,2}$' AND (_plan->>'party_size')::int BETWEEN 1 AND 30 THEN (_plan->>'party_size')::int END, v_budget)
  RETURNING id INTO v_id;
  INSERT INTO public.prive_key_events (user_id, event, mode, tier, plan_id) VALUES (v_uid, 'plan_saved', _plan->>'mode', _plan->>'tier', v_id);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ─────────────────────────────── Agregar el plan al viaje (itinerario existente) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.prive_key_add_to_trip(_ps text, _plan_id uuid, _trip_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; k public.prive_key_plans; r jsonb; v_items jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO k FROM public.prive_key_plans WHERE id = _plan_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF _trip_id IS NULL OR NOT public.has_trip_access(_trip_id, v_uid) THEN RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); END IF;
  -- Ya está en ese viaje: no se duplica en el itinerario.
  IF k.trip_id = _trip_id AND k.plan_group IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.trip_id = _trip_id
       AND b.raw_payload->>'plan_group' = k.plan_group::text) THEN
    RETURN jsonb_build_object('ok', true, 'added', 0, 'already', true, 'plan_group', k.plan_group);
  END IF;
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('experience_id', s->>'experience_id', 'start_at', s->>'start_iso',
           'template', 'prive_key_' || k.tier, 'transfer_estimate_min', s->'transfer_min')))
    INTO v_items FROM jsonb_array_elements(k.steps) s;
  r := public.prive_add_to_trip(_ps, _trip_id, v_items);
  IF coalesce((r->>'ok')::boolean, false) THEN
    UPDATE public.prive_key_plans SET trip_id = _trip_id, plan_group = (r->>'plan_group')::uuid, status = 'en_viaje', updated_at = now()
     WHERE id = k.id;
    INSERT INTO public.prive_key_events (user_id, event, mode, tier, plan_id) VALUES (v_uid, 'plan_added_to_trip', k.mode, k.tier, k.id);
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.prive_key_archive(_ps text, _plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  UPDATE public.prive_key_plans SET status = 'archivado', updated_at = now() WHERE id = _plan_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', FOUND);
END $$;

-- ─────────────────────────────── Mis planes con seguimiento honesto ───────────────────────────────
-- Estado de cada paso, SOLO con lo que existe:
--   'propuesta'                 nada más (ni en el viaje ni pedido)
--   'en_viaje_sin_reservar'     está en el itinerario (bookings 'pending', provider iatos_prive)
--   'solicitado'/'pendiente_confirmacion'/'rechazado'/'cancelado'/'caducado'  estado real de la solicitud Privé
--   'confirmado_por_proveedor'  solo si la solicitud se confirmó con evidencia (external_confirmation)
CREATE OR REPLACE FUNCTION public.prive_key_plans(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_adult boolean;
BEGIN
  v_uid := public.prive_require(_ps);
  v_adult := public.prive_is_adult(v_uid);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', k.id, 'mode', k.mode, 'tier', k.tier, 'wish', k.wish, 'destination', k.destination_slug, 'party_size', k.party_size, 'budget', k.budget,
      'trip_id', k.trip_id, 'status', k.status, 'created_at', k.created_at,
      'trip_label', (SELECT t.destino FROM public.trips t WHERE t.id = k.trip_id AND public.has_trip_access(t.id, v_uid)),
      'steps', (SELECT coalesce(jsonb_agg(s || jsonb_build_object(
          'experience', CASE WHEN e.id IS NULL THEN NULL WHEN e.age_policy <> 'todas' AND NOT v_adult THEN jsonb_build_object('id', e.id, 'age_locked', true)
                             ELSE public.prive_exp_json(e) END,
          'follow_up', coalesce((SELECT CASE WHEN r.status = 'confirmado_externamente' AND r.external_confirmation IS NOT NULL THEN 'confirmado_por_proveedor'
                                             WHEN r.status = 'confirmado_externamente' THEN 'pendiente_confirmacion' ELSE r.status END
                                   FROM public.concierge_requests r
                                  WHERE r.user_id = v_uid AND r.type = 'prive_request' AND r.experience_id = e.id
                                  ORDER BY r.created_at DESC LIMIT 1),
                                CASE WHEN k.trip_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.trip_id = k.trip_id
                                       AND b.raw_payload->>'plan_group' = k.plan_group::text AND b.raw_payload->>'experience_id' = e.id::text)
                                     THEN 'en_viaje_sin_reservar' END,
                                'propuesta'),
          'available', e.effective_state IN ('VERIFICADO', 'CURADO', 'ESTIMADO'))
          ORDER BY o), '[]')
        FROM jsonb_array_elements(k.steps) WITH ORDINALITY AS x(s, o)
        LEFT JOIN public.prive_experiences_v e ON e.id = CASE WHEN (x.s->>'experience_id') ~ '^[0-9a-f-]{36}$' THEN (x.s->>'experience_id')::uuid END)
    ) ORDER BY k.created_at DESC)
    FROM public.prive_key_plans k WHERE k.user_id = v_uid AND k.status <> 'archivado'), '[]'::jsonb);
END $$;

-- ─────────────────────────────── Gustos rápidos (Your World is Ready sin datos) ───────────────────────────────
-- _taste: { loves: ['gastronomia','alta_cocina','noche','cultura','mar','bienestar','naturaleza','artesania'], budget: 'smart'|'estandar'|'premium'|'ultra' }
-- Agrega (no borra) valores en ai_user_preferences con los mismos códigos que lee prive_user_signals, y solo si
-- _consent es true marca onboarding.dna_consent: sin permiso, los gustos se guardan pero NO ordenan Privé.
CREATE OR REPLACE FUNCTION public.prive_key_taste_save(_ps text, _taste jsonb, _consent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_loves text[]; v_comida text[] := '{}'; v_tarde text[] := '{}'; v_budget text;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _taste IS NULL OR jsonb_typeof(_taste) <> 'object' OR length(_taste::text) > 2000 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  v_loves := ARRAY(SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_taste->'loves') = 'array' THEN _taste->'loves' ELSE '[]' END) x
                    WHERE x IN ('gastronomia', 'alta_cocina', 'noche', 'cultura', 'mar', 'bienestar', 'naturaleza', 'artesania') LIMIT 8);
  IF 'alta_cocina' = ANY (v_loves) THEN v_comida := v_comida || 'michelin'::text; END IF;
  IF 'gastronomia' = ANY (v_loves) THEN v_comida := v_comida || 'foodie'::text; END IF;
  IF 'cultura' = ANY (v_loves) THEN v_tarde := v_tarde || 'museos'::text; END IF;
  IF 'naturaleza' = ANY (v_loves) OR 'bienestar' = ANY (v_loves) THEN v_tarde := v_tarde || 'naturaleza'::text; END IF;
  IF 'noche' = ANY (v_loves) THEN v_tarde := v_tarde || 'nocturna'::text; END IF;
  IF 'mar' = ANY (v_loves) THEN v_tarde := v_tarde || 'playas'::text; END IF;
  IF 'artesania' = ANY (v_loves) THEN v_tarde := v_tarde || 'talleres'::text; END IF;
  v_budget := CASE WHEN _taste->>'budget' IN ('smart', 'estandar', 'premium', 'ultra') THEN _taste->>'budget' END;
  INSERT INTO public.ai_user_preferences (user_id, estilo_comida, actividades_tarde, nivel_presupuesto)
  VALUES (v_uid, v_comida, v_tarde, v_budget)
  ON CONFLICT (user_id) DO UPDATE SET
    estilo_comida = ARRAY(SELECT DISTINCT unnest(coalesce(public.ai_user_preferences.estilo_comida, '{}') || EXCLUDED.estilo_comida)),
    actividades_tarde = ARRAY(SELECT DISTINCT unnest(coalesce(public.ai_user_preferences.actividades_tarde, '{}') || EXCLUDED.actividades_tarde)),
    nivel_presupuesto = coalesce(EXCLUDED.nivel_presupuesto, public.ai_user_preferences.nivel_presupuesto);
  IF _consent IS NOT NULL THEN
    UPDATE public.prive_memberships SET onboarding = onboarding || jsonb_build_object('dna_consent', _consent), updated_at = now() WHERE user_id = v_uid;
  END IF;
  INSERT INTO public.prive_key_events (user_id, event) VALUES (v_uid, 'taste_saved');
  RETURN jsonb_build_object('ok', true, 'loves', to_jsonb(v_loves), 'dna_consent', _consent);
END $$;

-- ─────────────────────────────── Corrección: dna_consent sí se guarda ───────────────────────────────
-- Igual que 20261023090200 + la llave dna_consent (true/false/null). Antes se descartaba en silencio.
CREATE OR REPLACE FUNCTION public.prive_save_progress(_user uuid, _welcome_version int, _onboarding jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.prive_access_code(_user);
  v_clean jsonb := '{}'::jsonb;
  v_ts text;
  m public.prive_memberships%ROWTYPE;
BEGIN
  IF v_code IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', v_code); END IF;
  IF _welcome_version IS NOT NULL AND (_welcome_version < 0 OR _welcome_version > 1000) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;
  IF _onboarding IS NOT NULL THEN
    IF jsonb_typeof(_onboarding) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
    IF _onboarding ? 'version' THEN
      IF jsonb_typeof(_onboarding->'version') <> 'number' THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
      v_clean := v_clean || jsonb_build_object('version', least(greatest((_onboarding->>'version')::numeric::int, 0), 1000));
    END IF;
    IF _onboarding ? 'step' THEN
      IF jsonb_typeof(_onboarding->'step') NOT IN ('number', 'string') OR length(_onboarding->>'step') > 40
         OR (_onboarding->>'step') !~ '^[A-Za-z0-9_.-]+$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
      END IF;
      v_clean := v_clean || jsonb_build_object('step', _onboarding->'step');
    END IF;
    FOREACH v_ts IN ARRAY ARRAY['completed_at', 'skipped_at'] LOOP
      IF _onboarding ? v_ts THEN
        IF jsonb_typeof(_onboarding->v_ts) = 'null' THEN
          v_clean := v_clean || jsonb_build_object(v_ts, NULL);
        ELSE
          BEGIN
            v_clean := v_clean || jsonb_build_object(v_ts,
              to_char((_onboarding->>v_ts)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
          EXCEPTION WHEN others THEN
            RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
          END;
        END IF;
      END IF;
    END LOOP;
    IF _onboarding ? 'dna_consent' THEN
      IF jsonb_typeof(_onboarding->'dna_consent') NOT IN ('boolean', 'null') THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
      v_clean := v_clean || jsonb_build_object('dna_consent', _onboarding->'dna_consent');
    END IF;
  END IF;
  UPDATE public.prive_memberships
     SET welcome_version_seen = greatest(welcome_version_seen, coalesce(_welcome_version, 0)),
         onboarding = onboarding || v_clean, updated_at = now()
   WHERE user_id = _user RETURNING * INTO m;
  RETURN jsonb_build_object('ok', true, 'welcome_version_seen', m.welcome_version_seen, 'onboarding', m.onboarding);
END $$;
REVOKE ALL ON FUNCTION public.prive_save_progress(uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_save_progress(uuid, int, jsonb) TO service_role;

-- ─────────────────────────────── Panel del equipo (Doc B §3, §17, §18) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_prive_key_metrics(_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 365)));
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_prive_key_metrics: solo el equipo' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'since', v_since,
    'events', (SELECT coalesce(jsonb_object_agg(event, n), '{}') FROM (SELECT event, count(*) n FROM public.prive_key_events WHERE created_at >= v_since GROUP BY event) x),
    'members_using_key', (SELECT count(DISTINCT user_id) FROM public.prive_key_events WHERE created_at >= v_since AND event = 'proposals_shown'),
    'first_option_ms_p50', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FROM public.prive_key_events WHERE created_at >= v_since AND event = 'first_option' AND ms IS NOT NULL),
    'first_option_ms_p90', (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY ms) FROM public.prive_key_events WHERE created_at >= v_since AND event = 'first_option' AND ms IS NOT NULL),
    'world_ready_open_ms_p50', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FROM public.prive_key_events WHERE created_at >= v_since AND event = 'world_ready_open' AND ms IS NOT NULL),
    'world_ready_within_2min_pct', (SELECT round(100.0 * count(*) FILTER (WHERE ms <= 120000) / nullif(count(*), 0), 1) FROM public.prive_key_events
                                    WHERE created_at >= v_since AND event = 'world_ready_open' AND ms IS NOT NULL),
    'activated_members', (SELECT count(*) FROM public.prive_memberships WHERE activated_at >= v_since),
    'activated_with_first_key', (SELECT count(*) FROM public.prive_memberships m WHERE m.activated_at >= v_since
                                   AND EXISTS (SELECT 1 FROM public.prive_key_events e WHERE e.user_id = m.user_id AND e.event = 'proposals_shown')),
    'plans_saved', (SELECT count(*) FROM public.prive_key_plans WHERE created_at >= v_since),
    'plans_in_trips', (SELECT count(*) FROM public.prive_key_plans WHERE created_at >= v_since AND trip_id IS NOT NULL),
    'by_tier_saved', (SELECT coalesce(jsonb_object_agg(tier, n), '{}') FROM (SELECT tier, count(*) n FROM public.prive_key_plans WHERE created_at >= v_since GROUP BY tier) x),
    'ai_cost_usd', 0);
END $$;

REVOKE ALL ON FUNCTION public.prive_key_track(text, text, jsonb), public.prive_key_save(text, jsonb), public.prive_key_add_to_trip(text, uuid, uuid),
  public.prive_key_archive(text, uuid), public.prive_key_plans(text), public.prive_key_taste_save(text, jsonb, boolean),
  public.admin_prive_key_metrics(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_key_track(text, text, jsonb), public.prive_key_save(text, jsonb), public.prive_key_add_to_trip(text, uuid, uuid),
  public.prive_key_archive(text, uuid), public.prive_key_plans(text), public.prive_key_taste_save(text, jsonb, boolean),
  public.admin_prive_key_metrics(int) TO authenticated, service_role;
