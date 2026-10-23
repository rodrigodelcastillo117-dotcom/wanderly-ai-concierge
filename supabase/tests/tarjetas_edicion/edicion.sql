-- Ediciones especiales de la tarjeta (member_card_grants.edition). Imprime "OK …" o "FALLA …".
-- Requiere run.sh (la base ya tiene TODAS las migraciones en orden).
-- Personas (ids ce…n):
--   1 Free + otorgamiento platinum_2 rose_gold        → platinum_2, edición rose_gold
--   2 Free + otorgamiento platinum_2 special          → platinum_2, edición special
--   3 Privé 100 días + otorgamiento gold special      → platinum_1 (automático), edición special
--   4 Privé 400 días, sin otorgamiento                → platinum_2, sin edición
--   5 fundador + otorgamiento platinum_2 special      → founder_black, sin edición (nunca en la negra)
--   6 Free + otorgamiento gold rose_gold              → gold, sin edición (rango final menor)
--   7 PRO + otorgamiento gold special                 → gold, sin edición (rango final menor)
--   8 Privé 400 días + otorgamiento platinum_2 sin edición → platinum_2, sin edición
--   9 Free sin otorgamiento (para probar el CHECK)
--  10 Privé 100 días + otorgamiento platinum_1 rose_gold → platinum_1, edición rose_gold
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
CREATE SCHEMA IF NOT EXISTS te;
GRANT USAGE ON SCHEMA te TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION te.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('ce000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION te.ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta _q con el rol dado (authenticated con sub = _uid, anon o service_role) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION te.run(_role text, _uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', _role, false);
  EXECUTE format('SET LOCAL ROLE %I', _role);
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION te.card(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT te.run('authenticated', te.u(n), 'SELECT public.my_member_card()::text')::jsonb $$;
CREATE OR REPLACE FUNCTION te.svc(_q text) RETURNS text LANGUAGE sql AS $$ SELECT te.run('service_role', NULL, _q) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA te TO anon, authenticated, service_role;

-- ───────────── Datos (como servidor) ─────────────
INSERT INTO auth.users (id, email, created_at) SELECT te.u(n), 'te' || n || '@example.test', now() - interval '800 days' FROM generate_series(1, 10) n ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) SELECT te.u(n) FROM generate_series(1, 10) n ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Edicion ' || substr(id::text, 34) WHERE id::text LIKE 'ce000000-%';
INSERT INTO public.subscriptions (user_id, status, plan)
SELECT te.u(n), 'comped', 'pro' FROM unnest(ARRAY[3, 4, 7, 8, 10]) n
ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
INSERT INTO public.prive_grants (email, user_id, reason, granted_by)
SELECT 'te' || n || '@example.test', te.u(n), 'prueba ediciones', 'pruebas' FROM unnest(ARRAY[3, 4, 8, 10]) n;
INSERT INTO public.prive_memberships (user_id, status, basis, activated_at, member_code)
SELECT te.u(n), 'active', 'grant', now() - make_interval(days => d), 'IP-TE' || chr(64 + n) || 'A-BCDE'
  FROM (VALUES (3, 100), (4, 400), (8, 400), (10, 100)) v(n, d)
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.founders (user_id, person) VALUES (te.u(5), 'rodrigo') ON CONFLICT DO NOTHING;

SELECT te.ok('E0 service_role escribe otorgamientos con edición',
  te.svc($q$WITH i AS (INSERT INTO public.member_card_grants (user_id, tier, reason, granted_by, edition) VALUES
     ('ce000000-0000-0000-0000-000000000001', 'platinum_2', 'Edición especial', 'pruebas', 'rose_gold'),
     ('ce000000-0000-0000-0000-000000000002', 'platinum_2', 'Edición especial', 'pruebas', 'special'),
     ('ce000000-0000-0000-0000-000000000003', 'gold', 'Edición especial', 'pruebas', 'special'),
     ('ce000000-0000-0000-0000-000000000005', 'platinum_2', 'Intento en la negra', 'pruebas', 'special'),
     ('ce000000-0000-0000-0000-000000000006', 'gold', 'Rango menor', 'pruebas', 'rose_gold'),
     ('ce000000-0000-0000-0000-000000000007', 'gold', 'Rango menor', 'pruebas', 'special'),
     ('ce000000-0000-0000-0000-000000000008', 'platinum_2', 'Sin edición', 'pruebas', NULL),
     ('ce000000-0000-0000-0000-000000000010', 'platinum_1', 'Edición especial', 'pruebas', 'rose_gold') RETURNING 1)
     SELECT count(*)::text FROM i$q$) = '8');

