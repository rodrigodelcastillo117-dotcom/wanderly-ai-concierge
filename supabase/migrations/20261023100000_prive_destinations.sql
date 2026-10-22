-- IATOS Privé (grupo catalog) · 1/9 · Catálogo global de destinos.
-- Diseño: docs/iatos/IATOS_PRIVE_MODELO_DE_DATOS.md §2 y docs/iatos/IATOS_PRIVE_GLOBAL_DESTINATIONS.md.
--
-- Antes no había catálogo: Members Only tenía 18 ciudades escritas en el código y "Montecarlo",
-- "Polanco" o "Miami Beach" podían existir como ciudades sueltas y duplicadas. Ahora:
--  * un solo árbol país → región → localidad → barrio, más "áreas" metropolitanas que agrupan
--    localidades sin duplicarlas (Área de Miami = Miami + Miami Beach);
--  * cada sobrenombre ("Monte Carlo", "CDMX", "Cabo San Lucas") apunta a UN destino (llave única);
--  * el nivel de cobertura NO se guarda ni se declara a mano: se calcula con el contenido verificado
--    (prive_destination_coverage, migración 20261023100100).
-- La siembra (lista exacta del dueño, coordenadas de Wikidata) va en 20261023100010.
-- Las tablas no se leen directo desde el cliente: todo pasa por RPC (prive_teaser o las de Privé).
-- Idempotente.

-- Normalizador sin extensiones (no depende de unaccent): minúsculas, sin acentos, & → and, cualquier
-- otro signo → espacio. scripts/prive/destinations.mjs (priveNorm) hace exactamente lo mismo.
CREATE OR REPLACE FUNCTION public.prive_norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÅĀĂĄáàâäãåāăąÉÈÊËĒĖĘĚéèêëēėęěÍÌÎÏĪĮíìîïīįÓÒÔÖÕŌŐóòôöõōőÚÙÛÜŪŮŰúùûüūůűÑŃñńÇĆČçćčŚŠśšŽŹŻžźżÝŸýÿĞğŞşİıŁł',
    'AAAAAAAAAaaaaaaaaaEEEEEEEEeeeeeeeeIIIIIIiiiiiiOOOOOOOoooooooUUUUUUUuuuuuuuNNnnCCCcccSSssZZZzzzYYyyGgSsIiLl')),
    '&', ' and '), '[^a-z0-9]+', ' ', 'g'));
