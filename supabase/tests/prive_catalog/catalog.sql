-- Pruebas del catálogo de IATOS Privé. Imprime "OK …" o "FALLA …". Requiere run.sh (migraciones +
-- stub de prive_require). Usuarios: U1 miembro con sesión Privé, U2 cuenta sin sesión Privé (gratis o
-- PRO < 90 días: solo adelanto), U3 equipo (admins).
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
  ('c0000000-0000-0000-0000-0000000000a1', 'u1-member@example.test'),
  ('c0000000-0000-0000-0000-0000000000a2', 'u2-free@example.test'),
  ('c0000000-0000-0000-0000-0000000000a3', 'u3-admin@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.admins(user_id) VALUES ('c0000000-0000-0000-0000-0000000000a3') ON CONFLICT DO NOTHING;
-- U1 es miembro de verdad: PRO activo, 99 días pagados, invitación aceptada, contraseña Privé y una
-- sesión Privé emitida por prive_unlock (la prive_require real del grupo core la valida).
CREATE TABLE IF NOT EXISTS public.t_tokens (label text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON public.t_tokens FROM PUBLIC, anon, authenticated;
DO $$
DECLARE u uuid := 'c0000000-0000-0000-0000-0000000000a1'; r jsonb; pw text := 'Catalogo de prueba Prive 2026';
BEGIN
  INSERT INTO public.profiles (id, full_name, email) VALUES (u, 'Miembro Prueba', 'u1-member@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (u, 'active', 'sub_cat1', 'cus_cat1', now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  PERFORM public.prive_record_paid_period(u, 'in_cat_1', 'sub_cat1', 'cus_cat1', now() - interval '100 days', now() - interval '1 day', 19900, 'mxn', 'test');
  PERFORM public.prive_invite_user(u, 'tenure', 'system');
  r := public.prive_accept_invitation(u, NULL);
  r := public.prive_set_password(u, pw, 'ok');
  r := public.prive_unlock(u, pw, NULL, NULL);
  IF r->>'token' IS NULL THEN RAISE NOTICE 'FALLA SETUP no se obtuvo sesión Privé: %', r; END IF;
  INSERT INTO public.t_tokens VALUES ('u1', r->>'token') ON CONFLICT (label) DO UPDATE SET token = EXCLUDED.token;
END $$;
CREATE OR REPLACE FUNCTION public.t_ps() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT token FROM public.t_tokens WHERE label = 'u1' $$;
GRANT EXECUTE ON FUNCTION public.t_ps() TO authenticated;
INSERT INTO public.trips(id, user_id, destino) VALUES ('c0000000-0000-0000-0000-00000000aa01', 'c0000000-0000-0000-0000-0000000000a1', 'Mónaco')
  ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.t_dest(_slug text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.prive_destinations WHERE slug = _slug $$;

INSERT INTO public.prive_experiences (id, slug, destination_id, neighborhood_id, universe, subcategory, name, website, sources, why_fact_es,
  data_state, verified_at, operating_status, commercial_label, price_min, price_max, price_currency, price_basis, price_source_url, price_checked_at,
  opening_hours, opening_hours_source, lat, lng)
VALUES ('e0000000-0000-0000-0000-000000000001', 'mc-t-louis-xv', public.t_dest('mc'), public.t_dest('monaco-monte-carlo'), 'the_table', 'alta_cocina',
  'T Louis XV', 'https://example.test/louis', '["https://example.test/louis"]', 'Hecho de prueba con fuente.',
  'VERIFICADO', now() - interval '5 days', 'abierto', 'EXPERIENCIA_CURADA', 300, 400, 'EUR', 'menu_degustacion', 'https://example.test/louis/menu', now(),
  '{"thu":[["19:30","22:00"]],"fri":[["19:30","22:00"]],"sat":[["19:30","22:00"]]}', 'https://example.test/louis/horario', 43.7393, 7.4276);
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at,
  operating_status, age_policy, license_authority, license_source, commercial_label)
VALUES ('e0000000-0000-0000-0000-000000000002', 'mc-t-casino', public.t_dest('mc'), 'casino_grand_nights', 'casino', 'T Casino',
  'https://example.test/casino', '["https://example.test/casino"]', 'Casino con licencia.', 'CURADO', now() - interval '1 day',
  'abierto', '18+', 'Autoridad de prueba', 'https://example.test/licencia', 'EXPERIENCIA_CURADA');
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at,
  operating_status, commercial_label, operator_name, operator_url, private_conditions_es)
VALUES ('e0000000-0000-0000-0000-000000000003', 'mc-t-yacht', public.t_dest('mc'), 'yacht_sea', 'paseo_privado', 'T Yacht Charter',
  'https://example.test/yacht', '["https://example.test/yacht"]', 'Operador con salidas privadas publicadas.', 'CURADO', now() - interval '1 day',
  'abierto', 'EXPERIENCIA_PRIVADA', 'T Yacht Charter SARL', 'https://example.test/yacht', 'Máximo 8 personas; según el sitio.');
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at, operating_status)
VALUES ('e0000000-0000-0000-0000-000000000004', 'mc-t-old-bar', public.t_dest('mc'), 'after_dark', 'cocteleria', 'T Old Bar',
  'https://example.test/bar', '["https://example.test/bar"]', 'Revisado hace mucho.', 'CURADO', now() - interval '100 days', 'abierto');
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at,
  operating_status, event_start, event_end)