-- ───────────── Esquema ─────────────
SELECT te.ok('E1 columna edition text NULL con CHECK rose_gold | special',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_card_grants'
           AND column_name = 'edition' AND data_type = 'text' AND is_nullable = 'YES')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_card_grants_edition_check'
               AND conrelid = 'public.member_card_grants'::regclass AND pg_get_constraintdef(oid) LIKE '%rose_gold%special%'));

-- ───────────── Edición solo con otorgamiento y en Platinum ─────────────
SELECT te.ok('E2 Free + platinum_2 rose_gold → platinum_2 con edición rose_gold',
  te.card(1)->>'tier' = 'platinum_2' AND te.card(1)->>'edition' = 'rose_gold' AND (te.card(1)->>'granted')::boolean, te.card(1)::text);
SELECT te.ok('E3 Free + platinum_2 special → platinum_2 con edición special',
  te.card(2)->>'tier' = 'platinum_2' AND te.card(2)->>'edition' = 'special', te.card(2)::text);
SELECT te.ok('E4 Privé (platinum_1 automático) + otorgamiento gold special → platinum_1 con special, sin "otorgado"',
  te.card(3)->>'tier' = 'platinum_1' AND te.card(3)->>'edition' = 'special' AND NOT (te.card(3)->>'granted')::boolean, te.card(3)::text);
SELECT te.ok('E5 platinum_1 otorgado + rose_gold → platinum_1 con rose_gold',
  te.card(10)->>'tier' = 'platinum_1' AND te.card(10)->>'edition' = 'rose_gold', te.card(10)::text);
SELECT te.ok('E6 Platinum II automático sin otorgamiento → sin llave edition (nunca se gana sola)',
  te.card(4)->>'tier' = 'platinum_2' AND NOT te.card(4) ? 'edition', te.card(4)::text);
SELECT te.ok('E7 otorgamiento sin edición → sin llave edition',
  te.card(8)->>'tier' = 'platinum_2' AND NOT te.card(8) ? 'edition', te.card(8)::text);
SELECT te.ok('E8 fundador con otorgamiento special → founder_black, sin edición',
  te.card(5)->>'tier' = 'founder_black' AND NOT te.card(5) ? 'edition', te.card(5)::text);
SELECT te.ok('E9 Free + otorgamiento gold rose_gold → gold, sin edición (rango final menor)',
  te.card(6)->>'tier' = 'gold' AND NOT te.card(6) ? 'edition', te.card(6)::text);
SELECT te.ok('E10 PRO + otorgamiento gold special → gold, sin edición (rango final menor)',
  te.card(7)->>'tier' = 'gold' AND NOT te.card(7) ? 'edition', te.card(7)::text);
SELECT te.ok('E11 llaves: las 7 de siempre + edition solo cuando aplica',
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(te.card(2)) k) = ARRAY['edition','granted','name','number','prive_days','since','tenure_days','tier']
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(te.card(4)) k) = ARRAY['granted','name','number','prive_days','since','tenure_days','tier']);

-- ───────────── La edición nunca cambia el rango ni los datos ─────────────
CREATE TEMP TABLE te_snap (con jsonb, sin jsonb, upd text);
INSERT INTO te_snap (con) SELECT te.card(2);
UPDATE te_snap SET upd = te.svc($q$UPDATE public.member_card_grants SET edition = NULL WHERE user_id = 'ce000000-0000-0000-0000-000000000002' RETURNING 'x'$q$);
UPDATE te_snap SET sin = te.card(2);
SELECT te.ok('E12 quitar la edición deja la tarjeta idéntica salvo la llave edition (mismo rango, número, fechas)',
  (SELECT con->>'edition' = 'special' AND upd = 'x' AND NOT sin ? 'edition' AND (con - 'edition') = sin FROM te_snap)
  AND te.svc($q$UPDATE public.member_card_grants SET edition = 'special' WHERE user_id = 'ce000000-0000-0000-0000-000000000002' RETURNING 'x'$q$) = 'x'
  AND te.card(2)->>'edition' = 'special', (SELECT sin::text FROM te_snap));
DROP TABLE te_snap;

SELECT te.ok('E13 perder Privé baja el rango y la edición desaparece (vuelve al regresar)',
  te.svc($q$UPDATE public.subscriptions SET status = 'canceled' WHERE user_id = 'ce000000-0000-0000-0000-000000000003' RETURNING 'x'$q$) = 'x'
  AND te.card(3)->>'tier' = 'gold' AND NOT te.card(3) ? 'edition'
  AND te.svc($q$UPDATE public.subscriptions SET status = 'comped' WHERE user_id = 'ce000000-0000-0000-0000-000000000003' RETURNING 'x'$q$) = 'x'
  AND te.card(3)->>'tier' = 'platinum_1' AND te.card(3)->>'edition' = 'special');
