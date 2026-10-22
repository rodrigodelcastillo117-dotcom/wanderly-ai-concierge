-- IATOS Privé · privevalor 6/6 · Métricas de producto de Privé (Doc B §18), solo para el equipo (admins).
-- Agregados sin datos personales: conteos y porcentajes; nunca nombres, correos, textos ni ids de personas.
-- Las métricas de THE PRIVÉ KEY (primera experiencia con The Key, tiempo a la primera opción útil) las
-- instrumenta el equipo privekey: aquí quedan en null con la nota "pendiente" hasta que existan sus eventos.
-- Correlación ≠ causalidad: "retención Privé vs PRO sin Privé" es descriptiva (piloto pequeño).
-- Idempotente.

CREATE OR REPLACE FUNCTION public.admin_prive_product_metrics(_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days int := greatest(1, least(coalesce(_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 365)));
  v_active int; v_ever int; v_ret int; v_members_pro int; v_nonmembers int; v_nonmembers_pro int;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'admin_prive_product_metrics: solo el equipo' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) FILTER (WHERE status = 'active'), count(*) INTO v_active, v_ever FROM public.prive_memberships;
  -- Retorno: miembros activos con actividad Privé en 2 o más días distintos de la ventana.
  SELECT count(*) INTO v_ret FROM (
    SELECT u FROM (
      SELECT user_id AS u, created_at::date AS d FROM public.prive_events WHERE created_at >= v_since AND user_id IS NOT NULL
      UNION SELECT user_id, created_at::date FROM public.prive_value_events WHERE created_at >= v_since AND user_id IS NOT NULL) x
    JOIN public.prive_memberships m ON m.user_id = x.u AND m.status = 'active'
    GROUP BY u HAVING count(DISTINCT d) >= 2) r;
  SELECT count(*) FILTER (WHERE public.is_pro(m.user_id)) INTO v_members_pro FROM public.prive_memberships m WHERE m.status = 'active';
  SELECT count(*), count(*) FILTER (WHERE public.is_pro(s.user_id)) INTO v_nonmembers, v_nonmembers_pro
    FROM public.subscriptions s WHERE s.stripe_subscription_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prive_memberships m WHERE m.user_id = s.user_id AND m.status = 'active');
  RETURN jsonb_build_object(
    'days', v_days,
    'activation', jsonb_build_object('invited_or_active_ever', v_ever, 'active', v_active,
       'pct_activated', CASE WHEN v_ever = 0 THEN NULL ELSE round(100.0 * v_active / v_ever, 1) END,
       'median_days_to_activate', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM activated_at - invited_at) / 86400)
                                     FROM public.prive_memberships WHERE activated_at IS NOT NULL AND invited_at IS NOT NULL)),
    'the_key', jsonb_build_object('first_experience_pct', NULL, 'median_seconds_to_first_useful_option', NULL,
       'note', 'pendiente: lo instrumenta el equipo privekey (THE PRIVÉ KEY)'),
    'saves', jsonb_build_object(
       'members_with_saves', (SELECT count(DISTINCT user_id) FROM public.recomendaciones WHERE guardado AND experience_id IS NOT NULL),
       'saves_in_window', (SELECT count(*) FROM public.prive_events WHERE event = 'save' AND experience_id IS NOT NULL AND created_at >= v_since),
       'tips_saved_in_window', (SELECT count(*) FROM public.prive_value_events WHERE event = 'tip_saved' AND created_at >= v_since)),
    'plans_into_trips', (SELECT count(DISTINCT coalesce(raw_payload->>'plan_group', id::text)) FROM public.bookings
                          WHERE provider = 'iatos_prive' AND created_at >= v_since),
    'tips_into_trips', (SELECT count(*) FROM public.prive_value_events WHERE event = 'tip_added_to_trip' AND created_at >= v_since),
    'booking_links_opened', (SELECT count(*) FROM public.prive_events WHERE event = 'external_click' AND created_at >= v_since),
    'drop_links_opened', (SELECT count(*) FROM public.prive_value_events WHERE event = 'drop_link_open' AND created_at >= v_since),
    'requests', (SELECT count(*) FROM public.concierge_requests WHERE type = 'prive_request' AND created_at >= v_since),
    'verified_bookings', (SELECT count(*) FROM public.concierge_requests WHERE type = 'prive_request' AND created_at >= v_since
                           AND status = 'confirmado_externamente' AND external_confirmation IS NOT NULL),
    'benefits', jsonb_build_object(
       'radar_by_state', (SELECT coalesce(jsonb_object_agg(state, n), '{}') FROM (SELECT state, count(*) n FROM public.prive_radar_items GROUP BY state) t),
       'applied_in_window', (SELECT count(*) FROM public.prive_radar_items WHERE state = 'utilizado' AND used_at >= v_since::date),
       'value_entries_by_kind', (SELECT coalesce(jsonb_object_agg(kind, n), '{}') FROM (SELECT kind, count(*) n FROM public.prive_value_entries GROUP BY kind) t)),
    'drops', jsonb_build_object(
       'by_status', (SELECT coalesce(jsonb_object_agg(effective_status, n), '{}') FROM (SELECT effective_status, count(*) n FROM public.prive_drops_v GROUP BY 1) t),
       'views', (SELECT count(*) FROM public.prive_value_events WHERE event = 'drops_view' AND created_at >= v_since),
       'opens', (SELECT count(*) FROM public.prive_value_events WHERE event = 'drop_open' AND created_at >= v_since)),
    'insider', jsonb_build_object(
       'published_tips', (SELECT count(*) FROM public.prive_insider_tips_v),
       'views', (SELECT count(*) FROM public.prive_value_events WHERE event = 'insider_view' AND created_at >= v_since),
       'before_you_go_views', (SELECT count(*) FROM public.prive_value_events WHERE event = 'before_you_go_view' AND created_at >= v_since)),
    'passport', jsonb_build_object(
       'members_with_entries', (SELECT count(DISTINCT user_id) FROM public.prive_passport_entries),
       'entries_in_window', (SELECT count(*) FROM public.prive_value_events WHERE event = 'passport_entry_added' AND created_at >= v_since)),
    'preview', jsonb_build_object(
       'views', (SELECT count(*) FROM public.prive_value_events WHERE event = 'preview_view' AND created_at >= v_since),
       'pro_clicks', (SELECT count(*) FROM public.prive_value_events WHERE event = 'preview_pro_click' AND created_at >= v_since)),
    'return', jsonb_build_object('active_members_returning', v_ret,
       'pct', CASE WHEN v_active = 0 THEN NULL ELSE round(100.0 * v_ret / v_active, 1) END),
    'retention_descriptive', jsonb_build_object(
       'prive_members_pro_active_pct', CASE WHEN v_active = 0 THEN NULL ELSE round(100.0 * v_members_pro / v_active, 1) END,
       'subscribers_without_prive_pro_active_pct', CASE WHEN v_nonmembers = 0 THEN NULL ELSE round(100.0 * v_nonmembers_pro / v_nonmembers, 1) END,
       'note', 'descriptivo, no causal; en el piloto (3 personas) no es estadística'),
    'incremental_costs', jsonb_build_object('note', 'ver docs/iatos/prive_reimagined/PRIVEVALOR.md §Costos: privevalor no llama IA, mapas ni correo'));
END $$;
REVOKE ALL ON FUNCTION public.admin_prive_product_metrics(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_prive_product_metrics(int) TO authenticated, service_role;
