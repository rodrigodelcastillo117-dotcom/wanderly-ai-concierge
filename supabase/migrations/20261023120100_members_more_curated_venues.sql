-- Members Only: "agrega más". Además de nightlife_premium (la tabla vieja), Members Only muestra ahora
-- la vida nocturna curada del catálogo Privé (universo after_dark), sin repetir lugares. Idempotente.
--
-- Antes: Members.tsx y MembersOnlyPanel leían nightlife_premium directo con ciudad = "parís" normalizado;
-- lo curado (con fuente, fecha de verificación y datos corregidos) no aparecía, y "CDMX", "Mexico City"
-- o "Polanco" no encontraban nada.
-- Ahora todo sale por RPC:
--  * members_venues(p_ciudad): solo con members_access() (PRO, prueba o cortesía; o contraseña temporal
--    vigente: la misma regla que la RLS de nightlife_premium, 20261022146000). La ciudad se resuelve con
--    los sobrenombres del catálogo (prive_resolve_destination) o la llave vieja (legacy_ciudad_key) e
--    incluye sus barrios y localidades hijas, y los miembros si es un área metropolitana.
--    Devuelve la unión de (a) nightlife_premium activo y (b) after_dark en VERIFICADO o CURADO vigente
--    (nunca PENDIENTE, NO DISPONIBLE, DESACTUALIZADO ni casino_grand_nights), una sola vez por lugar:
--    gana la fila curada (tiene los datos corregidos); una fila vieja que el cargador ligó
--    (legacy_nightlife_id / merged_legacy_ids) o con el mismo nombre normalizado en la ciudad no se repite.
--  * members_cities(): ciudades con al menos un lugar, con conteo (sin nombres de lugares). Para
--    cualquiera con sesión, como members_teaser.
--  * members_teaser(p_ciudad): misma firma y misma garantía (sin nombres); ahora cuenta la misma unión.

