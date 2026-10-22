-- IATOS Privé (grupo catalog) · 8/9 · Carga de la curaduría (content_g*.json) ya validada por
-- scripts/prive/load_curation.mjs. Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §9.2.
--
-- prive_import_batch(filas, lote, dry_run): solo servidor (service_role). Por omisión es un ENSAYO: hace
-- todo dentro de un bloque y lo deshace al final, devolviendo el reporte. Con dry_run = false aplica.
--  * upsert por (destino, llave de duplicado): una fila curada que coincide con una heredada (la misma
--    llave, o keep_existing con su nombre original) la ACTUALIZA y conserva su id y legacy_nightlife_id;
--  * replaces_existing_name: la fila reemplazada queda active = false y replaced_by_id = la nueva;
--  * el cargador NUNCA asigna PARTNER VERIFICADO ni BENEFICIO EXCLUSIVO (no hay acuerdos): esas filas
--    se rechazan; las etiquetas de socio solo las pone una persona con el contrato en el registro;
--  * cada fila va en su propia subtransacción: si rompe un CHECK, se rechaza con el motivo y las demás
--    siguen.
-- Idempotente.

-- Destino raíz de una familia (San José del Cabo → Los Cabos; Punta Mita → Riviera Nayarit). Sirve para
-- que un mismo lugar no exista dos veces bajo destinos que se contienen.
CREATE OR REPLACE FUNCTION public.prive_destination_root(_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.parent_id, 0 AS depth FROM public.prive_destinations d WHERE d.id = _id
    UNION ALL
    SELECT p.id, p.parent_id, up.depth + 1 FROM up JOIN public.prive_destinations p ON p.id = up.parent_id
     WHERE p.is_destination AND p.kind <> 'area' AND up.depth < 6)
  SELECT id FROM up ORDER BY depth DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.prive_destination_root(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_destination_root(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prive_import_batch(p_rows jsonb, p_batch text, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; v_new boolean; v_dest uuid; v_neigh uuid; v_id uuid; v_old uuid; v_key text; v_name text;
  n_ins int := 0; n_upd int := 0; n_rep int := 0; v_rej jsonb := '[]'; v_warn jsonb := '[]'; v_report jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'prive_import_batch: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'prive_import_batch: se espera un arreglo'; END IF;
  BEGIN
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_name := r->>'name';
      BEGIN
        SELECT id INTO v_dest FROM public.prive_destinations WHERE slug = r->>'destination_slug' AND is_destination AND kind IN ('country','region','locality');
        IF v_dest IS NULL THEN RAISE EXCEPTION 'destino % no está en el catálogo', r->>'destination_slug'; END IF;
        v_neigh := NULL;
        IF r->>'neighborhood_slug' IS NOT NULL THEN
          SELECT id INTO v_neigh FROM public.prive_destinations WHERE slug = r->>'neighborhood_slug' AND kind = 'neighborhood' AND parent_id = v_dest;
        END IF;
        IF coalesce(r->>'commercial_label', 'NINGUNA') NOT IN ('NINGUNA','EXPERIENCIA_CURADA','EXPERIENCIA_PRIVADA') THEN
          RAISE EXCEPTION 'el cargador no asigna etiquetas de socio (%)', r->>'commercial_label';
        END IF;
        -- Fila existente: misma llave, o la heredada que keep_existing nombra.
        v_key := public.prive_dedupe_key(v_name);
        SELECT id INTO v_id FROM public.prive_experiences WHERE destination_id = v_dest AND dedupe_key = v_key;
        IF v_id IS NULL AND (r->>'keep_existing')::boolean AND r->>'original_name' IS NOT NULL THEN
          SELECT id INTO v_id FROM public.prive_experiences
           WHERE destination_id = v_dest AND dedupe_key = public.prive_dedupe_key(r->>'original_name');
        END IF;
        -- El mismo nombre ya existe en otro destino de la misma familia: duplicado, no se crea otro.
        IF v_id IS NULL AND EXISTS (SELECT 1 FROM public.prive_experiences x
             WHERE x.dedupe_key = v_key AND x.destination_id <> v_dest AND x.active
               AND public.prive_destination_root(x.destination_id) = public.prive_destination_root(v_dest)) THEN
          RAISE EXCEPTION 'duplicado en la jerarquía de destinos: "%" ya existe en %', v_name,
            (SELECT d.slug FROM public.prive_experiences x JOIN public.prive_destinations d ON d.id = x.destination_id
              WHERE x.dedupe_key = v_key AND x.destination_id <> v_dest AND x.active
                AND public.prive_destination_root(x.destination_id) = public.prive_destination_root(v_dest) LIMIT 1);
        END IF;
        IF v_id IS NULL THEN
          INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, data_state, age_policy)
          VALUES (r->>'slug', v_dest, r->>'universe', r->>'subcategory', v_name, 'PENDIENTE', coalesce(r->>'age_policy', 'todas'))
          RETURNING id INTO v_id;
          v_new := true;
        ELSE
          v_new := false;
        END IF;
        UPDATE public.prive_experiences SET
          name = v_name, neighborhood_id = v_neigh, universe = r->>'universe', subcategory = r->>'subcategory',
          address = r->>'address', lat = (r->>'lat')::numeric, lng = (r->>'lng')::numeric,
          geo_precision = r->>'geo_precision', geo_source = r->>'geo_source',
          website = r->>'website', booking_url = r->>'booking_url', booking_method = coalesce(r->>'booking_method', 'concierge_request'),
          reservation_required = (r->>'reservation_required')::boolean,
          description_es = r->>'description_es', why_fact_es = r->>'why_fact_es',
          dress_code_es = r->>'dress_code_es', dress_code_source = r->>'dress_code_source',
          age_policy = coalesce(r->>'age_policy', 'todas'), age_policy_source = r->>'age_policy_source',
          restrictions_es = r->>'restrictions_es', safety_requirements_es = r->>'safety_requirements_es',
          operator_name = r->>'operator_name', operator_url = r->>'operator_url', operator_license = r->>'operator_license',
          license_authority = r->>'license_authority', license_ref = r->>'license_ref', license_source = r->>'license_source',
          price_level = (r->>'price_level')::smallint, price_note_es = r->>'price_note_es',
          price_currency = r->>'price_currency', price_min = (r->>'price_min')::numeric, price_max = (r->>'price_max')::numeric,
          price_basis = r->>'price_basis', price_source_url = r->>'price_source_url', price_checked_at = (r->>'price_checked_at')::timestamptz,
          opening_hours = CASE WHEN jsonb_typeof(r->'opening_hours') = 'object' THEN r->'opening_hours' END, opening_hours_source = r->>'opening_hours_source',
          opening_hours_checked_at = (r->>'opening_hours_checked_at')::timestamptz,
          season_note_es = r->>'season_note_es',
          season_months = CASE WHEN jsonb_typeof(r->'season_months') = 'array' THEN ARRAY(SELECT x::smallint FROM jsonb_array_elements_text(r->'season_months') x) END,
          season_reopens_on = (r->>'season_reopens_on')::date, season_closes_on = (r->>'season_closes_on')::date,
          season_source = r->>'season_source',
          data_state = r->>'data_state', operating_status = coalesce(r->>'operating_status', 'desconocido'),
          operating_checked_at = (r->>'operating_checked_at')::timestamptz,
          verified_at = (r->>'verified_at')::timestamptz, verified_by = r->>'verified_by',
          accolades = coalesce(nullif(r->'accolades', 'null'::jsonb), '[]'), sources = coalesce(nullif(r->'sources', 'null'::jsonb), '[]'),
          commercial_label = coalesce(r->>'commercial_label', 'NINGUNA'),
          image_source = 'pexels', image_query = r->>'image_query',
          tags = coalesce(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r->'tags') = 'array' THEN r->'tags' ELSE '[]' END)), '{}'),
          import_batch = p_batch, curation_notes = r->>'curation_notes', active = true, replaced_by_id = NULL
        WHERE id = v_id;
        -- Reemplazo de una fila heredada por otra distinta.
        IF r->>'replaces_existing_name' IS NOT NULL THEN
          SELECT id INTO v_old FROM public.prive_experiences
           WHERE destination_id = v_dest AND dedupe_key = public.prive_dedupe_key(r->>'replaces_existing_name') AND id <> v_id;
          IF v_old IS NOT NULL THEN
            UPDATE public.prive_experiences SET active = false, replaced_by_id = v_id WHERE id = v_old;
            n_rep := n_rep + 1;
          ELSE
            v_warn := v_warn || jsonb_build_array(jsonb_build_object('name', v_name, 'warning',
              'replaces_existing_name "' || (r->>'replaces_existing_name') || '" no existe en este destino'));
          END IF;
        END IF;
        IF v_new THEN n_ins := n_ins + 1; ELSE n_upd := n_upd + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_rej := v_rej || jsonb_build_array(jsonb_build_object('name', v_name, 'destination', r->>'destination_slug', 'reason', SQLERRM));
      END;
      v_id := NULL; v_old := NULL;
    END LOOP;
    -- Avisos de duplicado por dominio dentro del destino (una persona decide).
    INSERT INTO public.prive_dedupe_candidates (a_id, b_id, rule)
    SELECT least(a.id, b.id), greatest(a.id, b.id), 'mismo_dominio'
      FROM public.prive_experiences a JOIN public.prive_experiences b
        ON a.destination_id = b.destination_id AND a.id < b.id AND a.active AND b.active
       AND public.prive_site_label(a.website) = public.prive_site_label(b.website)
     WHERE a.import_batch = p_batch AND a.website IS NOT NULL AND b.website IS NOT NULL
    ON CONFLICT DO NOTHING;
    v_report := jsonb_build_object('batch', p_batch, 'dry_run', p_dry_run, 'inserted', n_ins, 'updated', n_upd, 'replaced', n_rep,
      'rejected', v_rej, 'warnings', v_warn,
      'dedupe_candidates', (SELECT count(*) FROM public.prive_dedupe_candidates c JOIN public.prive_experiences a ON a.id = c.a_id WHERE a.import_batch = p_batch),
      'by_state', (SELECT coalesce(jsonb_object_agg(effective_state, n), '{}') FROM (SELECT effective_state, count(*) n
                     FROM public.prive_experiences_v WHERE import_batch = p_batch GROUP BY 1) t));
    IF p_dry_run THEN RAISE EXCEPTION 'PRIVE_DRY_RUN_ROLLBACK'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PRIVE_DRY_RUN_ROLLBACK' THEN RAISE; END IF;
  END;
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.prive_import_batch(jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_import_batch(jsonb, text, boolean) TO service_role;
