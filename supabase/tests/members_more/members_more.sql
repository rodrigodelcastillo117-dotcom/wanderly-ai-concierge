-- Pruebas de Members Only "agrega más". Imprime "OK …" o "FALLA …". Requiere run.sh (todas las
-- migraciones). Usuarios: P1 con IATOS PRO, F1 gratis.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

CREATE OR REPLACE FUNCTION public.t_err(_label text, _sql text, _expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RAISE NOTICE 'FALLA % (no hubo error)', _label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ~* _expect THEN RAISE NOTICE 'OK % [%]', _label, left(SQLERRM, 90);
  ELSE RAISE NOTICE 'FALLA % (error inesperado: %)', _label, SQLERRM; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.t_ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.t_err(text, text, text), public.t_ok(text, boolean, text) TO anon, authenticated, service_role;

-- ───────────── Datos de prueba (como servidor) ─────────────
INSERT INTO auth.users(id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000b1', 'b1-pro@example.test'),
  ('d0000000-0000-0000-0000-0000000000f1', 'f1-free@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES ('d0000000-0000-0000-0000-0000000000b1', 'active', 'sub_mm1', 'cus_mm1', now() + interval '20 days')
ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';

CREATE OR REPLACE FUNCTION public.t_dest(_slug text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.prive_destinations WHERE slug = _slug $$;
-- Todos los nombres de lugares (para comprobar que el adelanto y las ciudades no los filtran).
CREATE OR REPLACE FUNCTION public.t_all_names() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT array_agg(lower(nombre)) FROM public.nightlife_premium) || (SELECT array_agg(lower(name)) FROM public.prive_experiences) $$;
CREATE OR REPLACE FUNCTION public.t_dk(_n text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.prive_dedupe_key(_n) $$;
GRANT EXECUTE ON FUNCTION public.t_all_names(), public.t_dk(text) TO authenticated;

-- 1) La curaduría actualiza la copia vieja de Hanky Panky (como hace prive_import_batch: conserva
--    legacy_nightlife_id) con datos corregidos → misma fila vieja + curada = UNA vez.
UPDATE public.prive_experiences e SET data_state = 'CURADO', operating_status = 'abierto', verified_at = now() - interval '5 days',
  sources = '["https://www.hankypanky.mx/"]', why_fact_es = 'Hecho de prueba con fuente.', website = 'https://www.hankypanky.mx/',
  subcategory = 'speakeasy_de_autor', description_es = 'Descripción corregida por la curaduría.'
  FROM public.nightlife_premium n WHERE e.legacy_nightlife_id = n.id AND n.nombre = 'Hanky Panky';
-- 2) Fifty Mils: la curaduría le corrige el nombre (otra llave de nombre); la liga legacy_nightlife_id
--    basta para no repetirlo.
UPDATE public.prive_experiences e SET data_state = 'VERIFICADO', operating_status = 'abierto', verified_at = now() - interval '2 days',
  sources = '[{"url":"https://www.fourseasons.com/mexico/dining/lounges/fifty-mils/"}]', why_fact_es = 'Hecho de prueba.',
  website = 'https://www.fourseasons.com/mexico/', subcategory = 'rooftop_de_hotel', name = 'Fifty Mils Bar Rooftop Test'
  FROM public.nightlife_premium n WHERE e.legacy_nightlife_id = n.id AND n.nombre = 'Fifty Mils - Four Seasons';
-- 3) Mismo lugar en la tabla vieja y en la curaduría SIN liga (acentos distintos) → una vez, gana la curada.
INSERT INTO public.nightlife_premium (ciudad, ciudad_display, pais, categoria, nombre, descripcion, active)
VALUES ('ciudad de mexico', 'Ciudad de México', 'México', 'speakeasy', 'Licorería Limantour', 'Texto viejo sin fuente', true);
INSERT INTO public.prive_experiences (slug, destination_id, neighborhood_id, universe, subcategory, name, website, sources, why_fact_es,
  data_state, verified_at, operating_status, description_es)
VALUES ('mm-licoreria', public.t_dest('cdmx'), public.t_dest('cdmx-roma-condesa'), 'after_dark', 'cocktail_bar', 'Licoreria Limantour',
  'https://limantour.tech/', '["https://limantour.tech/"]', 'Hecho de prueba.', 'VERIFICADO', '2026-10-01T12:00:00Z', 'abierto', 'Texto curado');
-- 4) Barrio: un lugar curado en Polanco y una fila vieja con ciudad "polanco".
INSERT INTO public.prive_experiences (slug, destination_id, neighborhood_id, universe, subcategory, name, website, sources, why_fact_es,
  data_state, verified_at, operating_status)
