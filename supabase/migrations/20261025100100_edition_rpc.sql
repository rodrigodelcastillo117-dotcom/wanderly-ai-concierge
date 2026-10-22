-- IATOS Privé · THE PRIVATE EDITION (equipo edition) · 2/3 · RPC de lectura (miembros) y del panel
-- editorial (admins). Idempotente.
--
-- Lectura (miembros Privé): TODA función empieza con v_uid := public.prive_require(_ps). Sin PRO vigente,
-- 90 días pagados, membresía activa y sesión Privé → PRIVE_* y no sale ni un título.
--   · solo artículos y números PUBLICADOS (o programados cuya hora llegó) y no retirados;
--   · solo imágenes con licencia APROBADA (un bloque de imagen sin licencia se quita del cuerpo);
--   · los breves vencidos no aparecen en The World Brief; en el número salen marcados "vigencia terminada".
-- Panel (admins de public.admins): revisar, ver fuentes, editar, aprobar, rechazar, programar, publicar,
-- corregir (con nota pública), retirar, y aprobar/bloquear licencias de imagen. Cada acción queda en
-- edition_reviews. La aprobación exige reglas que la BASE comprueba (no solo la pantalla).
-- Errores: SQLSTATE P0001 con MESSAGE = código estable EDITION_* (o PRIVE_* de prive_require).

-- ───────────────────────────── utilidades ─────────────────────────────
CREATE OR REPLACE FUNCTION public.edition_raise(_code text, _detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = _code, DETAIL = coalesce(_detail, '');
END $$;
REVOKE ALL ON FUNCTION public.edition_raise(text, text) FROM PUBLIC, anon, authenticated;

-- Palabras del cuerpo en español (para el tiempo de lectura: 220 palabras por minuto).
CREATE OR REPLACE FUNCTION public.edition_body_words(_body jsonb)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(sum(coalesce(array_length(regexp_split_to_array(btrim(t), '\s+'), 1), 0)), 0)::int
    FROM (
      SELECT b->>'es' AS t FROM jsonb_array_elements(coalesce(_body, '[]')) b WHERE coalesce(b->>'es', '') <> ''
      UNION ALL
      SELECT concat_ws(' ', it->'label'->>'es', it->'value'->>'es') FROM jsonb_array_elements(coalesce(_body, '[]')) b,
             jsonb_array_elements(CASE WHEN jsonb_typeof(b->'items') = 'array' THEN b->'items' ELSE '[]' END) it
       WHERE b->>'t' = 'facts'
      UNION ALL
      SELECT it->>'es' FROM jsonb_array_elements(coalesce(_body, '[]')) b,
             jsonb_array_elements(CASE WHEN jsonb_typeof(b->'items') = 'array' THEN b->'items' ELSE '[]' END) it
       WHERE b->>'t' = 'agenda'
    ) x WHERE btrim(coalesce(t, '')) <> '';
$$;

-- Claves de imagen que usa un artículo (portada del artículo + bloques "img" del cuerpo).
CREATE OR REPLACE FUNCTION public.edition_article_image_keys(_hero uuid, _body jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL), '{}') FROM (
    SELECT (SELECT i.key FROM public.edition_images i WHERE i.id = _hero) AS k
    UNION ALL
    SELECT b->>'image' FROM jsonb_array_elements(coalesce(_body, '[]')) b WHERE b->>'t' = 'img'
  ) x;
$$;
REVOKE ALL ON FUNCTION public.edition_article_image_keys(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.edition_image_json(i public.edition_images, _admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'key', i.key, 'provider', i.provider, 'url', i.url, 'page_url', i.page_url,
    'photographer', i.photographer, 'photographer_url', i.photographer_url,
    'license', i.license, 'license_url', i.license_url, 'illustrative', i.illustrative,
    'depicts', jsonb_build_object('es', i.depicts_es, 'en', i.depicts_en),
    'alt', jsonb_build_object('es', i.alt_es, 'en', i.alt_en), 'focal', i.focal,
    'allow_pdf', i.allow_pdf, 'allow_offline', i.allow_offline,
    'license_status', CASE WHEN _admin THEN i.license_status END,
    'license_note', CASE WHEN _admin THEN i.license_note END,
    'verification', CASE WHEN _admin THEN i.verification END));
$$;

CREATE OR REPLACE FUNCTION public.edition_source_json(s public.edition_sources, _used_for text DEFAULT NULL, _admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'key', s.key, 'kind', s.kind, 'entity', s.entity, 'author', s.author, 'title', s.title, 'url', s.url,
    'published_at', s.published_at, 'consulted_at', s.consulted_at, 'used_for', _used_for,
    'data_used', s.data_used, 'reuse_rights', s.reuse_rights, 'attribution', s.attribution,
    'distribution_restrictions', s.distribution_restrictions,
    'verification', CASE WHEN _admin THEN s.verification END,
    'link_status', s.link_status, 'link_http', CASE WHEN _admin THEN s.link_http END, 'link_checked_at', s.link_checked_at));
$$;

