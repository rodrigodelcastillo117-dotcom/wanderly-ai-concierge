-- IATOS Privé · privevalor 1/6 · PRIVÉ DROPS (Doc B §6) = "Privé Opportunities" de THE PRIVATE EDITION.
-- Una sola fuente de oportunidades verdaderas, tipadas y con fuente. Reglas que la BASE hace imposibles
-- de romper (trigger de validación, no solo la pantalla):
--  * todo Drop tiene proveedor, fuente https, enlace oficial https, fecha de verificación y quién verificó;
--    los no editoriales además condiciones y elegibilidad;
--  * un porcentaje solo existe con comparación verificable: precio de referencia + precio de oferta +
--    moneda + URL de la fuente de precios, y el porcentaje cuadra con la aritmética (±0.5). Ningún texto
--    puede traer "40 %" sin esa comparación; tampoco frases de escasez ("solo quedan", "última
--    oportunidad", "only 3 left"…);
--  * "beneficio contractual IATOS" solo con un beneficio del registro de alianzas existente
--    (prive_partner_benefits) vigente; el texto del beneficio sale del contrato; sin acuerdo no se muestra
--    (hoy no hay acuerdos: ese tipo no aparece);
--  * el estado efectivo se CALCULA: vencido al pasar valid_until (zona horaria del destino), por verificar
--    si nadie lo revisó en 45 días, programado antes de valid_from; los vencidos salen solos de la lista.
-- Las tablas no se leen desde el cliente: todo sale por RPC con prive_require() (miembros Privé).
-- API estrecha para el equipo edition (THE PRIVATE EDITION): prive_drops(_ps, …) y la vista
-- prive_drops_live (solo service_role). Ver docs/iatos/prive_reimagined/PRIVEVALOR.md.
-- Idempotente.

-- ───────────────────────────── utilidades comunes del equipo privevalor ──────────────────────────────
-- ¿Parece un número de tarjeta (13–19 dígitos seguidos, con o sin espacios/guiones/puntos)? Se usa en
-- los CHECK de todo texto libre de privevalor: nunca guardamos números completos de tarjeta.
CREATE OR REPLACE FUNCTION public.prive_has_card_number(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(regexp_replace(_t, '[\s.\-]', '', 'g') ~ '[0-9]{13,19}', false);
$$;
-- Solo la usan CHECK y RPC del servidor (dueño de las funciones): nadie más la necesita.
REVOKE ALL ON FUNCTION public.prive_has_card_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_has_card_number(text) TO service_role;

-- Frases de urgencia/escasez falsas que nunca deben aparecer en una oportunidad.
CREATE OR REPLACE FUNCTION public.prive_has_fake_urgency(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(public.prive_norm(_t) ~ ('(solo|unicamente) quedan|quedan pocos|ultim[oa]s? (lugares|habitaciones|boletos|asientos|oportunidad|horas)'
    || '|se (agota|acaba)|agotandose|date prisa|apresurate|no te lo pierdas|only [0-9]+ left|last chance|hurry|selling fast|almost gone|ends tonight'), false);
$$;
-- Un porcentaje escrito en el texto ("40%", "40 %", "40 por ciento").
CREATE OR REPLACE FUNCTION public.prive_has_percent(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(_t ~* '[0-9]\s*(%|por ciento|percent)', false);
$$;
REVOKE ALL ON FUNCTION public.prive_has_fake_urgency(text), public.prive_has_percent(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_has_fake_urgency(text), public.prive_has_percent(text) TO service_role;

-- ───────────────────────────── métricas de producto (Doc B §18), sin datos personales ─────────────────
-- Solo códigos de evento e ids internos; nunca texto libre, montos, nombres, correos ni ubicaciones.
-- user_id es el id interno (seudónimo) para contar retorno; se borra con la cuenta (limpieza por user_id).
CREATE TABLE IF NOT EXISTS public.prive_value_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  event text NOT NULL CHECK (event IN ('drops_view','drop_open','drop_link_open','radar_view','radar_state_change',
    'value_view','value_entry_added','insider_view','tip_saved','tip_added_to_trip','before_you_go_view',
    'passport_view','passport_entry_added','preview_view','preview_pro_click','edition_teaser_click')),
  ref_id uuid,                         -- drop, consejo o elemento (id interno, no texto)
  destination_id uuid,
  state text CHECK (state IS NULL OR state ~ '^[a-z_]{1,24}$'),
  surface text CHECK (surface IS NULL OR surface IN ('for_you','drops','insider','my_prive','radar','preview','trip','edition')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prive_value_events_time ON public.prive_value_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS prive_value_events_user ON public.prive_value_events (user_id, created_at DESC);
ALTER TABLE public.prive_value_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_value_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_value_events TO service_role;

-- Registro interno desde las RPC (ya autorizadas).
CREATE OR REPLACE FUNCTION public.prive_value_log(_uid uuid, _event text, _ref uuid DEFAULT NULL, _dest uuid DEFAULT NULL,
  _state text DEFAULT NULL, _surface text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.prive_value_events (user_id, event, ref_id, destination_id, state, surface)
  VALUES (_uid, _event, _ref, _dest, _state, _surface);
EXCEPTION WHEN check_violation OR read_only_sql_transaction THEN
  NULL;  -- una métrica nunca rompe la acción del miembro
END $$;
REVOKE ALL ON FUNCTION public.prive_value_log(uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_value_log(uuid, text, uuid, uuid, text, text) TO service_role;

-- Desde la app (vistas y clics). Los eventos de cambio (radar, valor, consejos, pasaporte) los escribe
-- solo el servidor dentro de cada RPC; aquí se rechazan.
CREATE OR REPLACE FUNCTION public.prive_value_track(_ps text, _event text, _ref uuid DEFAULT NULL, _destination text DEFAULT NULL,
  _surface text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_rl jsonb;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _event NOT IN ('drops_view','drop_open','drop_link_open','radar_view','value_view','insider_view','before_you_go_view',
                    'passport_view','edition_teaser_click') THEN
    RETURN false;
  END IF;
  IF _surface IS NOT NULL AND _surface NOT IN ('for_you','drops','insider','my_prive','radar','trip','edition') THEN _surface := NULL; END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_value_track', 120, 60);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN false; END IF;
  PERFORM public.prive_value_log(v_uid, _event, _ref,
    CASE WHEN _destination IS NOT NULL THEN public.prive_resolve_destination(_destination) END, NULL, _surface);
  RETURN true;
END $$;

-- Vista previa antes del día 90 (§14): solo exige sesión de IATOS, no Privé. Un único evento.
CREATE OR REPLACE FUNCTION public.prive_preview_track(_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_rl jsonb;
BEGIN
  IF v_uid IS NULL OR _event NOT IN ('preview_view','preview_pro_click') THEN RETURN false; END IF;
  v_rl := public.check_rate_limit(v_uid::text, 'prive_preview_track', 30, 60);
  IF coalesce((v_rl->>'allowed')::boolean, true) = false THEN RETURN false; END IF;
  PERFORM public.prive_value_log(v_uid, _event, NULL, NULL, NULL, 'preview');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.prive_value_track(text, text, uuid, text, text), public.prive_preview_track(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_value_track(text, text, uuid, text, text), public.prive_preview_track(text) TO authenticated, service_role;

-- ───────────────────────────── PRIVÉ DROPS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prive_drops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  drop_type        text NOT NULL CHECK (drop_type IN (
                     'promocion_publica',   -- promoción pública verificada
                     'tarifa_publicada',    -- tarifa especial publicada por el proveedor
                     'beneficio_lealtad',   -- beneficio de un programa de lealtad
                     'beneficio_tarjeta',   -- beneficio de tarjeta POTENCIALMENTE aplicable
                     'oferta_temporal',     -- oferta temporal con condiciones verificadas
                     'beneficio_iatos',     -- beneficio contractual IATOS (solo con acuerdo vigente)
                     'editorial')),         -- oportunidad editorial, etiquetada como tal
  title_es         text NOT NULL CHECK (length(btrim(title_es)) BETWEEN 3 AND 120),
  title_en         text CHECK (title_en IS NULL OR length(btrim(title_en)) BETWEEN 3 AND 120),
  provider_name    text NOT NULL CHECK (length(btrim(provider_name)) BETWEEN 2 AND 120),
  provider_url     text CHECK (provider_url IS NULL OR provider_url ~ '^https://'),
  destination_id   uuid REFERENCES public.prive_destinations(id),   -- NULL = aplica en cualquier destino
  benefit_es       text NOT NULL CHECK (length(btrim(benefit_es)) BETWEEN 3 AND 400),
  benefit_en       text CHECK (benefit_en IS NULL OR length(benefit_en) <= 400),
  conditions_es    text CHECK (conditions_es IS NULL OR length(conditions_es) <= 900),
  conditions_en    text CHECK (conditions_en IS NULL OR length(conditions_en) <= 900),
  eligibility_es   text CHECK (eligibility_es IS NULL OR length(eligibility_es) <= 400),
  eligibility_en   text CHECK (eligibility_en IS NULL OR length(eligibility_en) <= 400),
  restrictions_es  text CHECK (restrictions_es IS NULL OR length(restrictions_es) <= 600),
  restrictions_en  text CHECK (restrictions_en IS NULL OR length(restrictions_en) <= 600),
  valid_from       date,
  valid_until      date,
  -- Precio y comparación: solo con la fuente de precios. discount_pct solo si la comparación es verificable.
  offer_price      numeric(12,2) CHECK (offer_price IS NULL OR offer_price >= 0),
  reference_price  numeric(12,2) CHECK (reference_price IS NULL OR reference_price > 0),
  price_currency   char(3) CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  price_source_url text CHECK (price_source_url IS NULL OR price_source_url ~ '^https://'),
  discount_pct     numeric(5,2) CHECK (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct < 100)),
  source_url       text NOT NULL CHECK (source_url ~ '^https://'),
  source_name      text CHECK (source_name IS NULL OR length(source_name) <= 160),
  link_url         text NOT NULL CHECK (link_url ~ '^https://'),
  last_verified_at timestamptz NOT NULL,
  verified_by      text NOT NULL CHECK (length(btrim(verified_by)) BETWEEN 2 AND 80),
  curation_status  text NOT NULL DEFAULT 'activo' CHECK (curation_status IN ('activo','por_verificar','retirado')),
  -- Relación comercial declarada: promoción pública (ninguna), afiliado, publicidad o convenio IATOS.
  commercial_relationship text NOT NULL DEFAULT 'ninguna' CHECK (commercial_relationship IN ('ninguna','afiliado','publicidad','convenio')),
  partner_benefit_id uuid REFERENCES public.prive_partner_benefits(id),
  -- Para el Privilege Radar: nombres normalizados (prive_norm) de programas/tarjetas a los que aplica.
  program_match    text[] NOT NULL DEFAULT '{}',
  universes        text[] NOT NULL DEFAULT '{}',
  interests        text[] NOT NULL DEFAULT '{}',   -- intereses de THE PRIVATE EDITION (viajes, gastronomia…)
  import_batch     text,
  curation_notes   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_drop_dates CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS prive_drops_dest ON public.prive_drops (destination_id);
CREATE INDEX IF NOT EXISTS prive_drops_until ON public.prive_drops (valid_until);

CREATE OR REPLACE FUNCTION public.prive_drops_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_txt text; v_calc numeric;
BEGIN
  v_txt := concat_ws(' ', NEW.title_es, NEW.title_en, NEW.benefit_es, NEW.benefit_en, NEW.conditions_es, NEW.conditions_en,
                     NEW.eligibility_es, NEW.eligibility_en, NEW.restrictions_es, NEW.restrictions_en);
  IF public.prive_has_fake_urgency(v_txt) THEN
    RAISE EXCEPTION 'prive_drops: sin escasez ni urgencia falsas (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.drop_type <> 'editorial' AND (coalesce(btrim(NEW.conditions_es), '') = '' OR coalesce(btrim(NEW.eligibility_es), '') = '') THEN
    RAISE EXCEPTION 'prive_drops: condiciones y elegibilidad son obligatorias (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  -- Precio de referencia u oferta: siempre con moneda y fuente.
  IF (NEW.offer_price IS NOT NULL OR NEW.reference_price IS NOT NULL) AND (NEW.price_currency IS NULL OR NEW.price_source_url IS NULL) THEN
    RAISE EXCEPTION 'prive_drops: un precio necesita moneda y fuente (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reference_price IS NOT NULL AND NEW.offer_price IS NULL THEN
    RAISE EXCEPTION 'prive_drops: un precio "antes" sin precio actual no compara nada (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.discount_pct IS NOT NULL THEN
    IF NEW.reference_price IS NULL OR NEW.offer_price IS NULL OR NEW.offer_price >= NEW.reference_price THEN
      RAISE EXCEPTION 'prive_drops: un porcentaje exige comparación verificable (%)', NEW.slug USING ERRCODE = 'check_violation';
    END IF;
    v_calc := round(100 * (NEW.reference_price - NEW.offer_price) / NEW.reference_price, 2);
    IF abs(v_calc - NEW.discount_pct) > 0.5 THEN
      RAISE EXCEPTION 'prive_drops: el porcentaje (%) no cuadra con los precios (%)', NEW.discount_pct, v_calc USING ERRCODE = 'check_violation';
    END IF;
  ELSIF public.prive_has_percent(v_txt) THEN
    RAISE EXCEPTION 'prive_drops: un porcentaje en el texto exige la comparación verificable (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  -- Convenio IATOS ⇔ beneficio del registro de alianzas.
  IF NEW.drop_type = 'beneficio_iatos' AND (NEW.partner_benefit_id IS NULL OR NEW.commercial_relationship <> 'convenio') THEN
    RAISE EXCEPTION 'prive_drops: un beneficio IATOS exige un beneficio del registro de alianzas (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.drop_type <> 'beneficio_iatos' AND (NEW.partner_benefit_id IS NOT NULL OR NEW.commercial_relationship = 'convenio') THEN
    RAISE EXCEPTION 'prive_drops: solo un beneficio IATOS declara convenio (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.drop_type = 'beneficio_tarjeta' AND cardinality(NEW.program_match) = 0 THEN
    RAISE EXCEPTION 'prive_drops: un beneficio de tarjeta nombra la(s) tarjeta(s) a la(s) que aplica (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  IF public.prive_has_card_number(v_txt) THEN
    RAISE EXCEPTION 'prive_drops: sin números de tarjeta (%)', NEW.slug USING ERRCODE = 'check_violation';
  END IF;
  NEW.program_match := ARRAY(SELECT DISTINCT public.prive_norm(x) FROM unnest(NEW.program_match) x WHERE public.prive_norm(x) <> '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prive_drops_validate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prive_drops_validate ON public.prive_drops;
CREATE TRIGGER prive_drops_validate BEFORE INSERT OR UPDATE ON public.prive_drops
  FOR EACH ROW EXECUTE FUNCTION public.prive_drops_validate();

ALTER TABLE public.prive_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_drops FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_drops TO service_role;

-- Estado efectivo (calculado, nunca escrito): retirado · programado · vencido · por_verificar · activo.
-- "Hoy" es la fecha local del destino (o de la Ciudad de México si es global): vence al terminar su día.
CREATE OR REPLACE VIEW public.prive_drops_v AS
SELECT d.*,
  coalesce(dest.timezone, 'America/Mexico_City') AS local_tz,
  (now() AT TIME ZONE coalesce(dest.timezone, 'America/Mexico_City'))::date AS local_today,
  CASE
    WHEN d.curation_status = 'retirado' THEN 'retirado'
    WHEN d.drop_type = 'beneficio_iatos' AND NOT public.prive_benefit_active(d.partner_benefit_id) THEN 'retirado'
    WHEN d.valid_until IS NOT NULL AND d.valid_until < (now() AT TIME ZONE coalesce(dest.timezone, 'America/Mexico_City'))::date THEN 'vencido'
    WHEN d.valid_from IS NOT NULL AND d.valid_from > (now() AT TIME ZONE coalesce(dest.timezone, 'America/Mexico_City'))::date THEN 'programado'
    WHEN d.curation_status = 'por_verificar' OR d.last_verified_at < now() - interval '45 days' THEN 'por_verificar'
    ELSE 'activo'
  END AS effective_status,
  dest.slug AS destination_slug, dest.name_es AS destination_name_es, dest.name_en AS destination_name_en
FROM public.prive_drops d
LEFT JOIN public.prive_destinations dest ON dest.id = d.destination_id;
REVOKE ALL ON public.prive_drops_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prive_drops_v TO service_role;

-- API para el servidor de THE PRIVATE EDITION (equipo edition): solo lo publicable hoy, sin datos de
-- personas. Lo que el cliente lee pasa por prive_drops(_ps, …).
CREATE OR REPLACE VIEW public.prive_drops_live AS
SELECT id, slug, drop_type, title_es, title_en, provider_name, provider_url, destination_id, destination_slug,
  destination_name_es, destination_name_en, benefit_es, benefit_en, conditions_es, conditions_en, eligibility_es, eligibility_en,
  restrictions_es, restrictions_en, valid_from, valid_until, offer_price, reference_price, price_currency, price_source_url,
  discount_pct, source_url, source_name, link_url, last_verified_at, commercial_relationship, program_match, universes, interests,
  effective_status
FROM public.prive_drops_v WHERE effective_status IN ('activo','por_verificar');
REVOKE ALL ON public.prive_drops_live FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.prive_drops_live TO service_role;

-- JSON de un Drop para la app. El beneficio IATOS toma el texto literal del contrato.
CREATE OR REPLACE FUNCTION public.prive_drop_json(d public.prive_drops_v, _reasons text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', d.id, 'slug', d.slug, 'type', d.drop_type, 'status', d.effective_status,
    'title', jsonb_build_object('es', d.title_es, 'en', d.title_en),
    'provider', jsonb_build_object('name', d.provider_name, 'url', d.provider_url),
    'destination', CASE WHEN d.destination_id IS NOT NULL THEN jsonb_build_object('slug', d.destination_slug, 'es', d.destination_name_es, 'en', d.destination_name_en) END,
    'benefit', jsonb_build_object('es', coalesce((SELECT b.benefit_es FROM public.prive_partner_benefits b WHERE b.id = d.partner_benefit_id), d.benefit_es),
                                  'en', coalesce((SELECT b.benefit_en FROM public.prive_partner_benefits b WHERE b.id = d.partner_benefit_id), d.benefit_en)),
    'conditions', jsonb_build_object('es', coalesce((SELECT b.conditions_es FROM public.prive_partner_benefits b WHERE b.id = d.partner_benefit_id), d.conditions_es), 'en', d.conditions_en),
    'eligibility', jsonb_build_object('es', d.eligibility_es, 'en', d.eligibility_en),
    'restrictions', jsonb_build_object('es', d.restrictions_es, 'en', d.restrictions_en),
    'valid_from', d.valid_from, 'valid_until', d.valid_until,
    'price', CASE WHEN d.offer_price IS NOT NULL THEN jsonb_build_object('offer', d.offer_price, 'reference', d.reference_price,
       'currency', d.price_currency, 'source', d.price_source_url, 'discount_pct', d.discount_pct) END,
    'source', jsonb_build_object('url', d.source_url, 'name', d.source_name), 'link', d.link_url,
    'last_verified_at', d.last_verified_at, 'relationship', d.commercial_relationship,
    'universes', to_jsonb(d.universes), 'interests', to_jsonb(d.interests),
    'reasons', to_jsonb(coalesce(_reasons, '{}'::text[]))));
$$;
REVOKE ALL ON FUNCTION public.prive_drop_json(public.prive_drops_v, text[]) FROM PUBLIC, anon, authenticated;

-- Programas registrados voluntariamente en la Bóveda (nombres y niveles; NUNCA números de socio ni de
-- tarjeta). Lee user_vault_benefits (Bóveda actual) y, si existe, vault_items (Bóveda nueva del equipo
-- boveda, rama claude/wc-boveda): sección membresía/tarjeta, campos title/issuer/tier/program_id.
CREATE OR REPLACE FUNCTION public.prive_vault_programs(_uid uuid)
RETURNS TABLE (kind text, label text, tier text, norm text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH v AS (SELECT * FROM public.user_vault_benefits WHERE user_id = _uid),
  raw AS (
    SELECT 'tarjeta'::text AS k, concat_ws(' ', x->>'bank', coalesce(x->>'card_name', ''), x->>'network') AS l, x->>'card_tier' AS t
      FROM v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.credit_cards) = 'array' THEN v.credit_cards ELSE '[]' END) x
    UNION ALL
    SELECT 'hotel', x->>'chain_name', x->>'status_tier'
      FROM v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.hotel_loyalty) = 'array' THEN v.hotel_loyalty ELSE '[]' END) x
    UNION ALL
    SELECT 'aerolinea', concat_ws(' ', x->>'airline', x->>'alliance_name'), x->>'tier_status'
      FROM v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.airline_alliances) = 'array' THEN v.airline_alliances ELSE '[]' END) x
    UNION ALL
    SELECT 'auto', x->>'company_name', NULL
      FROM v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.car_rentals) = 'array' THEN v.car_rentals ELSE '[]' END) x)
  SELECT DISTINCT r.k, left(btrim(r.l), 80), left(nullif(btrim(r.t), ''), 40), public.prive_norm(r.l)
    FROM raw r WHERE coalesce(btrim(r.l), '') <> '' AND NOT public.prive_has_card_number(r.l);
  IF to_regclass('public.vault_items') IS NOT NULL THEN
    BEGIN
      RETURN QUERY EXECUTE
        $q$SELECT DISTINCT CASE WHEN section = 'tarjeta' THEN 'tarjeta' ELSE coalesce(kind, 'membresia') END,
                  left(concat_ws(' ', issuer, title), 80), left(tier, 40), public.prive_norm(concat_ws(' ', issuer, title, program_id))
             FROM public.vault_items WHERE user_id = $1 AND section IN ('membresia', 'tarjeta')$q$ USING _uid;
    EXCEPTION WHEN undefined_column OR undefined_table THEN NULL;
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.prive_vault_programs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_vault_programs(uuid) TO service_role;

-- ¿El programa del miembro (texto normalizado) coincide con alguno de los del Drop?
CREATE OR REPLACE FUNCTION public.prive_program_matches(_norm text, _match text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(_match, '{}')) m
                  WHERE m <> '' AND (' ' || coalesce(_norm, '') || ' ') LIKE ('% ' || m || ' %'));
$$;
REVOKE ALL ON FUNCTION public.prive_program_matches(text, text[]) FROM PUBLIC, anon, authenticated;

-- Texto libre del destino de un viaje ("París, Francia") → destino del catálogo.
CREATE OR REPLACE FUNCTION public.prive_trip_destination(_destino text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.prive_resolve_destination(_destino), public.prive_resolve_destination(split_part(_destino, ',', 1)));
$$;
REVOKE ALL ON FUNCTION public.prive_trip_destination(text) FROM PUBLIC, anon, authenticated;

-- Destinos relevantes del miembro: próximos viajes propios (con fecha futura o sin fecha) y destinos de
-- experiencias Privé guardadas.
CREATE OR REPLACE FUNCTION public.prive_member_destinations(_uid uuid)
RETURNS TABLE (destination_id uuid, why text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT public.prive_destination_root(public.prive_trip_destination(t.destino)), 'viaje'
    FROM public.trips t
   WHERE t.user_id = _uid AND (t.fecha_regreso IS NULL OR t.fecha_regreso >= current_date)
     AND public.prive_trip_destination(t.destino) IS NOT NULL
  UNION
  SELECT DISTINCT public.prive_destination_root(e.destination_id), 'guardado'
    FROM public.recomendaciones r JOIN public.prive_experiences e ON e.id = r.experience_id
   WHERE r.user_id = _uid AND r.guardado;
$$;
REVOKE ALL ON FUNCTION public.prive_member_destinations(uuid) FROM PUBLIC, anon, authenticated;

-- Lista de Drops publicables para el miembro, priorizada por sus viajes, guardados y programas de la
-- Bóveda. _destination filtra (slug o alias, incluye sus barrios/localidades); _types e _interests
-- filtran. Devuelve también cuántos vencieron en los últimos 30 días (para decirlo con honestidad).
CREATE OR REPLACE FUNCTION public.prive_drops(_ps text, _destination text DEFAULT NULL, _types text[] DEFAULT NULL,
  _interests text[] DEFAULT NULL, _limit int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_dest uuid; v_items jsonb; v_expired int;
BEGIN
  v_uid := public.prive_require(_ps);
  IF _destination IS NOT NULL THEN
    v_dest := public.prive_resolve_destination(_destination);
    IF v_dest IS NULL THEN
      RETURN jsonb_build_object('items', '[]'::jsonb, 'expired_recent', 0, 'destination_found', false, 'generated_at', now());
    END IF;
  END IF;
  WITH mine AS (SELECT destination_id, why FROM public.prive_member_destinations(v_uid)),
  progs AS (SELECT norm FROM public.prive_vault_programs(v_uid)),
  cand AS (
    SELECT d, ARRAY_REMOVE(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM mine m WHERE m.why = 'viaje' AND m.destination_id = public.prive_destination_root(d.destination_id)) THEN 'viaje' END,
        CASE WHEN EXISTS (SELECT 1 FROM mine m WHERE m.why = 'guardado' AND m.destination_id = public.prive_destination_root(d.destination_id)) THEN 'guardado' END,
        CASE WHEN EXISTS (SELECT 1 FROM progs p WHERE public.prive_program_matches(p.norm, d.program_match)) THEN 'boveda' END], NULL) AS reasons
      FROM public.prive_drops_v d
     WHERE d.effective_status IN ('activo','por_verificar')
       AND (v_dest IS NULL OR d.destination_id IS NULL OR d.destination_id = v_dest
            OR public.prive_destination_root(d.destination_id) = public.prive_destination_root(v_dest))
       AND (_types IS NULL OR d.drop_type = ANY (_types))
       AND (_interests IS NULL OR d.interests && _interests))
  , scored AS (
    SELECT c.d, c.reasons,
      CASE WHEN 'viaje' = ANY (c.reasons) THEN 40 ELSE 0 END + CASE WHEN 'boveda' = ANY (c.reasons) THEN 30 ELSE 0 END
      + CASE WHEN 'guardado' = ANY (c.reasons) THEN 20 ELSE 0 END + CASE WHEN (c.d).effective_status = 'activo' THEN 10 ELSE 0 END
      + CASE WHEN (c.d).drop_type = 'editorial' THEN -5 ELSE 0 END AS score
      FROM cand c),
  top AS (
    SELECT s.*, row_number() OVER (ORDER BY s.score DESC, (s.d).valid_until ASC NULLS LAST, (s.d).last_verified_at DESC, (s.d).slug) AS rn
      FROM scored s)
  SELECT coalesce(jsonb_agg(public.prive_drop_json(t.d, t.reasons) ORDER BY t.rn), '[]'::jsonb)
    INTO v_items
    FROM top t WHERE t.rn <= greatest(1, least(coalesce(_limit, 30), 60));
  SELECT count(*) INTO v_expired FROM public.prive_drops_v d
   WHERE d.effective_status = 'vencido' AND d.valid_until >= current_date - 30
     AND (v_dest IS NULL OR d.destination_id IS NULL OR public.prive_destination_root(d.destination_id) = public.prive_destination_root(v_dest));
  RETURN jsonb_build_object('items', v_items, 'expired_recent', v_expired, 'destination_found', true, 'generated_at', now());
END $$;

-- Un Drop por slug (también vencido, para que un enlace guardado diga "vencido" con honestidad).
CREATE OR REPLACE FUNCTION public.prive_drop(_ps text, _slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; d public.prive_drops_v;
BEGIN
  v_uid := public.prive_require(_ps);
  SELECT * INTO d FROM public.prive_drops_v WHERE slug = _slug AND effective_status IN ('activo','por_verificar','vencido');
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'drop', public.prive_drop_json(d));
END $$;
REVOKE ALL ON FUNCTION public.prive_drops(text, text, text[], text[], int), public.prive_drop(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prive_drops(text, text, text[], text[], int), public.prive_drop(text, text) TO authenticated, service_role;

-- ───────────────────────────── carga de la curaduría (como prive_import_batch) ───────────────────────
-- Solo servidor. Por omisión es ENSAYO (deshace todo y devuelve el reporte). Cada fila en su propia
-- subtransacción: la que rompe una regla se rechaza con el motivo y las demás siguen. Upsert por slug.
-- El cargador NUNCA crea beneficios IATOS: esas filas se rechazan (solo una persona con el contrato en el
-- registro de alianzas puede ligar uno).
CREATE OR REPLACE FUNCTION public.prive_drops_import_batch(p_rows jsonb, p_batch text, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; v_dest uuid; n_ins int := 0; n_upd int := 0; v_rej jsonb := '[]'; v_report jsonb; v_new boolean;
  arr text[]; ints text[]; unis text[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'prive_drops_import_batch: solo el servidor' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'prive_drops_import_batch: se espera un arreglo'; END IF;
  BEGIN
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        IF r->>'type' = 'beneficio_iatos' OR r->>'commercial_relationship' = 'convenio' THEN
          RAISE EXCEPTION 'el cargador no crea beneficios IATOS: se ligan a mano desde el registro de alianzas';
        END IF;
        v_dest := NULL;
        IF r->>'destination_slug' IS NOT NULL THEN
          v_dest := public.prive_resolve_destination(r->>'destination_slug');
          IF v_dest IS NULL THEN RAISE EXCEPTION 'destino % no está en el catálogo', r->>'destination_slug'; END IF;
        END IF;
        arr := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r->'program_match') = 'array' THEN r->'program_match' ELSE '[]' END));
        ints := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r->'interests') = 'array' THEN r->'interests' ELSE '[]' END));
        unis := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r->'universes') = 'array' THEN r->'universes' ELSE '[]' END));
        v_new := NOT EXISTS (SELECT 1 FROM public.prive_drops WHERE slug = r->>'slug');
        INSERT INTO public.prive_drops AS t (slug, drop_type, title_es, title_en, provider_name, provider_url, destination_id,
          benefit_es, benefit_en, conditions_es, conditions_en, eligibility_es, eligibility_en, restrictions_es, restrictions_en,
          valid_from, valid_until, offer_price, reference_price, price_currency, price_source_url, discount_pct,
          source_url, source_name, link_url, last_verified_at, verified_by, curation_status, commercial_relationship,
          program_match, universes, interests, import_batch, curation_notes)
        VALUES (r->>'slug', r->>'type', r->>'title_es', r->>'title_en', r->>'provider_name', r->>'provider_url', v_dest,
          r->>'benefit_es', r->>'benefit_en', r->>'conditions_es', r->>'conditions_en', r->>'eligibility_es', r->>'eligibility_en',
          r->>'restrictions_es', r->>'restrictions_en', (r->>'valid_from')::date, (r->>'valid_until')::date,
          (r->>'offer_price')::numeric, (r->>'reference_price')::numeric, r->>'price_currency', r->>'price_source_url',
          (r->>'discount_pct')::numeric, r->>'source_url', r->>'source_name', r->>'link_url', (r->>'last_verified_at')::timestamptz,
          r->>'verified_by', coalesce(r->>'curation_status', 'activo'), coalesce(r->>'commercial_relationship', 'ninguna'),
          arr, unis, ints, p_batch, r->>'curation_notes')
        ON CONFLICT (slug) DO UPDATE SET drop_type = EXCLUDED.drop_type, title_es = EXCLUDED.title_es, title_en = EXCLUDED.title_en,
          provider_name = EXCLUDED.provider_name, provider_url = EXCLUDED.provider_url, destination_id = EXCLUDED.destination_id,
          benefit_es = EXCLUDED.benefit_es, benefit_en = EXCLUDED.benefit_en, conditions_es = EXCLUDED.conditions_es,
          conditions_en = EXCLUDED.conditions_en, eligibility_es = EXCLUDED.eligibility_es, eligibility_en = EXCLUDED.eligibility_en,
          restrictions_es = EXCLUDED.restrictions_es, restrictions_en = EXCLUDED.restrictions_en, valid_from = EXCLUDED.valid_from,
          valid_until = EXCLUDED.valid_until, offer_price = EXCLUDED.offer_price, reference_price = EXCLUDED.reference_price,
          price_currency = EXCLUDED.price_currency, price_source_url = EXCLUDED.price_source_url, discount_pct = EXCLUDED.discount_pct,
          source_url = EXCLUDED.source_url, source_name = EXCLUDED.source_name, link_url = EXCLUDED.link_url,
          last_verified_at = EXCLUDED.last_verified_at, verified_by = EXCLUDED.verified_by, curation_status = EXCLUDED.curation_status,
          commercial_relationship = EXCLUDED.commercial_relationship, program_match = EXCLUDED.program_match,
          universes = EXCLUDED.universes, interests = EXCLUDED.interests, import_batch = EXCLUDED.import_batch,
          curation_notes = EXCLUDED.curation_notes;
        IF v_new THEN n_ins := n_ins + 1; ELSE n_upd := n_upd + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_rej := v_rej || jsonb_build_array(jsonb_build_object('slug', r->>'slug', 'reason', SQLERRM));
      END;
    END LOOP;
    v_report := jsonb_build_object('batch', p_batch, 'dry_run', p_dry_run, 'inserted', n_ins, 'updated', n_upd, 'rejected', v_rej,
      'by_status', (SELECT coalesce(jsonb_object_agg(effective_status, n), '{}') FROM (SELECT effective_status, count(*) n
                     FROM public.prive_drops_v WHERE import_batch = p_batch GROUP BY 1) t));
    IF p_dry_run THEN RAISE EXCEPTION 'PRIVE_DRY_RUN_ROLLBACK'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PRIVE_DRY_RUN_ROLLBACK' THEN RAISE; END IF;
  END;
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.prive_drops_import_batch(jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_drops_import_batch(jsonb, text, boolean) TO service_role;