VALUES ('e0000000-0000-0000-0000-000000000005', 'mc-t-past-gala', public.t_dest('mc'), 'iconic_events', 'gala', 'T Past Gala',
  'https://example.test/gala', '["https://example.test/gala"]', 'Evento ya pasado.', 'VERIFICADO', now() - interval '2 days', 'abierto',
  now() - interval '10 days', now() - interval '9 days');
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, data_state)
VALUES ('e0000000-0000-0000-0000-000000000006', 'mc-t-pending', public.t_dest('mc'), 'after_dark', 'club', 'T Pending Club', 'PENDIENTE');
-- Beach club en temporada cerrada (reabre en el futuro, con fuente): visible como cerrado por temporada.
INSERT INTO public.prive_experiences (id, slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at,
  operating_status, season_reopens_on, season_note_es, season_source)
VALUES ('e0000000-0000-0000-0000-000000000007', 'mc-t-beach', public.t_dest('mc'), 'wellness_escape', 'beach_club', 'T Beach Club',
  'https://example.test/beach', '["https://example.test/beach"]', 'Club de playa de temporada.', 'CURADO', now() - interval '1 day',
  'cerrado_temporal', current_date + 60, 'Reabre en primavera (según el sitio).', 'https://example.test/beach');

-- ───────────── 1. Acceso: sin derecho o sin sesión Privé no sale contenido ─────────────
-- U2 es una cuenta sin Privé (gratis): la base responde con un código PRIVE_* y nada más.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000a2', false);
SELECT public.t_err('A1 prive_destination sin sesión', $q$SELECT public.prive_destination(NULL, 'mc')$q$, 'PRIVE_');
SELECT public.t_err('A2 prive_search sin sesión', $q$SELECT public.prive_search('', ARRAY['Mónaco'])$q$, 'PRIVE_');
SELECT public.t_err('A3 prive_experience con sesión ajena', $q$SELECT public.prive_experience(public.t_ps(), 'mc-t-louis-xv')$q$, 'PRIVE_');
SELECT public.t_err('A4 prive_universe con token inventado', $q$SELECT public.prive_universe('x', 'the_table')$q$, 'PRIVE_');
SELECT public.t_err('A5 prive_save sin sesión', $q$SELECT public.prive_save(NULL, 'e0000000-0000-0000-0000-000000000001')$q$, 'PRIVE_');
SELECT public.t_err('A6 prive_add_to_trip sin sesión', $q$SELECT public.prive_add_to_trip(NULL, 'c0000000-0000-0000-0000-00000000aa01', '[]')$q$, 'PRIVE_');
SELECT public.t_err('A7 prive_request_create sin sesión', $q$SELECT public.prive_request_create(NULL, 'e0000000-0000-0000-0000-000000000001')$q$, 'PRIVE_');
SELECT public.t_err('A8 prive_track sin sesión', $q$SELECT public.prive_track(NULL, 'detail_open')$q$, 'PRIVE_');
SELECT public.t_err('A9 prive_for_you sin sesión', $q$SELECT public.prive_for_you(NULL, 'mc')$q$, 'PRIVE_');
SELECT public.t_err('A10 lectura directa de prive_experiences', $q$SELECT count(*) FROM public.prive_experiences$q$, 'permission denied');
SELECT public.t_err('A11 lectura directa de la vista', $q$SELECT count(*) FROM public.prive_experiences_v$q$, 'permission denied');
SELECT public.t_err('A12 lectura directa del registro de alianzas', $q$SELECT count(*) FROM public.prive_partner_agreements$q$, 'permission denied');
SELECT public.t_err('A13 escritura directa de experiencias', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name) VALUES ('x-x-x', public.t_dest('mc'),'the_table','xx','X')$q$, 'permission denied');

-- ───────────── 2. Adelanto: conteos sí, nombres no ─────────────
SELECT public.t_ok('T1 el adelanto trae universos y destinos',
  jsonb_array_length(public.prive_teaser()->'universes') = 12 AND jsonb_array_length(public.prive_teaser()->'destinations') >= 111);
SELECT public.t_ok('T2 el adelanto no filtra nombres, sitios ni coordenadas de experiencias',
  public.prive_teaser()::text !~* '(T Louis XV|T Casino|T Yacht|example\.test|website|address|"lat")');
SELECT public.t_ok('T3 el adelanto cuenta solo lo publicable (no PENDIENTE, ni pasado, ni desactualizado)',
  (SELECT (x->>'count')::int FROM jsonb_array_elements(public.prive_teaser()->'destinations') x WHERE x->>'slug' = 'mc') = 4,
  (SELECT x::text FROM jsonb_array_elements(public.prive_teaser()->'destinations') x WHERE x->>'slug' = 'mc'));
RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.t_err('T4 anon no llama el adelanto', $q$SELECT public.prive_teaser()$q$, 'permission denied');
RESET ROLE;

-- ───────────── 3. Estados de datos ─────────────
SET ROLE service_role;
SELECT public.t_ok('S1 VERIFICADO reciente queda VERIFICADO', (SELECT effective_state FROM public.prive_experiences_v WHERE slug = 'mc-t-louis-xv') = 'VERIFICADO');
SELECT public.t_ok('S2 más de 90 días sin verificar = DESACTUALIZADO', (SELECT effective_state FROM public.prive_experiences_v WHERE slug = 'mc-t-old-bar') = 'DESACTUALIZADO');
SELECT public.t_ok('S3 evento pasado = NO_DISPONIBLE', (SELECT effective_state FROM public.prive_experiences_v WHERE slug = 'mc-t-past-gala') = 'NO_DISPONIBLE');
SELECT public.t_ok('S4 cerrado por temporada con reapertura sourced: visible y marcado',
  (SELECT effective_state = 'CURADO' AND season_state = 'cerrado_por_temporada' FROM public.prive_experiences_v WHERE slug = 'mc-t-beach'));
