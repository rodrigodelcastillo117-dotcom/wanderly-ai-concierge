-- IATOS Privé · THE PRIVATE EDITION (equipo edition) · 1/3 · tablas, reglas y RLS. Idempotente.
--
-- Modelo editorial real (especificación del dueño §3, §4, §13):
--   investigación → fuentes → borrador (Claude, marcado como borrador) → verificación → revisión editorial
--   → maquetación → publicación. Nada se publica solo: un admin (public.admins) aprueba en el panel.
--
-- Qué guarda (solo lo necesario, §13):
--   edition_sources           registro de fuentes y derechos (URL, entidad, fechas, datos usados, licencia…)
--   edition_images            imágenes con licencia; solo las APROBADAS salen a la app, PDF u offline
--   edition_issues            números (edición común para todos los miembros)
--   edition_articles          artículos y breves (World Brief) con estado editorial y vigencia
--   edition_article_sources   qué fuente sostiene qué artículo
--   edition_reviews           bitácora de revisión/publicación (auditoría)
--   edition_member_prefs      preferencias editoriales del miembro (con consentimiento)
--   edition_saves             The Reading List (guardados)
--   edition_downloads         descargas PDF/offline (auditoría y medición de costos)
-- Oportunidades: NO hay tabla aquí. Privé Opportunities reutiliza PRIVÉ DROPS del equipo privevalor
-- (public.prive_drops + RPC prive_drops(_ps, …)); el cliente la lee con una interfaz estrecha.
--
-- Acceso: ninguna tabla de contenido se lee desde el cliente. Todo sale por RPC SECURITY DEFINER que
-- empiezan con public.prive_require(_ps) (PRO + 90 días + membresía activa + sesión Privé). Un usuario
-- FREE o un PRO sin Privé no puede leer contenido protegido por API directa. Las preferencias, guardados
-- y descargas son del dueño (RLS por user_id) y se borran con la cuenta (purge_account_data recorre las
-- tablas con columna user_id). Ninguna tabla de CONTENIDO tiene columna user_id (si la tuviera, borrar la
-- cuenta de un editor borraría artículos): el crédito editorial es un texto (approved_by_label).

-- ───────────────────────────── catálogo de intereses (§2) ─────────────────────────────
-- Lista cerrada del dueño. Los nombres coinciden con los de privevalor (prive_drops.interests).
CREATE OR REPLACE FUNCTION public.edition_interest_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['viajes_internacionales','hoteles_y_villas','yates_y_embarcaciones','aviacion_privada','superautos','relojes',
    'moda','belleza','joyeria','arquitectura_y_diseno','gastronomia','deportes','formula_1','golf','finanzas_y_mercados',
    'negocios','inteligencia_artificial','tecnologia','arte','cultura','bienestar','eventos_internacionales',
    'noticias_mundiales','mexico','experiencias_extraordinarias']::text[];
$$;
GRANT EXECUTE ON FUNCTION public.edition_interest_keys() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.edition_section_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['carta','portada','reportajes','agenda','explicadores','world_brief','oportunidades']::text[];
$$;
GRANT EXECUTE ON FUNCTION public.edition_section_keys() TO authenticated, service_role;

-- ¿Es admin quien llama? (misma regla que admin_metrics: fila en public.admins).
CREATE OR REPLACE FUNCTION public.edition_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.edition_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edition_is_admin() TO authenticated, service_role;