-- Cuerpo para lectura: sin bloques de imagen cuya licencia no esté aprobada (o, para PDF/offline, que no
-- permita ese uso: eso lo decide el cliente con allow_pdf / allow_offline).
CREATE OR REPLACE FUNCTION public.edition_reader_body(_body jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(b ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(_body, '[]')) WITH ORDINALITY x(b, ord)
   WHERE b->>'t' IS DISTINCT FROM 'img'
      OR EXISTS (SELECT 1 FROM public.edition_images i WHERE i.key = b->>'image' AND i.license_status = 'approved');
$$;
REVOKE ALL ON FUNCTION public.edition_reader_body(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.edition_article_json(a public.edition_articles, _full boolean DEFAULT true, _admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'slug', a.slug, 'issue', (SELECT s.slug FROM public.edition_issues s WHERE s.id = a.issue_id),
    'section', a.section, 'format', a.format, 'topics', to_jsonb(a.topics),
    'kicker', a.kicker, 'title', a.title, 'dek', a.dek, 'byline', a.byline,
    'hero_image', (SELECT i.key FROM public.edition_images i WHERE i.id = a.hero_image_id AND (_admin OR i.license_status = 'approved')),
    'fact_status', a.fact_status, 'sensitive', a.sensitive, 'fact_date', a.fact_date, 'valid_until', a.valid_until,
    'expired', CASE WHEN a.valid_until IS NOT NULL AND a.valid_until < public.edition_today() THEN true END,
    'destinations', to_jsonb(a.destinations), 'reading_minutes', a.reading_minutes, 'word_count', a.word_count,
    'sort_order', a.sort_order, 'version', a.version, 'drafted_by', a.drafted_by,
    'published_at', a.published_at, 'approved_by_label', a.approved_by_label,
    'correction', CASE WHEN a.corrected_at IS NOT NULL THEN jsonb_build_object('note', a.correction_note, 'at', a.corrected_at) END,
    'body', CASE WHEN _full THEN CASE WHEN _admin THEN a.body ELSE public.edition_reader_body(a.body) END END,
    'actions', CASE WHEN _full THEN a.actions END,
    'image_keys', to_jsonb(ARRAY(SELECT k FROM unnest(public.edition_article_image_keys(a.hero_image_id, a.body)) k
                   WHERE _admin OR EXISTS (SELECT 1 FROM public.edition_images i WHERE i.key = k AND i.license_status = 'approved'))),
    'sources', CASE WHEN _full THEN (SELECT coalesce(jsonb_agg(public.edition_source_json(s, l.used_for, _admin) ORDER BY s.kind, s.entity), '[]')
                   FROM public.edition_article_sources l JOIN public.edition_sources s ON s.id = l.source_id WHERE l.article_id = a.id) END,
    -- Solo para el panel:
    'status', CASE WHEN _admin THEN a.status END, 'editor_notes', CASE WHEN _admin THEN a.editor_notes END,
    'scheduled_for', CASE WHEN _admin THEN a.scheduled_for END, 'approved_at', CASE WHEN _admin THEN a.approved_at END,
    'retracted', CASE WHEN _admin AND a.retracted_at IS NOT NULL THEN jsonb_build_object('note', a.retraction_note, 'at', a.retracted_at) END,
    'updated_at', CASE WHEN _admin THEN a.updated_at END));
$$;
REVOKE ALL ON FUNCTION public.edition_article_json(public.edition_articles, boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.edition_issue_json(i public.edition_issues, _admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'slug', i.slug, 'number', i.number, 'period_start', i.period_start, 'period_label', i.period_label,
    'title', i.title, 'cover_line', i.cover_line,
    'cover_image', (SELECT im.key FROM public.edition_images im WHERE im.id = i.cover_image_id AND (_admin OR im.license_status = 'approved')),
    'cover_article', i.cover_article_slug, 'research_closed_at', i.research_closed_at,
    'published_at', i.published_at, 'version', i.version, 'approved_by_label', i.approved_by_label,
    'plan', CASE WHEN _admin THEN i.plan END,
    'status', CASE WHEN _admin THEN i.status END, 'scheduled_for', CASE WHEN _admin THEN i.scheduled_for END,
    'retracted', CASE WHEN i.retracted_at IS NOT NULL THEN jsonb_build_object('note', i.retraction_note, 'at', i.retracted_at) END));
$$;
REVOKE ALL ON FUNCTION public.edition_issue_json(public.edition_issues, boolean) FROM PUBLIC, anon, authenticated;

-- Mapa { clave: imagen } de las imágenes que usan los artículos dados.
CREATE OR REPLACE FUNCTION public.edition_images_map(_keys text[], _admin boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(i.key, public.edition_image_json(i, _admin)), '{}'::jsonb)
    FROM public.edition_images i
   WHERE i.key = ANY (coalesce(_keys, '{}')) AND (_admin OR i.license_status = 'approved');
$$;
REVOKE ALL ON FUNCTION public.edition_images_map(text[], boolean) FROM PUBLIC, anon, authenticated;

-- ───────────────────────────── LECTURA (miembros Privé) ─────────────────────────────
-- Biblioteca: números publicados, del más reciente al más antiguo.
CREATE OR REPLACE FUNCTION public.prive_edition_library(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_items jsonb; v_keys text[];
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT coalesce(jsonb_agg(public.edition_issue_json(i) || jsonb_build_object('article_count',
           (SELECT count(*) FROM public.edition_articles a WHERE a.issue_id = i.id AND public.edition_is_live(a.status, a.scheduled_for)))
           ORDER BY i.period_start DESC, i.number DESC), '[]'::jsonb),
         coalesce(array_agg(im.key) FILTER (WHERE im.key IS NOT NULL), '{}')
    INTO v_items, v_keys
    FROM public.edition_issues i LEFT JOIN public.edition_images im ON im.id = i.cover_image_id
   WHERE public.edition_is_live(i.status, i.scheduled_for);
  RETURN jsonb_build_object('issues', v_items, 'images', public.edition_images_map(v_keys),
    'saved_count', (SELECT count(*) FROM public.edition_saves s JOIN public.edition_articles a ON a.id = s.article_id
                     WHERE s.user_id = v_uid AND public.edition_is_live(a.status, a.scheduled_for)),
    'generated_at', now());
END $$;

-- Un número completo (el más reciente si _slug es NULL): portada, artículos publicados con sus fuentes,
-- imágenes con licencia aprobada, artículos retirados (para que una copia offline los quite) y guardados.
CREATE OR REPLACE FUNCTION public.prive_edition_issue(_ps text, _slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; i public.edition_issues; v_articles jsonb; v_keys text[];
BEGIN
  v_uid := public.prive_require(_ps);
  IF _slug IS NULL THEN
    SELECT * INTO i FROM public.edition_issues s WHERE public.edition_is_live(s.status, s.scheduled_for)
     ORDER BY s.period_start DESC, s.number DESC LIMIT 1;
  ELSE
    SELECT * INTO i FROM public.edition_issues s WHERE s.slug = _slug AND public.edition_is_live(s.status, s.scheduled_for);
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'generated_at', now());
  END IF;
  SELECT coalesce(jsonb_agg(public.edition_article_json(a) ORDER BY a.sort_order, a.slug), '[]'::jsonb)
    INTO v_articles
    FROM public.edition_articles a WHERE a.issue_id = i.id AND public.edition_is_live(a.status, a.scheduled_for);
  SELECT coalesce(array_agg(DISTINCT k), '{}') INTO v_keys
    FROM public.edition_articles a, unnest(public.edition_article_image_keys(a.hero_image_id, a.body)) k
   WHERE a.issue_id = i.id AND public.edition_is_live(a.status, a.scheduled_for);
  v_keys := v_keys || coalesce((SELECT ARRAY[im.key] FROM public.edition_images im WHERE im.id = i.cover_image_id), '{}');
  RETURN jsonb_build_object('found', true, 'issue', public.edition_issue_json(i), 'articles', v_articles,
    'images', public.edition_images_map(v_keys),
    'retracted', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'at', a.retracted_at, 'note', a.retraction_note)), '[]')
                    FROM public.edition_articles a WHERE a.issue_id = i.id AND a.status = 'retracted'),
    'saved', (SELECT coalesce(jsonb_agg(a.slug), '[]') FROM public.edition_saves s JOIN public.edition_articles a ON a.id = s.article_id
               WHERE s.user_id = v_uid AND a.issue_id = i.id),
    'generated_at', now());
