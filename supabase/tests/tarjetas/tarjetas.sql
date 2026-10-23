-- Tarjetas de rango: my_member_card(), founders y member_card_grants. Imprime "OK …" o "FALLA …".
-- Requiere run.sh (la base ya tiene TODAS las migraciones en orden).
-- Personas (ids c7…n):
--   1 Free                      → blue          2 PRO (cortesía)          → gold
--   3 Privé, 100 días           → platinum_1    4 Privé, 400 días         → platinum_2
--   5 fundador rodrigo (Free)   → founder_black 6 fundador rodrigo, 2ª cuenta, Privé 400 días → founder_black
--   7 fundador carlo (PRO)      → founder_black 8 Privé de 400 días pero SIN PRO (pausada) → blue
--   9 Free con otorgamiento Platinum II → platinum_2 (gana el otorgamiento)
--  10 Privé 100 días con otorgamiento Gold → platinum_1 (un otorgamiento nunca baja)
--  11 Privé, exactamente 364 días → platinum_1  12 Privé, exactamente 365 días → platinum_2
--  13 sin fila de fundador, para intentar una tercera persona / tercera cuenta
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
CREATE SCHEMA IF NOT EXISTS tc;
GRANT USAGE ON SCHEMA tc TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION tc.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION tc.ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta _q con el rol dado (authenticated con sub = _uid, anon o service_role) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION tc.run(_role text, _uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION tc.card(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT tc.run('authenticated', tc.u(n), 'SELECT public.my_member_card()::text')::jsonb $$;
CREATE OR REPLACE FUNCTION tc.tier(n int) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN r LIKE 'ERR:%' THEN r ELSE r::jsonb->>'tier' END FROM tc.run('authenticated', tc.u(n), 'SELECT public.my_member_card()::text') r $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tc TO anon, authenticated, service_role;

-- ───────────── Datos (como servidor) ─────────────
INSERT INTO auth.users (id, email, created_at) SELECT tc.u(n), 'tc' || n || '@example.test', now() - interval '800 days' FROM generate_series(1, 13) n ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) SELECT tc.u(n) FROM generate_series(1, 13) n ON CONFLICT DO NOTHING;
UPDATE public.profiles SET full_name = 'Persona   de Prueba ' || substr(id::text, 34) WHERE id::text LIKE 'c7000000-%';
-- PRO vigente (cortesía) para todos menos 1, 5, 8, 9 y 13.
INSERT INTO public.subscriptions (user_id, status, plan)
SELECT tc.u(n), 'comped', 'pro' FROM unnest(ARRAY[2, 3, 4, 6, 7, 10, 11, 12]) n
ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
-- Elegibilidad Privé por concesión y membresía activa con su fecha de activación.
INSERT INTO public.prive_grants (email, user_id, reason, granted_by)
SELECT 'tc' || n || '@example.test', tc.u(n), 'prueba tarjetas', 'pruebas' FROM unnest(ARRAY[3, 4, 6, 8, 10, 11, 12]) n;
INSERT INTO public.prive_memberships (user_id, status, basis, activated_at, member_code)
SELECT tc.u(n), 'active', 'grant', now() - make_interval(days => d), 'IP-TC' || chr(64 + n) || 'A-BCDE'
  FROM (VALUES (3, 100), (4, 400), (6, 400), (8, 400), (10, 100), (11, 364), (12, 365)) v(n, d)
ON CONFLICT (user_id) DO NOTHING;

-- Fundadores y otorgamientos los escribe service_role (como hará el coordinador).
SELECT tc.ok('F0 service_role escribe founders (3 cuentas, 2 personas)',
  tc.run('service_role', NULL, $q$WITH i AS (INSERT INTO public.founders (user_id, person) VALUES
     ('c7000000-0000-0000-0000-000000000005', 'rodrigo'), ('c7000000-0000-0000-0000-000000000006', 'rodrigo'),
     ('c7000000-0000-0000-0000-000000000007', 'carlo') RETURNING 1) SELECT count(*)::text FROM i$q$) = '3');
SELECT tc.ok('G0 service_role escribe member_card_grants',
  tc.run('service_role', NULL, $q$WITH i AS (INSERT INTO public.member_card_grants (user_id, tier, reason, granted_by) VALUES
     ('c7000000-0000-0000-0000-000000000009', 'platinum_2', 'Pedido del dueño', 'pruebas'),
     ('c7000000-0000-0000-0000-000000000010', 'gold', 'Prueba: no baja', 'pruebas') RETURNING 1) SELECT count(*)::text FROM i$q$) = '2');

-- ───────────── Cada rango según el estado ─────────────
SELECT tc.ok('R1 Free → blue', tc.tier(1) = 'blue', tc.tier(1));
SELECT tc.ok('R2 PRO → gold', tc.tier(2) = 'gold', tc.tier(2));
SELECT tc.ok('R3 Privé 100 días → platinum_1', tc.tier(3) = 'platinum_1', tc.tier(3));
SELECT tc.ok('R4 Privé 400 días → platinum_2', tc.tier(4) = 'platinum_2', tc.tier(4));
SELECT tc.ok('R5 Privé 364 días → platinum_1', tc.tier(11) = 'platinum_1', tc.tier(11));
SELECT tc.ok('R6 Privé 365 días → platinum_2', tc.tier(12) = 'platinum_2', tc.tier(12));
SELECT tc.ok('R7 fundador Free → founder_black', tc.tier(5) = 'founder_black', tc.tier(5));
SELECT tc.ok('R8 fundador con Privé de 400 días → founder_black (manda sobre platinum_2)', tc.tier(6) = 'founder_black', tc.tier(6));
SELECT tc.ok('R9 fundador (otra persona) → founder_black', tc.tier(7) = 'founder_black', tc.tier(7));
SELECT tc.ok('R10 Privé pausada (sin PRO) → blue, no platinum', tc.tier(8) = 'blue', tc.tier(8));
SELECT tc.ok('R11 mismo usuario: perder el PRO baja el rango (gold → blue)',
  (SELECT tc.tier(2) = 'gold') AND
  tc.run('service_role', NULL, $q$UPDATE public.subscriptions SET status = 'canceled' WHERE user_id = 'c7000000-0000-0000-0000-000000000002' RETURNING 'x'$q$) = 'x'
  AND tc.tier(2) = 'blue'
  AND tc.run('service_role', NULL, $q$UPDATE public.subscriptions SET status = 'comped' WHERE user_id = 'c7000000-0000-0000-0000-000000000002' RETURNING 'x'$q$) = 'x'
  AND tc.tier(2) = 'gold');

-- ───────────── Datos de la tarjeta ─────────────
SELECT tc.ok('D1 sin Privé: número IA-XXXX-XXXX estable', (tc.card(1)->>'number') ~ '^IA-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
  AND tc.card(1)->>'number' = tc.card(1)->>'number' AND tc.card(1)->>'number' <> tc.card(2)->>'number', tc.card(1)->>'number');
SELECT tc.ok('D2 con Privé: reúsa el member_code IP-…', tc.card(3)->>'number' = 'IP-TCCA-BCDE', tc.card(3)->>'number');
SELECT tc.ok('D3 Platinum: "miembro desde" = activación de Privé y antigüedad en días',
  (tc.card(4)->>'since')::timestamptz = (SELECT activated_at FROM public.prive_memberships WHERE user_id = tc.u(4))
  AND (tc.card(4)->>'tenure_days')::int BETWEEN 399 AND 401 AND (tc.card(4)->>'prive_days')::int BETWEEN 399 AND 401);
SELECT tc.ok('D4 Free: "miembro desde" = alta de la cuenta, sin días de Privé',
  (tc.card(1)->>'since')::timestamptz = (SELECT created_at FROM auth.users WHERE id = tc.u(1)) AND tc.card(1)->'prive_days' = 'null'::jsonb);
SELECT tc.ok('D5 nombre completo con espacios normalizados', tc.card(1)->>'name' = 'Persona de Prueba 001', tc.card(1)->>'name');
SELECT tc.ok('D6 la respuesta trae exactamente las llaves documentadas',
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(tc.card(3)) k) = ARRAY['granted','name','number','prive_days','since','tenure_days','tier']);