-- ───────────────────────────── fuentes y derechos (§4) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.edition_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE CHECK (key ~ '^[a-zA-Z0-9_]{3,60}$'),
  kind          text NOT NULL CHECK (kind IN ('fuente_primaria_oficial','datos_publicos_autorizados','medio_periodistico',
                  'material_comercial_proveedor','fotografia_con_licencia','articulo_original_iatos','material_licenciado_tercero')),
  entity        text NOT NULL CHECK (length(btrim(entity)) BETWEEN 2 AND 200),
  author        text CHECK (author IS NULL OR length(author) <= 200),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 300),
  url           text NOT NULL CHECK (url ~ '^https://[^\s]+$'),
  published_at  date,
  consulted_at  date NOT NULL,
  data_used     text NOT NULL CHECK (length(btrim(data_used)) BETWEEN 3 AND 2000),
  reuse_rights  text NOT NULL CHECK (length(btrim(reuse_rights)) BETWEEN 3 AND 600),
  attribution   text NOT NULL CHECK (length(btrim(attribution)) BETWEEN 3 AND 300),
  distribution_restrictions text CHECK (distribution_restrictions IS NULL OR length(distribution_restrictions) <= 600),
  verification  text NOT NULL CHECK (length(btrim(verification)) BETWEEN 3 AND 1000),
  link_status   text NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','ok','broken','blocked')),
  link_http     int,
  link_checked_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edition_source_dates CHECK (published_at IS NULL OR published_at <= consulted_at)
);

-- ───────────────────────────── imágenes y licencias ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.edition_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{3,60}$'),
  provider        text NOT NULL CHECK (provider IN ('pexels','official_press','iatos','licensed_third_party')),
  provider_id     text,
  url             text NOT NULL CHECK (url ~ '^https://[^\s]+$'),
  page_url        text CHECK (page_url IS NULL OR page_url ~ '^https://'),
  photographer    text,
  photographer_url text CHECK (photographer_url IS NULL OR photographer_url ~ '^https://'),
  license         text,
  license_url     text CHECK (license_url IS NULL OR license_url ~ '^https://'),
  illustrative    boolean NOT NULL,
  depicts_es      text NOT NULL CHECK (length(btrim(depicts_es)) BETWEEN 3 AND 400),
  depicts_en      text,
  alt_es          text NOT NULL CHECK (length(btrim(alt_es)) BETWEEN 3 AND 300),
  alt_en          text,
  focal           text CHECK (focal IS NULL OR focal ~ '^[0-9]{1,3}% [0-9]{1,3}%$'),
  allow_pdf       boolean NOT NULL DEFAULT false,
  allow_offline   boolean NOT NULL DEFAULT false,
  verification    text,
  license_status  text NOT NULL DEFAULT 'pending' CHECK (license_status IN ('pending','approved','blocked')),
  license_reviewed_at timestamptz,
  license_note    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Una imagen aprobada siempre tiene licencia, enlace a la licencia, crédito y página de origen.
  CONSTRAINT edition_image_approved_has_license CHECK (license_status <> 'approved' OR (
    coalesce(btrim(license), '') <> '' AND license_url IS NOT NULL AND coalesce(btrim(photographer), '') <> '' AND page_url IS NOT NULL))
);

-- ───────────────────────────── números ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.edition_issues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  number          int NOT NULL UNIQUE CHECK (number > 0),
  period_start    date NOT NULL,
  period_label    jsonb NOT NULL CHECK (jsonb_typeof(period_label) = 'object' AND period_label ? 'es'),
  title           jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object' AND title ? 'es'),
  cover_line      jsonb NOT NULL DEFAULT '{}'::jsonb,
  cover_image_id  uuid REFERENCES public.edition_images(id),
  cover_article_slug text,
  research_closed_at date,
  plan            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','scheduled','published','retracted')),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  retracted_at    timestamptz,
  retraction_note text,
  approved_at     timestamptz,
  approved_by_label text,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edition_issue_scheduled CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL),
  CONSTRAINT edition_issue_published CHECK (status NOT IN ('published') OR published_at IS NOT NULL),
  CONSTRAINT edition_issue_retracted CHECK (status <> 'retracted' OR (retracted_at IS NOT NULL AND coalesce(btrim(retraction_note), '') <> ''))
);