$$;
GRANT EXECUTE ON FUNCTION public.prive_norm(text) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.prive_destinations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('country','region','locality','neighborhood','area')),
  parent_id       uuid REFERENCES public.prive_destinations(id),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  name_es         text NOT NULL CHECK (length(name_es) BETWEEN 1 AND 80),
  name_en         text NOT NULL CHECK (length(name_en) BETWEEN 1 AND 80),
  iso_country     char(2) NOT NULL CHECK (iso_country ~ '^[A-Z]{2}$'),
  admin_area      text,
  lat             numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  lng             numeric(9,6) CHECK (lng BETWEEN -180 AND 180),
  coord_source    text,                 -- URL de la fuente pública (Wikidata) de la coordenada
  coord_note      text,                 -- por qué falta la coordenada, si falta
  wikidata_qid    text CHECK (wikidata_qid IS NULL OR wikidata_qid ~ '^Q[0-9]+$'),
  timezone        text,
  currency        char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  region_group    text CHECK (region_group IN ('europa','norteamerica','mexico','medio_oriente','asia_oceania','otras_regiones')),
  is_destination  boolean NOT NULL DEFAULT false,   -- está en la lista del dueño y puede tener experiencias
  legacy_ciudad_key text UNIQUE,                    -- valor de nightlife_premium.ciudad (vista de compatibilidad)
  editor_intro_es text CHECK (length(editor_intro_es) <= 220),
  editor_intro_en text CHECK (length(editor_intro_en) <= 220),
  cover_image_query text,
  sort_order      int NOT NULL DEFAULT 5000,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prive_dest_parent_ok CHECK ((kind = 'country') = (parent_id IS NULL)),
  CONSTRAINT prive_dest_coords_pair CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT prive_dest_coords_sourced CHECK (lat IS NULL OR coalesce(coord_source, '') ~ '^https://'),
  CONSTRAINT prive_dest_area_not_destination CHECK (NOT (kind = 'area' AND is_destination)),
  CONSTRAINT prive_dest_group_when_destination CHECK (NOT is_destination OR region_group IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS prive_dest_unique_name
  ON public.prive_destinations (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, public.prive_norm(name_es));
CREATE INDEX IF NOT EXISTS prive_dest_parent ON public.prive_destinations (parent_id);

-- Un sobrenombre apunta a UN solo destino: así no puede haber dos "Montecarlo".
CREATE TABLE IF NOT EXISTS public.prive_destination_aliases (
  alias_norm     text PRIMARY KEY CHECK (alias_norm = public.prive_norm(alias_norm) AND alias_norm <> ''),
  destination_id uuid NOT NULL REFERENCES public.prive_destinations(id) ON DELETE CASCADE,
  is_misspelling boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS prive_alias_dest ON public.prive_destination_aliases (destination_id);

-- Áreas metropolitanas: agrupan destinos sin duplicarlos.
CREATE TABLE IF NOT EXISTS public.prive_destination_members (
  area_id        uuid NOT NULL REFERENCES public.prive_destinations(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.prive_destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (area_id, destination_id),
  CHECK (area_id <> destination_id)
);

-- Jerarquía coherente: una región cuelga de un país; una localidad de un país o una región; un barrio
-- de un destino (país-destino, región o localidad); un área de un país. Así "Montecarlo" no puede
-- quedar como ciudad suelta ni Polanco como hijo de otro barrio.
CREATE OR REPLACE FUNCTION public.prive_destinations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE p record;
BEGIN
  NEW.updated_at := now();
  IF NEW.kind = 'country' THEN RETURN NEW; END IF;
  SELECT kind, is_destination, iso_country INTO p FROM public.prive_destinations WHERE id = NEW.parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'prive_destinations: el padre no existe'; END IF;
  IF p.iso_country <> NEW.iso_country THEN RAISE EXCEPTION 'prive_destinations: el país del hijo debe ser el del padre'; END IF;
  IF (NEW.kind IN ('region','area') AND p.kind <> 'country')
     OR (NEW.kind = 'locality' AND p.kind NOT IN ('country','region'))
     OR (NEW.kind = 'neighborhood' AND NOT (p.is_destination AND p.kind IN ('country','region','locality'))) THEN
    RAISE EXCEPTION 'prive_destinations: un % no puede colgar de un %', NEW.kind, p.kind;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prive_destinations_guard ON public.prive_destinations;
CREATE TRIGGER prive_destinations_guard BEFORE INSERT OR UPDATE ON public.prive_destinations
  FOR EACH ROW EXECUTE FUNCTION public.prive_destinations_guard();

CREATE OR REPLACE FUNCTION public.prive_destination_members_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.prive_destinations WHERE id = NEW.area_id AND kind = 'area') THEN
    RAISE EXCEPTION 'prive_destination_members: area_id debe ser un área';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prive_destinations WHERE id = NEW.destination_id AND is_destination) THEN
    RAISE EXCEPTION 'prive_destination_members: el miembro debe ser un destino';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prive_destination_members_guard ON public.prive_destination_members;
CREATE TRIGGER prive_destination_members_guard BEFORE INSERT OR UPDATE ON public.prive_destination_members
  FOR EACH ROW EXECUTE FUNCTION public.prive_destination_members_guard();

-- Resuelve un texto libre ("Monte Carlo", "cdmx", "san-jose-del-cabo") a un destino, por slug o alias.
CREATE OR REPLACE FUNCTION public.prive_resolve_destination(_q text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT id FROM public.prive_destinations WHERE slug = lower(btrim(coalesce(_q, ''))) AND active),
    (SELECT a.destination_id FROM public.prive_destination_aliases a
       JOIN public.prive_destinations d ON d.id = a.destination_id AND d.active
      WHERE a.alias_norm = public.prive_norm(_q)));
$$;
REVOKE ALL ON FUNCTION public.prive_resolve_destination(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_resolve_destination(text) TO service_role;

ALTER TABLE public.prive_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_destination_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prive_destination_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prive_destinations, public.prive_destination_aliases, public.prive_destination_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.prive_destinations, public.prive_destination_aliases, public.prive_destination_members TO service_role;
REVOKE ALL ON FUNCTION public.prive_destinations_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prive_destination_members_guard() FROM PUBLIC, anon, authenticated;