SELECT public.t_err('S5 CURADO sin fuentes', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,why_fact_es,data_state,verified_at) VALUES ('mc-s5',public.t_dest('mc'),'the_table','xx','S5','x','CURADO',now())$q$, 'prive_sourced_states');
SELECT public.t_err('S6 VERIFICADO sin sitio oficial', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,why_fact_es,data_state,verified_at,sources) VALUES ('mc-s6',public.t_dest('mc'),'the_table','xx','S6','x','VERIFICADO',now(),'["https://a.test"]')$q$, 'prive_verified_official');
SELECT public.t_err('S7 precio sin fuente', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,price_min,price_currency) VALUES ('mc-s7',public.t_dest('mc'),'the_table','xx','S7',100,'EUR')$q$, 'prive_price_has_source');
SELECT public.t_err('S8 horario sin fuente', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,opening_hours) VALUES ('mc-s8',public.t_dest('mc'),'the_table','xx','S8','{"mon":[["19:00","23:00"]]}')$q$, 'prive_hours_have_source');
SELECT public.t_err('S9 disponibilidad sin consulta', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,availability_state) VALUES ('mc-s9',public.t_dest('mc'),'the_table','xx','S9','disponible')$q$, 'prive_availability_consulted');
SELECT public.t_err('S10 casino publicado sin licencia', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,why_fact_es,data_state,verified_at,sources,age_policy) VALUES ('mc-s10',public.t_dest('mc'),'casino_grand_nights','casino','S10','x','CURADO',now(),'["https://a.test"]','18+')$q$, 'prive_casino_rules');
SELECT public.t_err('S11 casino para todas las edades', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,age_policy) VALUES ('mc-s11',public.t_dest('mc'),'casino_grand_nights','casino','S11','todas')$q$, 'prive_casino_rules');
SELECT public.t_err('S12 aventura sin requisitos de seguridad', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,why_fact_es,data_state,verified_at,sources) VALUES ('mc-s12',public.t_dest('mc'),'adventure_elite','heli','S12','x','CURADO',now(),'["https://a.test"]')$q$, 'prive_adventure_rules');
SELECT public.t_err('S13 premio sin año', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name,accolades) VALUES ('mc-s13',public.t_dest('mc'),'the_table','xx','S13','[{"name":"Guía","url":"https://a.test"}]')$q$, 'accolades');

-- ───────────── 4. Etiquetas comerciales: imposibles sin evidencia ─────────────
SELECT public.t_err('L1 PARTNER VERIFICADO sin acuerdo', $q$UPDATE public.prive_experiences SET commercial_label='PARTNER_VERIFICADO' WHERE slug='mc-t-louis-xv'$q$, 'prive_label_partner|acuerdo firmado');
SELECT public.t_err('L2 BENEFICIO EXCLUSIVO sin beneficio', $q$UPDATE public.prive_experiences SET commercial_label='BENEFICIO_EXCLUSIVO' WHERE slug='mc-t-louis-xv'$q$, 'prive_label|acuerdo firmado');
SELECT public.t_err('L3 EXPERIENCIA CURADA en algo PENDIENTE', $q$UPDATE public.prive_experiences SET commercial_label='EXPERIENCIA_CURADA' WHERE slug='mc-t-pending'$q$, 'prive_label_curada');
SELECT public.t_err('L4 EXPERIENCIA PRIVADA sin operador', $q$UPDATE public.prive_experiences SET commercial_label='EXPERIENCIA_PRIVADA' WHERE slug='mc-t-old-bar'$q$, 'prive_label_private');
SELECT public.t_err('L5 acuerdo "firmado" sin documento de evidencia', $q$INSERT INTO public.prive_partner_agreements(partner_id,tier,status,signed_at,valid_from) SELECT gen_random_uuid(),'socio','firmado',current_date,current_date$q$, 'prive_agreement_signed_has_evidence|foreign key');
INSERT INTO public.prive_partners(id, legal_name, iatos_owner_admin_id) VALUES ('f0000000-0000-0000-0000-000000000001', 'Socio de prueba SA', 'c0000000-0000-0000-0000-0000000000a3');
INSERT INTO public.prive_partner_agreements(id, partner_id, tier, status) VALUES ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-000000000001', 'socio', 'borrador');
SELECT public.t_err('L6 PARTNER VERIFICADO con acuerdo en borrador', $q$UPDATE public.prive_experiences SET commercial_label='PARTNER_VERIFICADO', partner_id='f0000000-0000-0000-0000-000000000001', partner_agreement_id='f0000000-0000-0000-0000-0000000000b1' WHERE slug='mc-t-louis-xv'$q$, 'acuerdo firmado y vigente');
INSERT INTO public.prive_partner_agreements(id, partner_id, tier, status, signed_at, valid_from, valid_to, conditions_es, evidence_document_path, partner_signatory, iatos_owner_admin_id)
VALUES ('f0000000-0000-0000-0000-0000000000b2', 'f0000000-0000-0000-0000-000000000001', 'socio_beneficio', 'firmado', current_date - 10, current_date - 10, current_date + 30,
  'Condiciones de prueba', 'contracts/prueba.pdf', 'Firmante de prueba', 'c0000000-0000-0000-0000-0000000000a3');