-- Categoría de la curaduría → categorías que la pantalla ya filtra. Lo que no corresponde se queda con
-- su subcategoría (la pantalla lo agrupa en "Otros").
CREATE OR REPLACE FUNCTION public.members_category(_sub text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN s IN ('cabaret','burlesque','members_club','speakeasy','rooftop','casino_vip','jazz_lounge','evento_vip') THEN s
    WHEN s ~ 'rooftop' THEN 'rooftop'
    WHEN s ~ 'speakeasy' THEN 'speakeasy'
    WHEN s ~ 'burlesque' THEN 'burlesque'
    WHEN s ~ 'cabaret' THEN 'cabaret'
    WHEN s ~ 'jazz' THEN 'jazz_lounge'
    WHEN s ~ '^(private_)?members?_club$|^club_privado$' THEN 'members_club'
    ELSE s END
  FROM (SELECT lower(coalesce(_sub, '')) AS s) x;
$$;

-- Todos los lugares de Members Only, ya sin duplicados por ciudad. Interna: solo la usan las RPC de abajo.
-- city_id = destino del catálogo (país-destino, región o localidad; nunca barrio). Una fila vieja cuya
-- ciudad no está en el catálogo se queda con su llave (city_id NULL), como antes.
CREATE OR REPLACE FUNCTION public.members_venue_pool()
RETURNS TABLE (
  id uuid, city_id uuid, city_key text, ciudad_display text, pais text, neighborhood_id uuid, neighborhood text,
  categoria text, emoji text, nombre text, por_que text, descripcion text, dress_code text, precio_estimado text,
  reserva_requerida boolean, tags text[], address text, website text, fuente text, effective_state text,
  effective_label text, source_url text, verified_at timestamptz, season_state text, age_policy text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cur AS (
    SELECT e.id, d.id AS city_id, coalesce(d.legacy_ciudad_key, d.slug) AS city_key, d.name_es AS ciudad_display,
           c.name_es AS pais, nb.id AS neighborhood_id, nb.name_es AS neighborhood,
           public.members_category(e.subcategory) AS categoria, NULL::text AS emoji, e.name AS nombre,
           e.why_fact_es AS por_que, e.description_es AS descripcion, e.dress_code_es AS dress_code,
           nullif(repeat('$', coalesce(e.price_level, 0)), '') AS precio_estimado,
           coalesce(e.reservation_required, false) AS reserva_requerida,   -- NULL = la fuente no lo dice
           e.tags, e.address, e.website, 'curaduria'::text AS fuente, e.effective_state, e.effective_label,
           CASE jsonb_typeof(e.sources -> 0) WHEN 'string' THEN e.sources ->> 0 WHEN 'object' THEN e.sources -> 0 ->> 'url' END AS source_url,
           e.verified_at, e.season_state, e.age_policy,
           e.legacy_nightlife_id, e.merged_legacy_ids, 0 AS src_rank, e.created_at
      FROM public.prive_experiences_v e
      JOIN public.prive_destinations d ON d.id = e.destination_id
      LEFT JOIN public.prive_destinations nb ON nb.id = e.neighborhood_id
      LEFT JOIN public.prive_destinations c ON c.kind = 'country' AND c.iso_country = d.iso_country
     WHERE e.universe = 'after_dark' AND e.effective_state IN ('VERIFICADO','CURADO')
  ), leg_raw AS (
    SELECT n.*, coalesce(public.prive_resolve_destination(n.ciudad), public.prive_resolve_destination(n.ciudad_display),
             (SELECT x.id FROM public.prive_destinations x WHERE x.legacy_ciudad_key = n.ciudad AND x.active)) AS raw_dest
      FROM public.nightlife_premium n
     WHERE n.active
       AND NOT EXISTS (SELECT 1 FROM cur WHERE cur.legacy_nightlife_id = n.id OR n.id = ANY (cur.merged_legacy_ids))
  ), leg AS (
    SELECT n.id, cty.id AS city_id, coalesce(cty.legacy_ciudad_key, cty.slug, n.ciudad) AS city_key,
           coalesce(cty.name_es, n.ciudad_display) AS ciudad_display, coalesce(n.pais, c.name_es) AS pais,
           CASE WHEN r.kind = 'neighborhood' THEN r.id END AS neighborhood_id,
           CASE WHEN r.kind = 'neighborhood' THEN r.name_es END AS neighborhood,
           n.categoria, n.emoji, n.nombre, n.por_que, n.descripcion, n.dress_code, n.precio_estimado,
           n.reserva_requerida, n.tags, n.address, n.website, 'members'::text AS fuente, NULL::text AS effective_state,
           NULL::text AS effective_label, NULL::text AS source_url, NULL::timestamptz AS verified_at,
           NULL::text AS season_state, NULL::text AS age_policy,
           NULL::uuid AS legacy_nightlife_id, NULL::uuid[] AS merged_legacy_ids, 1 AS src_rank, n.created_at
      FROM leg_raw n
      LEFT JOIN public.prive_destinations r ON r.id = n.raw_dest AND r.kind <> 'area'
      LEFT JOIN public.prive_destinations cty ON cty.id = CASE WHEN r.kind = 'neighborhood' THEN r.parent_id ELSE r.id END
      LEFT JOIN public.prive_destinations c ON c.kind = 'country' AND c.iso_country = cty.iso_country
  ), alle AS (
    SELECT * FROM cur UNION ALL SELECT * FROM leg
  ), ranked AS (
    SELECT a.*, row_number() OVER (
             PARTITION BY coalesce(a.city_id::text, 'k:' || public.prive_norm(a.city_key)), public.prive_dedupe_key(a.nombre)
             ORDER BY a.src_rank, (a.effective_state = 'VERIFICADO') DESC NULLS LAST, a.verified_at DESC NULLS LAST, a.created_at, a.id) AS rn
      FROM alle a
  )
  SELECT id, city_id, city_key, ciudad_display, pais, neighborhood_id, neighborhood, categoria, emoji, nombre, por_que,
         descripcion, dress_code, precio_estimado, reserva_requerida, tags, address, website, fuente, effective_state,
         effective_label, source_url, verified_at, season_state, age_policy
    FROM ranked WHERE rn = 1;
$$;

-- Qué abarca un texto de ciudad: el destino que resuelve, sus hijos (localidades/regiones) y, si es un
-- área, sus miembros; si es un barrio, solo ese barrio. q = texto normalizado para las filas viejas sin
-- destino en el catálogo (comportamiento anterior: ciudad = texto normalizado).
CREATE OR REPLACE FUNCTION public.members_scope(p_ciudad text)
RETURNS TABLE (root_id uuid, neighborhood_id uuid, city_ids uuid[], q text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid; k text;
BEGIN
  q := public.prive_norm(p_ciudad);
  city_ids := '{}';
  IF q = '' THEN RETURN NEXT; RETURN; END IF;
  v := public.prive_resolve_destination(p_ciudad);
  IF v IS NULL THEN
    SELECT d.id INTO v FROM public.prive_destinations d
     WHERE d.active AND d.legacy_ciudad_key IS NOT NULL AND public.prive_norm(d.legacy_ciudad_key) = q LIMIT 1;
  END IF;
  SELECT d.kind INTO k FROM public.prive_destinations d WHERE d.id = v;
  root_id := v;
  IF k = 'neighborhood' THEN
    neighborhood_id := v;
  ELSIF v IS NOT NULL THEN
    WITH RECURSIVE base AS (
      SELECT v AS did
      UNION SELECT m.destination_id FROM public.prive_destination_members m WHERE m.area_id = v
    ), tree AS (
      SELECT b.did FROM base b
      UNION SELECT d.id FROM public.prive_destinations d JOIN tree t ON d.parent_id = t.did
       WHERE d.active AND d.kind IN ('region','locality')
    )
    SELECT coalesce(array_agg(t.did), '{}') INTO city_ids FROM tree t;
  END IF;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.members_category(text), public.members_venue_pool(), public.members_scope(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.members_category(text), public.members_venue_pool(), public.members_scope(text) TO service_role;

-- Contenido completo: solo con derecho. Mismas columnas que la pantalla ya usa + fuente y verificación.
DROP FUNCTION IF EXISTS public.members_venues(text);
CREATE FUNCTION public.members_venues(p_ciudad text)
RETURNS TABLE (
  id uuid, ciudad text, ciudad_display text, pais text, categoria text, emoji text, nombre text, por_que text,
  descripcion text, dress_code text, precio_estimado text, reserva_requerida boolean, tags text[], address text,
  website text, fuente text, effective_state text, effective_label text, source_url text, verified_at timestamptz,
  neighborhood text, season_state text, age_policy text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT coalesce(public.members_access(), false) THEN
    RAISE EXCEPTION 'MEMBERS_PRO_REQUIRED: Members Only es exclusivo de IATOS PRO' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.city_key, p.ciudad_display, p.pais, p.categoria, p.emoji, p.nombre, p.por_que, p.descripcion,
         p.dress_code, p.precio_estimado, p.reserva_requerida, p.tags, p.address, p.website, p.fuente,
         p.effective_state, p.effective_label, p.source_url, p.verified_at,
         -- Barrio, o la localidad hija cuando se buscó la región o el área ("San José del Cabo" en Los Cabos).
         coalesce(p.neighborhood, CASE WHEN s.root_id IS NOT NULL AND s.neighborhood_id IS NULL
                                        AND p.city_id IS DISTINCT FROM s.root_id THEN p.ciudad_display END),
         p.season_state, p.age_policy
    FROM public.members_venue_pool() p
    CROSS JOIN public.members_scope(p_ciudad) s
   WHERE p.city_id = ANY (s.city_ids)
      OR (s.neighborhood_id IS NOT NULL AND p.neighborhood_id = s.neighborhood_id)
      OR (p.city_id IS NULL AND s.q <> '' AND (public.prive_norm(p.city_key) = s.q OR public.prive_norm(p.ciudad_display) = s.q))
   ORDER BY p.nombre, p.id;
END $$;
REVOKE ALL ON FUNCTION public.members_venues(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_venues(text) TO authenticated, service_role;

-- Ciudades con lugares (nombre visible, país y cuántos). Sin nombres, direcciones ni sitios de lugares.
DROP FUNCTION IF EXISTS public.members_cities();
CREATE FUNCTION public.members_cities()
RETURNS TABLE (ciudad text, ciudad_display text, pais text, venues int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min(p.city_key), min(p.ciudad_display), min(p.pais), count(*)::int
    FROM public.members_venue_pool() p
   WHERE auth.uid() IS NOT NULL
   GROUP BY coalesce(p.city_id::text, 'k:' || public.prive_norm(p.city_key))
   ORDER BY count(*) DESC, min(p.ciudad_display);
$$;
REVOKE ALL ON FUNCTION public.members_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_cities() TO authenticated, service_role;

-- Adelanto (misma firma, misma garantía: sin nombres): ahora cuenta la misma unión que members_venues.
CREATE OR REPLACE FUNCTION public.members_teaser(p_ciudad text DEFAULT NULL)
RETURNS TABLE (ciudad text, ciudad_display text, pais text, categoria text, venues int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT min(p.city_key), min(p.ciudad_display), min(p.pais), p.categoria, count(*)::int
    FROM public.members_venue_pool() p
    LEFT JOIN public.members_scope(p_ciudad) s ON p_ciudad IS NOT NULL
   WHERE auth.uid() IS NOT NULL
     AND (p_ciudad IS NULL
          OR p.city_id = ANY (s.city_ids)
          OR (s.neighborhood_id IS NOT NULL AND p.neighborhood_id = s.neighborhood_id)
          OR (p.city_id IS NULL AND s.q <> '' AND (public.prive_norm(p.city_key) = s.q OR public.prive_norm(p.ciudad_display) = s.q)))
   GROUP BY coalesce(p.city_id::text, 'k:' || public.prive_norm(p.city_key)), p.categoria
   ORDER BY 1, 4;
$$;
REVOKE ALL ON FUNCTION public.members_teaser(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_teaser(text) TO authenticated, service_role;