END $$;

-- Un artículo. Retirado → found=true, retracted (nota pública). No publicado → found=false.
CREATE OR REPLACE FUNCTION public.prive_edition_article(_ps text, _slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; a public.edition_articles; v_live_issue boolean;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO a FROM public.edition_articles WHERE slug = _slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT public.edition_is_live(s.status, s.scheduled_for) OR s.status = 'retracted' INTO v_live_issue FROM public.edition_issues s WHERE s.id = a.issue_id;
  IF a.status = 'retracted' AND v_live_issue THEN
    RETURN jsonb_build_object('found', true, 'retracted', jsonb_build_object('slug', a.slug, 'title', a.title, 'note', a.retraction_note, 'at', a.retracted_at));
  END IF;
  IF NOT public.edition_is_live(a.status, a.scheduled_for) OR NOT coalesce(v_live_issue, false) THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object('found', true, 'article', public.edition_article_json(a),
    'images', public.edition_images_map(public.edition_article_image_keys(a.hero_image_id, a.body)),
    'saved', EXISTS (SELECT 1 FROM public.edition_saves s WHERE s.user_id = v_uid AND s.article_id = a.id),
    'generated_at', now());
END $$;

-- The World Brief: breves publicados y VIGENTES (vencidos fuera), del más reciente al más antiguo.
CREATE OR REPLACE FUNCTION public.prive_edition_world_brief(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  RETURN jsonb_build_object(
    'items', (SELECT coalesce(jsonb_agg(public.edition_article_json(a) ORDER BY a.fact_date DESC, a.sort_order), '[]')
                FROM public.edition_articles a JOIN public.edition_issues s ON s.id = a.issue_id
               WHERE a.format = 'brief' AND public.edition_is_live(a.status, a.scheduled_for) AND public.edition_is_live(s.status, s.scheduled_for)
                 AND (a.valid_until IS NULL OR a.valid_until >= public.edition_today())),
    'expired_count', (SELECT count(*) FROM public.edition_articles a JOIN public.edition_issues s ON s.id = a.issue_id
               WHERE a.format = 'brief' AND public.edition_is_live(a.status, a.scheduled_for) AND public.edition_is_live(s.status, s.scheduled_for)
                 AND a.valid_until < public.edition_today()),
    'today', public.edition_today(), 'generated_at', now());
END $$;

-- Preferencias editoriales del miembro (o los valores por omisión si aún no hay).
CREATE OR REPLACE FUNCTION public.prive_edition_prefs(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; p public.edition_member_prefs;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO p FROM public.edition_member_prefs WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('saved', false, 'edition_kind', 'mi_mezcla', 'interests', '{}'::jsonb, 'excluded', '[]'::jsonb,
      'language', NULL, 'reading_minutes', 20, 'section_order', '[]'::jsonb, 'show_name_on_cover', false,
      'personalization_consent', false, 'first_name', public.prive_first_name(v_uid));
  END IF;
  RETURN jsonb_build_object('saved', true, 'edition_kind', p.edition_kind, 'interests', p.interests, 'excluded', to_jsonb(p.excluded),
    'language', p.language, 'reading_minutes', p.reading_minutes, 'section_order', to_jsonb(p.section_order),
    'show_name_on_cover', p.show_name_on_cover, 'personalization_consent', p.personalization_consent,
    'consented_at', p.consented_at, 'updated_at', p.updated_at, 'first_name', public.prive_first_name(v_uid));
END $$;

-- Guardar preferencias. Los intereses solo se guardan con consentimiento explícito; sin él se borran.
-- Nunca se infieren (ni por sexo, ni por género, ni por nada): solo lo que el miembro eligió.
CREATE OR REPLACE FUNCTION public.prive_edition_prefs_save(_ps text, _prefs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_consent boolean; v_interests jsonb := '{}'::jsonb; k text; v jsonb; v_excl text[]; v_order text[];
  v_kind text; v_lang text; v_min int;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _prefs IS NULL OR jsonb_typeof(_prefs) <> 'object' THEN PERFORM public.edition_raise('EDITION_BAD_PREFS'); END IF;
  v_consent := coalesce((_prefs->>'personalization_consent')::boolean, false);
  v_kind := coalesce(_prefs->>'edition_kind', 'mi_mezcla');
  IF v_kind NOT IN ('viajes','negocios','estilo_de_vida','mi_mezcla') THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'edition_kind'); END IF;
  v_lang := coalesce(_prefs->>'language', 'es');
  IF v_lang NOT IN ('es','en') THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'language'); END IF;
  v_min := coalesce((_prefs->>'reading_minutes')::int, 20);
  IF v_min NOT BETWEEN 5 AND 120 THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'reading_minutes'); END IF;
  IF jsonb_typeof(coalesce(_prefs->'interests', '{}')) <> 'object' THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'interests'); END IF;
  IF v_consent THEN
    FOR k, v IN SELECT * FROM jsonb_each(coalesce(_prefs->'interests', '{}')) LOOP
      IF NOT (k = ANY (public.edition_interest_keys())) THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'interest:' || left(k, 40)); END IF;
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT IN (1, 2, 3) THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'intensity:' || k); END IF;
      v_interests := v_interests || jsonb_build_object(k, (v #>> '{}')::int);
    END LOOP;
  END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_excl FROM jsonb_array_elements_text(coalesce(_prefs->'excluded', '[]')) x;
  IF NOT (v_excl <@ public.edition_interest_keys()) THEN PERFORM public.edition_raise('EDITION_BAD_PREFS', 'excluded'); END IF;
  SELECT coalesce(array_agg(x ORDER BY o), '{}') INTO v_order FROM jsonb_array_elements_text(coalesce(_prefs->'section_order', '[]')) WITH ORDINALITY t(x, o);
  IF NOT (v_order <@ public.edition_section_keys()) OR cardinality(v_order) <> (SELECT count(DISTINCT y) FROM unnest(v_order) y) THEN
    PERFORM public.edition_raise('EDITION_BAD_PREFS', 'section_order');
  END IF;
  INSERT INTO public.edition_member_prefs AS p (user_id, edition_kind, interests, excluded, language, reading_minutes, section_order,
      show_name_on_cover, personalization_consent, consented_at, updated_at)
  VALUES (v_uid, v_kind, v_interests, v_excl, v_lang, v_min, v_order, coalesce((_prefs->>'show_name_on_cover')::boolean, false),
      v_consent, CASE WHEN v_consent THEN now() END, now())
  ON CONFLICT (user_id) DO UPDATE SET edition_kind = EXCLUDED.edition_kind, interests = EXCLUDED.interests, excluded = EXCLUDED.excluded,
      language = EXCLUDED.language, reading_minutes = EXCLUDED.reading_minutes, section_order = EXCLUDED.section_order,
      show_name_on_cover = EXCLUDED.show_name_on_cover, personalization_consent = EXCLUDED.personalization_consent,
      consented_at = CASE WHEN EXCLUDED.personalization_consent THEN coalesce(p.consented_at, now()) END, updated_at = now();
  RETURN public.prive_edition_prefs(_ps);
END $$;

-- The Reading List.
CREATE OR REPLACE FUNCTION public.prive_edition_save(_ps text, _slug text, _saved boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT a.id INTO v_id FROM public.edition_articles a JOIN public.edition_issues s ON s.id = a.issue_id
   WHERE a.slug = _slug AND public.edition_is_live(a.status, a.scheduled_for) AND public.edition_is_live(s.status, s.scheduled_for);
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'EDITION_NOT_FOUND'); END IF;
  IF coalesce(_saved, true) THEN
    IF (SELECT count(*) FROM public.edition_saves WHERE user_id = v_uid) >= 500 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EDITION_SAVE_LIMIT');
    END IF;
    INSERT INTO public.edition_saves (user_id, article_id) VALUES (v_uid, v_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.edition_saves WHERE user_id = v_uid AND article_id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'saved', coalesce(_saved, true));
END $$;

CREATE OR REPLACE FUNCTION public.prive_edition_saved(_ps text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_keys text[];
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT coalesce(array_agg(DISTINCT k), '{}') INTO v_keys
    FROM public.edition_saves sv JOIN public.edition_articles a ON a.id = sv.article_id,
         unnest(public.edition_article_image_keys(a.hero_image_id, NULL)) k
   WHERE sv.user_id = v_uid;
  RETURN jsonb_build_object('items', (SELECT coalesce(jsonb_agg(public.edition_article_json(a, false) || jsonb_build_object('saved_at', sv.created_at)
              ORDER BY sv.created_at DESC), '[]')
      FROM public.edition_saves sv JOIN public.edition_articles a ON a.id = sv.article_id JOIN public.edition_issues s ON s.id = a.issue_id
     WHERE sv.user_id = v_uid AND public.edition_is_live(a.status, a.scheduled_for) AND public.edition_is_live(s.status, s.scheduled_for)),
    'images', public.edition_images_map(v_keys), 'generated_at', now());
END $$;

-- Registro de una descarga (PDF u offline) para auditoría y medición de costos. Sin contenido personal.
CREATE OR REPLACE FUNCTION public.prive_edition_log_download(_ps text, _issue text, _format text, _kind text,
  _article_count int DEFAULT 0, _image_count int DEFAULT 0, _bytes bigint DEFAULT NULL, _duration_ms int DEFAULT NULL, _language text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_rl jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _format NOT IN ('pdf','offline') OR _kind NOT IN ('issue','flight') THEN RETURN false; END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'edition_log_download', 60, 3600);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN false; END IF;
  INSERT INTO public.edition_downloads (user_id, issue_id, format, kind, article_count, image_count, bytes, duration_ms, language)
  VALUES (v_uid, (SELECT id FROM public.edition_issues WHERE slug = _issue), _format, _kind, greatest(0, coalesce(_article_count, 0)),
    greatest(0, coalesce(_image_count, 0)), _bytes, _duration_ms, CASE WHEN _language IN ('es','en') THEN _language END);
  RETURN true;
EXCEPTION WHEN check_violation THEN RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.prive_edition_library(text), public.prive_edition_issue(text, text), public.prive_edition_article(text, text),
  public.prive_edition_world_brief(text), public.prive_edition_prefs(text), public.prive_edition_prefs_save(text, jsonb),
  public.prive_edition_save(text, text, boolean), public.prive_edition_saved(text),
  public.prive_edition_log_download(text, text, text, text, int, int, bigint, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_edition_library(text), public.prive_edition_issue(text, text), public.prive_edition_article(text, text),
  public.prive_edition_world_brief(text), public.prive_edition_prefs(text), public.prive_edition_prefs_save(text, jsonb),
  public.prive_edition_save(text, text, boolean), public.prive_edition_saved(text),
  public.prive_edition_log_download(text, text, text, text, int, int, bigint, int, text) TO authenticated, service_role;

-- ───────────────────────────── PANEL EDITORIAL (admins) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.edition_admin_require()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    PERFORM public.edition_raise('EDITION_NOT_ADMIN');
  END IF;
  RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.edition_admin_require() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.edition_log_review(_entity text, _key text, _action text, _actor uuid, _note text, _diff jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.edition_reviews (entity, entity_key, action, user_id, note, diff) VALUES (_entity, _key, _action, _actor, left(_note, 2000), _diff);
$$;
REVOKE ALL ON FUNCTION public.edition_log_review(text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Lo que impide aprobar (blocking) y lo que conviene revisar (warnings). Lo usa la aprobación y el panel.
CREATE OR REPLACE FUNCTION public.edition_article_checks(_article_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.edition_articles; b text[] := '{}'; w text[] := '{}'; n_src int; r record; v_hosts text[]; v_host text;
BEGIN
  SELECT * INTO a FROM public.edition_articles WHERE id = _article_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('blocking', jsonb_build_array('not_found'), 'warnings', '[]'::jsonb); END IF;
  SELECT count(*) INTO n_src FROM public.edition_article_sources WHERE article_id = a.id;
  -- Fuentes: toda pieza no editorial necesita al menos una; lo sensible (finanzas, política…) al menos dos.
  IF a.format <> 'letter' AND n_src = 0 THEN b := b || 'no_sources'::text; END IF;
  IF a.sensitive AND n_src < 2 THEN b := b || 'sensitive_needs_two_sources'::text; END IF;
  FOR r IN SELECT s.key, s.link_status FROM public.edition_article_sources l JOIN public.edition_sources s ON s.id = l.source_id WHERE l.article_id = a.id LOOP
    IF r.link_status = 'broken' THEN b := b || ('broken_source:' || r.key); END IF;
    IF r.link_status = 'unchecked' THEN w := w || ('unchecked_source:' || r.key); END IF;
    IF r.link_status = 'blocked' THEN w := w || ('source_blocks_robots:' || r.key); END IF;
  END LOOP;
  -- Imágenes: todas con licencia aprobada.
  FOR r IN SELECT k, i.license_status FROM unnest(public.edition_article_image_keys(a.hero_image_id, a.body)) k
           LEFT JOIN public.edition_images i ON i.key = k LOOP
    IF r.license_status IS NULL THEN b := b || ('image_missing:' || r.k);
    ELSIF r.license_status <> 'approved' THEN b := b || ('image_not_licensed:' || r.k); END IF;
  END LOOP;
  -- Breves: hechos recientes, nunca historia presentada como nueva.
  IF a.format = 'brief' THEN
    IF a.fact_date IS NULL THEN b := b || 'brief_without_date'::text;
    ELSIF a.fact_date < public.edition_today() - 90 THEN b := b || 'brief_fact_too_old'::text;
    ELSIF a.fact_date > public.edition_today() THEN b := b || 'brief_fact_in_future'::text; END IF;
  END IF;
  IF a.valid_until IS NOT NULL AND a.valid_until < public.edition_today() THEN b := b || 'expired'::text; END IF;
  -- Acciones "From Page to Experience": tipos conocidos; un enlace oficial debe ir al dominio de una
  -- fuente registrada del artículo (nada de enlaces comerciales sin fuente).
  SELECT coalesce(array_agg(DISTINCT lower(substring(s.url FROM '^https://([^/:?#]+)'))), '{}') INTO v_hosts
    FROM public.edition_article_sources l JOIN public.edition_sources s ON s.id = l.source_id WHERE l.article_id = a.id;
  FOR r IN SELECT x FROM jsonb_array_elements(a.actions) x LOOP
    IF (r.x->>'kind') NOT IN ('explore_destination','explore_universe','ask_iato','plan_trip','hotels','restaurants','official_link') THEN
      b := b || ('action_unknown:' || coalesce(r.x->>'kind', '?'));
    ELSIF r.x->>'kind' = 'official_link' THEN
      v_host := lower(substring(coalesce(r.x->>'url', '') FROM '^https://([^/:?#]+)'));
      IF v_host IS NULL THEN b := b || 'action_link_not_https'::text;
      ELSIF NOT EXISTS (SELECT 1 FROM unnest(v_hosts) h WHERE h = v_host OR h = 'www.' || v_host OR v_host = 'www.' || h) THEN
        b := b || ('action_link_without_source:' || v_host);
      END IF;
    END IF;
  END LOOP;
  IF a.drafted_by = 'claude' THEN w := w || 'ai_draft_needs_human_read'::text; END IF;
  RETURN jsonb_build_object('blocking', to_jsonb(b), 'warnings', to_jsonb(w));
END $$;
REVOKE ALL ON FUNCTION public.edition_article_checks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edition_article_checks(uuid) TO service_role;

-- Mínimo para publicar un número: carta, artículo de portada aprobado, portada con licencia y al menos
-- 4 piezas no-breve aprobadas (una revista sin contenido suficiente no se publica).
CREATE OR REPLACE FUNCTION public.edition_issue_checks(_issue_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.edition_issues; b text[] := '{}'; w text[] := '{}'; n int;
BEGIN
  SELECT * INTO i FROM public.edition_issues WHERE id = _issue_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('blocking', jsonb_build_array('not_found'), 'warnings', '[]'::jsonb); END IF;
  SELECT count(*) INTO n FROM public.edition_articles WHERE issue_id = i.id AND format <> 'brief'
     AND status IN ('approved','scheduled','published');
  IF n < 4 THEN b := b || ('not_enough_content:' || n); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.edition_articles WHERE issue_id = i.id AND slug = i.cover_article_slug AND status IN ('approved','scheduled','published')) THEN
    b := b || 'cover_article_not_approved'::text;
  END IF;
  IF i.cover_image_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.edition_images WHERE id = i.cover_image_id AND license_status = 'approved') THEN
    b := b || 'cover_image_not_licensed'::text;
  END IF;
  SELECT count(*) INTO n FROM public.edition_articles WHERE issue_id = i.id AND status IN ('draft','pending_review');
  IF n > 0 THEN w := w || ('articles_pending_review:' || n); END IF;
  RETURN jsonb_build_object('blocking', to_jsonb(b), 'warnings', to_jsonb(w));
END $$;
REVOKE ALL ON FUNCTION public.edition_issue_checks(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edition_issue_checks(uuid) TO service_role;

-- Todo lo que el panel necesita (todos los estados, con comprobaciones).
CREATE OR REPLACE FUNCTION public.edition_admin_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid;
BEGIN
  v_admin := public.edition_admin_require();
  RETURN jsonb_build_object(
    'issues', (SELECT coalesce(jsonb_agg(public.edition_issue_json(i, true) || jsonb_build_object('checks', public.edition_issue_checks(i.id))
                 ORDER BY i.period_start DESC), '[]') FROM public.edition_issues i),
    'articles', (SELECT coalesce(jsonb_agg(public.edition_article_json(a, false, true) || jsonb_build_object('checks', public.edition_article_checks(a.id),
                   'source_count', (SELECT count(*) FROM public.edition_article_sources l WHERE l.article_id = a.id))
                 ORDER BY s.period_start DESC, a.sort_order), '[]')
                 FROM public.edition_articles a JOIN public.edition_issues s ON s.id = a.issue_id),
    'sources', (SELECT coalesce(jsonb_agg(public.edition_source_json(s, NULL, true) || jsonb_build_object('used_by',
                   (SELECT coalesce(jsonb_agg(a.slug), '[]') FROM public.edition_article_sources l JOIN public.edition_articles a ON a.id = l.article_id WHERE l.source_id = s.id))
                 ORDER BY s.key), '[]') FROM public.edition_sources s),
    'images', (SELECT coalesce(jsonb_agg(public.edition_image_json(i, true) ORDER BY i.key), '[]') FROM public.edition_images i),
    'reviews', (SELECT coalesce(jsonb_agg(jsonb_build_object('entity', r.entity, 'key', r.entity_key, 'action', r.action, 'note', r.note,
                   'at', r.created_at, 'by_me', r.user_id = v_admin) ORDER BY r.id DESC), '[]')
                  FROM (SELECT * FROM public.edition_reviews ORDER BY id DESC LIMIT 80) r),
    'downloads', jsonb_build_object(
       'pdf_30d', (SELECT count(*) FROM public.edition_downloads WHERE format = 'pdf' AND created_at > now() - interval '30 days'),
       'offline_30d', (SELECT count(*) FROM public.edition_downloads WHERE format = 'offline' AND created_at > now() - interval '30 days'),
       'avg_pdf_bytes', (SELECT round(avg(bytes)) FROM public.edition_downloads WHERE format = 'pdf' AND bytes IS NOT NULL),
       'avg_pdf_ms', (SELECT round(avg(duration_ms)) FROM public.edition_downloads WHERE format = 'pdf' AND duration_ms IS NOT NULL)),
    'generated_at', now());
END $$;

-- Vista previa (modo demostración) de un número en cualquier estado: lo que verá el miembro cuando se
-- publique, con TODAS las piezas no rechazadas/retiradas y todas las imágenes (con su estado de licencia).
CREATE OR REPLACE FUNCTION public.edition_admin_preview(_issue_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; i public.edition_issues; v_keys text[];
BEGIN
  v_admin := public.edition_admin_require();
  SELECT * INTO i FROM public.edition_issues s WHERE (_issue_slug IS NULL OR s.slug = _issue_slug)
   ORDER BY s.period_start DESC, s.number DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT coalesce(array_agg(DISTINCT k), '{}') INTO v_keys
    FROM public.edition_articles a, unnest(public.edition_article_image_keys(a.hero_image_id, a.body)) k
   WHERE a.issue_id = i.id AND a.status NOT IN ('rejected','retracted');
  v_keys := v_keys || coalesce((SELECT ARRAY[im.key] FROM public.edition_images im WHERE im.id = i.cover_image_id), '{}');
  RETURN jsonb_build_object('found', true, 'preview', true, 'issue', public.edition_issue_json(i, true),
    'articles', (SELECT coalesce(jsonb_agg(public.edition_article_json(a, true, true) ORDER BY a.sort_order, a.slug), '[]')
                   FROM public.edition_articles a WHERE a.issue_id = i.id AND a.status NOT IN ('rejected','retracted')),
    'images', public.edition_images_map(v_keys, true), 'retracted', '[]'::jsonb, 'saved', '[]'::jsonb, 'generated_at', now());
END $$;

-- Editar un artículo no publicado. Si estaba aprobado, vuelve a revisión. Publicado → usar "corregir".
CREATE OR REPLACE FUNCTION public.edition_admin_article_update(_slug text, _patch jsonb, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; a public.edition_articles; k text; v_diff jsonb := '{}'::jsonb; v_src jsonb; v_img uuid;
BEGIN
  v_admin := public.edition_admin_require();
  SELECT * INTO a FROM public.edition_articles WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_NOT_FOUND'); END IF;
  IF a.status IN ('published','scheduled','retracted') THEN PERFORM public.edition_raise('EDITION_USE_CORRECT', a.status); END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN PERFORM public.edition_raise('EDITION_BAD_PATCH'); END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF k NOT IN ('title','dek','kicker','byline','body','actions','topics','valid_until','fact_date','editor_notes','hero_image','sources','sensitive','fact_status') THEN
      PERFORM public.edition_raise('EDITION_BAD_PATCH', k);
    END IF;
    v_diff := v_diff || jsonb_build_object(k, true);
  END LOOP;
  IF _patch ? 'hero_image' THEN
    IF jsonb_typeof(_patch->'hero_image') = 'null' THEN v_img := NULL;
    ELSE
      SELECT id INTO v_img FROM public.edition_images WHERE key = _patch->>'hero_image';
      IF v_img IS NULL THEN PERFORM public.edition_raise('EDITION_BAD_PATCH', 'hero_image'); END IF;
    END IF;
  END IF;
  UPDATE public.edition_articles SET
    title = coalesce(_patch->'title', title), dek = coalesce(_patch->'dek', dek), kicker = coalesce(_patch->'kicker', kicker),
    byline = coalesce(_patch->'byline', byline), body = coalesce(_patch->'body', body), actions = coalesce(_patch->'actions', actions),
    topics = CASE WHEN _patch ? 'topics' THEN ARRAY(SELECT jsonb_array_elements_text(_patch->'topics')) ELSE topics END,
    valid_until = CASE WHEN _patch ? 'valid_until' THEN (_patch->>'valid_until')::date ELSE valid_until END,
    fact_date = CASE WHEN _patch ? 'fact_date' THEN (_patch->>'fact_date')::date ELSE fact_date END,
    editor_notes = CASE WHEN _patch ? 'editor_notes' THEN _patch->>'editor_notes' ELSE editor_notes END,
    sensitive = coalesce((_patch->>'sensitive')::boolean, sensitive),
    fact_status = coalesce(_patch->>'fact_status', fact_status),
    hero_image_id = CASE WHEN _patch ? 'hero_image' THEN v_img ELSE hero_image_id END,
    -- Un humano editó el texto: deja de ser un borrador solo de IA (sigue necesitando aprobación).
    drafted_by = CASE WHEN _patch ? 'body' OR _patch ? 'title' THEN 'human' ELSE drafted_by END,
    status = CASE WHEN status = 'approved' THEN 'pending_review' ELSE status END,
    approved_at = CASE WHEN status = 'approved' THEN NULL ELSE approved_at END,
    version = version + 1
  WHERE id = a.id RETURNING * INTO a;
  IF _patch ? 'sources' THEN
    DELETE FROM public.edition_article_sources WHERE article_id = a.id;
    FOR v_src IN SELECT * FROM jsonb_array_elements(_patch->'sources') LOOP
      INSERT INTO public.edition_article_sources (article_id, source_id, used_for)
      SELECT a.id, s.id, v_src->>'used_for' FROM public.edition_sources s WHERE s.key = v_src->>'key';
      IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_BAD_PATCH', 'source:' || coalesce(v_src->>'key', '?')); END IF;
    END LOOP;
  END IF;
  UPDATE public.edition_articles SET word_count = public.edition_body_words(body),
    reading_minutes = greatest(1, ceil(public.edition_body_words(body) / 220.0)::int) WHERE id = a.id;
  PERFORM public.edition_log_review('article', a.slug, 'edit', v_admin, _note, v_diff);
  RETURN jsonb_build_object('ok', true, 'article', public.edition_article_json(a, true, true), 'checks', public.edition_article_checks(a.id));
END $$;

-- Corregir un artículo PUBLICADO: la nota de corrección es pública y queda con su fecha.
CREATE OR REPLACE FUNCTION public.edition_admin_article_correct(_slug text, _patch jsonb, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; a public.edition_articles; k text; v_checks jsonb;
BEGIN
  v_admin := public.edition_admin_require();
  IF coalesce(btrim(_note), '') = '' THEN PERFORM public.edition_raise('EDITION_NOTE_REQUIRED'); END IF;
  SELECT * INTO a FROM public.edition_articles WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_NOT_FOUND'); END IF;
  IF a.status <> 'published' THEN PERFORM public.edition_raise('EDITION_NOT_PUBLISHED', a.status); END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(_patch, '{}')) LOOP
    IF k NOT IN ('title','dek','body','actions','valid_until') THEN PERFORM public.edition_raise('EDITION_BAD_PATCH', k); END IF;
  END LOOP;
  UPDATE public.edition_articles SET title = coalesce(_patch->'title', title), dek = coalesce(_patch->'dek', dek),
    body = coalesce(_patch->'body', body), actions = coalesce(_patch->'actions', actions),
    valid_until = CASE WHEN _patch ? 'valid_until' THEN (_patch->>'valid_until')::date ELSE valid_until END,
    correction_note = btrim(_note), corrected_at = now(), version = version + 1
  WHERE id = a.id RETURNING * INTO a;
  -- Una corrección no puede introducir imágenes sin licencia ni enlaces sin fuente.
  v_checks := public.edition_article_checks(a.id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_checks->'blocking') x WHERE x LIKE 'image_%' OR x LIKE 'action_%' OR x LIKE 'broken_source:%') THEN
    PERFORM public.edition_raise('EDITION_CHECKS_FAILED', (v_checks->'blocking')::text);
  END IF;
  UPDATE public.edition_articles SET word_count = public.edition_body_words(body),
    reading_minutes = greatest(1, ceil(public.edition_body_words(body) / 220.0)::int) WHERE id = a.id;
  PERFORM public.edition_log_review('article', a.slug, 'correct', v_admin, _note, NULL);
  RETURN jsonb_build_object('ok', true, 'article', public.edition_article_json(a, true, true));
END $$;

-- Cambios de estado de un artículo: submit · approve · reject · schedule · publish · retract · return_to_review.
CREATE OR REPLACE FUNCTION public.edition_admin_article_transition(_slug text, _action text, _note text DEFAULT NULL,
  _when timestamptz DEFAULT NULL, _label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; a public.edition_articles; v_checks jsonb; v_issue public.edition_issues;
BEGIN
  v_admin := public.edition_admin_require();
  SELECT * INTO a FROM public.edition_articles WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_NOT_FOUND'); END IF;
  SELECT * INTO v_issue FROM public.edition_issues WHERE id = a.issue_id;
  CASE _action
    WHEN 'submit' THEN
      IF a.status NOT IN ('draft','rejected') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→submit'); END IF;
      UPDATE public.edition_articles SET status = 'pending_review' WHERE id = a.id;
    WHEN 'approve' THEN
      IF a.status NOT IN ('pending_review','draft','rejected') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→approve'); END IF;
      v_checks := public.edition_article_checks(a.id);
      IF jsonb_array_length(v_checks->'blocking') > 0 THEN PERFORM public.edition_raise('EDITION_CHECKS_FAILED', (v_checks->'blocking')::text); END IF;
      UPDATE public.edition_articles SET status = 'approved', approved_at = now(),
        approved_by_label = left(coalesce(nullif(btrim(_label), ''), 'Dirección editorial IATOS Privé'), 120) WHERE id = a.id;
    WHEN 'reject' THEN
      IF coalesce(btrim(_note), '') = '' THEN PERFORM public.edition_raise('EDITION_NOTE_REQUIRED'); END IF;
      IF a.status NOT IN ('pending_review','approved','draft') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→reject'); END IF;
      UPDATE public.edition_articles SET status = 'rejected', approved_at = NULL, editor_notes = btrim(_note) WHERE id = a.id;
    WHEN 'schedule' THEN
      IF a.status <> 'approved' THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→schedule'); END IF;
      IF _when IS NULL OR _when <= now() THEN PERFORM public.edition_raise('EDITION_BAD_DATE'); END IF;
      UPDATE public.edition_articles SET status = 'scheduled', scheduled_for = _when, published_at = _when WHERE id = a.id;
    WHEN 'publish' THEN
      IF a.status NOT IN ('approved','scheduled') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→publish'); END IF;
      IF NOT public.edition_is_live(v_issue.status, v_issue.scheduled_for) THEN PERFORM public.edition_raise('EDITION_ISSUE_NOT_PUBLISHED'); END IF;
      v_checks := public.edition_article_checks(a.id);
      IF jsonb_array_length(v_checks->'blocking') > 0 THEN PERFORM public.edition_raise('EDITION_CHECKS_FAILED', (v_checks->'blocking')::text); END IF;
      UPDATE public.edition_articles SET status = 'published', published_at = now(), scheduled_for = NULL WHERE id = a.id;
    WHEN 'retract' THEN
      IF coalesce(btrim(_note), '') = '' THEN PERFORM public.edition_raise('EDITION_NOTE_REQUIRED'); END IF;
      IF a.status NOT IN ('published','scheduled') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→retract'); END IF;
      UPDATE public.edition_articles SET status = 'retracted', retracted_at = now(), retraction_note = btrim(_note) WHERE id = a.id;
    WHEN 'return_to_review' THEN
      IF a.status NOT IN ('approved','scheduled','rejected') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', a.status || '→return_to_review'); END IF;
      UPDATE public.edition_articles SET status = 'pending_review', scheduled_for = NULL, approved_at = NULL,
        published_at = CASE WHEN status = 'scheduled' THEN NULL ELSE published_at END WHERE id = a.id;
    ELSE PERFORM public.edition_raise('EDITION_BAD_ACTION', _action);
  END CASE;
  PERFORM public.edition_log_review('article', a.slug, _action, v_admin, _note, CASE WHEN _when IS NOT NULL THEN jsonb_build_object('when', _when) END);
  SELECT * INTO a FROM public.edition_articles WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'article', public.edition_article_json(a, false, true), 'checks', public.edition_article_checks(a.id));
END $$;

-- Cambios de estado de un número: approve · schedule · publish · retract · return_to_review.
-- Publicar el número publica sus artículos APROBADOS (los demás siguen en revisión, invisibles).
CREATE OR REPLACE FUNCTION public.edition_admin_issue_transition(_slug text, _action text, _note text DEFAULT NULL,
  _when timestamptz DEFAULT NULL, _label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; i public.edition_issues; v_checks jsonb; n int;
BEGIN
  v_admin := public.edition_admin_require();
  SELECT * INTO i FROM public.edition_issues WHERE slug = _slug FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_NOT_FOUND'); END IF;
  CASE _action
    WHEN 'approve' THEN
      IF i.status NOT IN ('draft','pending_review') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', i.status || '→approve'); END IF;
      v_checks := public.edition_issue_checks(i.id);
      IF jsonb_array_length(v_checks->'blocking') > 0 THEN PERFORM public.edition_raise('EDITION_CHECKS_FAILED', (v_checks->'blocking')::text); END IF;
      UPDATE public.edition_issues SET status = 'approved', approved_at = now(),
        approved_by_label = left(coalesce(nullif(btrim(_label), ''), 'Dirección editorial IATOS Privé'), 120) WHERE id = i.id;
    WHEN 'schedule' THEN
      IF i.status <> 'approved' THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', i.status || '→schedule'); END IF;
      IF _when IS NULL OR _when <= now() THEN PERFORM public.edition_raise('EDITION_BAD_DATE'); END IF;
      UPDATE public.edition_issues SET status = 'scheduled', scheduled_for = _when, published_at = _when WHERE id = i.id;
      UPDATE public.edition_articles SET status = 'scheduled', scheduled_for = _when, published_at = _when WHERE issue_id = i.id AND status = 'approved';
    WHEN 'publish' THEN
      IF i.status NOT IN ('approved','scheduled') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', i.status || '→publish'); END IF;
      v_checks := public.edition_issue_checks(i.id);
      IF jsonb_array_length(v_checks->'blocking') > 0 THEN PERFORM public.edition_raise('EDITION_CHECKS_FAILED', (v_checks->'blocking')::text); END IF;
      UPDATE public.edition_issues SET status = 'published', published_at = now(), scheduled_for = NULL WHERE id = i.id;
      UPDATE public.edition_articles SET status = 'published', published_at = now(), scheduled_for = NULL
       WHERE issue_id = i.id AND status IN ('approved','scheduled');
      GET DIAGNOSTICS n = ROW_COUNT;
    WHEN 'retract' THEN
      IF coalesce(btrim(_note), '') = '' THEN PERFORM public.edition_raise('EDITION_NOTE_REQUIRED'); END IF;
      IF i.status NOT IN ('published','scheduled') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', i.status || '→retract'); END IF;
      UPDATE public.edition_issues SET status = 'retracted', retracted_at = now(), retraction_note = btrim(_note) WHERE id = i.id;
      UPDATE public.edition_articles SET status = 'retracted', retracted_at = now(), retraction_note = btrim(_note)
       WHERE issue_id = i.id AND status IN ('published','scheduled');
    WHEN 'return_to_review' THEN
      IF i.status NOT IN ('approved','scheduled') THEN PERFORM public.edition_raise('EDITION_BAD_TRANSITION', i.status || '→return_to_review'); END IF;
      UPDATE public.edition_issues SET status = 'pending_review', scheduled_for = NULL, published_at = NULL, approved_at = NULL WHERE id = i.id;
      UPDATE public.edition_articles SET status = 'approved', scheduled_for = NULL, published_at = NULL WHERE issue_id = i.id AND status = 'scheduled';
    ELSE PERFORM public.edition_raise('EDITION_BAD_ACTION', _action);
  END CASE;
  PERFORM public.edition_log_review('issue', i.slug, _action, v_admin, _note,
    jsonb_strip_nulls(jsonb_build_object('when', _when, 'articles_published', n)));
  SELECT * INTO i FROM public.edition_issues WHERE id = i.id;
  RETURN jsonb_build_object('ok', true, 'issue', public.edition_issue_json(i, true), 'checks', public.edition_issue_checks(i.id));
END $$;

-- Licencia de imagen: aprobar (solo con licencia, enlace, crédito y página) o bloquear.
CREATE OR REPLACE FUNCTION public.edition_admin_image_license(_key text, _decision text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid; im public.edition_images;
BEGIN
  v_admin := public.edition_admin_require();
  SELECT * INTO im FROM public.edition_images WHERE key = _key FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.edition_raise('EDITION_NOT_FOUND'); END IF;
  IF _decision = 'approve' THEN
    IF coalesce(btrim(im.license), '') = '' OR im.license_url IS NULL OR coalesce(btrim(im.photographer), '') = '' OR im.page_url IS NULL THEN
      PERFORM public.edition_raise('EDITION_LICENSE_INCOMPLETE');
    END IF;
    UPDATE public.edition_images SET license_status = 'approved', license_reviewed_at = now(), license_note = _note WHERE id = im.id;
    PERFORM public.edition_log_review('image', im.key, 'license_approve', v_admin, _note);
  ELSIF _decision = 'block' THEN
    IF coalesce(btrim(_note), '') = '' THEN PERFORM public.edition_raise('EDITION_NOTE_REQUIRED'); END IF;
    UPDATE public.edition_images SET license_status = 'blocked', license_reviewed_at = now(), license_note = _note WHERE id = im.id;
    PERFORM public.edition_log_review('image', im.key, 'license_block', v_admin, _note);
  ELSE PERFORM public.edition_raise('EDITION_BAD_ACTION', _decision);
  END IF;
  SELECT * INTO im FROM public.edition_images WHERE id = im.id;
  RETURN jsonb_build_object('ok', true, 'image', public.edition_image_json(im, true));
END $$;

-- Resultado de la comprobación de un enlace de fuente (función edition-link-check con service_role, o un
-- admin a mano desde el panel).
CREATE OR REPLACE FUNCTION public.edition_record_link_check(_key text, _status text, _http int DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid;
BEGIN
  -- Ojo: dentro de SECURITY DEFINER current_user es el dueño; solo cuenta el rol del JWT.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    v_actor := public.edition_admin_require();
  END IF;
  IF _status NOT IN ('ok','broken','blocked','unchecked') THEN PERFORM public.edition_raise('EDITION_BAD_ACTION', _status); END IF;
  UPDATE public.edition_sources SET link_status = _status, link_http = _http, link_checked_at = now() WHERE key = _key;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.edition_log_review('source', _key, 'link_check', v_actor, _status || coalesce(' ' || _http, ''));
  RETURN true;
END $$;

-- Lista de URLs de fuentes para la función de comprobación (solo admins o service_role).
CREATE OR REPLACE FUNCTION public.edition_sources_to_check(_limit int DEFAULT 60)
RETURNS TABLE (key text, url text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Ojo: dentro de SECURITY DEFINER current_user es el dueño; solo cuenta el rol del JWT.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.edition_admin_require();
  END IF;
  RETURN QUERY SELECT s.key, s.url FROM public.edition_sources s
   ORDER BY s.link_checked_at NULLS FIRST, s.key LIMIT greatest(1, least(coalesce(_limit, 60), 120));
END $$;

REVOKE ALL ON FUNCTION public.edition_admin_overview(), public.edition_admin_preview(text),
  public.edition_admin_article_update(text, jsonb, text), public.edition_admin_article_correct(text, jsonb, text),
  public.edition_admin_article_transition(text, text, text, timestamptz, text),
  public.edition_admin_issue_transition(text, text, text, timestamptz, text),
  public.edition_admin_image_license(text, text, text), public.edition_record_link_check(text, text, int),
  public.edition_sources_to_check(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edition_admin_overview(), public.edition_admin_preview(text),
  public.edition_admin_article_update(text, jsonb, text), public.edition_admin_article_correct(text, jsonb, text),
  public.edition_admin_article_transition(text, text, text, timestamptz, text),
  public.edition_admin_issue_transition(text, text, text, timestamptz, text),
  public.edition_admin_image_license(text, text, text), public.edition_record_link_check(text, text, int),
  public.edition_sources_to_check(int) TO authenticated, service_role;