-- ───────────────────────────── artículos ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.edition_articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        uuid NOT NULL REFERENCES public.edition_issues(id) ON DELETE CASCADE,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,100}$'),
  section         text NOT NULL CHECK (section IN ('carta','portada','reportajes','agenda','explicadores','world_brief')),
  format          text NOT NULL CHECK (format IN ('letter','feature','short','explainer','brief','agenda')),
  topics          text[] NOT NULL DEFAULT '{}' CHECK (topics <@ public.edition_interest_keys()),
  kicker          jsonb NOT NULL DEFAULT '{}'::jsonb,
  title           jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object' AND length(coalesce(title->>'es', '')) BETWEEN 3 AND 200),
  dek             jsonb NOT NULL DEFAULT '{}'::jsonb,
  byline          jsonb NOT NULL DEFAULT '{}'::jsonb,
  hero_image_id   uuid REFERENCES public.edition_images(id),
  -- Distinguir hechos comprobados, análisis editorial y opinión atribuida (§5).
  fact_status     text NOT NULL CHECK (fact_status IN ('verified_facts','analysis','opinion','mixed','editorial')),
  sensitive       boolean NOT NULL DEFAULT false,
  fact_date       date,
  valid_until     date,
  destinations    text[] NOT NULL DEFAULT '{}',
  body            jsonb NOT NULL CHECK (jsonb_typeof(body) = 'array' AND jsonb_array_length(body) > 0),
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array'),
  sort_order      int NOT NULL DEFAULT 100,
  word_count      int NOT NULL DEFAULT 0,
  reading_minutes int NOT NULL DEFAULT 1 CHECK (reading_minutes BETWEEN 1 AND 90),
  drafted_by      text NOT NULL DEFAULT 'claude' CHECK (drafted_by IN ('claude','human')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','rejected','scheduled','published','retracted')),
  editor_notes    text,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  approved_at     timestamptz,
  approved_by_label text,
  correction_note text,
  corrected_at    timestamptz,
  retracted_at    timestamptz,
  retraction_note text,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edition_article_scheduled CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL),
  CONSTRAINT edition_article_published CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT edition_article_retracted CHECK (status <> 'retracted' OR (retracted_at IS NOT NULL AND coalesce(btrim(retraction_note), '') <> '')),
  CONSTRAINT edition_article_correction CHECK (corrected_at IS NULL OR coalesce(btrim(correction_note), '') <> ''),
  -- Un breve del World Brief siempre tiene fecha del hecho: nada de información sin fecha (§5).
  CONSTRAINT edition_brief_dated CHECK (format <> 'brief' OR fact_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS edition_articles_issue ON public.edition_articles (issue_id, sort_order);
CREATE INDEX IF NOT EXISTS edition_articles_status ON public.edition_articles (status, section);

CREATE TABLE IF NOT EXISTS public.edition_article_sources (
  article_id uuid NOT NULL REFERENCES public.edition_articles(id) ON DELETE CASCADE,
  source_id  uuid NOT NULL REFERENCES public.edition_sources(id),
  used_for   text,
  PRIMARY KEY (article_id, source_id)
);

-- ───────────────────────────── bitácora editorial ─────────────────────────────
-- user_id = quien actuó (admin). Se llama user_id a propósito: si el editor borra su cuenta, sus filas se
-- borran con ella (purge_account_data); la acción sobre el contenido queda en el propio artículo.
CREATE TABLE IF NOT EXISTS public.edition_reviews (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity     text NOT NULL CHECK (entity IN ('issue','article','image','source')),
  entity_key text NOT NULL,
  action     text NOT NULL CHECK (action IN ('seed','submit','edit','approve','reject','schedule','publish','correct','retract',
               'return_to_review','license_approve','license_block','link_check','unpublish_expired')),
  user_id    uuid,
  note       text CHECK (note IS NULL OR length(note) <= 2000),
  diff       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edition_reviews_entity ON public.edition_reviews (entity, entity_key, created_at DESC);

-- ───────────────────────────── del miembro ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.edition_member_prefs (
  user_id         uuid PRIMARY KEY,
  edition_kind    text NOT NULL DEFAULT 'mi_mezcla' CHECK (edition_kind IN ('viajes','negocios','estilo_de_vida','mi_mezcla')),
  -- { "gastronomia": 3, "golf": 1, … } con intensidad 1 (algo), 2 (bastante), 3 (mucho).
  interests       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(interests) = 'object'),
  excluded        text[] NOT NULL DEFAULT '{}' CHECK (excluded <@ public.edition_interest_keys()),
  language        text NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  reading_minutes int NOT NULL DEFAULT 20 CHECK (reading_minutes BETWEEN 5 AND 120),
  section_order   text[] NOT NULL DEFAULT '{}' CHECK (section_order <@ public.edition_section_keys()),
  show_name_on_cover boolean NOT NULL DEFAULT false,
  personalization_consent boolean NOT NULL DEFAULT false,
  consented_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.edition_saves (
  user_id    uuid NOT NULL,
  article_id uuid NOT NULL REFERENCES public.edition_articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE IF NOT EXISTS public.edition_downloads (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL,
  issue_id      uuid REFERENCES public.edition_issues(id) ON DELETE SET NULL,
  format        text NOT NULL CHECK (format IN ('pdf','offline')),
  kind          text NOT NULL CHECK (kind IN ('issue','flight')),
  article_count int NOT NULL DEFAULT 0 CHECK (article_count >= 0),
  image_count   int NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  bytes         bigint CHECK (bytes IS NULL OR bytes >= 0),
  duration_ms   int CHECK (duration_ms IS NULL OR duration_ms >= 0),
  language      text CHECK (language IS NULL OR language IN ('es','en')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edition_downloads_user ON public.edition_downloads (user_id, created_at DESC);

-- ───────────────────────────── RLS y permisos ─────────────────────────────
ALTER TABLE public.edition_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_article_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_member_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_downloads ENABLE ROW LEVEL SECURITY;

-- Contenido: sin acceso directo para nadie salvo service_role (las RPC son SECURITY DEFINER).
REVOKE ALL ON public.edition_sources, public.edition_images, public.edition_issues, public.edition_articles,
  public.edition_article_sources, public.edition_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.edition_sources, public.edition_images, public.edition_issues, public.edition_articles,
  public.edition_article_sources, public.edition_reviews TO service_role;

-- Del miembro: puede VER y BORRAR lo suyo (derecho de acceso y supresión); escribe por RPC (exige Privé).
REVOKE ALL ON public.edition_member_prefs, public.edition_saves, public.edition_downloads FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.edition_member_prefs, public.edition_saves TO authenticated;
GRANT SELECT ON public.edition_downloads TO authenticated;
GRANT ALL ON public.edition_member_prefs, public.edition_saves, public.edition_downloads TO service_role;

DROP POLICY IF EXISTS edition_prefs_owner_select ON public.edition_member_prefs;
CREATE POLICY edition_prefs_owner_select ON public.edition_member_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS edition_prefs_owner_delete ON public.edition_member_prefs;
CREATE POLICY edition_prefs_owner_delete ON public.edition_member_prefs FOR DELETE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS edition_saves_owner_select ON public.edition_saves;
CREATE POLICY edition_saves_owner_select ON public.edition_saves FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS edition_saves_owner_delete ON public.edition_saves;
CREATE POLICY edition_saves_owner_delete ON public.edition_saves FOR DELETE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS edition_downloads_owner_select ON public.edition_downloads;
CREATE POLICY edition_downloads_owner_select ON public.edition_downloads FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ───────────────────────────── reglas de visibilidad ─────────────────────────────
-- Hoy en la Ciudad de México (vigencias editoriales en hora del centro).
CREATE OR REPLACE FUNCTION public.edition_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Mexico_City')::date $$;

-- Publicado = 'published', o 'scheduled' cuya hora ya llegó (sin cron: la lectura decide).
CREATE OR REPLACE FUNCTION public.edition_is_live(_status text, _scheduled_for timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _status = 'published' OR (_status = 'scheduled' AND _scheduled_for IS NOT NULL AND _scheduled_for <= now());
$$;
REVOKE ALL ON FUNCTION public.edition_today(), public.edition_is_live(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edition_today(), public.edition_is_live(text, timestamptz) TO authenticated, service_role;

-- updated_at
CREATE OR REPLACE FUNCTION public.edition_touch()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edition_sources','edition_images','edition_issues','edition_articles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.edition_touch()', t || '_touch', t);
  END LOOP;
END $$;
