-- IATOS Privé (grupo catalog) · 7/9 · RPC de contenido, personalización, guardados y viaje.
-- Contrato (scratchpad prive_contract.md §5): TODA RPC de contenido es plpgsql SECURITY DEFINER y su
-- primera línea es v_uid := public.prive_require(_ps). prive_require la construye el grupo core: valida
-- sesión de IATOS, PRO vigente, 90 días pagados (o concesión), membresía activa y la sesión Privé del
-- usuario. Sin eso, RAISE 'PRIVE_*' y no sale ningún nombre.
-- La única excepción es prive_teaser(): conteos, universos y destinos; nunca nombres ni direcciones.
--
-- Qué se muestra:
--  * VERIFICADO, CURADO, ESTIMADO vigentes: sí, con su estado, fecha y etiqueta efectiva;
--  * DESACTUALIZADO (más de 90 días): solo en la página del destino, marcado "por verificar"; Iato no lo
--    recomienda (prive_search lo excluye);
--  * PENDIENTE y NO DISPONIBLE (cerrado, evento pasado, fuera de vigencia, reemplazado): nunca;
--  * 18+ / 21+: solo a quien hizo la declaración de mayoría de edad (prive_confirm_adult); a los demás
--    solo se les dice cuántas hay;
--  * precio y horario: solo con su fuente; si no, null (la pantalla dice "por confirmar").
-- Las RPC con sesión son VOLATILE (por omisión) para que prive_require pueda refrescar el reloj de
-- inactividad de la sesión Privé.
-- Idempotente.

-- Tarjeta de una experiencia (lo que ve la app). _full agrega fuentes, descripción y reglas.
CREATE OR REPLACE FUNCTION public.prive_exp_json(e public.prive_experiences_v, _full boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'name', e.name, 'universe', e.universe, 'subcategory', e.subcategory,
    'destination', (SELECT jsonb_build_object('slug', d.slug, 'name', d.name_es, 'timezone', d.timezone, 'currency', d.currency)
                      FROM public.prive_destinations d WHERE d.id = e.destination_id),
    'neighborhood', (SELECT n.name_es FROM public.prive_destinations n WHERE n.id = e.neighborhood_id),
    'state', e.effective_state, 'verified_at', e.verified_at,
    'label', CASE WHEN e.effective_label <> 'NINGUNA' THEN e.effective_label END,
    'label_evidence', CASE
       WHEN e.effective_label = 'BENEFICIO_EXCLUSIVO' THEN (SELECT jsonb_build_object('benefit', b.benefit_es, 'conditions', b.conditions_es,
              'valid_to', coalesce(b.valid_to, a.valid_to), 'partner', p.trade_name)
            FROM public.prive_partner_benefits b JOIN public.prive_partner_agreements a ON a.id = b.agreement_id
            JOIN public.prive_partners p ON p.id = a.partner_id WHERE b.id = e.benefit_id)
       WHEN e.effective_label = 'PARTNER_VERIFICADO' THEN (SELECT jsonb_build_object('partner', coalesce(p.trade_name, p.legal_name), 'valid_to', a.valid_to)
            FROM public.prive_partner_agreements a JOIN public.prive_partners p ON p.id = a.partner_id WHERE a.id = e.partner_agreement_id)
       WHEN e.effective_label = 'EXPERIENCIA_PRIVADA' THEN jsonb_build_object('operator', e.operator_name, 'operator_url', e.operator_url,
            'conditions', e.private_conditions_es)
       WHEN e.effective_label = 'EXPERIENCIA_CURADA' THEN jsonb_build_object('sources', jsonb_array_length(e.sources), 'verified_at', e.verified_at)
     END,
    'why', e.why_fact_es, 'address', e.address, 'lat', e.lat, 'lng', e.lng, 'geo_precision', e.geo_precision,
    'website', e.website, 'booking_url', e.booking_url, 'booking_method', e.booking_method, 'reservation_required', e.reservation_required,
    'age_policy', e.age_policy, 'dress_code', e.dress_code_es,
    'price_level', e.price_level, 'price_note', e.price_note_es,
    'price', CASE WHEN e.price_source_url IS NOT NULL AND (e.price_min IS NOT NULL OR e.price_max IS NOT NULL) THEN jsonb_build_object(
       'min', e.price_min, 'max', e.price_max, 'currency', e.price_currency, 'basis', e.price_basis, 'source', e.price_source_url,
       'checked_at', e.price_checked_at, 'stale', e.price_stale) END,
    'opening_hours', CASE WHEN e.opening_hours_source IS NOT NULL THEN jsonb_build_object('hours', e.opening_hours,
       'source', e.opening_hours_source, 'checked_at', e.opening_hours_checked_at) END,
    'duration_min', e.typical_duration_min,
    'season', CASE WHEN e.season_state IS NOT NULL OR e.season_note_es IS NOT NULL THEN jsonb_build_object('state', e.season_state,
       'note', e.season_note_es, 'months', e.season_months, 'reopens_on', e.season_reopens_on, 'closes_on', e.season_closes_on,
       'source', e.season_source) END,
    'availability', jsonb_build_object('state', e.availability_state, 'checked_at', e.availability_checked_at),
    'operating_status', e.operating_status,
    'restrictions', e.restrictions_es, 'members_only_venue', CASE WHEN e.is_members_only_venue THEN true END,
    'accolades', CASE WHEN jsonb_array_length(e.accolades) > 0 THEN e.accolades END,
    'image', jsonb_build_object('source', e.image_source, 'query', e.image_query, 'url', e.image_url,
       'photographer', e.image_photographer, 'photographer_url', e.image_photographer_url, 'page_url', e.image_page_url,
       'illustrative', e.image_is_illustrative, 'alt', e.image_alt_es),
    'description', CASE WHEN _full THEN e.description_es END,
    'sources', CASE WHEN _full THEN e.sources END,
    'safety', CASE WHEN _full OR e.universe = 'adventure_elite' THEN e.safety_requirements_es END,
    'operator', CASE WHEN e.universe = 'adventure_elite' THEN e.operator_name END,
    'license', CASE WHEN e.universe = 'casino_grand_nights' THEN jsonb_build_object('authority', e.license_authority,
       'ref', e.license_ref, 'source', e.license_source) END,
    'booking_policy', CASE WHEN _full THEN e.booking_policy_es END,
    'cancellation', CASE WHEN _full THEN e.cancellation_es END,
    'event_start', e.event_start, 'event_end', e.event_end, 'valid_to', e.valid_to,
    'tags', CASE WHEN cardinality(e.tags) > 0 THEN to_jsonb(e.tags) END));