SELECT te.ok('E14 service_role puede poner y quitar una edición válida',
  te.svc($q$UPDATE public.member_card_grants SET edition = 'rose_gold' WHERE user_id = 'ce000000-0000-0000-0000-000000000008' RETURNING edition$q$) = 'rose_gold'
  AND te.card(8)->>'edition' = 'rose_gold' AND te.card(8)->>'tier' = 'platinum_2'
  AND te.svc($q$UPDATE public.member_card_grants SET edition = NULL WHERE user_id = 'ce000000-0000-0000-0000-000000000008' RETURNING coalesce(edition, 'nula')$q$) = 'nula'
  AND NOT te.card(8) ? 'edition');

-- ───────────── CHECK ─────────────
SELECT te.ok('E15 el CHECK rechaza otras ediciones al insertar (aun con service_role)',
  te.svc($q$INSERT INTO public.member_card_grants (user_id, tier, reason, edition) VALUES ('ce000000-0000-0000-0000-000000000009', 'platinum_2', 'intento', 'black') RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_edition_check%'
  AND te.svc($q$INSERT INTO public.member_card_grants (user_id, tier, reason, edition) VALUES ('ce000000-0000-0000-0000-000000000009', 'platinum_2', 'intento', 'founder_black') RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_edition_check%');
SELECT te.ok('E16 el CHECK rechaza otras ediciones al actualizar (mayúsculas, vacío, con espacios)',
  te.svc($q$UPDATE public.member_card_grants SET edition = 'ROSE_GOLD' WHERE user_id = 'ce000000-0000-0000-0000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_edition_check%'
  AND te.svc($q$UPDATE public.member_card_grants SET edition = '' WHERE user_id = 'ce000000-0000-0000-0000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_edition_check%'
  AND te.svc($q$UPDATE public.member_card_grants SET edition = 'special ' WHERE user_id = 'ce000000-0000-0000-0000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_edition_check%'
  AND te.card(1)->>'edition' = 'rose_gold');

-- ───────────── Los clientes no escriben ─────────────
SELECT te.ok('E17 un usuario no puede ponerse una edición (UPDATE de su otorgamiento)',
  te.run('authenticated', te.u(8), $q$UPDATE public.member_card_grants SET edition = 'special' WHERE user_id = 'ce000000-0000-0000-0000-000000000008' RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND NOT te.card(8) ? 'edition');
SELECT te.ok('E18 un usuario no puede otorgarse una edición (INSERT)',
  te.run('authenticated', te.u(9), $q$INSERT INTO public.member_card_grants (user_id, tier, reason, edition) VALUES ('ce000000-0000-0000-0000-000000000009', 'platinum_2', 'yo', 'special') RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND te.card(9)->>'tier' = 'blue' AND NOT te.card(9) ? 'edition');
GRANT INSERT, SELECT, UPDATE ON public.member_card_grants TO authenticated;
SELECT te.ok('E19 aun con GRANT por error, RLS sin políticas bloquea la edición',
  te.run('authenticated', te.u(8), $q$UPDATE public.member_card_grants SET edition = 'special' RETURNING 'x'$q$) = '<null>'
  AND te.run('authenticated', te.u(9), $q$INSERT INTO public.member_card_grants (user_id, tier, reason, edition) VALUES ('ce000000-0000-0000-0000-000000000009', 'platinum_2', 'yo', 'special') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%'
  AND (SELECT edition FROM public.member_card_grants WHERE user_id = te.u(8)) IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.member_card_grants WHERE user_id = te.u(9)));
REVOKE INSERT, SELECT, UPDATE ON public.member_card_grants FROM authenticated;
SELECT te.ok('E20 anon no lee ni escribe member_card_grants',
  te.run('anon', NULL, 'SELECT count(*)::text FROM public.member_card_grants') LIKE 'ERR:permission denied%'
  AND te.run('anon', NULL, $q$UPDATE public.member_card_grants SET edition = 'special' RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND te.run('anon', NULL, 'SELECT public.my_member_card()::text') LIKE 'ERR:permission denied%');
SELECT te.ok('E21 cada quien ve SU edición; member_card_for no es ejecutable por clientes',
  te.card(1)->>'edition' = 'rose_gold' AND te.card(2)->>'edition' = 'special'
  AND te.run('authenticated', te.u(9), $q$SELECT public.member_card_for('ce000000-0000-0000-0000-000000000002')::text$q$) LIKE 'ERR:permission denied%'
  AND NOT has_function_privilege('anon', 'public.member_card_for(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.member_card_for(uuid)', 'EXECUTE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_card_grants'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.member_card_grants'::regclass));
SELECT te.ok('E22 la migración no trae user_ids y ninguna función de cliente escribe member_card_grants',
  NOT EXISTS (SELECT 1 FROM public.member_card_grants WHERE user_id::text NOT LIKE 'ce000000-%')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?member_card_grants\M'));

RESET ROLE;
DROP SCHEMA te CASCADE;