VALUES ('mm-polanco-jazz', public.t_dest('cdmx'), public.t_dest('cdmx-polanco'), 'after_dark', 'club_de_jazz', 'T Polanco Jazz',
  'https://example.test/jazz', '["https://example.test/jazz"]', 'Hecho de prueba.', 'CURADO', now() - interval '1 day', 'abierto');
INSERT INTO public.nightlife_premium (ciudad, ciudad_display, pais, categoria, nombre, active)
VALUES ('polanco', 'Polanco', 'México', 'rooftop', 'Terraza Legado Polanco', true);
-- 5) Lo que NO debe salir: PENDIENTE, casino, desactualizado, otro universo.
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, data_state)
VALUES ('mm-pendiente', public.t_dest('cdmx'), 'after_dark', 'club', 'T Pendiente CDMX', 'PENDIENTE');
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at,
  operating_status, age_policy, license_authority, license_source)
VALUES ('mm-casino', public.t_dest('cdmx'), 'casino_grand_nights', 'casino', 'T Casino CDMX', 'https://example.test/casino',
  '["https://example.test/casino"]', 'Casino con licencia.', 'CURADO', now() - interval '1 day', 'abierto', '18+', 'Autoridad', 'https://example.test/lic');
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('mm-viejo', public.t_dest('cdmx'), 'after_dark', 'cocteleria', 'T Viejo CDMX', 'https://example.test/viejo',
  '["https://example.test/viejo"]', 'Revisado hace mucho.', 'CURADO', now() - interval '100 days', 'abierto');
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('mm-mesa', public.t_dest('cdmx'), 'the_table', 'alta_cocina', 'T Mesa CDMX', 'https://example.test/mesa',
  '["https://example.test/mesa"]', 'Restaurante.', 'VERIFICADO', now() - interval '1 day', 'abierto');
-- 6) Región con localidad hija (Los Cabos → San José del Cabo) y área metropolitana (Área de Miami).
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('mm-cabo', public.t_dest('san-jose-del-cabo'), 'after_dark', 'mezcaleria', 'T Cabo Bar', 'https://example.test/cabo',
  '["https://example.test/cabo"]', 'Hecho de prueba.', 'CURADO', now() - interval '1 day', 'abierto');
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('mm-beach', public.t_dest('miami-beach'), 'after_dark', 'lounge_bar', 'T Beach Lounge', 'https://example.test/beach',
  '["https://example.test/beach"]', 'Hecho de prueba.', 'CURADO', now() - interval '1 day', 'abierto');
-- 7) Una ciudad vieja que no existe en el catálogo sigue funcionando como antes.
INSERT INTO public.nightlife_premium (ciudad, ciudad_display, pais, categoria, nombre, active)
VALUES ('zz ciudad prueba', 'ZZ Ciudad Prueba', 'Ninguno', 'cabaret', 'Lugar Sin Catalogo', true);

-- ───────────── 1. Acceso ─────────────
SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.t_err('A1 anon no llama members_venues', $q$SELECT * FROM public.members_venues('CDMX')$q$, 'permission denied');
SELECT public.t_err('A2 anon no llama members_cities', $q$SELECT * FROM public.members_cities()$q$, 'permission denied');
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000f1', false);
SELECT public.t_err('A3 gratis: members_venues se niega', $q$SELECT * FROM public.members_venues('CDMX')$q$, 'MEMBERS_PRO_REQUIRED');
SELECT public.t_err('A4 nadie llama la función interna', $q$SELECT * FROM public.members_venue_pool()$q$, 'permission denied');
SELECT public.t_err('A5 la tabla vieja sigue cerrada para gratis', $q$DO $d$ BEGIN IF (SELECT count(*) FROM public.nightlife_premium) > 0 THEN RAISE EXCEPTION 'vio filas'; END IF; RAISE EXCEPTION 'cero filas'; END $d$$q$, 'cero filas');