$$;

CREATE OR REPLACE FUNCTION public.prive_is_adult(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.prive_age_confirmations c
                 WHERE c.user_id = _uid
                   AND c.terms_version = coalesce((SELECT value #>> '{}' FROM public.app_flags WHERE key = 'prive_adult_terms_version'), c.terms_version));
$$;

-- Señales del usuario para "Para ti" (fórmula fija, sin IA). Ver MODELO_DE_DATOS §4.1.
CREATE OR REPLACE FUNCTION public.prive_user_signals(_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; aff jsonb := '{}'::jsonb; lvl int; h record;
BEGIN
  SELECT nivel_presupuesto, coalesce(estilo_comida, '{}') AS comida, coalesce(actividades_tarde, '{}') AS tarde
    INTO p FROM public.ai_user_preferences WHERE user_id = _uid;
  IF FOUND THEN
    lvl := CASE lower(coalesce(p.nivel_presupuesto, '')) WHEN 'smart' THEN 1 WHEN 'estandar' THEN 2 WHEN 'premium' THEN 3
           WHEN 'ultra' THEN 4 WHEN 'alto' THEN 3 END;
    IF 'michelin' = ANY (p.comida) THEN aff := aff || jsonb_build_object('the_table', 20); END IF;
    IF 'foodie' = ANY (p.comida) THEN aff := aff || jsonb_build_object('the_table', greatest(coalesce((aff->>'the_table')::int, 0), 10), 'signature_mexico', 10); END IF;
    IF 'museos' = ANY (p.tarde) THEN aff := aff || jsonb_build_object('culture_access', 20); END IF;
    IF 'naturaleza' = ANY (p.tarde) THEN aff := aff || jsonb_build_object('adventure_elite', 15, 'wellness_escape', 10); END IF;
    IF 'nocturna' = ANY (p.tarde) THEN aff := aff || jsonb_build_object('after_dark', 20); END IF;
    IF 'playas' = ANY (p.tarde) THEN aff := aff || jsonb_build_object('yacht_sea', 15, 'wellness_escape', greatest(coalesce((aff->>'wellness_escape')::int, 0), 5)); END IF;
    IF 'talleres' = ANY (p.tarde) THEN aff := aff || jsonb_build_object('signature_mexico', 15, 'culture_access', greatest(coalesce((aff->>'culture_access')::int, 0), 10)); END IF;
  END IF;
  -- Historial propio en Privé (fichas abiertas y guardados de 90 días): +3 por evento, máximo +10.
  FOR h IN SELECT e.universe, count(*) AS n FROM public.prive_events ev JOIN public.prive_experiences e ON e.id = ev.experience_id
            WHERE ev.user_id = _uid AND ev.event IN ('detail_open','save') AND ev.created_at > now() - interval '90 days'
            GROUP BY e.universe LOOP
    aff := aff || jsonb_build_object(h.universe, least(30, coalesce((aff->>h.universe)::int, 0) + least(10, 3 * h.n::int)));
  END LOOP;
  RETURN jsonb_build_object('budget_level', lvl, 'affinity', aff,
    'opened_recently', coalesce((SELECT jsonb_agg(DISTINCT experience_id) FROM public.prive_events
       WHERE user_id = _uid AND event = 'detail_open' AND created_at > now() - interval '30 days' AND experience_id IS NOT NULL), '[]'));
END $$;

-- Puntuación determinista con razones legibles (Iato solo las explica; no inventa).
CREATE OR REPLACE FUNCTION public.prive_score(_sig jsonb, e public.prive_experiences_v, _budget int, _trip_dest uuid,
  _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s int := 0; r text[] := '{}'; a int; lvl int := coalesce(_budget, (_sig->>'budget_level')::int); best_year int;
BEGIN
  a := least(30, coalesce((_sig->'affinity'->>e.universe)::int, 0));
  IF a > 0 THEN s := s + a; r := r || ('dna:' || e.universe); END IF;
  IF lvl IS NOT NULL AND e.price_level IS NOT NULL THEN
    IF abs(lvl - e.price_level) = 0 THEN s := s + 15; r := r || ('presupuesto:nivel_' || e.price_level);
    ELSIF abs(lvl - e.price_level) = 1 THEN s := s + 5;
    ELSE s := s - 20; r := r || ('presupuesto:lejos_nivel_' || e.price_level); END IF;
  END IF;
  IF _trip_dest IS NOT NULL AND (e.destination_id = _trip_dest) THEN s := s + 20; r := r || 'viaje:destino_del_viaje'::text; END IF;
  IF e.event_start IS NOT NULL AND _from IS NOT NULL AND _to IS NOT NULL
     AND e.event_start::date BETWEEN _from AND _to THEN s := s + 10; r := r || 'viaje:evento_en_tus_fechas'::text; END IF;
  IF e.effective_state = 'VERIFICADO' THEN s := s + 10; r := r || 'calidad:verificado'::text;
  ELSIF e.effective_state = 'CURADO' THEN s := s + 5; END IF;
  SELECT max((x->>'year')::int) INTO best_year FROM jsonb_array_elements(e.accolades) x;
  IF best_year >= 2024 THEN s := s + 5; r := r || ('premio:' || best_year); END IF;
  IF NOT coalesce((_sig->'opened_recently') ? e.id::text, false) THEN s := s + 5; END IF;
  RETURN jsonb_build_object('score', s, 'reasons', to_jsonb(r));
END $$;

-- ─────────────────────────────── Adelanto (sin sesión Privé) ───────────────────────────────────────
-- Para cuentas gratis y PRO con menos de 90 días: universos, destinos y conteos. Nada más.
CREATE OR REPLACE FUNCTION public.prive_teaser()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PRIVE_NO_SESSION' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object(
    'universes', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', u, 'count', coalesce(c.n, 0)) ORDER BY o), '[]')
       FROM unnest(ARRAY['the_table','after_dark','casino_grand_nights','yacht_sea','private_stays','iconic_events','culture_access',
                         'wellness_escape','adventure_elite','sport_leisure','celebrations','signature_mexico']) WITH ORDINALITY AS t(u, o)
       LEFT JOIN (SELECT universe, count(*) n FROM public.prive_experiences_v
                   WHERE effective_state IN ('VERIFICADO','CURADO','ESTIMADO') GROUP BY universe) c ON c.universe = t.u),
    'destinations', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name_es, 'region_group', d.region_group,
          'kind', d.kind, 'coverage', public.prive_destination_coverage(d.id)->>'level',
          'count', (SELECT count(*) FROM public.prive_experiences_v e WHERE e.destination_id = d.id
                      AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO'))) ORDER BY d.sort_order), '[]')
       FROM public.prive_destinations d WHERE d.is_destination AND d.active),
    'total', (SELECT count(*) FROM public.prive_experiences_v WHERE effective_state IN ('VERIFICADO','CURADO','ESTIMADO')));
END $$;

-- ─────────────────────────────── Contenido (con sesión Privé) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prive_home(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN public.prive_teaser() || jsonb_build_object('adult_confirmed', public.prive_is_adult(v_uid),
    'adult_terms_version', (SELECT value #>> '{}' FROM public.app_flags WHERE key = 'prive_adult_terms_version'));
END $$;

CREATE OR REPLACE FUNCTION public.prive_destination(_ps text, _slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; d record; v_adult boolean; v_sig jsonb; v_items jsonb; v_locked int;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO d FROM public.prive_destinations WHERE id = public.prive_resolve_destination(_slug) AND is_destination;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  v_adult := public.prive_is_adult(v_uid);
  v_sig := public.prive_user_signals(v_uid);
  SELECT coalesce(jsonb_agg(public.prive_exp_json(e) || jsonb_build_object('score', public.prive_score(v_sig, e, NULL, NULL, NULL, NULL))
           ORDER BY (e.effective_state = 'DESACTUALIZADO'), e.universe, e.name), '[]')
    INTO v_items
    FROM public.prive_experiences_v e
   WHERE (e.destination_id = d.id OR (d.kind = 'neighborhood' AND e.neighborhood_id = d.id))
     AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO','DESACTUALIZADO')
     AND (e.age_policy = 'todas' OR v_adult);
  SELECT count(*) INTO v_locked FROM public.prive_experiences_v e
   WHERE (e.destination_id = d.id OR (d.kind = 'neighborhood' AND e.neighborhood_id = d.id))
     AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO','DESACTUALIZADO') AND e.age_policy <> 'todas' AND NOT v_adult;
  INSERT INTO public.prive_events (user_id, event, destination_id, surface) VALUES (v_uid, 'city_view', d.id, 'city');
  RETURN jsonb_build_object('found', true,
    'destination', jsonb_strip_nulls(jsonb_build_object('slug', d.slug, 'name', d.name_es, 'name_en', d.name_en, 'kind', d.kind,
       'admin_area', d.admin_area, 'lat', d.lat, 'lng', d.lng, 'timezone', d.timezone, 'currency', d.currency,
       'region_group', d.region_group, 'intro', d.editor_intro_es, 'cover_query', coalesce(d.cover_image_query, d.name_en || ' skyline'),
       'parent', (SELECT jsonb_build_object('slug', p.slug, 'name', p.name_es) FROM public.prive_destinations p WHERE p.id = d.parent_id AND p.is_destination),
       'neighborhoods', (SELECT jsonb_agg(jsonb_build_object('slug', n.slug, 'name', n.name_es) ORDER BY n.sort_order)
                           FROM public.prive_destinations n WHERE n.parent_id = d.id AND n.kind = 'neighborhood'),
       'areas', (SELECT jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.name_es)) FROM public.prive_destination_members m
                   JOIN public.prive_destinations a ON a.id = m.area_id WHERE m.destination_id = d.id))),
    'coverage', public.prive_destination_coverage(d.id),
    'experiences', v_items, 'age_locked_count', v_locked, 'adult_confirmed', v_adult,
    'adult_terms_version', (SELECT value #>> '{}' FROM public.app_flags WHERE key = 'prive_adult_terms_version'));
END $$;

CREATE OR REPLACE FUNCTION public.prive_universe(_ps text, _universe text, _destination text DEFAULT NULL, _limit int DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_adult boolean; v_sig jsonb; v_dest uuid; v_items jsonb; v_locked int;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _universe NOT IN ('the_table','after_dark','casino_grand_nights','yacht_sea','private_stays','iconic_events','culture_access',
                       'wellness_escape','adventure_elite','sport_leisure','celebrations','signature_mexico') THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  v_adult := public.prive_is_adult(v_uid);
  v_sig := public.prive_user_signals(v_uid);
  v_dest := CASE WHEN _destination IS NOT NULL THEN public.prive_resolve_destination(_destination) END;
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.sc DESC, x.nm), '[]') INTO v_items FROM (
    SELECT public.prive_exp_json(e) || jsonb_build_object('score', sc) AS j, (sc->>'score')::int AS sc, e.name AS nm
      FROM public.prive_experiences_v e, LATERAL public.prive_score(v_sig, e, NULL, NULL, NULL, NULL) sc
     WHERE e.universe = _universe AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')
       AND (v_dest IS NULL OR e.destination_id = v_dest)
       AND (e.age_policy = 'todas' OR v_adult)
     ORDER BY (sc->>'score')::int DESC, e.name LIMIT greatest(1, least(coalesce(_limit, 60), 200))) x;
  SELECT count(*) INTO v_locked FROM public.prive_experiences_v e
   WHERE e.universe = _universe AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')
     AND (v_dest IS NULL OR e.destination_id = v_dest) AND e.age_policy <> 'todas' AND NOT v_adult;
  INSERT INTO public.prive_events (user_id, event, destination_id, surface) VALUES (v_uid, 'home_view', v_dest, 'home');
  RETURN jsonb_build_object('found', true, 'universe', _universe, 'experiences', v_items, 'age_locked_count', v_locked,
    'adult_confirmed', v_adult, 'adult_terms_version', (SELECT value #>> '{}' FROM public.app_flags WHERE key = 'prive_adult_terms_version'));
END $$;

CREATE OR REPLACE FUNCTION public.prive_experience(_ps text, _id_or_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; e public.prive_experiences_v; v_saved boolean; v_requested boolean;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO e FROM public.prive_experiences_v x
   WHERE x.slug = _id_or_slug OR (_id_or_slug ~ '^[0-9a-f-]{36}$' AND x.id = _id_or_slug::uuid) LIMIT 1;
  IF NOT FOUND OR e.effective_state = 'PENDIENTE' THEN RETURN jsonb_build_object('found', false); END IF;
  v_saved := EXISTS (SELECT 1 FROM public.recomendaciones r WHERE r.user_id = v_uid AND r.experience_id = e.id AND r.guardado);
  v_requested := EXISTS (SELECT 1 FROM public.concierge_requests r WHERE r.user_id = v_uid AND r.experience_id = e.id);
  -- NO DISPONIBLE solo se muestra a quien ya la había guardado o pedido (en gris, sin solicitar).
  IF e.effective_state = 'NO_DISPONIBLE' AND NOT (v_saved OR v_requested) THEN RETURN jsonb_build_object('found', false); END IF;
  IF e.age_policy <> 'todas' AND NOT public.prive_is_adult(v_uid) THEN
    RETURN jsonb_build_object('found', true, 'age_locked', true, 'age_policy', e.age_policy);
  END IF;
  INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, surface) VALUES (v_uid, 'detail_open', e.id, e.destination_id, 'city');
  RETURN jsonb_build_object('found', true, 'experience', public.prive_exp_json(e, true)
    || jsonb_build_object('saved', v_saved, 'requested', v_requested,
         'can_request', e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO'),
         'score', public.prive_score(public.prive_user_signals(v_uid), e, NULL, NULL, NULL, NULL)));
END $$;

-- Búsqueda de Iato (herramienta search_prive): por ciudad, agrupada, máximo N por universo y ciudad.
-- Excluye PENDIENTE, DESACTUALIZADO y NO DISPONIBLE. Un casino solo aparece si se pidió el universo.
CREATE OR REPLACE FUNCTION public.prive_search(_ps text, _cities text[], _universes text[] DEFAULT NULL,
  _keywords text[] DEFAULT NULL, _date_from date DEFAULT NULL, _date_to date DEFAULT NULL, _party int DEFAULT NULL,
  _budget int DEFAULT NULL, _per_universe int DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid; v_adult boolean; v_sig jsonb; c text; v_dest uuid; d record; v_out jsonb := '[]'; v_items jsonb; v_kw text;
BEGIN
  v_uid := public.prive_require(_ps);
  v_adult := public.prive_is_adult(v_uid);
  v_sig := public.prive_user_signals(v_uid);
  v_kw := CASE WHEN _keywords IS NOT NULL AND cardinality(_keywords) > 0
               THEN '(' || array_to_string(ARRAY(SELECT regexp_replace(public.prive_norm(k), '\s+', '.*', 'g')
                                                FROM unnest(_keywords) k WHERE public.prive_norm(k) <> ''), '|') || ')' END;
  IF v_kw = '()' THEN v_kw := NULL; END IF;
  FOREACH c IN ARRAY coalesce(_cities[1:5], '{}') LOOP
    v_dest := public.prive_resolve_destination(c);
    SELECT * INTO d FROM public.prive_destinations WHERE id = v_dest;
    IF d.kind = 'neighborhood' THEN SELECT * INTO d FROM public.prive_destinations WHERE id = d.parent_id; END IF;
    IF v_dest IS NULL OR NOT d.is_destination THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('query', left(c, 80), 'resolved', false,
                 'coverage', 'SIN_COBERTURA_VERIFICADA', 'items', '[]'::jsonb));
      CONTINUE;
    END IF;
    SELECT coalesce(jsonb_agg(z.j ORDER BY z.sc DESC), '[]') INTO v_items FROM (
      SELECT y.j, y.sc FROM (
        SELECT public.prive_exp_json(e) || jsonb_build_object('reasons', sc->'reasons', 'score', (sc->>'score')::int) AS j,
               (sc->>'score')::int AS sc,
               row_number() OVER (PARTITION BY e.universe ORDER BY (sc->>'score')::int DESC, e.name) AS rn
          FROM public.prive_experiences_v e,
               LATERAL public.prive_score(v_sig, e, _budget, d.id, _date_from, _date_to) sc
         WHERE e.destination_id = d.id
           AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')
           AND e.operating_status IN ('abierto','desconocido','cerrado_temporal')
           AND (e.age_policy = 'todas' OR v_adult)
           AND ((_universes IS NOT NULL AND e.universe = ANY (_universes))
                OR (v_kw IS NOT NULL AND (public.prive_norm(e.subcategory || ' ' || e.name || ' ' || array_to_string(e.tags, ' ')) ~ v_kw))
                OR (_universes IS NULL AND v_kw IS NULL AND e.universe <> 'casino_grand_nights'))
      ) y WHERE y.rn <= greatest(1, least(coalesce(_per_universe, 3), 6))) z;
    INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, surface)
    SELECT v_uid, 'iato_pick_shown', (x->>'id')::uuid, d.id, 'iato' FROM jsonb_array_elements(v_items) x;
    v_out := v_out || jsonb_build_array(jsonb_build_object('query', left(c, 80), 'resolved', true,
      'city', jsonb_build_object('slug', d.slug, 'name', d.name_es, 'timezone', d.timezone, 'currency', d.currency, 'lat', d.lat, 'lng', d.lng),
      'coverage', public.prive_destination_coverage(d.id)->>'level', 'items', v_items,
      'age_locked', (NOT v_adult AND EXISTS (SELECT 1 FROM public.prive_experiences_v e WHERE e.destination_id = d.id
                       AND e.age_policy <> 'todas' AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')))));
  END LOOP;
  RETURN jsonb_build_object('available', true, 'cities', v_out, 'adult_confirmed', v_adult);
END $$;

-- "Para ti en <destino>": máximo 2 por universo en los primeros N, casinos solo con señal propia.
CREATE OR REPLACE FUNCTION public.prive_for_you(_ps text, _destination text, _from date DEFAULT NULL, _to date DEFAULT NULL,
  _limit int DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid; v_sig jsonb; v_adult boolean;
BEGIN
  v_uid := public.prive_require(_ps);
  v_dest := public.prive_resolve_destination(_destination);
  IF v_dest IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_sig := public.prive_user_signals(v_uid);
  v_adult := public.prive_is_adult(v_uid);
  RETURN coalesce((SELECT jsonb_agg(y.j ORDER BY y.sc DESC) FROM (
    SELECT x.j, x.sc FROM (
      SELECT public.prive_exp_json(e) || jsonb_build_object('reasons', sc->'reasons', 'score', (sc->>'score')::int) AS j,
             (sc->>'score')::int AS sc, row_number() OVER (PARTITION BY e.universe ORDER BY (sc->>'score')::int DESC) AS rn
        FROM public.prive_experiences_v e, LATERAL public.prive_score(v_sig, e, NULL, v_dest, _from, _to) sc
       WHERE e.destination_id = v_dest AND e.effective_state IN ('VERIFICADO','CURADO','ESTIMADO')
         AND (e.age_policy = 'todas' OR v_adult)
         AND (e.universe <> 'casino_grand_nights' OR (v_sig->'affinity') ? 'casino_grand_nights')) x
     WHERE x.rn <= 2 ORDER BY x.sc DESC LIMIT greatest(1, least(coalesce(_limit, 8), 24))) y), '[]'::jsonb);
END $$;

-- Declaración 18+ (versión de términos vigente). Solo esta función escribe la tabla.
CREATE OR REPLACE FUNCTION public.prive_confirm_adult(_ps text, _terms_version text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_current text;
BEGIN
  v_uid := public.prive_require(_ps);
  v_current := (SELECT value #>> '{}' FROM public.app_flags WHERE key = 'prive_adult_terms_version');
  IF _terms_version IS DISTINCT FROM v_current THEN RETURN false; END IF;
  INSERT INTO public.prive_age_confirmations (user_id, terms_version, confirmed_at) VALUES (v_uid, _terms_version, now())
  ON CONFLICT (user_id) DO UPDATE SET terms_version = EXCLUDED.terms_version, confirmed_at = now();
  RETURN true;
END $$;

-- ─────────────────────────────── Guardados (estado "guardado") ─────────────────────────────────────
ALTER TABLE public.recomendaciones ADD COLUMN IF NOT EXISTS experience_id uuid REFERENCES public.prive_experiences(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recomendaciones_user_experience_uq ON public.recomendaciones (user_id, experience_id) WHERE experience_id IS NOT NULL;

-- El cliente no puede fabricar un "guardado" de Privé escribiendo experience_id directo: solo prive_save().
CREATE OR REPLACE FUNCTION public.prive_recomendaciones_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.experience_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.experience_id IS DISTINCT FROM OLD.experience_id)
     AND nullif(current_setting('prive.actor', true), '') IS NULL AND coalesce(auth.role(), '') <> 'service_role'
     AND current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'recomendaciones: los guardados de Privé solo se crean con prive_save()';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prive_recomendaciones_guard ON public.recomendaciones;
CREATE TRIGGER prive_recomendaciones_guard BEFORE INSERT OR UPDATE ON public.recomendaciones
  FOR EACH ROW EXECUTE FUNCTION public.prive_recomendaciones_guard();

CREATE OR REPLACE FUNCTION public.prive_save(_ps text, _experience_id uuid, _saved boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; e public.prive_experiences_v;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO e FROM public.prive_experiences_v WHERE id = _experience_id;
  IF NOT FOUND OR e.effective_state = 'PENDIENTE' THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  PERFORM set_config('prive.actor', 'usuario', true);
  IF _saved THEN
    INSERT INTO public.recomendaciones (user_id, tipo, titulo, descripcion, guardado, metadata, experience_id)
    VALUES (v_uid, 'prive', left(e.name, 200), e.why_fact_es, true,
            jsonb_build_object('slug', e.slug, 'universe', e.universe, 'source', 'prive'), e.id)
    ON CONFLICT (user_id, experience_id) WHERE experience_id IS NOT NULL DO UPDATE SET guardado = true;
  ELSE
    UPDATE public.recomendaciones SET guardado = false WHERE user_id = v_uid AND experience_id = e.id;
  END IF;
  PERFORM set_config('prive.actor', '', true);
  INSERT INTO public.prive_events (user_id, event, experience_id, destination_id, surface)
  VALUES (v_uid, CASE WHEN _saved THEN 'save' ELSE 'unsave' END, e.id, e.destination_id, 'favoritos');
  RETURN jsonb_build_object('ok', true, 'saved', _saved);
END $$;

CREATE OR REPLACE FUNCTION public.prive_saved(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN coalesce((SELECT jsonb_agg(public.prive_exp_json(e) ORDER BY r.created_at DESC)
    FROM public.recomendaciones r JOIN public.prive_experiences_v e ON e.id = r.experience_id
   WHERE r.user_id = v_uid AND r.guardado AND e.effective_state <> 'PENDIENTE'), '[]'::jsonb);
END $$;

-- ─────────────────────────────── Agregar al viaje (sistema de viajes existente) ────────────────────
-- Cada elemento del plan queda en bookings con trip_id (el mismo enlace E-22 de las herramientas del
-- viaje), status 'pending' y provider 'iatos_prive': el expediente lo muestra como "no reservado".
-- Nunca se crea un 'confirmed' aquí: eso solo lo hace prive_request_transition con evidencia.
CREATE OR REPLACE FUNCTION public.prive_add_to_trip(_ps text, _trip_id uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; it jsonb; e record; n int := 0; v_skipped jsonb := '[]'; v_plan uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _trip_id IS NULL OR NOT public.has_trip_access(_trip_id, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 12 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  END IF;
  v_plan := gen_random_uuid();
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT x.*, d.name_es AS dest_name, c.name_es AS country_name INTO e
      FROM public.prive_experiences_v x JOIN public.prive_destinations d ON d.id = x.destination_id
      LEFT JOIN public.prive_destinations c ON c.kind = 'country' AND c.iso_country = d.iso_country
     WHERE x.id = CASE WHEN (it->>'experience_id') ~ '^[0-9a-f-]{36}$' THEN (it->>'experience_id')::uuid END;
    IF NOT FOUND OR e.effective_state NOT IN ('VERIFICADO','CURADO','ESTIMADO')
       OR (e.age_policy <> 'todas' AND NOT public.prive_is_adult(v_uid)) THEN
      v_skipped := v_skipped || jsonb_build_array(it->>'experience_id');
      CONTINUE;
    END IF;
    INSERT INTO public.bookings (user_id, trip_id, category, provider, status, title, subtitle, city, country, start_at, end_at,
      booking_url, raw_payload)
    VALUES (v_uid, _trip_id, public.prive_booking_category(e.universe), 'iatos_prive', 'pending', left(e.name, 200),
      'Plan Privé · ' || CASE WHEN e.opening_hours_source IS NULL THEN 'horario por confirmar' ELSE 'horario según el sitio oficial' END
        || ' · aún no es una reserva',
      e.dest_name, e.country_name,
      CASE WHEN (it->>'start_at') ~ '^\d{4}-\d{2}-\d{2}T' THEN (it->>'start_at')::timestamptz END,
      CASE WHEN (it->>'end_at') ~ '^\d{4}-\d{2}-\d{2}T' THEN (it->>'end_at')::timestamptz END,
      coalesce(e.booking_url, e.website),
      jsonb_build_object('source', 'prive_planner', 'experience_id', e.id, 'slug', e.slug, 'plan_group', v_plan,
        'estado', 'planeado', 'data_state', e.effective_state, 'template', left(it->>'template', 40),
        'transfer_estimate_min', CASE WHEN (it->>'transfer_estimate_min') ~ '^\d{1,3}$' THEN (it->>'transfer_estimate_min')::int END,
        'transfer_estimate_label', 'ESTIMADO'));
    n := n + 1;
  END LOOP;
  IF n > 0 THEN
    INSERT INTO public.prive_events (user_id, event, trip_id, surface) VALUES (v_uid, 'save', _trip_id, 'trip');
  END IF;
  RETURN jsonb_build_object('ok', n > 0, 'added', n, 'skipped', v_skipped, 'plan_group', v_plan);
END $$;

REVOKE ALL ON FUNCTION public.prive_exp_json(public.prive_experiences_v, boolean), public.prive_is_adult(uuid),
  public.prive_user_signals(uuid), public.prive_score(jsonb, public.prive_experiences_v, int, uuid, date, date),
  public.prive_recomendaciones_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prive_teaser() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_teaser() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prive_home(text), public.prive_destination(text, text), public.prive_universe(text, text, text, int),
  public.prive_experience(text, text), public.prive_search(text, text[], text[], text[], date, date, int, int, int),
  public.prive_for_you(text, text, date, date, int), public.prive_confirm_adult(text, text), public.prive_save(text, uuid, boolean),
  public.prive_saved(text), public.prive_add_to_trip(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_home(text), public.prive_destination(text, text), public.prive_universe(text, text, text, int),
  public.prive_experience(text, text), public.prive_search(text, text[], text[], text[], date, date, int, int, int),
  public.prive_for_you(text, text, date, date, int), public.prive_confirm_adult(text, text), public.prive_save(text, uuid, boolean),
  public.prive_saved(text), public.prive_add_to_trip(text, uuid, jsonb) TO authenticated, service_role;
