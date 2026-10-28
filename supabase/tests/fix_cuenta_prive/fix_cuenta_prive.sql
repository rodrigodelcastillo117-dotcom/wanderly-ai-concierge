-- prive_status() con 'pro_basis' (20261029020000_fix_cuenta_prive). Imprime "OK …" o "FALLA …".
-- Requiere run.sh (la base ya tiene TODAS las migraciones en orden).
-- Personas (ids fc…n):
--   1 PRO de cortesía sin fecha (la cuenta de la auditoría)   → pro_basis 'comped', 0 días, no elegible
--   2 prueba gratuita vigente                                  → 'trial', 0 días
--   3 PRO pagado con 120 días pagados                          → 'paid', ≥ 90 días, elegible
--   4 sin suscripción (Free)                                   → null, sin PRO
--   5 PRO pagado que ya venció (canceled)                      → null
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
CREATE SCHEMA IF NOT EXISTS fc;
GRANT USAGE ON SCHEMA fc TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION fc.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('fc000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION fc.ok(_label text, _cond boolean, _detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(_cond, false) THEN RAISE NOTICE 'OK % %', _label, _detail; ELSE RAISE NOTICE 'FALLA % %', _label, _detail; END IF;
END $$;
-- Ejecuta _q con el rol dado (authenticated con sub = _uid, o anon) y devuelve el texto o ERR:<mensaje>.
CREATE OR REPLACE FUNCTION fc.run(_role text, _uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION fc.st(n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN r LIKE 'ERR:%' THEN jsonb_build_object('err', r) ELSE r::jsonb END
    FROM fc.run('authenticated', fc.u(n), 'SELECT public.prive_status()::text') r $$;
-- SQLSTATE y mensaje de un error (o 'OK' si no falla), como authenticated con sub = _uid.
CREATE OR REPLACE FUNCTION fc.state(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fc TO anon, authenticated, service_role;

BEGIN;
INSERT INTO auth.users (id, email, created_at) SELECT fc.u(n), 'fc' || n || '@example.test', now() - interval '30 days' FROM generate_series(1, 5) n ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id) SELECT fc.u(n) FROM generate_series(1, 5) n ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (fc.u(1), 'comped', 'pro') ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
INSERT INTO public.subscriptions (user_id, status, plan, trial_end, current_period_end)
  VALUES (fc.u(2), 'trialing', 'pro', now() + interval '10 days', now() + interval '10 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'trialing', current_period_end = now() + interval '10 days';
INSERT INTO public.subscriptions (user_id, status, plan, current_period_end)
  VALUES (fc.u(3), 'active', 'pro', now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
INSERT INTO public.pro_paid_periods (user_id, stripe_invoice_id, period, amount_paid, currency, status, source)
  VALUES (fc.u(3), 'in_fc3', tstzrange(now() - interval '120 days', now() + interval '5 days'), 9900, 'mxn', 'paid', 'test')
  ON CONFLICT (stripe_invoice_id) DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, plan, current_period_end)
  VALUES (fc.u(5), 'canceled', 'pro', now() - interval '3 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'canceled';
INSERT INTO public.admins (user_id) VALUES (fc.u(4)) ON CONFLICT DO NOTHING;
COMMIT;

-- 1. La cuenta de la auditoría: PRO de cortesía → lo dice, sin días y sin elegibilidad.
SELECT fc.ok('cortesía: pro_basis=comped, is_pro, 0 días, no elegible',
  fc.st(1)->>'pro_basis' = 'comped' AND (fc.st(1)->>'is_pro')::boolean AND (fc.st(1)->>'tenure_days')::int = 0
  AND NOT (fc.st(1)->>'eligible')::boolean, fc.st(1)::text);
-- 2. Prueba gratuita vigente.
SELECT fc.ok('prueba: pro_basis=trial, 0 días', fc.st(2)->>'pro_basis' = 'trial' AND (fc.st(2)->>'tenure_days')::int = 0, fc.st(2)::text);
-- 3. PRO pagado con 120 días pagados: suma y es elegible (nada de eso cambió).
SELECT fc.ok('pagado: pro_basis=paid, ≥ 90 días, elegible',
  fc.st(3)->>'pro_basis' = 'paid' AND (fc.st(3)->>'tenure_days')::int >= 90 AND (fc.st(3)->>'eligible')::boolean, fc.st(3)::text);
-- 4. Free: sin PRO, pro_basis null (la llave existe, con valor null).
SELECT fc.ok('free: is_pro false y pro_basis null',
  NOT (fc.st(4)->>'is_pro')::boolean AND fc.st(4) ? 'pro_basis' AND fc.st(4)->'pro_basis' = 'null'::jsonb, fc.st(4)::text);
-- 5. Suscripción vencida: sin PRO y sin base.
SELECT fc.ok('vencida: is_pro false y pro_basis null', NOT (fc.st(5)->>'is_pro')::boolean AND fc.st(5)->'pro_basis' = 'null'::jsonb, fc.st(5)::text);
-- 6. Contrato: se conservan todas las llaves anteriores (el cliente viejo sigue funcionando).
SELECT fc.ok('conserva las 16 llaves anteriores + pro_basis',
  (SELECT count(*) FROM jsonb_object_keys(fc.st(1)) k) = 17
  AND fc.st(1) ?& ARRAY['is_pro','tenure_days','required_days','eligible','basis','membership_status','has_password','password_status',
    'locked_until','activated_at','member_code','first_name','welcome_version_seen','onboarding','invitation_pending','members_requires_prive'],
  (SELECT string_agg(k, ',') FROM jsonb_object_keys(fc.st(1)) k));
-- 7. Solo los datos propios: cada quien ve su base, no la de otro.
SELECT fc.ok('cada cuenta ve solo su estado (1≠3)', fc.st(1)->>'pro_basis' <> fc.st(3)->>'pro_basis');
-- 8. anon no puede llamarla.
SELECT fc.ok('anon no ejecuta prive_status', fc.run('anon', NULL, 'SELECT public.prive_status()::text') LIKE 'ERR:permission denied%',
  fc.run('anon', NULL, 'SELECT public.prive_status()::text'));
-- 9. Sin sesión (authenticated sin sub) sigue siendo PRIVE_NO_SESSION.
SELECT fc.ok('sin usuario: PRIVE_NO_SESSION', fc.run('authenticated', NULL, 'SELECT public.prive_status()::text') LIKE 'ERR:PRIVE_NO_SESSION%',
  fc.run('authenticated', NULL, 'SELECT public.prive_status()::text'));

-- 10–12. Panel editorial: quien no es admin recibe 42501 (HTTP 403 en PostgREST) con el mismo código
-- EDITION_NOT_ADMIN; un admin sí entra.
SELECT fc.ok('panel editorial, no admin: 42501 EDITION_NOT_ADMIN (overview)',
  fc.state(fc.u(1), 'SELECT public.edition_admin_overview()::text') = '42501:EDITION_NOT_ADMIN',
  fc.state(fc.u(1), 'SELECT public.edition_admin_overview()::text'));
SELECT fc.ok('panel editorial, no admin: 42501 EDITION_NOT_ADMIN (preview)',
  fc.state(fc.u(3), 'SELECT public.edition_admin_preview(NULL)::text') = '42501:EDITION_NOT_ADMIN',
  fc.state(fc.u(3), 'SELECT public.edition_admin_preview(NULL)::text'));
SELECT fc.ok('panel editorial, admin: overview responde', fc.state(fc.u(4), 'SELECT public.edition_admin_overview()::text') = 'OK',
  fc.state(fc.u(4), 'SELECT public.edition_admin_overview()::text'));