INSERT INTO public.prive_partner_benefits(id, agreement_id, benefit_es, conditions_es, clause_ref)
VALUES ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-0000000000b2', 'Copa de bienvenida', 'Con solicitud previa', 'Cláusula 4.2');
SELECT public.t_err('L7 beneficio de otro acuerdo', $q$UPDATE public.prive_experiences SET commercial_label='BENEFICIO_EXCLUSIVO', partner_id='f0000000-0000-0000-0000-000000000001', partner_agreement_id='f0000000-0000-0000-0000-0000000000b1', benefit_id='f0000000-0000-0000-0000-0000000000c1' WHERE slug='mc-t-louis-xv'$q$, 'foreign key|prive_benefit_fk|acuerdo firmado');
UPDATE public.prive_experiences SET commercial_label = 'BENEFICIO_EXCLUSIVO', partner_id = 'f0000000-0000-0000-0000-000000000001',
  partner_agreement_id = 'f0000000-0000-0000-0000-0000000000b2', benefit_id = 'f0000000-0000-0000-0000-0000000000c1' WHERE slug = 'mc-t-louis-xv';
SELECT public.t_ok('L8 con acuerdo firmado, vigente y beneficio del registro sí hay BENEFICIO EXCLUSIVO',
  (SELECT effective_label FROM public.prive_experiences_v WHERE slug = 'mc-t-louis-xv') = 'BENEFICIO_EXCLUSIVO');
UPDATE public.prive_partner_agreements SET valid_to = current_date - 1, valid_from = current_date - 10 WHERE id = 'f0000000-0000-0000-0000-0000000000b2';
SELECT public.t_ok('L9 al vencer el acuerdo la etiqueta cae sola a EXPERIENCIA CURADA',
  (SELECT effective_label FROM public.prive_experiences_v WHERE slug = 'mc-t-louis-xv') = 'EXPERIENCIA_CURADA');
SELECT public.t_ok('L10 el beneficio vencido ya no se publica en la tarjeta',
  (SELECT public.prive_exp_json(v) ->> 'label_evidence' FROM public.prive_experiences_v v WHERE slug = 'mc-t-louis-xv') !~ 'Copa de bienvenida');
SELECT public.t_err('L11 no se puede escribir un beneficio que no está en el registro', $q$UPDATE public.prive_experiences SET benefit_id=gen_random_uuid() WHERE slug='mc-t-louis-xv'$q$, 'foreign key|prive_benefit_fk|vigente');
SELECT public.t_ok('L12 ninguna fila del registro fue inventada por la migración (solo las de esta prueba)',
  (SELECT count(*) FROM public.prive_partners WHERE id <> 'f0000000-0000-0000-0000-000000000001') = 0);
UPDATE public.prive_experiences SET commercial_label = 'EXPERIENCIA_CURADA', partner_id = NULL, partner_agreement_id = NULL, benefit_id = NULL WHERE slug = 'mc-t-louis-xv';

-- ───────────── 5. Destinos: alias, duplicados y jerarquía ─────────────
SELECT public.t_ok('D1 "Monte Carlo", "montecarlo" y "Monte-Carlo" son el mismo barrio de Mónaco',
  public.prive_resolve_destination('Monte Carlo') = public.t_dest('monaco-monte-carlo')
  AND public.prive_resolve_destination('montecarlo') = public.t_dest('monaco-monte-carlo')
  AND public.prive_resolve_destination('Monte-Carlo') = public.t_dest('monaco-monte-carlo')
  AND (SELECT parent_id FROM public.prive_destinations WHERE slug = 'monaco-monte-carlo') = public.t_dest('mc'));
SELECT public.t_ok('D2 CDMX, DF, Mexico City → Ciudad de México; Polanco y Roma-Condesa son barrios de la CDMX',
  public.prive_resolve_destination('CDMX') = public.t_dest('cdmx') AND public.prive_resolve_destination('Mexico City') = public.t_dest('cdmx')
  AND public.prive_resolve_destination('df') = public.t_dest('cdmx')
  AND (SELECT parent_id FROM public.prive_destinations WHERE slug = 'cdmx-polanco') = public.t_dest('cdmx')
  AND (SELECT parent_id FROM public.prive_destinations WHERE slug = 'cdmx-roma-condesa') = public.t_dest('cdmx')
  AND public.prive_resolve_destination('La Condesa') = public.t_dest('cdmx-roma-condesa'));
SELECT public.t_ok('D3 Punta Mita en Riviera Nayarit; San José del Cabo en Los Cabos; Miami Beach en el Área de Miami',
  (SELECT parent_id FROM public.prive_destinations WHERE slug = 'punta-mita') = public.t_dest('riviera-nayarit')
  AND (SELECT parent_id FROM public.prive_destinations WHERE slug = 'san-jose-del-cabo') = public.t_dest('los-cabos')
  AND EXISTS (SELECT 1 FROM public.prive_destination_members WHERE area_id = public.t_dest('area-miami') AND destination_id = public.t_dest('miami-beach'))
  AND EXISTS (SELECT 1 FROM public.prive_destination_members WHERE area_id = public.t_dest('area-los-angeles') AND destination_id = public.t_dest('malibu'))
  AND EXISTS (SELECT 1 FROM public.prive_destination_members WHERE area_id = public.t_dest('area-cdmx') AND destination_id = public.t_dest('interlomas')));
