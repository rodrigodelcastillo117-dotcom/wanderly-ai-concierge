-- IATOS Privé (grupo catalog) · 3/9 · Registro de alianzas, catálogo de experiencias (12 universos,
-- una sola arquitectura), estados de datos, etiquetas comerciales con evidencia y cobertura calculada.
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §3 y docs/iatos/IATOS_PRIVE_CURATION_STANDARD.md.
--
-- Reglas que la base hace imposibles de romper (CHECK, llaves y triggers, no solo la pantalla):
--  * existencia (operating_status), disponibilidad (availability_state) y relación comercial
--    (commercial_label) son campos independientes; la disponibilidad solo existe si alguien consultó;
--  * VERIFICADO/CURADO/ESTIMADO exigen fuentes y fecha de verificación; DESACTUALIZADO no se guarda:
--    se calcula a los 90 días (prive_experiences_v);
--  * PARTNER VERIFICADO y BENEFICIO EXCLUSIVO exigen un acuerdo FIRMADO y vigente del registro, con
--    documento de evidencia y responsable; el texto del beneficio vive en el registro (no se puede
--    escribir un beneficio que no exista); al vencer el acuerdo la etiqueta cae sola;
--  * EXPERIENCIA PRIVADA exige operador real, su sitio y las condiciones;
--  * ACCESO CONFIRMADO no es una etiqueta de catálogo: solo existe en una solicitud confirmada por el
--    proveedor con evidencia (migración 20261023100300);
--  * precio y horario solo con URL de la fuente; casinos solo con autoridad que otorga la licencia y
--    regla de edad; aventura solo con operador y requisitos de seguridad.
-- Ninguna tabla se lee directo desde el cliente: el contenido sale por RPC que exigen prive_require().
-- Idempotente.