-- ───────────── Otorgamientos ─────────────
SELECT tc.ok('G1 otorgamiento Platinum II a una cuenta Free → platinum_2 (gana el mayor)', tc.tier(9) = 'platinum_2' AND (tc.card(9)->>'granted')::boolean, tc.card(9)::text);
SELECT tc.ok('G2 otorgamiento Gold a un Platinum I → sigue platinum_1 (nunca baja)', tc.tier(10) = 'platinum_1' AND NOT (tc.card(10)->>'granted')::boolean, tc.card(10)::text);
SELECT tc.ok('G3 ni service_role puede otorgar founder_black por member_card_grants',
  tc.run('service_role', NULL, $q$INSERT INTO public.member_card_grants (user_id, tier, reason) VALUES ('c7000000-0000-0000-0000-000000000013', 'founder_black', 'intento') RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_tier_check%');
SELECT tc.ok('G4 tampoco cambiando un otorgamiento existente a founder_black',
  tc.run('service_role', NULL, $q$UPDATE public.member_card_grants SET tier = 'founder_black' WHERE user_id = 'c7000000-0000-0000-0000-000000000009' RETURNING 'x'$q$) LIKE 'ERR:%member_card_grants_tier_check%');
SELECT tc.ok('G5 un usuario no puede otorgarse un rango (INSERT)',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.member_card_grants (user_id, tier, reason) VALUES ('c7000000-0000-0000-0000-000000000001', 'platinum_2', 'yo mismo') RETURNING 'x'$q$) LIKE 'ERR:permission denied%');
SELECT tc.ok('G6 un usuario no puede cambiar su otorgamiento (UPDATE) ni leerlo',
  tc.run('authenticated', tc.u(10), $q$UPDATE public.member_card_grants SET tier = 'platinum_2' RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND tc.run('authenticated', tc.u(9), $q$SELECT count(*)::text FROM public.member_card_grants$q$) LIKE 'ERR:permission denied%');
GRANT INSERT, SELECT ON public.member_card_grants TO authenticated;
SELECT tc.ok('G7 aun con GRANT por error, RLS sin políticas bloquea al usuario en member_card_grants',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.member_card_grants (user_id, tier, reason) VALUES ('c7000000-0000-0000-0000-000000000001', 'platinum_2', 'yo mismo') RETURNING 'x'$q$) LIKE 'ERR:%row-level security%'
  AND tc.run('authenticated', tc.u(9), $q$SELECT count(*)::text FROM public.member_card_grants$q$) = '0');
REVOKE INSERT, SELECT ON public.member_card_grants FROM authenticated;

-- ───────────── Fundadores ─────────────
SELECT tc.ok('F1 un usuario no se puede insertar en founders (sin permiso)',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000001', 'carlo') RETURNING 'x'$q$) LIKE 'ERR:permission denied%');
GRANT INSERT, SELECT, UPDATE ON public.founders TO authenticated;
SELECT tc.ok('F2 aun con GRANT por error, RLS (sin políticas) y el trigger lo bloquean',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000001', 'carlo') RETURNING 'x'$q$) ~ '^ERR:(La tarjeta de fundador no se asigna desde la app|.*row-level security)'
  AND tc.run('authenticated', tc.u(5), $q$SELECT count(*)::text FROM public.founders$q$) = '0'
  AND tc.run('authenticated', tc.u(5), $q$UPDATE public.founders SET user_id = 'c7000000-0000-0000-0000-000000000001' RETURNING 'x'$q$) <> 'x'
  AND (SELECT count(*) FROM public.founders WHERE user_id = tc.u(1)) = 0);
REVOKE INSERT, SELECT, UPDATE ON public.founders FROM authenticated;
SELECT tc.ok('F3 un usuario no ve founders', tc.run('authenticated', tc.u(5), $q$SELECT count(*)::text FROM public.founders$q$) LIKE 'ERR:permission denied%');
SELECT tc.ok('F4 ninguna función que authenticated pueda ejecutar escribe founders ni member_card_grants',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(founders|member_card_grants)\M'));
SELECT tc.ok('F5 una tercera persona falla aun con service_role (CHECK)',
  tc.run('service_role', NULL, $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000013', 'pedro') RETURNING 'x'$q$) ~ '^ERR:(Solo existen dos fundadores de IATOS|.*founders_person_check)');
SELECT tc.ok('F6 una tercera cuenta para la misma persona falla (máx. 2 por persona)',
  tc.run('service_role', NULL, $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000013', 'rodrigo') RETURNING 'x'$q$) LIKE 'ERR:Cada fundador puede tener como mucho 2 cuentas%');
SELECT tc.ok('F7 mover una cuenta de persona no se salta el tope (carlo → 3ª de rodrigo)',
  tc.run('service_role', NULL, $q$UPDATE public.founders SET person = 'rodrigo' WHERE user_id = 'c7000000-0000-0000-0000-000000000007' RETURNING 'x'$q$) LIKE 'ERR:Cada fundador%');
-- Aunque alguien quite el CHECK, el trigger impide una tercera persona (en una transacción que se deshace).
BEGIN;
ALTER TABLE public.founders DROP CONSTRAINT founders_person_check;
SELECT tc.ok('F8 sin el CHECK, el trigger rechaza una tercera persona (service_role)',
  tc.run('service_role', NULL, $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000013', 'pedro') RETURNING 'x'$q$) LIKE 'ERR:Solo existen dos fundadores de IATOS%');
ROLLBACK;
SELECT tc.ok('F9 el CHECK sigue en su lugar y los fundadores son los mismos 3',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'founders_person_check') AND (SELECT count(*) FROM public.founders) = 3
  AND (SELECT count(DISTINCT person) FROM public.founders) = 2);
SELECT tc.ok('F10 borrar un fundador le quita la negra (vuelve a su rango automático)',
  tc.run('service_role', NULL, $q$DELETE FROM public.founders WHERE user_id = 'c7000000-0000-0000-0000-000000000006' RETURNING 'x'$q$) = 'x'
  AND tc.tier(6) = 'platinum_2'
  AND tc.run('service_role', NULL, $q$INSERT INTO public.founders (user_id, person) VALUES ('c7000000-0000-0000-0000-000000000006', 'rodrigo') RETURNING 'x'$q$) = 'x'
  AND tc.tier(6) = 'founder_black');

-- ───────────── Nadie se autoasigna nada por otras tablas ─────────────
SELECT tc.ok('S1 un usuario no puede darse PRO (subscriptions) ni cambiar profiles.tier',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.subscriptions (user_id, status) VALUES ('c7000000-0000-0000-0000-000000000001', 'comped') RETURNING 'x'$q$) LIKE 'ERR:%'
  AND tc.run('authenticated', tc.u(8), $q$UPDATE public.subscriptions SET status = 'comped' RETURNING 'x'$q$) <> 'x'
  AND tc.run('authenticated', tc.u(1), $q$UPDATE public.profiles SET tier = 'founder' WHERE id = 'c7000000-0000-0000-0000-000000000001' RETURNING 'x'$q$) LIKE 'ERR:%'
  AND tc.tier(1) = 'blue' AND tc.tier(8) = 'blue');
SELECT tc.ok('S2 un usuario no puede activarse Privé (prive_memberships / prive_grants)',
  tc.run('authenticated', tc.u(1), $q$INSERT INTO public.prive_memberships (user_id, status, basis, activated_at) VALUES ('c7000000-0000-0000-0000-000000000001', 'active', 'grant', now() - interval '2 years') RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND tc.run('authenticated', tc.u(1), $q$INSERT INTO public.prive_grants (email, user_id, reason, granted_by) VALUES ('tc1@example.test', 'c7000000-0000-0000-0000-000000000001', 'yo', 'yo mismo') RETURNING 'x'$q$) LIKE 'ERR:permission denied%'
  AND tc.tier(1) = 'blue');

-- ───────────── La RPC solo responde por uno mismo; anon sin acceso ─────────────
SELECT tc.ok('P1 my_member_card no recibe parámetros', (SELECT pronargs FROM pg_proc WHERE proname = 'my_member_card' AND pronamespace = 'public'::regnamespace) = 0);
SELECT tc.ok('P2 cada quien recibe SU tarjeta (U1 no ve la negra de U5 y viceversa)',
  tc.card(1)->>'number' = public.member_card_number(tc.u(1)) AND tc.card(5)->>'number' = public.member_card_number(tc.u(5))
  AND tc.tier(1) = 'blue' AND tc.tier(5) = 'founder_black');
SELECT tc.ok('P3 un usuario no puede pedir la tarjeta de otro (member_card_for)',
  tc.run('authenticated', tc.u(1), $q$SELECT public.member_card_for('c7000000-0000-0000-0000-000000000005')::text$q$) LIKE 'ERR:permission denied%');
SELECT tc.ok('P4 los ayudantes internos no son ejecutables por clientes',
  NOT has_function_privilege('authenticated', 'public.member_card_rank(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.member_card_number(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.member_card_for(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.founders_guard()', 'EXECUTE'));
SELECT tc.ok('A1 anon no puede llamar my_member_card', tc.run('anon', NULL, 'SELECT public.my_member_card()::text') LIKE 'ERR:permission denied%');
SELECT tc.ok('A2 anon no lee founders ni member_card_grants',
  tc.run('anon', NULL, 'SELECT count(*)::text FROM public.founders') LIKE 'ERR:permission denied%'
  AND tc.run('anon', NULL, 'SELECT count(*)::text FROM public.member_card_grants') LIKE 'ERR:permission denied%');
SELECT tc.ok('A3 sin sesión (authenticated sin sub) la RPC no responde', tc.run('authenticated', NULL, 'SELECT public.my_member_card()::text') LIKE 'ERR:Inicia sesión%');
SELECT tc.ok('A4 RLS activado en founders y member_card_grants, sin políticas',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.founders'::regclass, 'public.member_card_grants'::regclass))
  AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.founders'::regclass, 'public.member_card_grants'::regclass)));
SELECT tc.ok('A5 la migración no trae ningún user_id (founders y grants vacíos sin el coordinador)',
  NOT EXISTS (SELECT 1 FROM public.founders WHERE user_id::text NOT LIKE 'c7000000-%')
  AND NOT EXISTS (SELECT 1 FROM public.member_card_grants WHERE user_id::text NOT LIKE 'c7000000-%'));

RESET ROLE;
DROP SCHEMA tc CASCADE;