-- ───────────── 2. Ciudades y adelanto (gratis): conteos sí, nombres no ─────────────
-- Auditoría 10 #14 (20261029010000): solo se cuentan los lugares con fuente, los mismos que la app muestra;
-- las 3 filas viejas de nightlife_premium de CDMX (sin fuente) ya no inflan el conteo.
SELECT public.t_ok('C1 gratis ve ciudades con conteo', (SELECT count(*) FROM public.members_cities()) >= 3
  AND NOT EXISTS (SELECT 1 FROM public.members_cities() WHERE venues <= 0));
SELECT public.t_ok('C2 CDMX en members_cities con 4 lugares (los curados, con fuente)',
  (SELECT venues FROM public.members_cities() WHERE ciudad_display = 'Ciudad de México') = 4,
  (SELECT string_agg(ciudad_display || ':' || venues, ', ') FROM public.members_cities()));
SELECT public.t_ok('C3 ordenadas por conteo',
  (SELECT bool_and(v_prev >= venues) FROM (SELECT venues, lag(venues) OVER () AS v_prev FROM public.members_cities()) x WHERE v_prev IS NOT NULL));
SELECT public.t_ok('C4 members_cities no trae nombres de lugares',
  NOT EXISTS (SELECT 1 FROM unnest(public.t_all_names()) nm, public.members_cities() c
              WHERE lower(c.ciudad || ' ' || c.ciudad_display || ' ' || coalesce(c.pais, '')) LIKE '%' || nm || '%'));
SELECT public.t_ok('C5 members_teaser no trae nombres de lugares',
  NOT EXISTS (SELECT 1 FROM unnest(public.t_all_names()) nm, public.members_teaser(NULL) t
              WHERE lower(t.ciudad || ' ' || t.ciudad_display || ' ' || coalesce(t.pais, '') || ' ' || t.categoria) LIKE '%' || nm || '%'));
SELECT public.t_ok('C6 adelanto total = suma de members_cities',
  (SELECT sum(venues) FROM public.members_teaser(NULL)) = (SELECT sum(venues) FROM public.members_cities()));
SELECT public.t_ok('C7 adelanto de CDMX = 4 (lo que PRO ve)', (SELECT sum(venues) FROM public.members_teaser('CDMX')) = 4);
SELECT public.t_ok('C8 el adelanto ya cuenta la categoría mapeada (speakeasy incluye la curada)',
  (SELECT venues FROM public.members_teaser('Ciudad de México') WHERE categoria = 'speakeasy') = 1
  AND (SELECT venues FROM public.members_teaser('Ciudad de México') WHERE categoria = 'cocktail_bar') = 1);

-- ───────────── 3. PRO: la unión ─────────────
SELECT set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-0000000000b1', false);
SELECT public.t_ok('P1 PRO recibe la unión de CDMX (7)', (SELECT count(*) FROM public.members_venues('CDMX')) = 7,
  (SELECT string_agg(nombre || '/' || fuente, ', ') FROM public.members_venues('CDMX')));
SELECT public.t_ok('P2 trae lugares viejos y curados',
  (SELECT count(*) FILTER (WHERE fuente = 'members') = 3 AND count(*) FILTER (WHERE fuente = 'curaduria') = 4 FROM public.members_venues('CDMX')));
SELECT public.t_ok('P3 Hanky Panky (vieja + curada ligada) aparece una vez y es la curada',
  (SELECT count(*) = 1 AND bool_and(fuente = 'curaduria' AND descripcion = 'Descripción corregida por la curaduría.' AND categoria = 'speakeasy')
     FROM public.members_venues('CDMX') WHERE public.t_dk(nombre) = 'hanky panky'));
SELECT public.t_ok('P4 Fifty Mils renombrado no se repite (liga legacy_nightlife_id)',
  (SELECT count(*) FROM public.members_venues('CDMX') WHERE nombre ILIKE 'fifty mils%') = 1);