SELECT public.t_ok('D4 Riviera Maya y Tulum son destinos distintos de Quintana Roo; Omán es país con Mascate',
  public.t_dest('riviera-maya') <> public.t_dest('tulum') AND (SELECT parent_id FROM public.prive_destinations WHERE slug = 'mascate') = public.t_dest('om'));
SELECT public.t_ok('D5 los 111 destinos de la lista del dueño, ninguno duplicado por nombre',
  (SELECT count(*) FROM public.prive_destinations WHERE is_destination) = 111
  AND NOT EXISTS (SELECT public.prive_norm(name_es) FROM public.prive_destinations WHERE is_destination GROUP BY 1 HAVING count(*) > 1));
SELECT public.t_ok('D6 todos nacen SIN COBERTURA VERIFICADA (sin contenido)',
  (SELECT bool_and(public.prive_destination_coverage(id)->>'level' = 'SIN_COBERTURA_VERIFICADA') FROM public.prive_destinations
    WHERE is_destination AND slug NOT IN ('mc','monaco-monte-carlo','capri')));
SELECT public.t_ok('D7 coordenadas: cada una con fuente; las que faltan dicen por qué',
  NOT EXISTS (SELECT 1 FROM public.prive_destinations WHERE is_destination AND kind <> 'country' AND lat IS NULL AND coord_note IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.prive_destinations WHERE lat IS NOT NULL AND coord_source !~ '^https://www.wikidata.org/'));
SELECT public.t_err('D8 un segundo alias "montecarlo" a otro destino', $q$INSERT INTO public.prive_destination_aliases(alias_norm, destination_id) VALUES ('montecarlo', public.t_dest('niza'))$q$, 'duplicate key');
SELECT public.t_err('D9 una segunda "Montecarlo" bajo Mónaco', $q$INSERT INTO public.prive_destinations(slug,kind,parent_id,name_es,name_en,iso_country) VALUES ('mc-dup','neighborhood',public.t_dest('mc'),'Montecarlo','Monte Carlo','MC')$q$, 'duplicate key');
SELECT public.t_err('D10 un barrio colgando de otro barrio', $q$INSERT INTO public.prive_destinations(slug,kind,parent_id,name_es,name_en,iso_country) VALUES ('mx-bad','neighborhood',public.t_dest('cdmx-polanco'),'Bad','Bad','MX')$q$, 'no puede colgar');
SELECT public.t_err('D11 experiencia colgada de un área', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name) VALUES ('area-x',public.t_dest('area-miami'),'the_table','xx','X')$q$, 'debe ser un destino');
SELECT public.t_err('D12 barrio que no es de ese destino', $q$INSERT INTO public.prive_experiences(slug,destination_id,neighborhood_id,universe,subcategory,name) VALUES ('mc-bad-n',public.t_dest('mc'),public.t_dest('cdmx-polanco'),'the_table','xx','X')$q$, 'no pertenece');
SELECT public.t_err('D13 duplicado por nombre en el mismo destino ("T Louis XV - Hôtel de Paris")', $q$INSERT INTO public.prive_experiences(slug,destination_id,universe,subcategory,name) VALUES ('mc-dup-louis',public.t_dest('mc'),'the_table','xx','The T Louis XV - Hôtel de Paris')$q$, 'prive_dedupe');

-- ───────────── 6. Cobertura calculada ─────────────
SELECT public.t_ok('C1 Mónaco con contenido VERIFICADO/CURADO vigente = COBERTURA PARCIAL', public.prive_destination_coverage(public.t_dest('mc'))->>'level' = 'COBERTURA_PARCIAL',
  public.prive_destination_coverage(public.t_dest('mc'))::text);
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at)
VALUES ('paris-t-old', public.t_dest('paris'), 'after_dark', 'bar', 'T Paris Old', 'https://example.test/p', '["https://example.test/p"]', 'x', 'VERIFICADO', now() - interval '120 days');
SELECT public.t_ok('C2 París solo con PENDIENTE (heredados) y DESACTUALIZADO = SIN COBERTURA VERIFICADA',
  public.prive_destination_coverage(public.t_dest('paris'))->>'level' = 'SIN_COBERTURA_VERIFICADA', public.prive_destination_coverage(public.t_dest('paris'))::text);
INSERT INTO public.prive_experiences (slug, destination_id, universe, subcategory, name, website, sources, why_fact_es, data_state, verified_at)
SELECT 'capri-t-' || g, public.t_dest('capri'), (ARRAY['the_table','yacht_sea','wellness_escape'])[1 + g % 3], 'xx', 'T Capri ' || g,
       'https://example.test/c' || g, '["https://example.test/c"]', 'x', 'VERIFICADO', now() - interval '3 days'
  FROM generate_series(1, 12) g;