-- ───────────────────────────── Registro de alianzas (sin filas: nada se inventa) ─────────────────────
CREATE TABLE IF NOT EXISTS public.prive_partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 200),
  trade_name    text,
  iso_country   char(2),
  website       text CHECK (website IS NULL OR website ~ '^https://'),
  tax_id        text,                                 -- RFC u otro; uso interno
  iatos_owner_admin_id uuid NOT NULL,                 -- persona de IATOS responsable de la relación
  partner_contact text,                               -- nombre y cargo; sin datos sensibles
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prive_partner_agreements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         uuid NOT NULL REFERENCES public.prive_partners(id),
  tier               text NOT NULL CHECK (tier IN ('socio','socio_beneficio','acceso')),
  status             text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','firmado','vencido','terminado')),
  signed_at          date,
  valid_from         date,
  valid_to           date,
  conditions_es      text,                            -- condiciones generales del acuerdo, literal
  availability_rules text,
  cancellation_terms text,
  data_sharing       text,                            -- qué datos del cliente se transfieren (LFPDPPP)
  privacy_notice_url text CHECK (privacy_notice_url IS NULL OR privacy_notice_url ~ '^https://'),
  brand_use          text,
  evidence_document_path text,                        -- Storage privado; nunca público
  partner_signatory  text,
  iatos_owner_admin_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_agreement_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT prive_agreement_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  -- Firmado (o histórico) = hay evidencia: fecha de firma, vigencia, documento, firmantes y condiciones.
  CONSTRAINT prive_agreement_signed_has_evidence CHECK (status = 'borrador' OR (
    signed_at IS NOT NULL AND valid_from IS NOT NULL AND evidence_document_path IS NOT NULL
    AND length(btrim(evidence_document_path)) > 0 AND partner_signatory IS NOT NULL
    AND iatos_owner_admin_id IS NOT NULL AND conditions_es IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.prive_partner_benefits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id  uuid NOT NULL REFERENCES public.prive_partner_agreements(id),
  benefit_es    text NOT NULL CHECK (length(benefit_es) BETWEEN 3 AND 300),   -- texto literal del contrato
  benefit_en    text,
  conditions_es text NOT NULL,                                               -- condiciones del beneficio
  clause_ref    text NOT NULL,                                               -- cláusula del acuerdo que lo define
  valid_from    date,
  valid_to      date,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_benefit_agreement_uq UNIQUE (id, agreement_id),
  CONSTRAINT prive_benefit_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE OR REPLACE FUNCTION public.prive_agreement_active(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.prive_partner_agreements a
                 WHERE a.id = _id AND a.status = 'firmado'
                   AND current_date >= a.valid_from AND current_date <= coalesce(a.valid_to, 'infinity'::date));
$$;
CREATE OR REPLACE FUNCTION public.prive_benefit_active(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.prive_partner_benefits b
                 WHERE b.id = _id AND b.active AND public.prive_agreement_active(b.agreement_id)
                   AND current_date >= coalesce(b.valid_from, '-infinity'::date)
                   AND current_date <= coalesce(b.valid_to, 'infinity'::date));
$$;

-- ───────────────────────────── Validadores de evidencia (JSON) ───────────────────────────────────────
-- accolades: [{name, year, url https}], año razonable. Un premio sin año y sin URL no se publica.
CREATE OR REPLACE FUNCTION public.prive_accolades_ok(_a jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(_a) = 'array' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(_a) x
    WHERE jsonb_typeof(x) <> 'object'
       OR coalesce(length(btrim(x->>'name')), 0) < 2
       OR coalesce(x->>'url', '') !~ '^https://'
       OR coalesce(x->>'year', '') !~ '^(19[5-9][0-9]|20[0-9]{2})$');
$$;
-- sources: [url https] o [{url https, kind?, consulted_at?}]
CREATE OR REPLACE FUNCTION public.prive_sources_ok(_s jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(_s) = 'array' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(_s) x
    WHERE NOT ((jsonb_typeof(x) = 'string' AND (x #>> '{}') ~ '^https://')
            OR (jsonb_typeof(x) = 'object' AND coalesce(x->>'url', '') ~ '^https://')));
$$;
-- Horario: {"mon":[["19:00","23:30"]], …}; días mon..sun; horas HH:MM (cierre después de medianoche
-- se escribe como "26:00"). Solo con fuente (CHECK más abajo).
CREATE OR REPLACE FUNCTION public.prive_hours_ok(_h jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _h IS NULL OR (jsonb_typeof(_h) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(_h) d
    WHERE d.key NOT IN ('mon','tue','wed','thu','fri','sat','sun') OR jsonb_typeof(d.value) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.value) r
                  WHERE jsonb_typeof(r) <> 'array' OR jsonb_array_length(r) <> 2
                     OR (r->>0) !~ '^([01][0-9]|2[0-9]):[0-5][0-9]$' OR (r->>1) !~ '^([01][0-9]|2[0-9]|3[0-5]):[0-5][0-9]$')));
$$;

-- Llave de duplicado: nombre normalizado sin artículos ni tipo, sin lo que va tras " - " ni entre
-- paréntesis. "Fifty Mils - Four Seasons" → "fifty mils"; "Please Don't Tell (PDT)" → "please don t tell".
-- scripts/prive/curation-lib.mjs (dedupeKey) hace exactamente lo mismo.
CREATE OR REPLACE FUNCTION public.prive_dedupe_key(_name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH base AS (
    SELECT public.prive_norm(regexp_replace(regexp_replace(coalesce(_name, ''), '\s+[-–—]\s+.*$', ''), '\([^)]*\)', ' ', 'g')) AS n
  ), stripped AS (
    SELECT n, btrim(regexp_replace(regexp_replace(n,
      '\m(the|el|la|los|las|le|les|il|lo|bar|restaurante|restaurant|ristorante|club)\M', ' ', 'g'), '\s+', ' ', 'g')) AS s
    FROM base
  )
  SELECT CASE WHEN s = '' THEN n ELSE s END FROM stripped;
$$;
GRANT EXECUTE ON FUNCTION public.prive_dedupe_key(text) TO service_role;

-- ───────────────────────────── Experiencias ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prive_experiences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  destination_id     uuid NOT NULL REFERENCES public.prive_destinations(id),
  neighborhood_id    uuid REFERENCES public.prive_destinations(id),
  universe           text NOT NULL CHECK (universe IN ('the_table','after_dark','casino_grand_nights','yacht_sea',
                       'private_stays','iconic_events','culture_access','wellness_escape','adventure_elite',
                       'sport_leisure','celebrations','signature_mexico')),
  subcategory        text NOT NULL CHECK (subcategory ~ '^[a-z0-9_]{2,40}$'),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  dedupe_key         text GENERATED ALWAYS AS (public.prive_dedupe_key(name)) STORED,
  address            text,
  lat                numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  lng                numeric(9,6) CHECK (lng BETWEEN -180 AND 180),
  geo_precision      text CHECK (geo_precision IN ('exacta','aproximada')),
  geo_source         text,
  google_place_id    text,
  website            text CHECK (website IS NULL OR website ~ '^https://'),
  booking_url        text CHECK (booking_url IS NULL OR booking_url ~ '^https://'),
  booking_method     text NOT NULL DEFAULT 'concierge_request'
                     CHECK (booking_method IN ('web','resy','opentable','sevenrooms','tock','phone','email','walk_in','concierge_request','partner_ota')),
  reservation_required boolean,                          -- NULL = la fuente no lo dice
  booking_policy_es  text, booking_policy_en text,
  cancellation_es    text, cancellation_en text,
  description_es     text, description_en text,
  why_fact_es        text, why_fact_en text,
  dress_code_es      text, dress_code_en text, dress_code_source text,
  age_policy         text NOT NULL DEFAULT 'todas' CHECK (age_policy IN ('todas','18+','21+')),
  age_policy_source  text,
  restrictions_es    text, restrictions_en text,
  safety_requirements_es text,
  operator_license   text,
  is_members_only_venue boolean NOT NULL DEFAULT false,
  members_only_source text,
  license_authority  text, license_ref text, license_source text,
  price_level        smallint CHECK (price_level BETWEEN 1 AND 4),
  price_currency     char(3) CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  price_min numeric(12,2) CHECK (price_min IS NULL OR price_min >= 0),
  price_max numeric(12,2) CHECK (price_max IS NULL OR price_max >= 0),
  price_basis        text CHECK (price_basis IN ('por_persona','por_grupo','por_noche','menu_degustacion','entrada')),
  price_note_es      text, price_note_en text,
  price_source_url   text,
  price_checked_at   timestamptz,
  opening_hours      jsonb CHECK (public.prive_hours_ok(opening_hours)),
  opening_hours_source text,
  opening_hours_checked_at timestamptz,
  typical_duration_min int CHECK (typical_duration_min IS NULL OR typical_duration_min BETWEEN 15 AND 1440),
  duration_source    text,
  season_note_es     text,                              -- texto de temporada tal como lo da la fuente
  season_months      smallint[] CHECK (season_months IS NULL OR season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  season_reopens_on  date,                              -- "reabre el 6 de mayo de 2027"
  season_closes_on   date,                              -- "abierto hasta el 1 de noviembre de 2026"
  season_source      text,
  valid_from date, valid_to date, event_start timestamptz, event_end timestamptz,
  data_state         text NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (data_state IN ('VERIFICADO','CURADO','ESTIMADO','PENDIENTE','NO_DISPONIBLE')),
  operating_status   text NOT NULL DEFAULT 'desconocido'
                     CHECK (operating_status IN ('abierto','cerrado_temporal','cerrado_permanente','desconocido')),
  operating_checked_at timestamptz,
  verified_at        timestamptz,
  verified_by        text,
  accolades          jsonb NOT NULL DEFAULT '[]' CHECK (public.prive_accolades_ok(accolades)),
  sources            jsonb NOT NULL DEFAULT '[]' CHECK (public.prive_sources_ok(sources)),
  availability_state text NOT NULL DEFAULT 'no_consultada'
                     CHECK (availability_state IN ('no_consultada','disponible','sin_disponibilidad','lista_de_espera')),
  availability_checked_at timestamptz, availability_source text, availability_for daterange,
  commercial_label   text NOT NULL DEFAULT 'NINGUNA'
                     CHECK (commercial_label IN ('NINGUNA','EXPERIENCIA_CURADA','PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO','EXPERIENCIA_PRIVADA')),
  partner_id         uuid,
  partner_agreement_id uuid,
  benefit_id         uuid,
  operator_name      text,
  operator_url       text CHECK (operator_url IS NULL OR operator_url ~ '^https://'),
  private_conditions_es text,
  image_source       text NOT NULL DEFAULT 'pexels' CHECK (image_source IN ('pexels','none')),
  image_query        text CHECK (image_query IS NULL OR length(image_query) <= 120),
  image_url text, image_photographer text, image_photographer_url text, image_page_url text,
  image_alt_es text, image_alt_en text,
  image_is_illustrative boolean NOT NULL DEFAULT true,
  verified_image     boolean NOT NULL DEFAULT false,
  image_checked_at   timestamptz,
  tags               text[] NOT NULL DEFAULT '{}',
  legacy_nightlife_id uuid UNIQUE,
  merged_legacy_ids  uuid[] NOT NULL DEFAULT '{}',
  replaced_by_id     uuid REFERENCES public.prive_experiences(id),
  import_batch       text,
  curation_notes     text,
  active             boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prive_dedupe UNIQUE (destination_id, dedupe_key),
  CONSTRAINT prive_partner_fk FOREIGN KEY (partner_agreement_id, partner_id)
    REFERENCES public.prive_partner_agreements(id, partner_id) MATCH FULL,
  CONSTRAINT prive_benefit_fk FOREIGN KEY (benefit_id, partner_agreement_id)
    REFERENCES public.prive_partner_benefits(id, agreement_id),
  CONSTRAINT prive_benefit_needs_agreement CHECK (benefit_id IS NULL OR partner_agreement_id IS NOT NULL),
  CONSTRAINT prive_coords_pair CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT prive_price_has_source CHECK ((price_min IS NULL AND price_max IS NULL)
    OR (coalesce(price_source_url, '') ~ '^https://' AND price_currency IS NOT NULL AND price_checked_at IS NOT NULL)),
  CONSTRAINT prive_price_range CHECK (price_min IS NULL OR price_max IS NULL OR price_max >= price_min),
  CONSTRAINT prive_hours_have_source CHECK (opening_hours IS NULL OR coalesce(opening_hours_source, '') ~ '^https://'),
  CONSTRAINT prive_duration_has_source CHECK (typical_duration_min IS NULL OR duration_source IS NOT NULL),
  CONSTRAINT prive_dates_ok CHECK ((valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
    AND (event_end IS NULL OR event_start IS NULL OR event_end >= event_start)),
  CONSTRAINT prive_availability_consulted CHECK (availability_state = 'no_consultada'
    OR (availability_checked_at IS NOT NULL AND availability_source IS NOT NULL AND availability_for IS NOT NULL)),
  CONSTRAINT prive_members_only_sourced CHECK (NOT is_members_only_venue OR members_only_source IS NOT NULL),
  CONSTRAINT prive_casino_rules CHECK (universe <> 'casino_grand_nights' OR (age_policy IN ('18+','21+')
    AND (data_state IN ('PENDIENTE','NO_DISPONIBLE') OR (license_authority IS NOT NULL AND coalesce(license_source, '') ~ '^https://')))),
  CONSTRAINT prive_adventure_rules CHECK (universe <> 'adventure_elite' OR data_state IN ('PENDIENTE','NO_DISPONIBLE')
    OR (safety_requirements_es IS NOT NULL AND operator_name IS NOT NULL)),
  CONSTRAINT prive_sourced_states CHECK (data_state NOT IN ('VERIFICADO','CURADO','ESTIMADO')
    OR (jsonb_array_length(sources) > 0 AND verified_at IS NOT NULL AND why_fact_es IS NOT NULL)),
  CONSTRAINT prive_verified_official CHECK (data_state <> 'VERIFICADO' OR website IS NOT NULL),
  CONSTRAINT prive_season_sourced CHECK ((season_months IS NULL AND season_reopens_on IS NULL AND season_closes_on IS NULL)
    OR season_source IS NOT NULL),
  CONSTRAINT prive_image_illustrative CHECK (verified_image OR image_is_illustrative),
  -- Etiquetas comerciales: cada una solo con su evidencia.
  CONSTRAINT prive_label_curada CHECK (commercial_label <> 'EXPERIENCIA_CURADA' OR data_state IN ('VERIFICADO','CURADO')),
  CONSTRAINT prive_label_partner CHECK (commercial_label NOT IN ('PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO')
    OR (partner_agreement_id IS NOT NULL AND data_state = 'VERIFICADO')),
  CONSTRAINT prive_label_benefit CHECK ((commercial_label = 'BENEFICIO_EXCLUSIVO') = (benefit_id IS NOT NULL)),
  CONSTRAINT prive_label_private CHECK (commercial_label <> 'EXPERIENCIA_PRIVADA' OR (operator_name IS NOT NULL
    AND operator_url IS NOT NULL AND private_conditions_es IS NOT NULL AND data_state IN ('VERIFICADO','CURADO'))),
  CONSTRAINT prive_agreement_only_with_partner_label CHECK (partner_agreement_id IS NULL
    OR commercial_label IN ('PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO'))
);
CREATE INDEX IF NOT EXISTS prive_exp_dest ON public.prive_experiences (destination_id, universe) WHERE active;
CREATE INDEX IF NOT EXISTS prive_exp_neigh ON public.prive_experiences (neighborhood_id) WHERE neighborhood_id IS NOT NULL;

-- Ubicación coherente y acuerdo vigente al escribir. El acuerdo se valida aquí (un CHECK no puede leer
-- otra tabla); cuando después vence, la vista devuelve la etiqueta a EXPERIENCIA CURADA sola.
CREATE OR REPLACE FUNCTION public.prive_experiences_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE d record;
BEGIN
  NEW.updated_at := now();
  SELECT kind, is_destination INTO d FROM public.prive_destinations WHERE id = NEW.destination_id;
  IF NOT (d.is_destination AND d.kind IN ('country','region','locality')) THEN
    RAISE EXCEPTION 'prive_experiences: destination_id debe ser un destino (país-destino, región o localidad), no un %', d.kind;
  END IF;
  IF NEW.neighborhood_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.prive_destinations n WHERE n.id = NEW.neighborhood_id AND n.kind = 'neighborhood' AND n.parent_id = NEW.destination_id) THEN
    RAISE EXCEPTION 'prive_experiences: el barrio no pertenece a ese destino';
  END IF;
  IF NEW.commercial_label IN ('PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO')
     AND (TG_OP = 'INSERT' OR NEW.commercial_label IS DISTINCT FROM OLD.commercial_label
          OR NEW.partner_agreement_id IS DISTINCT FROM OLD.partner_agreement_id OR NEW.benefit_id IS DISTINCT FROM OLD.benefit_id)
     AND NOT public.prive_agreement_active(NEW.partner_agreement_id) THEN
    RAISE EXCEPTION 'prive_experiences: % requiere un acuerdo firmado y vigente', NEW.commercial_label;
  END IF;
  IF NEW.benefit_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.benefit_id IS DISTINCT FROM OLD.benefit_id)
     AND NOT public.prive_benefit_active(NEW.benefit_id) THEN
    RAISE EXCEPTION 'prive_experiences: el beneficio no está vigente en el registro';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prive_experiences_guard ON public.prive_experiences;
CREATE TRIGGER prive_experiences_guard BEFORE INSERT OR UPDATE ON public.prive_experiences
  FOR EACH ROW EXECUTE FUNCTION public.prive_experiences_guard();

-- Avisos de posible duplicado para que una persona decida (mismo dominio o cercanía + nombre).
CREATE TABLE IF NOT EXISTS public.prive_dedupe_candidates (
  a_id uuid NOT NULL REFERENCES public.prive_experiences(id) ON DELETE CASCADE,
  b_id uuid NOT NULL REFERENCES public.prive_experiences(id) ON DELETE CASCADE,
  rule text NOT NULL CHECK (rule IN ('mismo_dominio','cercania_nombre')),
  decision text CHECK (decision IN ('distintos','fusionar')),
  decided_by text, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a_id, b_id, rule),
  CHECK (a_id < b_id)
);

-- Declaración de mayoría de edad para Privé (versión de términos). Solo la escribe prive_confirm_adult().
CREATE TABLE IF NOT EXISTS public.prive_age_confirmations (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  confirmed_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Estado efectivo (calculado) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prive_flag_int(_key text, _default int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric::int END
                   FROM public.app_flags WHERE key = _key), _default);
$$;

INSERT INTO public.app_flags (key, value, note) VALUES
  ('prive_on_demand_discovery', 'false'::jsonb, 'Privé: descubrimiento bajo demanda (gasta SerpApi). Apagado hasta GO del dueño.'),
  ('prive_stale_days', '90'::jsonb, 'Privé: días tras la última verificación para marcar DESACTUALIZADO'),
  ('prive_pilot_min_experiences', '12'::jsonb, 'Privé: mínimo de experiencias publicables para PILOTO VERIFICADO'),
  ('prive_pilot_min_universes', '3'::jsonb, 'Privé: mínimo de universos distintos para PILOTO VERIFICADO'),
  ('prive_pilot_min_verified_pct', '80'::jsonb, 'Privé: % mínimo de experiencias VERIFICADO para PILOTO VERIFICADO'),
  ('prive_adult_terms_version', '"2026-10-22"'::jsonb, 'Privé: versión vigente de la declaración 18+')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.prive_experiences_v AS
SELECT e.*,
  CASE
    WHEN NOT e.active OR e.replaced_by_id IS NOT NULL OR e.data_state = 'NO_DISPONIBLE'
      OR e.operating_status = 'cerrado_permanente'
      -- Cerrado temporal sin fecha ni nota de temporada con fuente = no disponible. Con fecha o nota de
      -- la fuente ("reabre en primavera"), se muestra como "cerrado por temporada", nunca como abierto.
      OR (e.operating_status = 'cerrado_temporal' AND (e.season_reopens_on <= current_date
          OR (e.season_reopens_on IS NULL AND e.season_note_es IS NULL)))
      OR (e.valid_to IS NOT NULL AND e.valid_to < current_date)
      OR (e.event_end IS NOT NULL AND e.event_end < now())                        THEN 'NO_DISPONIBLE'
    WHEN e.data_state IN ('VERIFICADO','CURADO','ESTIMADO')
      AND (e.verified_at IS NULL
           OR e.verified_at < now() - make_interval(days => public.prive_flag_int('prive_stale_days', 90))) THEN 'DESACTUALIZADO'
    ELSE e.data_state
  END AS effective_state,
  CASE
    WHEN e.commercial_label = 'BENEFICIO_EXCLUSIVO' AND public.prive_benefit_active(e.benefit_id) THEN 'BENEFICIO_EXCLUSIVO'
    WHEN e.commercial_label IN ('PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO') AND public.prive_agreement_active(e.partner_agreement_id) THEN 'PARTNER_VERIFICADO'
    WHEN e.commercial_label IN ('PARTNER_VERIFICADO','BENEFICIO_EXCLUSIVO','EXPERIENCIA_CURADA')
      AND e.data_state IN ('VERIFICADO','CURADO') THEN 'EXPERIENCIA_CURADA'
    WHEN e.commercial_label = 'EXPERIENCIA_PRIVADA' THEN 'EXPERIENCIA_PRIVADA'
    ELSE 'NINGUNA'
  END AS effective_label,
  (e.price_checked_at IS NOT NULL AND e.price_checked_at < now() - interval '90 days') AS price_stale,
  -- Temporada (dimensión de disponibilidad, con fuente): NULL si la fuente no dice nada.
  CASE
    WHEN e.operating_status = 'cerrado_temporal' THEN 'cerrado_por_temporada'
    WHEN e.season_reopens_on IS NOT NULL AND e.season_reopens_on > current_date THEN 'cerrado_por_temporada'
    WHEN e.season_closes_on IS NOT NULL AND e.season_closes_on < current_date
         AND (e.season_reopens_on IS NULL OR e.season_reopens_on <= e.season_closes_on) THEN 'cerrado_por_temporada'
    WHEN e.season_months IS NOT NULL AND cardinality(e.season_months) > 0
         AND NOT (extract(month FROM current_date)::smallint = ANY (e.season_months)) THEN 'cerrado_por_temporada'
    WHEN e.season_months IS NOT NULL OR e.season_reopens_on IS NOT NULL OR e.season_closes_on IS NOT NULL THEN 'en_temporada'
  END AS season_state
FROM public.prive_experiences e;

-- Cobertura de un destino, calculada SIEMPRE desde el contenido (nunca declarada a mano).
--  PILOTO_VERIFICADO: ≥ N publicables en ≥ U universos y ≥ P% en VERIFICADO vigente.
--  COBERTURA_PARCIAL: al menos una experiencia VERIFICADO o CURADO vigente (con fuente y ≤ 90 días).
--  DESCUBRIMIENTO_BAJO_DEMANDA: nada publicado, pero el descubrimiento está encendido.
--  SIN_COBERTURA_VERIFICADA: lo demás. Lo PENDIENTE, DESACTUALIZADO o NO DISPONIBLE no cuenta.
-- Un barrio cuenta sus experiencias; un área, las de sus miembros; un país-destino, las suyas.
CREATE OR REPLACE FUNCTION public.prive_destination_coverage(_dest uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text; n_pub int; n_ver int; n_uni int; lvl text;
BEGIN
  SELECT kind INTO k FROM public.prive_destinations WHERE id = _dest;
  IF k IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE effective_state IN ('VERIFICADO','CURADO','ESTIMADO')),
         count(*) FILTER (WHERE effective_state = 'VERIFICADO'),
         count(DISTINCT universe) FILTER (WHERE effective_state IN ('VERIFICADO','CURADO','ESTIMADO'))
    INTO n_pub, n_ver, n_uni
    FROM public.prive_experiences_v e
   WHERE CASE k
           WHEN 'neighborhood' THEN e.neighborhood_id = _dest
           WHEN 'area' THEN e.destination_id IN (SELECT destination_id FROM public.prive_destination_members WHERE area_id = _dest)
           ELSE e.destination_id = _dest END;
  IF n_pub >= public.prive_flag_int('prive_pilot_min_experiences', 12)
     AND n_uni >= public.prive_flag_int('prive_pilot_min_universes', 3)
     AND n_ver * 100 >= public.prive_flag_int('prive_pilot_min_verified_pct', 80) * n_pub THEN
    lvl := 'PILOTO_VERIFICADO';
  ELSIF EXISTS (SELECT 1 FROM public.prive_experiences_v e
                WHERE e.effective_state IN ('VERIFICADO','CURADO')
                  AND CASE k WHEN 'neighborhood' THEN e.neighborhood_id = _dest
                             WHEN 'area' THEN e.destination_id IN (SELECT destination_id FROM public.prive_destination_members WHERE area_id = _dest)
                             ELSE e.destination_id = _dest END) THEN
    lvl := 'COBERTURA_PARCIAL';
  ELSIF public.app_flag('prive_on_demand_discovery') AND k <> 'area' THEN
    lvl := 'DESCUBRIMIENTO_BAJO_DEMANDA';
  ELSE
    lvl := 'SIN_COBERTURA_VERIFICADA';
  END IF;
  RETURN jsonb_build_object('level', lvl, 'publicables', n_pub, 'verificadas', n_ver, 'universos', n_uni);
END $$;

-- RLS y permisos: nada directo para clientes.
ALTER TABLE public.prive_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_partner_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_partner_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_dedupe_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_age_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_partners, public.prive_partner_agreements, public.prive_partner_benefits, public.prive_experiences,
  public.prive_dedupe_candidates, public.prive_age_confirmations, public.prive_experiences_v FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_partners, public.prive_partner_agreements, public.prive_partner_benefits, public.prive_experiences,
  public.prive_dedupe_candidates, public.prive_age_confirmations TO service_role;
GRANT SELECT ON public.prive_experiences_v TO service_role;
REVOKE ALL ON FUNCTION public.prive_agreement_active(uuid), public.prive_benefit_active(uuid), public.prive_flag_int(text, int),
  public.prive_destination_coverage(uuid), public.prive_experiences_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_agreement_active(uuid), public.prive_benefit_active(uuid), public.prive_flag_int(text, int),
  public.prive_destination_coverage(uuid) TO service_role;