SELECT public.t_ok('P5 Licorería sin liga: una vez, curada, con barrio, fuente y fecha',
  (SELECT count(*) = 1 AND bool_and(fuente = 'curaduria' AND neighborhood = 'Roma-Condesa' AND source_url = 'https://limantour.tech/'
     AND verified_at = '2026-10-01T12:00:00Z' AND effective_state = 'VERIFICADO' AND categoria = 'cocktail_bar')
     FROM public.members_venues('CDMX') WHERE nombre ILIKE 'licor%'));
SELECT public.t_ok('P6 PENDIENTE, casino, desactualizado y otro universo no salen',
  NOT EXISTS (SELECT 1 FROM public.members_venues('CDMX') WHERE nombre IN ('T Pendiente CDMX','T Casino CDMX','T Viejo CDMX','T Mesa CDMX')));
SELECT public.t_ok('P7 solo VERIFICADO/CURADO en lo curado',
  NOT EXISTS (SELECT 1 FROM public.members_venues('CDMX') WHERE fuente = 'curaduria' AND effective_state NOT IN ('VERIFICADO','CURADO')));
SELECT public.t_ok('P8 barrio dentro de la ciudad: Polanco aparece en CDMX con su nombre',
  (SELECT count(*) FROM public.members_venues('CDMX') WHERE neighborhood = 'Polanco') = 2);
SELECT public.t_ok('P9 buscar "Polanco" da solo Polanco',
  (SELECT count(*) = 2 AND bool_and(neighborhood = 'Polanco') FROM public.members_venues('Polanco')));
SELECT public.t_ok('P10 CDMX = Ciudad de Mexico = Mexico City = ciudad de méxico',
  (SELECT array_agg(id ORDER BY id) FROM public.members_venues('CDMX')) = (SELECT array_agg(id ORDER BY id) FROM public.members_venues('Ciudad de Mexico'))
  AND (SELECT array_agg(id ORDER BY id) FROM public.members_venues('CDMX')) = (SELECT array_agg(id ORDER BY id) FROM public.members_venues('Mexico City'))
  AND (SELECT array_agg(id ORDER BY id) FROM public.members_venues('CDMX')) = (SELECT array_agg(id ORDER BY id) FROM public.members_venues('  ciudad de méxico ')));
SELECT public.t_ok('P11 región incluye su localidad hija (Los Cabos → San José del Cabo)',
  (SELECT count(*) = 1 AND bool_and(neighborhood = 'San José del Cabo') FROM public.members_venues('Los Cabos')));
SELECT public.t_ok('P12 área metropolitana incluye a sus miembros (Miami + Miami Beach)',
  (SELECT count(*) FROM public.members_venues('Área de Miami')) = (SELECT count(*) FROM public.members_venues('Miami')) + 1
  AND EXISTS (SELECT 1 FROM public.members_venues('Área de Miami') WHERE nombre = 'T Beach Lounge'));
SELECT public.t_ok('P13 ciudad vieja fuera del catálogo sigue funcionando',
  (SELECT count(*) FROM public.members_venues('ZZ Ciudad Prueba')) = 1);
SELECT public.t_ok('P14 París sin curaduría: las 4 de siempre',
  (SELECT count(*) FROM public.members_venues('París')) = 4);
SELECT public.t_ok('P15 conteos del adelanto = lugares de PRO por ciudad',
  NOT EXISTS (SELECT 1 FROM public.members_cities() c
               WHERE c.venues <> (SELECT count(*) FROM public.members_venues(c.ciudad_display) v
                                   WHERE v.fuente = 'curaduria' OR nullif(btrim(v.source_url), '') IS NOT NULL)));
SELECT public.t_ok('P16 ningún lugar repetido en ninguna ciudad',
  NOT EXISTS (SELECT 1 FROM public.members_cities() c, LATERAL (
    SELECT public.t_dk(v.nombre) k FROM public.members_venues(c.ciudad_display) v GROUP BY v.ciudad, 1 HAVING count(*) > 1) d));
SELECT public.t_ok('P17 texto vacío: nada', (SELECT count(*) FROM public.members_venues('')) = 0);
RESET ROLE;
