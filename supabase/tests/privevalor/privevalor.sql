-- Pruebas SQL de privevalor. Imprime "OK …" o "FALLA …". Lo corre run.sh sobre una base desechable con
-- TODAS las migraciones (incluida la siembra verificada 20261024100400).
-- Personas: U1 y U2 miembros Privé con sesión (U2 sirve para probar fugas entre cuentas), U3 cuenta
-- gratis, U4 PRO con 30 días pagados (aún no elegible), U5 equipo (admins).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

DROP SCHEMA IF EXISTS pv CASCADE;
CREATE SCHEMA pv;
GRANT USAGE ON SCHEMA pv TO anon, authenticated, service_role;
CREATE TABLE pv.tokens (n int PRIMARY KEY, token text NOT NULL);
CREATE FUNCTION pv.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pv.ps(n int) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT token FROM pv.tokens WHERE tokens.n = ps.n $$;
CREATE FUNCTION pv.ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK %', _label; ELSE RAISE NOTICE 'FALLA % %', _label, coalesce(_detail, ''); END IF;
END $$;
CREATE FUNCTION pv.err(_label text, _sql text, _expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RAISE NOTICE 'FALLA % (no hubo error)', _label;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ~* _expect THEN RAISE NOTICE 'OK % [%]', _label, left(SQLERRM, 80);
  ELSE RAISE NOTICE 'FALLA % (error inesperado: %)', _label, SQLERRM; END IF;
END $$;
-- Comprobación del lado del servidor (lee tablas que authenticated no puede leer).
CREATE FUNCTION pv.sq(_sql text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v boolean; BEGIN EXECUTE _sql INTO v; RETURN v; END $$;
CREATE FUNCTION pv.sid(_sql text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid; BEGIN EXECUTE _sql INTO v; RETURN v; END $$;
-- Contexto de PostgREST para la persona n (NULL = sin sesión).
CREATE FUNCTION pv.login(n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', CASE WHEN n IS NULL THEN '' ELSE pv.u(n)::text END, false),
         set_config('request.jwt.claim.role', 'authenticated', false),
         set_config('request.jwt.claims', CASE WHEN n IS NULL THEN '{}' ELSE jsonb_build_object('sub', pv.u(n), 'role', 'authenticated')::text END, false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pv TO anon, authenticated, service_role;

-- ───────────── Personas y datos de prueba (como servidor) ─────────────
INSERT INTO auth.users (id, email) SELECT pv.u(n), 'pval' || n || '@example.test' FROM generate_series(1, 5) n ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) SELECT pv.u(n), 'Persona ' || n, 'pval' || n || '@example.test' FROM generate_series(1, 5) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.admins (user_id) VALUES (pv.u(5)) ON CONFLICT DO NOTHING;
DO $$
DECLARE r jsonb; pw text := 'Valor de prueba Prive 2026'; k int;
BEGIN
  FOREACH k IN ARRAY ARRAY[1, 2, 4] LOOP
    INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
    VALUES (pv.u(k), 'active', 'sub_pv' || k, 'cus_pv' || k, now() + interval '20 days')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  END LOOP;
  PERFORM public.prive_record_paid_period(pv.u(4), 'in_pv_4', 'sub_pv4', 'cus_pv4', now() - interval '30 days', now() - interval '1 day', 19900, 'mxn', 'test');
  FOREACH k IN ARRAY ARRAY[1, 2] LOOP
    PERFORM public.prive_record_paid_period(pv.u(k), 'in_pv_' || k, 'sub_pv' || k, 'cus_pv' || k, now() - interval '120 days', now() - interval '1 day', 19900, 'mxn', 'test');
    PERFORM public.prive_invite_user(pv.u(k), 'tenure', 'system');
    r := public.prive_accept_invitation(pv.u(k), NULL);
    r := public.prive_set_password(pv.u(k), pw, 'ok');
    r := public.prive_unlock(pv.u(k), pw, NULL, NULL);
    IF r->>'token' IS NULL THEN RAISE NOTICE 'FALLA SETUP sin sesión Privé para U%: %', k, r; END IF;
    INSERT INTO pv.tokens VALUES (k, r->>'token') ON CONFLICT (n) DO UPDATE SET token = EXCLUDED.token;
  END LOOP;
END $$;
-- U1: viaje a París en 10 días; Bóveda con Marriott (con número de socio, que NUNCA debe salir) y una tarjeta.
INSERT INTO public.trips (id, user_id, destino, fecha_salida, fecha_regreso)
VALUES ('d0000000-0000-0000-0000-0000000000f1', pv.u(1), 'París, Francia', current_date + 10, current_date + 15),
       ('d0000000-0000-0000-0000-0000000000f2', pv.u(2), 'Tokio', current_date + 40, current_date + 50) ON CONFLICT DO NOTHING;
INSERT INTO public.user_vault_benefits (user_id, credit_cards, hotel_loyalty, airline_alliances)
VALUES (pv.u(1), '[{"bank":"Banco Prueba","card_name":"Platinum Viajero","card_tier":"Platinum","perks_enabled":["salas"]}]',
        '[{"chain_name":"Marriott Bonvoy","member_id":"987654321","status_tier":"Gold Elite","room_preferences":""}]',
        '[{"airline":"Aerolínea Prueba","alliance_name":"SkyTeam","membership_number":"AB123456","tier_status":"Gold","seat_preference":""}]')
ON CONFLICT (user_id) DO NOTHING;

-- Drops de prueba (como servidor): vencido, programado, sin revisar en 60 días y retirado.
INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, destination_id, benefit_es, conditions_es, eligibility_es,
  valid_from, valid_until, source_url, link_url, last_verified_at, verified_by, curation_status)
VALUES
 ('pv-vencido', 'oferta_temporal', 'Oferta de prueba vencida', 'Proveedor Prueba', public.prive_resolve_destination('paris'), 'Beneficio de prueba',
  'Condiciones de prueba', 'Todos', current_date - 20, current_date - 2, 'https://example.test/a', 'https://example.test/a', now(), 'test', 'activo'),
 ('pv-programado', 'oferta_temporal', 'Oferta de prueba futura', 'Proveedor Prueba', public.prive_resolve_destination('paris'), 'Beneficio de prueba',
  'Condiciones de prueba', 'Todos', current_date + 5, current_date + 30, 'https://example.test/b', 'https://example.test/b', now(), 'test', 'activo'),
 ('pv-viejo', 'promocion_publica', 'Promoción de prueba sin revisar', 'Proveedor Prueba', public.prive_resolve_destination('paris'), 'Beneficio de prueba',
  'Condiciones de prueba', 'Todos', NULL, NULL, 'https://example.test/c', 'https://example.test/c', now() - interval '60 days', 'test', 'activo'),
 ('pv-retirado', 'promocion_publica', 'Promoción de prueba retirada', 'Proveedor Prueba', NULL, 'Beneficio de prueba',
  'Condiciones de prueba', 'Todos', NULL, NULL, 'https://example.test/d', 'https://example.test/d', now(), 'test', 'retirado');
-- Consejo vencido (no debe aparecer) para París.
INSERT INTO public.prive_insider_tips (slug, destination_id, category, title_es, body_es, before_you_go, rank, valid_until, source_url,
  source_name, source_checked_at, verified_by)
VALUES ('pv-tip-vencido', public.prive_resolve_destination('paris'), 'errores', 'Consejo vencido de prueba', 'Este consejo ya venció y no debe salir.',
  true, 1, current_date - 1, 'https://example.test/t', 'Prueba', current_date - 3, 'test');

-- ═════════════ 1. Acceso: solo miembros con sesión Privé; nada directo ═════════════
SELECT pv.login(3); SET ROLE authenticated;
SELECT pv.err('A01 cuenta gratis: prive_drops', $q$SELECT public.prive_drops(NULL)$q$, 'PRIVE_');
SELECT pv.err('A02 cuenta gratis con token de otra persona', $q$SELECT public.prive_drops(pv.ps(1))$q$, 'PRIVE_');
SELECT pv.err('A03 cuenta gratis: prive_drop', $q$SELECT public.prive_drop('x', 'louvre-primer-viernes-gratis')$q$, 'PRIVE_');
SELECT pv.err('A04 cuenta gratis: radar', $q$SELECT public.prive_radar(NULL)$q$, 'PRIVE_');
SELECT pv.err('A05 cuenta gratis: valor', $q$SELECT public.prive_value_summary(NULL)$q$, 'PRIVE_');
SELECT pv.err('A06 cuenta gratis: insider', $q$SELECT public.prive_insider(NULL, 'paris')$q$, 'PRIVE_');
SELECT pv.err('A07 cuenta gratis: índice del insider', $q$SELECT public.prive_insider_index(NULL)$q$, 'PRIVE_');
SELECT pv.err('A08 cuenta gratis: before you go', $q$SELECT public.prive_before_you_go(NULL)$q$, 'PRIVE_');
SELECT pv.err('A09 cuenta gratis: pasaporte', $q$SELECT public.prive_passport(NULL)$q$, 'PRIVE_');
SELECT pv.err('A10 cuenta gratis: escribir pasaporte', $q$SELECT public.prive_passport_save(NULL, '{"kind":"deseo","title":"X","place":"Roma"}')$q$, 'PRIVE_');
SELECT pv.err('A11 cuenta gratis: tracking Privé', $q$SELECT public.prive_value_track(NULL, 'drops_view')$q$, 'PRIVE_');
SELECT pv.err('A12 lectura directa de prive_drops', $q$SELECT count(*) FROM public.prive_drops$q$, 'permission denied');
SELECT pv.err('A13 lectura directa de prive_drops_v', $q$SELECT count(*) FROM public.prive_drops_v$q$, 'permission denied');
SELECT pv.err('A14 lectura directa de prive_drops_live (API del servidor de edition)', $q$SELECT count(*) FROM public.prive_drops_live$q$, 'permission denied');
SELECT pv.err('A15 lectura directa de consejos', $q$SELECT count(*) FROM public.prive_insider_tips$q$, 'permission denied');
SELECT pv.err('A16 lectura directa del radar', $q$SELECT count(*) FROM public.prive_radar_items$q$, 'permission denied');
SELECT pv.err('A17 lectura directa del valor', $q$SELECT count(*) FROM public.prive_value_entries$q$, 'permission denied');
SELECT pv.err('A18 lectura directa del pasaporte', $q$SELECT count(*) FROM public.prive_passport_entries$q$, 'permission denied');
SELECT pv.err('A19 lectura directa de eventos', $q$SELECT count(*) FROM public.prive_value_events$q$, 'permission denied');
SELECT pv.err('A20 escritura directa de un Drop', $q$INSERT INTO public.prive_drops (slug) VALUES ('x-x-x')$q$, 'permission denied');
SELECT pv.err('A21 el importador de Drops es solo del servidor', $q$SELECT public.prive_drops_import_batch('[]', 'x', true)$q$, 'permission denied|solo el servidor');
SELECT pv.err('A22 el importador del Insider es solo del servidor', $q$SELECT public.prive_insider_import_batch('[]', 'x', true)$q$, 'permission denied|solo el servidor');
SELECT pv.err('A23 métricas: solo el equipo', $q$SELECT public.admin_prive_product_metrics(30)$q$, 'solo el equipo');
-- La vista previa (antes del día 90) sí registra su evento sin sesión Privé, y solo ese.
SELECT pv.ok('A24 vista previa: registra preview_view sin sesión Privé', public.prive_preview_track('preview_view'));
SELECT pv.ok('A25 vista previa: no acepta otros eventos', NOT public.prive_preview_track('drop_open'));
RESET ROLE;
SELECT pv.login(4); SET ROLE authenticated;
SELECT pv.err('A26 PRO con 30 días: aún no elegible', $q$SELECT public.prive_drops(NULL)$q$, 'PRIVE_');
RESET ROLE;
SET ROLE anon; SELECT pv.login(NULL);
SELECT pv.err('A27 anon no ejecuta prive_drops', $q$SELECT public.prive_drops('x')$q$, 'permission denied');
SELECT pv.err('A28 anon no ejecuta la vista previa', $q$SELECT public.prive_preview_track('preview_view')$q$, 'permission denied');
RESET ROLE;

-- ═════════════ 2. Reglas de honestidad de Privé Drops (la base las impone) ═════════════
SELECT pv.err('D01 porcentaje en el título sin comparación', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d01','oferta_temporal','40% en tu hotel','Proveedor','Beneficio','C','E','https://a.test','https://a.test',now(),'test')$q$, 'porcentaje');
SELECT pv.err('D02 porcentaje que no cuadra con los precios', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, offer_price, reference_price, price_currency, price_source_url, discount_pct, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d02','oferta_temporal','Tarifa','Proveedor','Beneficio','C','E',80,100,'EUR','https://a.test',40,'https://a.test','https://a.test',now(),'test')$q$, 'no cuadra');
SELECT pv.err('D03 precio "antes" inventado sin precio actual', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, reference_price, price_currency, price_source_url, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d03','oferta_temporal','Tarifa','Proveedor','Beneficio','C','E',100,'EUR','https://a.test','https://a.test','https://a.test',now(),'test')$q$, 'antes');
SELECT pv.err('D04 precio sin fuente', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, offer_price, price_currency, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d04','tarifa_publicada','Tarifa','Proveedor','Beneficio','C','E',100,'EUR','https://a.test','https://a.test',now(),'test')$q$, 'moneda y fuente');
SELECT pv.err('D05 escasez falsa', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d05','oferta_temporal','Solo quedan 3 suites','Proveedor','Beneficio','C','E','https://a.test','https://a.test',now(),'test')$q$, 'escasez');
SELECT pv.err('D06 escasez falsa en inglés', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, title_en, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d06','oferta_temporal','Tarifa','Last chance: only 2 left','Proveedor','Beneficio','C','E','https://a.test','https://a.test',now(),'test')$q$, 'escasez');
SELECT pv.err('D07 sin condiciones ni elegibilidad', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d07','promocion_publica','Promo','Proveedor','Beneficio','https://a.test','https://a.test',now(),'test')$q$, 'condiciones y elegibilidad');
SELECT pv.err('D08 fuente que no es https', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d08','editorial','Editorial','Proveedor','Beneficio','http://a.test','https://a.test',now(),'test')$q$, 'prive_drops_source_url_check');
SELECT pv.err('D09 número de tarjeta en el texto', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d09','promocion_publica','Promo','Proveedor','Paga con 4111 1111 1111 1111','C','E','https://a.test','https://a.test',now(),'test')$q$, 'tarjeta');
SELECT pv.err('D10 beneficio de tarjeta sin decir a qué tarjeta aplica', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by) VALUES ('pv-d10','beneficio_tarjeta','Sala VIP','Proveedor','Acceso a salas','C','E','https://a.test','https://a.test',now(),'test')$q$, 'tarjeta');
SELECT pv.err('D11 beneficio IATOS sin el registro de alianzas', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by, commercial_relationship) VALUES ('pv-d11','beneficio_iatos','Exclusivo IATOS','Proveedor','Upgrade','C','E','https://a.test','https://a.test',now(),'test','convenio')$q$, 'registro de alianzas');
SELECT pv.err('D12 "convenio" declarado en una promoción pública', $q$INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at, verified_by, commercial_relationship) VALUES ('pv-d12','promocion_publica','Promo','Proveedor','Beneficio','C','E','https://a.test','https://a.test',now(),'test','convenio')$q$, 'convenio');
INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, offer_price, reference_price,
  price_currency, price_source_url, discount_pct, source_url, link_url, last_verified_at, verified_by, destination_id)
VALUES ('pv-d13', 'tarifa_publicada', 'Tarifa de temporada baja publicada', 'Proveedor Prueba', 'Tarifa publicada por el proveedor: 25 % menos que su tarifa estándar',
  'Según el sitio', 'Todos', 300, 400, 'EUR', 'https://example.test/precios', 25, 'https://example.test/precios', 'https://example.test/precios', now(), 'test',
  public.prive_resolve_destination('mc'));
SELECT pv.ok('D13 un porcentaje SÍ se acepta con comparación verificable y cuadrada', EXISTS (SELECT 1 FROM public.prive_drops WHERE slug = 'pv-d13'));
SELECT pv.ok('D14 normaliza program_match (sin acentos ni mayúsculas)',
  (SELECT program_match FROM public.prive_drops WHERE slug = 'my-monte-carlo-entrada-casino') @> ARRAY['my monte carlo']);

-- Estado calculado y vencimiento automático.
SELECT pv.ok('E01 vencido al pasar valid_until', (SELECT effective_status FROM public.prive_drops_v WHERE slug = 'pv-vencido') = 'vencido');
SELECT pv.ok('E02 programado antes de valid_from', (SELECT effective_status FROM public.prive_drops_v WHERE slug = 'pv-programado') = 'programado');
SELECT pv.ok('E03 por verificar a los 45 días sin revisión', (SELECT effective_status FROM public.prive_drops_v WHERE slug = 'pv-viejo') = 'por_verificar');
SELECT pv.ok('E04 retirado no se publica', (SELECT effective_status FROM public.prive_drops_v WHERE slug = 'pv-retirado') = 'retirado');
SELECT pv.ok('E05 la siembra verificada está activa', (SELECT count(*) FROM public.prive_drops_v WHERE import_batch = 'valor-2026-10' AND effective_status = 'activo') = 9);
SELECT pv.ok('E06 la vista para edition solo trae lo publicable',
  NOT EXISTS (SELECT 1 FROM public.prive_drops_live WHERE slug IN ('pv-vencido','pv-programado','pv-retirado'))
  AND EXISTS (SELECT 1 FROM public.prive_drops_live WHERE slug = 'pv-viejo' AND effective_status = 'por_verificar'));
-- Beneficio IATOS: con acuerdo en borrador NO aparece; con acuerdo firmado y vigente, sí.
INSERT INTO public.prive_partners (id, legal_name, iatos_owner_admin_id) VALUES ('d0000000-0000-0000-0000-00000000aa01', 'Socio de Prueba SA', pv.u(5)) ON CONFLICT DO NOTHING;
INSERT INTO public.prive_partner_agreements (id, partner_id, tier, status) VALUES ('d0000000-0000-0000-0000-00000000aa02', 'd0000000-0000-0000-0000-00000000aa01', 'socio_beneficio', 'borrador') ON CONFLICT DO NOTHING;
INSERT INTO public.prive_partner_benefits (id, agreement_id, benefit_es, conditions_es, clause_ref)
VALUES ('d0000000-0000-0000-0000-00000000aa03', 'd0000000-0000-0000-0000-00000000aa02', 'Texto literal del contrato de prueba', 'Condiciones del contrato', 'Cláusula 3') ON CONFLICT DO NOTHING;
INSERT INTO public.prive_drops (slug, drop_type, title_es, provider_name, benefit_es, conditions_es, eligibility_es, source_url, link_url, last_verified_at,
  verified_by, commercial_relationship, partner_benefit_id)
VALUES ('pv-iatos', 'beneficio_iatos', 'Beneficio IATOS de prueba', 'Socio de Prueba', 'Texto que NO debe mostrarse', 'C', 'Miembros Privé',
  'https://example.test/contrato', 'https://example.test/socio', now(), 'test', 'convenio', 'd0000000-0000-0000-0000-00000000aa03');
SELECT pv.ok('E07 beneficio IATOS con acuerdo en borrador: no se publica', (SELECT effective_status FROM public.prive_drops_v WHERE slug = 'pv-iatos') = 'retirado');
SELECT pv.ok('E08 hoy no hay beneficios IATOS publicables en la siembra', NOT EXISTS (SELECT 1 FROM public.prive_drops_live WHERE drop_type = 'beneficio_iatos'));

-- Importador: ensayo no escribe; rechaza filas malas con motivo; nunca crea beneficios IATOS.
SELECT pv.ok('I01 ensayo: reporta y no escribe',
  (public.prive_drops_import_batch('[{"slug":"pv-imp-1","type":"editorial","title_es":"Editorial de prueba","provider_name":"Proveedor","benefit_es":"Contenido editorial","source_url":"https://a.test","link_url":"https://a.test","last_verified_at":"2026-10-22T00:00:00Z","verified_by":"test-runner"}]', 'pv-test', true)->>'inserted')::int = 1
  AND NOT EXISTS (SELECT 1 FROM public.prive_drops WHERE slug = 'pv-imp-1'));
SELECT pv.ok('I02 rechaza beneficio IATOS, porcentaje sin comparación y destino inexistente; acepta el bueno',
  (SELECT jsonb_array_length(r->'rejected') = 3 AND (r->>'inserted')::int = 1 AND r::text ~ 'registro de alianzas' AND r::text ~ 'porcentaje' AND r::text ~ 'no está en el catálogo'
     FROM (SELECT public.prive_drops_import_batch('[
       {"slug":"pv-imp-2","type":"beneficio_iatos","title_es":"Exclusivo","provider_name":"Proveedor","benefit_es":"Beneficio de prueba","conditions_es":"C","eligibility_es":"E","source_url":"https://a.test","link_url":"https://a.test","last_verified_at":"2026-10-22T00:00:00Z","verified_by":"test-runner"},
       {"slug":"pv-imp-3","type":"oferta_temporal","title_es":"Hasta 50% en suites","provider_name":"Proveedor","benefit_es":"Beneficio de prueba","conditions_es":"C","eligibility_es":"E","source_url":"https://a.test","link_url":"https://a.test","last_verified_at":"2026-10-22T00:00:00Z","verified_by":"test-runner"},
       {"slug":"pv-imp-4","type":"promocion_publica","destination_slug":"atlantida","title_es":"Promo","provider_name":"Proveedor","benefit_es":"Beneficio de prueba","conditions_es":"C","eligibility_es":"E","source_url":"https://a.test","link_url":"https://a.test","last_verified_at":"2026-10-22T00:00:00Z","verified_by":"test-runner"},
       {"slug":"pv-imp-5","type":"promocion_publica","destination_slug":"Monte Carlo","title_es":"Promo de prueba","provider_name":"Proveedor","benefit_es":"Beneficio de prueba","conditions_es":"C","eligibility_es":"E","source_url":"https://a.test","link_url":"https://a.test","last_verified_at":"2026-10-22T00:00:00Z","verified_by":"test-runner"}]', 'pv-test', false) AS r) q));
SELECT pv.ok('I03 alias de destino ("Monte Carlo") resuelto por el catálogo',
  (SELECT d.slug FROM public.prive_drops x JOIN public.prive_destinations d ON d.id = x.destination_id WHERE x.slug = 'pv-imp-5') = 'monaco-monte-carlo');
SELECT pv.ok('I04 la siembra es idempotente: re-aplicarla no duplica', (SELECT count(*) FROM public.prive_drops WHERE import_batch = 'valor-2026-10') = 9
  AND (SELECT count(*) FROM public.prive_insider_tips WHERE import_batch = 'valor-2026-10') = 20);

-- ═════════════ 3. Drops para el miembro: relevancia honesta y vencimiento ═════════════
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('M01 el miembro ve Drops publicables', jsonb_array_length(public.prive_drops(pv.ps(1))->'items') >= 9);
SELECT pv.ok('M02 nunca ve vencidos, programados, retirados ni IATOS sin acuerdo',
  public.prive_drops(pv.ps(1))::text !~ '"slug": "pv-(vencido|programado|retirado|iatos)"');
SELECT pv.ok('M03 dice cuántos vencieron recientemente (honestidad)', (public.prive_drops(pv.ps(1), 'paris')->>'expired_recent')::int >= 1);
SELECT pv.ok('M04 su viaje a París pone primero el Louvre, con razón "viaje"',
  (SELECT x->>'slug' = 'louvre-primer-viernes-gratis' AND x->'reasons' ? 'viaje' FROM jsonb_array_elements(public.prive_drops(pv.ps(1), 'paris')->'items') WITH ORDINALITY a(x, i) WHERE i = 1));
SELECT pv.ok('M05 Marriott en su Bóveda: razón "boveda" en los Drops de Marriott',
  (SELECT bool_and(x->'reasons' ? 'boveda') FROM jsonb_array_elements(public.prive_drops(pv.ps(1))->'items') x WHERE x->>'slug' LIKE 'marriott-%'));
SELECT pv.ok('M06 filtro por destino: Mónaco incluye Montecarlo (barrio) y globales, no París',
  (SELECT bool_and(coalesce(x->'destination'->>'slug', 'global') IN ('mc','monaco-monte-carlo','global')) AND bool_or(x->>'slug' = 'pv-imp-5')
     FROM jsonb_array_elements(public.prive_drops(pv.ps(1), 'mc')->'items') x));
SELECT pv.ok('M07 destino desconocido: lista vacía y lo dice', (public.prive_drops(pv.ps(1), 'atlantida')->>'destination_found')::boolean = false);
SELECT pv.ok('M08 filtro por tipo e intereses (API de edition)',
  (SELECT bool_and(x->>'type' = 'editorial') AND count(*) = 2 FROM jsonb_array_elements(public.prive_drops(pv.ps(1), NULL, ARRAY['editorial'], ARRAY['formula_1'])->'items') x));
SELECT pv.ok('M09 un vencido abierto por enlace dice "vencido"', (public.prive_drop(pv.ps(1), 'pv-vencido')->'drop'->>'status') = 'vencido');
SELECT pv.ok('M10 un programado no se abre', (public.prive_drop(pv.ps(1), 'pv-programado')->>'found')::boolean = false);
SELECT pv.ok('M11 el porcentaje solo viaja con su comparación', (SELECT x->'price'->>'discount_pct' = '25.00' AND x->'price'->>'reference' = '400.00'
  FROM jsonb_array_elements(public.prive_drops(pv.ps(1), 'mc')->'items') x WHERE x->>'slug' = 'pv-d13'));
SELECT pv.ok('M12 tracking de vista desde la app', public.prive_value_track(pv.ps(1), 'drops_view', NULL, 'paris', 'drops'));
SELECT pv.ok('M13 la app no puede escribir eventos del servidor', NOT public.prive_value_track(pv.ps(1), 'radar_state_change'));

-- ═════════════ 4. Privilege Radar ═════════════
SELECT pv.ok('R01 programas de la Bóveda: nombres y niveles, NUNCA números',
  public.prive_radar(pv.ps(1))->'programs' @> '[{"label":"Marriott Bonvoy","tier":"Gold Elite"}]'
  AND public.prive_radar(pv.ps(1))::text !~ '(987654321|AB123456)');
SELECT pv.ok('R02 sugerencias POSIBLE BENEFICIO por coincidencia (Marriott), con condiciones y fuente',
  (SELECT count(*) = 2 AND bool_and(x->>'suggested_state' = 'posible' AND x->'conditions'->>'es' IS NOT NULL AND x->'source'->>'url' ~ '^https://')
     FROM jsonb_array_elements(public.prive_radar(pv.ps(1))->'suggestions') x WHERE x->>'slug' LIKE 'marriott-%'));
SELECT pv.ok('R03 no sugiere programas que no tiene (My Monte-Carlo)',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.prive_radar(pv.ps(1))->'suggestions') x WHERE x->>'slug' = 'my-monte-carlo-entrada-casino'));
SELECT (public.prive_radar_save(pv.ps(1), jsonb_build_object('drop_id', (SELECT x->>'id' FROM jsonb_array_elements(public.prive_drops(pv.ps(1))->'items') x WHERE x->>'slug' = 'marriott-bonvoy-nightly-upgrade-awards'), 'state', 'por_comprobar'))->'item'->>'id') AS r1 \gset
SELECT pv.ok('R04 seguir un beneficio: ELEGIBILIDAD POR COMPROBAR, copia beneficio y fuente del Drop',
  pv.sq(format($q$SELECT state = 'por_comprobar' AND benefit_es ~ 'Nightly Upgrade' AND source_url ~ '^https://www.marriott.com' AND verified_at IS NULL
     FROM public.prive_radar_items WHERE id = %L$q$, :'r1')));
SELECT pv.ok('R05 ya seguido: deja de aparecer como sugerencia',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.prive_radar(pv.ps(1))->'suggestions') x WHERE x->>'slug' = 'marriott-bonvoy-nightly-upgrade-awards'));
SELECT pv.ok('R06 VERIFICADO exige decir cómo se verificó', public.prive_radar_save(pv.ps(1), jsonb_build_object('id', :'r1', 'state', 'verificado'))->>'code' = 'VERIFICATION_REQUIRED');
SELECT pv.ok('R07 UTILIZADO sin verificar antes: no', public.prive_radar_save(pv.ps(1), jsonb_build_object('id', :'r1', 'state', 'utilizado', 'verification_note', 'x'))->>'code' IN ('VERIFY_FIRST','VERIFICATION_REQUIRED'));
SELECT pv.ok('R08 VERIFICADO con nota fija la fecha',
  (public.prive_radar_save(pv.ps(1), jsonb_build_object('id', :'r1', 'state', 'verificado', 'verification_note', 'Confirmado en mi cuenta Bonvoy: nivel Gold Elite'))->>'ok')::boolean
  AND pv.sq(format($q$SELECT verified_at IS NOT NULL FROM public.prive_radar_items WHERE id = %L$q$, :'r1')));
SELECT pv.ok('R09 UTILIZADO después de verificar, con fecha de uso',
  (public.prive_radar_save(pv.ps(1), jsonb_build_object('id', :'r1', 'state', 'utilizado', 'used_at', current_date::text))->>'ok')::boolean
  AND pv.sq(format($q$SELECT state = 'utilizado' AND used_at = current_date FROM public.prive_radar_items WHERE id = %L$q$, :'r1')));
SELECT pv.ok('R10 beneficio manual (sin Drop) empieza como POSIBLE', (public.prive_radar_save(pv.ps(1), '{"program":"Tarjeta Platinum Viajero","benefit":"Acceso a salas según mi banco"}')->'item'->>'state') = 'posible');
SELECT pv.ok('R11 un número de tarjeta en el radar se rechaza', public.prive_radar_save(pv.ps(1), '{"program":"Tarjeta","benefit":"Mi tarjeta 4111-1111-1111-1111"}')->>'code' = 'INVALID');
SELECT pv.ok('R12 viaje ajeno en el radar: no', public.prive_radar_save(pv.ps(1), jsonb_build_object('program', 'X', 'benefit', 'Beneficio de prueba', 'trip_id', 'd0000000-0000-0000-0000-0000000000f2'))->>'code' = 'TRIP_NOT_FOUND');
RESET ROLE;
SELECT pv.ok('R14 eventos del radar: solo códigos (estado), nunca texto libre',
  (SELECT count(*) >= 3 AND bool_and(state IN ('posible','por_comprobar','verificado','utilizado')) FROM public.prive_value_events WHERE event = 'radar_state_change' AND user_id = pv.u(1)));
-- Fugas entre cuentas.
SELECT pv.login(2); SET ROLE authenticated;
SELECT pv.ok('X01 U2 no ve el radar de U1', jsonb_array_length(public.prive_radar(pv.ps(2))->'items') = 0 AND jsonb_array_length(public.prive_radar(pv.ps(2))->'programs') = 0);
SELECT pv.ok('X02 U2 no modifica un beneficio de U1', public.prive_radar_save(pv.ps(2), jsonb_build_object('id', :'r1', 'state', 'posible'))->>'code' = 'NOT_FOUND');
SELECT pv.ok('X03 U2 no borra un beneficio de U1', (public.prive_radar_delete(pv.ps(2), :'r1')->>'ok')::boolean = false);
SELECT pv.err('X04 U2 no usa la sesión Privé de U1', $q$SELECT public.prive_radar(pv.ps(1))$q$, 'PRIVE_SESSION_INVALID');
RESET ROLE;
SELECT pv.ok('X05 el beneficio de U1 sigue intacto', (SELECT state FROM public.prive_radar_items WHERE id = :'r1') = 'utilizado');
-- Defensa en profundidad: aunque alguien concediera SELECT, la RLS solo deja ver filas propias.
GRANT SELECT ON public.prive_radar_items TO authenticated;
SELECT pv.login(2); SET ROLE authenticated;
SELECT pv.ok('X06 RLS: con permiso directo U2 sigue sin ver filas de U1', (SELECT count(*) FROM public.prive_radar_items) = 0);
RESET ROLE;
REVOKE SELECT ON public.prive_radar_items FROM authenticated;

-- ═════════════ 5. The Value of Your Privé: ahorro comprobado ≠ estimado ≠ potencial ≠ sin ahorro ═════════════
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('V01 comprobado sin evidencia: no', public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Hotel","currency":"MXN","reference_amount":5000,"paid_amount":4000,"reference_source":"Tarifa pública del hotel"}')->>'code' = 'INVALID');
SELECT pv.ok('V02 comprobado sin precio de referencia: no', public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Hotel","evidence_note":"Folio 123"}')->>'code' = 'INVALID');
SELECT pv.ok('V03 "ahorro" con pagado >= referencia: no', public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Hotel","currency":"MXN","reference_amount":4000,"paid_amount":4000,"reference_source":"x y z","evidence_note":"Folio"}')->>'code' = 'INVALID');
SELECT pv.ok('V04 comprobado con referencia, pagado y evidencia: ahorro CALCULADO',
  (public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Mejora de habitación","currency":"MXN","reference_amount":5200,"paid_amount":4100,"reference_source":"Tarifa publicada del hotel el 2026-10-20","evidence_note":"Folio de la reservación"}')->'entry'->>'savings_amount') = '1100.00');
SELECT pv.ok('V05 estimado sin fuente de referencia: no', public.prive_value_save(pv.ps(1), '{"kind":"estimado","title":"Cena","currency":"EUR","reference_amount":300,"paid_amount":250}')->>'code' = 'INVALID');
SELECT pv.ok('V06 estimado con fuente', (public.prive_value_save(pv.ps(1), '{"kind":"estimado","title":"Cena","currency":"EUR","reference_amount":300,"paid_amount":250,"reference_source":"Menú publicado"}')->>'ok')::boolean);
SELECT pv.ok('V07 potencial sin oportunidad ni beneficio ligado: no', public.prive_value_save(pv.ps(1), '{"kind":"potencial","title":"Algo"}')->>'code' = 'INVALID');
SELECT pv.ok('V08 potencial ligado a un beneficio del radar, sin monto', (public.prive_value_save(pv.ps(1), jsonb_build_object('kind', 'potencial', 'title', 'Mejora posible', 'radar_item_id', :'r1'))->>'ok')::boolean);
SELECT pv.ok('V09 valor sin ahorro con monto: no', public.prive_value_save(pv.ps(1), '{"kind":"sin_ahorro","title":"Aniversario","currency":"MXN","reference_amount":10,"paid_amount":5,"non_monetary_note":"Noche organizada"}')->>'code' = 'INVALID');
SELECT pv.ok('V10 valor sin ahorro: experiencia organizada', (public.prive_value_save(pv.ps(1), '{"kind":"sin_ahorro","title":"Aniversario en CDMX","non_monetary_note":"Noche completa organizada con The Privé Key"}')->>'ok')::boolean);
SELECT pv.ok('V11 el monto de ahorro no se puede escribir a mano', public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Hotel","currency":"MXN","savings_amount":99999,"evidence_note":"x y z","reference_source":"x y z"}')->>'code' = 'INVALID');
SELECT public.prive_value_save(pv.ps(1), '{"kind":"comprobado","title":"Entrada","currency":"EUR","reference_amount":32,"paid_amount":0,"reference_source":"Tarifa oficial del museo","evidence_note":"Primer viernes del mes"}');
SELECT pv.ok('V12 resumen: totales por tipo y por moneda, sin mezclar',
  (SELECT s->'totals'->'comprobado' @> '[{"currency":"MXN","amount":1100.00},{"currency":"EUR","amount":32.00}]'
      AND s->'totals'->'estimado' @> '[{"currency":"EUR","amount":50.00}]'
      AND NOT (s->'totals' ? 'sin_ahorro')
      AND jsonb_array_length(s->'totals'->'comprobado') = 2
    FROM (SELECT public.prive_value_summary(pv.ps(1)) AS s) q), (SELECT public.prive_value_summary(pv.ps(1))->>'totals'));
SELECT pv.ok('V13 resumen incluye el radar por estado', (public.prive_value_summary(pv.ps(1))->'radar'->>'utilizado')::int = 1);
RESET ROLE;
SELECT pv.login(2); SET ROLE authenticated;
SELECT pv.ok('V14 U2 no ve el valor de U1', jsonb_array_length(public.prive_value_summary(pv.ps(2))->'entries') = 0 AND public.prive_value_summary(pv.ps(2))->'totals' = '{}');
SELECT pv.ok('V15 U2 no borra entradas de U1', (public.prive_value_delete(pv.ps(2), pv.sid('SELECT id FROM public.prive_value_entries WHERE user_id = pv.u(1) LIMIT 1'))->>'ok')::boolean = false);
SELECT pv.ok('V16 U2 no liga un beneficio del radar de U1', public.prive_value_save(pv.ps(2), jsonb_build_object('kind', 'potencial', 'title', 'Robo', 'radar_item_id', :'r1'))->>'code' = 'INVALID');
RESET ROLE;

SELECT pv.login(1); SET ROLE authenticated;
SELECT (public.prive_radar_save(pv.ps(1), '{"program":"Programa temporal","benefit":"Beneficio temporal de prueba"}')->'item'->>'id') AS rtmp \gset
SELECT public.prive_value_save(pv.ps(1), jsonb_build_object('kind', 'potencial', 'title', 'Potencial temporal', 'radar_item_id', :'rtmp'));
SELECT pv.ok('V17 quitar un beneficio del radar con un potencial ligado: se borra el potencial, no falla',
  (public.prive_radar_delete(pv.ps(1), :'rtmp')->>'ok')::boolean
  AND pv.sq($q$SELECT NOT EXISTS (SELECT 1 FROM public.prive_value_entries WHERE title = 'Potencial temporal')
              AND EXISTS (SELECT 1 FROM public.prive_value_entries WHERE kind = 'comprobado' AND user_id = pv.u(1))$q$));
RESET ROLE;

-- ═════════════ 6. Insider's Notebook + Before You Go ═════════════
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('N01 índice: destinos con consejos y fecha de revisión',
  (SELECT count(*) >= 7 AND bool_and((x->>'tips')::int > 0 AND x->>'last_checked' IS NOT NULL) FROM jsonb_array_elements(public.prive_insider_index(pv.ps(1))->'destinations') x));
SELECT pv.ok('N02 cada consejo trae fuente https, nombre y fecha de revisión',
  (SELECT bool_and(x->'source'->>'url' ~ '^https://' AND x->'source'->>'name' IS NOT NULL AND x->'source'->>'checked_at' IS NOT NULL)
     FROM jsonb_array_elements(public.prive_insider(pv.ps(1), 'paris')->'tips') x));
SELECT pv.ok('N03 un consejo vencido no aparece', public.prive_insider(pv.ps(1), 'paris')::text !~ 'pv-tip-vencido');
SELECT pv.ok('N04 alias: "Monte Carlo" abre el cuaderno de Mónaco con sus consejos',
  (SELECT count(*) >= 4 FROM jsonb_array_elements(public.prive_insider(pv.ps(1), 'Monte Carlo')->'tips') x));
SELECT pv.ok('N05 destino inexistente', (public.prive_insider(pv.ps(1), 'atlantida')->>'found')::boolean = false);
SELECT pv.ok('N06 Before You Go: el próximo viaje real (París), 5 cosas como máximo, primero las marcadas',
  (SELECT b->'trip'->>'destino' = 'París, Francia' AND (b->'trip'->>'days_until')::int = 10 AND b->'destination'->>'slug' = 'paris'
      AND jsonb_array_length(b->'tips') BETWEEN 1 AND 5 AND (b->'tips'->0->>'before_you_go')::boolean
    FROM (SELECT public.prive_before_you_go(pv.ps(1)) b) q));
SELECT pv.ok('N07 Before You Go de un viaje ajeno: no', public.prive_before_you_go(pv.ps(1), 'd0000000-0000-0000-0000-0000000000f2')->>'code' = 'TRIP_NOT_FOUND');
SELECT (SELECT x->>'id' FROM jsonb_array_elements(public.prive_insider(pv.ps(1), 'paris')->'tips') x WHERE x->>'slug' = 'paris-louvre-cierra-martes') AS tip1 \gset
SELECT pv.ok('N08 guardar un consejo', (public.prive_tip_save(pv.ps(1), :'tip1')->>'ok')::boolean
  AND (SELECT (x->>'saved')::boolean FROM jsonb_array_elements(public.prive_insider(pv.ps(1), 'paris')->'tips') x WHERE x->>'id' = :'tip1'));
SELECT pv.ok('N09 agregar a las notas del viaje: una línea con su fuente', (public.prive_tip_add_to_trip(pv.ps(1), :'tip1', 'd0000000-0000-0000-0000-0000000000f1')->>'added')::boolean);
SELECT pv.ok('N10 agregar otra vez: no duplica', (public.prive_tip_add_to_trip(pv.ps(1), :'tip1', 'd0000000-0000-0000-0000-0000000000f1')->>'already_present')::boolean);
RESET ROLE;
SELECT pv.ok('N11 la nota quedó en "Tips de tu concierge" con fuente y fecha',
  (SELECT count(*) = 1 FROM public.trips t, jsonb_array_elements_text(t.tips_personalizados) x
    WHERE t.id = 'd0000000-0000-0000-0000-0000000000f1' AND x LIKE 'Privé · El Louvre cierra los martes:%Fuente: Musée du Louvre%revisada el 22/10/2026)'));
SELECT pv.login(2); SET ROLE authenticated;
SELECT pv.ok('N12 U2 no escribe en el viaje de U1', public.prive_tip_add_to_trip(pv.ps(2), :'tip1', 'd0000000-0000-0000-0000-0000000000f1')->>'code' = 'TRIP_NOT_FOUND');
SELECT pv.ok('N13 U2 no ve los guardados de U1', NOT (SELECT (x->>'saved')::boolean FROM jsonb_array_elements(public.prive_insider(pv.ps(2), 'paris')->'tips') x WHERE x->>'id' = :'tip1'));
SELECT pv.ok('N14 Before You Go de U2: su viaje a Tokio', public.prive_before_you_go(pv.ps(2))->'destination'->>'slug' = 'tokio');
RESET ROLE;

-- ═════════════ 7. Privé Passport: privado, sin niveles por riqueza, fundador solo con criterio ═════════════
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('P01 tarjeta: nombre, Member Since, número no sensible, antigüedad, estado',
  (SELECT m->>'member_code' ~ '^IP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' AND m ? 'member_since' AND (m->>'tenure_days')::int >= 0 AND m->>'status' = 'active'
    FROM (SELECT public.prive_passport(pv.ps(1))->'member' AS m) q));
SELECT pv.ok('P02 sin fecha de corte nadie es Founding Member', (public.prive_passport(pv.ps(1))->'member'->>'founding_member')::boolean = false);
SELECT pv.ok('P03 la tarjeta no trae niveles por gasto ni correo', public.prive_passport(pv.ps(1))::text !~* '(tier|nivel|gasto|spend|email|@example)');
SELECT pv.ok('P04 registrar un destino visitado', (public.prive_passport_save(pv.ps(1), '{"kind":"visitado","destination":"paris","title":"Primera vez en París","happened_on":"2025-05-10"}')->>'ok')::boolean);
SELECT pv.ok('P05 registrar un deseo con fecha futura', (public.prive_passport_save(pv.ps(1), '{"kind":"deseo","destination":"tokio","title":"Ver los cerezos","happened_on":"2027-04-01"}')->>'ok')::boolean);
SELECT pv.ok('P06 algo "vivido" con fecha futura: no', public.prive_passport_save(pv.ps(1), '{"kind":"recuerdo","place":"Roma","title":"Recuerdo del futuro","happened_on":"2030-01-01"}')->>'code' = 'INVALID');
SELECT pv.ok('P07 sin lugar ni destino: no', public.prive_passport_save(pv.ps(1), '{"kind":"favorito","title":"Algo"}')->>'code' = 'INVALID');
SELECT pv.ok('P08 número de tarjeta en una nota: no', public.prive_passport_save(pv.ps(1), '{"kind":"recuerdo","place":"Roma","title":"Cena","note":"pagué con 5555 5555 5555 4444"}')->>'code' = 'INVALID');
SELECT pv.ok('P09 estadísticas: países visitados cuentan solo lo vivido', (public.prive_passport(pv.ps(1))->'stats'->>'countries')::int = 1 AND (public.prive_passport(pv.ps(1))->'stats'->>'deseo')::int = 1);
RESET ROLE;
UPDATE public.app_flags SET value = to_jsonb(current_date::text) WHERE key = 'prive_founding_cutoff';
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('P10 con fecha de corte explícita, quien activó antes es Founding Member',
  (public.prive_passport(pv.ps(1))->'member'->>'founding_member')::boolean AND public.prive_passport(pv.ps(1))->'member'->>'founding_cutoff' = current_date::text);
RESET ROLE;
UPDATE public.app_flags SET value = to_jsonb((current_date - 400)::text) WHERE key = 'prive_founding_cutoff';
SELECT pv.login(1); SET ROLE authenticated;
SELECT pv.ok('P11 quien activó después del corte no es fundador', (public.prive_passport(pv.ps(1))->'member'->>'founding_member')::boolean = false);
RESET ROLE;
UPDATE public.app_flags SET value = 'null'::jsonb WHERE key = 'prive_founding_cutoff';
SELECT pv.login(2); SET ROLE authenticated;
SELECT pv.ok('P12 U2 no ve el pasaporte de U1', jsonb_array_length(public.prive_passport(pv.ps(2))->'entries') = 0);
SELECT pv.ok('P13 U2 no edita una entrada de U1', public.prive_passport_save(pv.ps(2), jsonb_build_object('id', pv.sid('SELECT id FROM public.prive_passport_entries WHERE user_id = pv.u(1) LIMIT 1'), 'title', 'Hackeado'))->>'code' = 'NOT_FOUND');
SELECT pv.ok('P14 U2 no borra una entrada de U1', (public.prive_passport_delete(pv.ps(2), pv.sid('SELECT id FROM public.prive_passport_entries WHERE user_id = pv.u(1) LIMIT 1'))->>'ok')::boolean = false);
RESET ROLE;
SELECT pv.ok('P15 el pasaporte no tiene columnas para compartir ni coordenadas',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prive_passport_entries' AND column_name ~ '(share|public|visib|lat|lng|coord)'));

-- ═════════════ 8. Métricas sin datos personales ═════════════
SELECT pv.ok('Q01 eventos: sin columnas de texto libre', NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name = 'prive_value_events' AND column_name !~ '^(id|user_id|event|ref_id|destination_id|state|surface|created_at)$'));
SELECT pv.login(5); SET ROLE authenticated;
SELECT pv.ok('Q02 panel del equipo: activación, Drops, radar, insider, pasaporte, vista previa, retorno',
  (SELECT m ?& ARRAY['activation','the_key','saves','plans_into_trips','booking_links_opened','verified_bookings','benefits','drops','insider','passport','preview','return','retention_descriptive']
      AND (m->'activation'->>'active')::int = 2 AND (m->'preview'->>'views')::int >= 1 AND (m->'benefits'->'applied_in_window')::int = 1
    FROM (SELECT public.admin_prive_product_metrics(30) AS m) q));
SELECT pv.ok('Q03 el panel no trae correos, nombres ni ids de personas',
  public.admin_prive_product_metrics(30)::text !~* '(@example|Persona |d0000000-0000-0000-0000-00000000000)');
RESET ROLE;

-- ═════════════ 9. Borrar la cuenta borra todo lo de privevalor (y nada de otras cuentas) ═════════════
SELECT count(*) AS u2_before FROM (SELECT 1 FROM public.prive_radar_items WHERE user_id = pv.u(2) UNION ALL SELECT 1 FROM public.prive_passport_entries WHERE user_id = pv.u(2)
  UNION ALL SELECT 1 FROM public.prive_value_events WHERE user_id = pv.u(2)) x \gset
SET ROLE service_role;
SELECT public.purge_account_data(pv.u(1));
RESET ROLE;
SELECT pv.ok('Z01 purge_account_data: sin radar, valor, guardados, pasaporte ni eventos de U1',
  NOT EXISTS (SELECT 1 FROM public.prive_radar_items WHERE user_id = pv.u(1)) AND NOT EXISTS (SELECT 1 FROM public.prive_value_entries WHERE user_id = pv.u(1))
  AND NOT EXISTS (SELECT 1 FROM public.prive_saved_tips WHERE user_id = pv.u(1)) AND NOT EXISTS (SELECT 1 FROM public.prive_passport_entries WHERE user_id = pv.u(1))
  AND NOT EXISTS (SELECT 1 FROM public.prive_value_events WHERE user_id = pv.u(1)));
SELECT pv.ok('Z02 lo de U2 sigue intacto', (SELECT count(*) FROM (SELECT 1 FROM public.prive_radar_items WHERE user_id = pv.u(2) UNION ALL SELECT 1 FROM public.prive_passport_entries WHERE user_id = pv.u(2)
  UNION ALL SELECT 1 FROM public.prive_value_events WHERE user_id = pv.u(2)) x) = :u2_before);
SELECT pv.ok('Z03 el catálogo curado (Drops y consejos) no se toca', (SELECT count(*) FROM public.prive_drops WHERE import_batch = 'valor-2026-10') = 9);

-- ═════════════ limpieza ═════════════
DROP SCHEMA pv CASCADE;