SELECT public.t_ok('C3 12 VERIFICADO en 3 universos = PILOTO VERIFICADO', public.prive_destination_coverage(public.t_dest('capri'))->>'level' = 'PILOTO_VERIFICADO');
UPDATE public.prive_experiences SET data_state = 'CURADO' WHERE slug IN ('capri-t-1','capri-t-2','capri-t-3');
SELECT public.t_ok('C4 con 75% verificado baja a COBERTURA PARCIAL', public.prive_destination_coverage(public.t_dest('capri'))->>'level' = 'COBERTURA_PARCIAL');
SELECT public.t_ok('C5 el barrio Montecarlo cuenta lo suyo', public.prive_destination_coverage(public.t_dest('monaco-monte-carlo'))->>'level' = 'COBERTURA_PARCIAL');
SELECT public.t_ok('C6 la cobertura no es una columna que se pueda escribir a mano',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prive_destinations' AND column_name LIKE 'coverage%'));
RESET ROLE;

-- ───────────── 7. Contenido para el miembro ─────────────
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_err('M0a miembro sin token', $q$SELECT public.prive_destination(NULL, 'mc')$q$, 'PRIVE_NO_SESSION');
SELECT public.t_err('M0b miembro con token inventado', $q$SELECT public.prive_destination(repeat('x', 43), 'mc')$q$, 'PRIVE_SESSION_INVALID');
SELECT public.t_ok('M1 la página de Mónaco no muestra PENDIENTE ni el evento pasado',
  public.prive_destination(public.t_ps(), 'mc')::text !~ '(T Pending Club|T Past Gala)');
SELECT public.t_ok('M2 lo desactualizado aparece marcado DESACTUALIZADO',
  (SELECT x->>'state' FROM jsonb_array_elements(public.prive_destination(public.t_ps(), 'Monte Carlo')->'experiences') x WHERE x->>'slug' = 'mc-t-old-bar') IS NULL
  AND (SELECT x->>'state' FROM jsonb_array_elements(public.prive_destination(public.t_ps(), 'mc')->'experiences') x WHERE x->>'slug' = 'mc-t-old-bar') = 'DESACTUALIZADO');
SELECT public.t_ok('M3 sin declaración 18+ el casino no sale (solo el conteo)',
  public.prive_destination(public.t_ps(), 'mc')::text !~ 'T Casino' AND (public.prive_destination(public.t_ps(), 'mc')->>'age_locked_count')::int = 1);
SELECT public.t_ok('M4 declaración 18+ con la versión vigente', public.prive_confirm_adult(public.t_ps(), '2026-10-22'));
SELECT public.t_ok('M5 Iato no recomienda casino si no se pidió', public.prive_search(public.t_ps(), ARRAY['Montecarlo'])::text !~ 'T Casino');
SELECT public.t_ok('M6 Iato: casino legal solo si se pidió, con licencia y edad',
  (SELECT x->'license'->>'authority' FROM jsonb_array_elements(public.prive_search(public.t_ps(), ARRAY['Mónaco'], ARRAY['casino_grand_nights'])->'cities'->0->'items') x LIMIT 1) = 'Autoridad de prueba');
SELECT public.t_ok('M7 Iato excluye DESACTUALIZADO, PENDIENTE y NO DISPONIBLE',
  public.prive_search(public.t_ps(), ARRAY['Mónaco'], ARRAY['after_dark','iconic_events'])::text !~ '(T Old Bar|T Pending|T Past Gala)');
SELECT public.t_ok('M8 ciudad sin cobertura: dice SIN COBERTURA y no inventa nada',
  (SELECT x->>'coverage' = 'SIN_COBERTURA_VERIFICADA' AND jsonb_array_length(x->'items') = 0
     FROM jsonb_array_elements(public.prive_search(public.t_ps(), ARRAY['Atlantis'])->'cities') x));
SELECT public.t_ok('M9 búsqueda por palabra clave (beach club) encuentra el club de playa con su temporada',
  (SELECT x->'season'->>'state' FROM jsonb_array_elements(public.prive_search(public.t_ps(), ARRAY['Mónaco'], NULL, ARRAY['beach club'])->'cities'->0->'items') x
    WHERE x->>'slug' = 'mc-t-beach') = 'cerrado_por_temporada');
SELECT public.t_ok('M10 ficha: precio y horario solo con su fuente',
  (public.prive_experience(public.t_ps(), 'mc-t-louis-xv')->'experience'->'price'->>'source') = 'https://example.test/louis/menu'
  AND (public.prive_experience(public.t_ps(), 'mc-t-yacht')->'experience'->'price') IS NULL
  AND (public.prive_experience(public.t_ps(), 'mc-t-yacht')->'experience'->'opening_hours') IS NULL);
SELECT public.t_ok('M11 una experiencia PENDIENTE no existe para el miembro', (public.prive_experience(public.t_ps(), 'mc-t-pending')->>'found')::boolean = false);
SELECT public.t_ok('M12a guardar', (public.prive_save(public.t_ps(), 'e0000000-0000-0000-0000-000000000003')->>'ok')::boolean);
-- (cada verificación de estado va en su propia sentencia: una sentencia no ve lo que escribió su propia función)
SELECT public.t_ok('M12b el guardado queda en Favoritos (recomendaciones)', EXISTS (SELECT 1 FROM public.recomendaciones WHERE experience_id = 'e0000000-0000-0000-0000-000000000003' AND guardado));
SELECT public.t_err('M13 el cliente no fabrica guardados de Privé', $q$INSERT INTO public.recomendaciones(user_id, tipo, titulo, experience_id) VALUES ('c0000000-0000-0000-0000-0000000000a1','prive','x','e0000000-0000-0000-0000-000000000001')$q$, 'prive_save');
SELECT public.t_ok('M14 agregar al viaje crea elementos NO confirmados en el viaje',
  (public.prive_add_to_trip(public.t_ps(), 'c0000000-0000-0000-0000-00000000aa01',
     '[{"experience_id":"e0000000-0000-0000-0000-000000000001","start_at":"2026-11-12T20:00:00+01:00"},{"experience_id":"e0000000-0000-0000-0000-000000000006"}]')->>'added')::int = 1);
SELECT public.t_ok('M14b en el viaje quedan como pendientes, sin folio (no reservados)', (SELECT bool_and(status = 'pending' AND confirmation_code IS NULL AND provider = 'iatos_prive') FROM public.bookings WHERE trip_id = 'c0000000-0000-0000-0000-00000000aa01'));
SELECT public.t_ok('M15 la ficha trae la evidencia de la etiqueta y el crédito de imagen ilustrativa',
  (public.prive_experience(public.t_ps(), 'mc-t-yacht')->'experience'->'label_evidence'->>'operator') = 'T Yacht Charter SARL'
  AND (public.prive_experience(public.t_ps(), 'mc-t-yacht')->'experience'->'image'->>'illustrative')::boolean);
SELECT public.t_ok('M16a sin consentimiento de Travel DNA no se usan preferencias',
  (SELECT x->'score'->'reasons' FROM jsonb_array_elements(public.prive_destination(public.t_ps(), 'mc')->'experiences') x WHERE x->>'slug' = 'mc-t-louis-xv')::text !~ 'dna:');
RESET ROLE;
INSERT INTO public.ai_user_preferences (user_id, estilo_comida) VALUES ('c0000000-0000-0000-0000-0000000000a1', '{michelin}')
  ON CONFLICT (user_id) DO UPDATE SET estilo_comida = '{michelin}';
UPDATE public.prive_memberships SET onboarding = coalesce(onboarding, '{}'::jsonb) || '{"dna_consent": true}' WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';
SET ROLE authenticated;
SELECT public.t_ok('M16b con consentimiento, el gusto Michelin sube The Table (razón dna:the_table)',
  (SELECT x->'score'->'reasons' FROM jsonb_array_elements(public.prive_destination(public.t_ps(), 'mc')->'experiences') x WHERE x->>'slug' = 'mc-t-louis-xv')::text ~ 'dna:the_table');
SELECT public.t_ok('M16 prive_track ignora eventos que solo escribe el servidor', public.prive_track(public.t_ps(), 'request_confirmed') = false);

-- ───────────── 8. Solicitudes: transiciones solo del servidor ─────────────
SELECT public.t_ok('R1 solicitar crea "solicitado"', (SELECT (j->>'status') = 'solicitado' FROM (SELECT public.prive_request_create(public.t_ps(),
  'e0000000-0000-0000-0000-000000000003', now() + interval '20 days', 2, 'Atardecer', 'app', 'c0000000-0000-0000-0000-00000000aa01') j) t));
SELECT public.t_ok('R2 no se puede solicitar algo PENDIENTE', (public.prive_request_create(public.t_ps(), 'e0000000-0000-0000-0000-000000000006')->>'code') = 'EXPERIENCE_UNAVAILABLE');
SELECT public.t_err('R3 el usuario no cambia el estado directo', $q$UPDATE public.concierge_requests SET status='confirmado_externamente' WHERE type='prive_request'$q$, 'permission denied');
SELECT public.t_err('R4 el usuario no inserta una solicitud confirmada', $q$INSERT INTO public.concierge_requests(user_id,type,title,status,experience_id) VALUES ('c0000000-0000-0000-0000-0000000000a1','prive_request','x','confirmado_externamente','e0000000-0000-0000-0000-000000000003')$q$, 'permission denied');
SELECT public.t_err('R5 el usuario no es el equipo', $q$SELECT public.prive_request_transition((SELECT id FROM public.concierge_requests WHERE type='prive_request' LIMIT 1), 'pendiente_confirmacion')$q$, 'solo el equipo');
SELECT public.t_ok('R6 lo no confirmado nunca se muestra como confirmado',
  (SELECT bool_and(NOT (x->>'is_confirmed')::boolean AND x->>'label' IS NULL AND x->>'status_text' ~ 'aún no es una reserva') FROM jsonb_array_elements(public.prive_my_requests()) x));
RESET ROLE;
SET ROLE service_role; SELECT set_config('request.jwt.claim.role', 'service_role', false); SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.t_err('R7 ni con llave de servicio se cambia el estado sin la función', $q$UPDATE public.concierge_requests SET status='pendiente_confirmacion' WHERE type='prive_request'$q$, 'solo cambia con');
SELECT public.t_ok('R8 transición ilegal (solicitado → confirmado) rechazada',
  (public.prive_request_transition((SELECT id FROM public.concierge_requests WHERE type = 'prive_request' LIMIT 1), 'confirmado_externamente')->>'code') = 'ILLEGAL_TRANSITION');
SELECT public.t_ok('R9 solicitado → pendiente de confirmación', (public.prive_request_transition((SELECT id FROM public.concierge_requests WHERE type = 'prive_request' LIMIT 1),
  'pendiente_confirmacion', 'Enviada al operador')->>'status') = 'pendiente_confirmacion');
SELECT public.t_err('R10 confirmar sin evidencia', $q$SELECT public.prive_request_transition((SELECT id FROM public.concierge_requests WHERE type='prive_request' LIMIT 1), 'confirmado_externamente', 'x', '{"confirmed_by":"Ana"}')$q$, 'prive_confirm_has_evidence');
SELECT public.t_ok('R11 confirmar con evidencia', (public.prive_request_transition((SELECT id FROM public.concierge_requests WHERE type = 'prive_request' LIMIT 1),
  'confirmado_externamente', 'Confirmado por correo', '{"confirmed_by":"Operador T","confirmed_at":"2026-10-22T10:00:00Z","confirmation_code":"ABC123","channel":"email"}')->>'status') = 'confirmado_externamente');
SELECT public.t_ok('R12 la constancia confirmada existe en bookings con folio',
  EXISTS (SELECT 1 FROM public.bookings WHERE status = 'confirmed' AND confirmation_code = 'ABC123' AND provider = 'iatos_prive'));
SELECT public.t_ok('R13 historial con actor en cada paso',
  (SELECT string_agg(coalesce(from_status, '∅') || '>' || to_status || ':' || actor, ',' ORDER BY id) FROM public.concierge_request_events)
   = '∅>solicitado:usuario,solicitado>pendiente_confirmacion:equipo,pendiente_confirmacion>confirmado_externamente:equipo',
  (SELECT string_agg(coalesce(from_status, '∅') || '>' || to_status || ':' || actor, ',' ORDER BY id) FROM public.concierge_request_events));
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_ok('R14 la confirmada sí se ve confirmada, con ACCESO CONFIRMADO y folio',
  (SELECT (x->>'is_confirmed')::boolean AND x->>'label' = 'ACCESO_CONFIRMADO' AND x->>'confirmation_code' = 'ABC123' FROM jsonb_array_elements(public.prive_my_requests()) x LIMIT 1));
SELECT public.t_ok('R15a nueva solicitud', (public.prive_request_create(public.t_ps(), 'e0000000-0000-0000-0000-000000000001')->>'ok')::boolean);
SELECT public.t_ok('R15b la nueva sigue "aún no es una reserva"', (SELECT count(*) FROM jsonb_array_elements(public.prive_my_requests()) x WHERE NOT (x->>'is_confirmed')::boolean AND x->>'status_text' ~ 'aún no es una reserva') = 1);
SELECT public.t_ok('R16a el usuario cancela la suya',
  (public.prive_request_cancel((SELECT id FROM public.concierge_requests WHERE status = 'confirmado_externamente' LIMIT 1))->>'status') = 'cancelado');
SELECT public.t_ok('R16b la constancia queda cancelada', NOT EXISTS (SELECT 1 FROM public.bookings WHERE confirmation_code = 'ABC123' AND status = 'confirmed'));
SELECT public.t_ok('R17 una cancelada no se puede volver a cancelar', (public.prive_request_cancel((SELECT id FROM public.concierge_requests WHERE status = 'cancelado' LIMIT 1))->>'code') = 'NOT_CANCELLABLE');
RESET ROLE;

-- ───────────── 9. Carga de curaduría: duplicados en la jerarquía y etiquetas ─────────────
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT public.t_ok('I1 un lugar ya cargado en Los Cabos no se duplica en San José del Cabo (misma familia)',
  (SELECT (j->'rejected'->0->>'reason') ~ 'jerarquía' FROM (SELECT public.prive_import_batch(
     '[{"destination_slug":"los-cabos","slug":"los-cabos-t-cocina","universe":"the_table","subcategory":"autor","name":"T Cocina de Autor","data_state":"PENDIENTE"},
       {"destination_slug":"san-jose-del-cabo","slug":"sjd-t-cocina","universe":"the_table","subcategory":"autor","name":"T Cocina de Autor","data_state":"PENDIENTE"}]'::jsonb,
     'prueba_familia', true) j) t));
