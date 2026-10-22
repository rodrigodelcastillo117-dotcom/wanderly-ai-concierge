-- IATOS Privé (grupo catalog) · 4/9 · Copia de nightlife_premium (Members Only) al catálogo nuevo.
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §5.1–5.2.
--
-- Las 194 filas de producción (solo 28 están en el repo) no tienen fuente, fecha de verificación ni
-- coordenadas, y 47 traen superlativos que no se pueden comprobar. Por eso entran como PENDIENTE:
-- quedan OCULTAS (ninguna RPC de contenido muestra PENDIENTE) hasta que una persona o la curaduría las
-- revise. nightlife_premium NO se toca: Members Only y members_teaser siguen leyendo la tabla vieja.
--  * universo: after_dark; casino_vip → casino_grand_nights (y no puede salir de PENDIENTE sin la
--    autoridad que otorga la licencia: CHECK prive_casino_rules);
--  * sitio: con https:// si venía sin esquema; si no parece un dominio, NULL;
--  * precio: solo como nota "Antes: €€€€" (no se convierte a nivel de precio);
--  * duplicados por ciudad (misma llave de nombre): una fila; las demás quedan en merged_legacy_ids;
--  * mismo nombre de dominio en la misma ciudad (hankypanky.mx y hankypanky.com.mx): aviso para una
--    persona en prive_dedupe_candidates.
-- Idempotente: una fila ya copiada (o fusionada) no se vuelve a copiar.

-- Etiqueta principal del dominio, sin www ni TLD: "https://www.hankypanky.com.mx/x" → "hankypanky".
CREATE OR REPLACE FUNCTION public.prive_site_label(_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(split_part(regexp_replace(lower(substring(coalesce(_url, '') FROM '^https?://([^/:?#]+)')), '^www\.', ''), '.', 1), '');
$$;

-- Sitio heredado → https o NULL.
CREATE OR REPLACE FUNCTION public.prive_legacy_https(_w text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _w IS NULL OR btrim(_w) = '' THEN NULL
    WHEN btrim(_w) ~* '^https://[a-z0-9.-]+\.[a-z]{2,}' THEN btrim(_w)
    WHEN btrim(_w) ~* '^http://[a-z0-9.-]+\.[a-z]{2,}' THEN regexp_replace(btrim(_w), '^http://', 'https://', 'i')
    WHEN btrim(_w) ~* '^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/\S*)?$' THEN 'https://' || btrim(_w)
    ELSE NULL END;
$$;

DO $$
DECLARE
  r record; v_dest uuid; v_dest_slug text; v_key text; v_existing uuid; v_slug text; v_n int := 0; v_merged int := 0; v_skip int := 0;
BEGIN
  IF to_regclass('public.nightlife_premium') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT n.* FROM public.nightlife_premium n
     WHERE NOT EXISTS (SELECT 1 FROM public.prive_experiences e WHERE e.legacy_nightlife_id = n.id OR n.id = ANY (e.merged_legacy_ids))
     ORDER BY (public.prive_legacy_https(n.website) IS NULL), n.created_at, n.id
  LOOP
    v_dest := coalesce(public.prive_resolve_destination(r.ciudad), public.prive_resolve_destination(r.ciudad_display));
    -- Un barrio heredado (p. ej. "polanco") cuelga de su destino.
    SELECT CASE WHEN d.kind = 'neighborhood' THEN d.parent_id ELSE d.id END INTO v_dest FROM public.prive_destinations d WHERE d.id = v_dest;
    SELECT slug INTO v_dest_slug FROM public.prive_destinations WHERE id = v_dest;
    IF v_dest IS NULL OR NOT EXISTS (SELECT 1 FROM public.prive_destinations WHERE id = v_dest AND is_destination AND kind IN ('country','region','locality')) THEN
      v_skip := v_skip + 1;
      RAISE NOTICE 'prive backfill: ciudad sin destino en el catálogo, fila % (%) no copiada', r.id, r.ciudad;
      CONTINUE;
    END IF;
    UPDATE public.prive_destinations SET legacy_ciudad_key = r.ciudad
     WHERE id = v_dest AND legacy_ciudad_key IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.prive_destinations x WHERE x.legacy_ciudad_key = r.ciudad);
    v_key := public.prive_dedupe_key(r.nombre);
    SELECT id INTO v_existing FROM public.prive_experiences WHERE destination_id = v_dest AND dedupe_key = v_key;
    IF v_existing IS NOT NULL THEN
      UPDATE public.prive_experiences SET merged_legacy_ids = array_append(merged_legacy_ids, r.id)
       WHERE id = v_existing AND NOT (r.id = ANY (merged_legacy_ids));
      v_merged := v_merged + 1;
      CONTINUE;
    END IF;
    v_slug := left(v_dest_slug || '-' || coalesce(nullif(regexp_replace(v_key, '[^a-z0-9]+', '-', 'g'), ''), 'lugar'), 100)
              || '-' || substr(replace(r.id::text, '-', ''), 1, 6);
    INSERT INTO public.prive_experiences (
      slug, destination_id, universe, subcategory, name, address, lat, lng, geo_precision, geo_source, website,
      booking_method, reservation_required, description_es, why_fact_es, dress_code_es, age_policy,
      price_note_es, tags, legacy_nightlife_id, data_state, import_batch, active, curation_notes)
    VALUES (
      v_slug, v_dest,
      CASE WHEN r.categoria = 'casino_vip' THEN 'casino_grand_nights' ELSE 'after_dark' END,
      left(coalesce(nullif(regexp_replace(lower(r.categoria), '[^a-z0-9_]+', '_', 'g'), ''), 'otro'), 40),
      r.nombre, r.address,
      CASE WHEN r.lat IS NOT NULL AND r.lng IS NOT NULL THEN r.lat END,
      CASE WHEN r.lat IS NOT NULL AND r.lng IS NOT NULL THEN r.lng END,
      CASE WHEN r.lat IS NOT NULL AND r.lng IS NOT NULL THEN 'aproximada' END,
      CASE WHEN r.lat IS NOT NULL AND r.lng IS NOT NULL THEN 'legado_sin_fuente' END,
      public.prive_legacy_https(r.website),
      'concierge_request', NULL, r.descripcion, r.por_que, r.dress_code, '18+',
      CASE WHEN nullif(btrim(r.precio_estimado), '') IS NOT NULL THEN 'Antes: ' || btrim(r.precio_estimado) END,
      coalesce(r.tags, '{}'), r.id, 'PENDIENTE', 'legacy_nightlife_premium', r.active,
      'Copiado de nightlife_premium sin fuente ni verificación: oculto hasta revisión humana.');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'prive backfill: % copiadas, % fusionadas como duplicado, % sin destino', v_n, v_merged, v_skip;

  -- Avisos de posible duplicado por dominio (regla 2) para revisión humana.
  INSERT INTO public.prive_dedupe_candidates (a_id, b_id, rule)
  SELECT least(a.id, b.id), greatest(a.id, b.id), 'mismo_dominio'
    FROM public.prive_experiences a JOIN public.prive_experiences b
      ON a.destination_id = b.destination_id AND a.id < b.id
     AND public.prive_site_label(a.website) = public.prive_site_label(b.website)
   WHERE a.website IS NOT NULL AND b.website IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.prive_site_label(text), public.prive_legacy_https(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_site_label(text), public.prive_legacy_https(text) TO service_role;