SELECT public.t_ok('I2 el cargador no puede poner PARTNER VERIFICADO',
  (SELECT (j->'rejected'->0->>'reason') ~ 'etiquetas de socio' FROM (SELECT public.prive_import_batch(
     '[{"destination_slug":"mc","slug":"mc-t-x","universe":"the_table","subcategory":"autor","name":"T Socio","data_state":"PENDIENTE","commercial_label":"PARTNER_VERIFICADO"}]'::jsonb,
     'prueba_label', true) j) t));
SELECT public.t_ok('I3 el ensayo (dry run) no deja nada escrito', NOT EXISTS (SELECT 1 FROM public.prive_experiences WHERE import_batch IN ('prueba_familia','prueba_label')));
SELECT set_config('request.jwt.claim.role', '', false);

-- ───────────── 10. Heredados ─────────────
SELECT public.t_ok('H1 los lugares heredados entran PENDIENTE y ocultos', (SELECT count(*) FROM public.prive_experiences WHERE import_batch = 'legacy_nightlife_premium' AND data_state <> 'PENDIENTE') = 0
  AND (SELECT count(*) FROM public.prive_experiences WHERE import_batch = 'legacy_nightlife_premium') >= 28);
SELECT public.t_ok('H2 nightlife_premium no se tocó', (SELECT count(*) FROM public.nightlife_premium) >= 28);

-- ───────────── 11. Métricas ─────────────
SELECT public.t_ok('X1 las métricas no guardan texto libre', NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name = 'prive_events' AND column_name NOT IN ('id','user_id','event','experience_id','destination_id','trip_id','surface','plan','created_at')));
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000a3', false);
SELECT public.t_ok('X2 el equipo ve confirmadas con evidencia', (public.admin_prive_metrics(30)->>'requests')::int = 2);
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_err('X3 un usuario no ve el panel', $q$SELECT public.admin_prive_metrics(30)$q$, 'solo el equipo');
RESET ROLE;
