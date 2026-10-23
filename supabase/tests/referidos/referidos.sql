-- Promoción "Invita 5 amigos y gana 1 mes de PRO" (20261027080000_referidos_promo.sql).
-- Imprime "OK RFnn …" o "FALLA RFnn …". Corre con run.sh sobre una base desechable (nunca producción).
-- Personas (rf.u(n)):
--   1 Ana (invita; plan gratuito)          11–20 referidos de Ana
--   2 Pablo (invita; paga PRO en Stripe)    21–25 referidos de Pablo
--   3 Rita (invita; miembro de Privé)       31–35 referidos de Rita
--   4 Ciro (invita; cortesía indefinida)    41–45 referidos de Ciro
--   5 Nora (invita; prueba sin tarjeta)     51–55 referidos de Nora
--   6 Sofía (otra persona, para "solo responde por uno mismo")
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;
DROP SCHEMA IF EXISTS rf CASCADE;
CREATE SCHEMA rf;
GRANT USAGE ON SCHEMA rf TO authenticated, anon;
CREATE FUNCTION rf.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c8000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION rf.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '') END $$;
-- Ejecuta q como el usuario (rol authenticated) y devuelve el texto o ERR:<mensaje>.
CREATE FUNCTION rf.as_user(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false), set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
CREATE FUNCTION rf.as_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false);
  SET LOCAL ROLE anon;
  EXECUTE _q INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN coalesce(v, '<null>');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN 'ERR:' || SQLERRM;
END $$;
-- Cuenta con correo comprobado por Google (proven) o sin confirmar; nombre visible.
CREATE FUNCTION rf.mk(n int, _email text, _name text, _proven boolean) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, created_at, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (rf.u(n), _email, now() - interval '5 minutes',
          CASE WHEN _proven THEN now() - interval '5 minutes' END,
          CASE WHEN _proven THEN '{"provider":"google","providers":["google"]}'::jsonb ELSE '{"provider":"email","providers":["email"]}'::jsonb END,
          jsonb_build_object('full_name', _name));
  RETURN rf.u(n);
END $$;
CREATE FUNCTION rf.code(n int) RETURNS text LANGUAGE sql AS $$ SELECT invite_code FROM public.profiles WHERE id = rf.u(n) $$;
-- La persona n se une con el código de r (como la app: claim_referral con su sesión).
CREATE FUNCTION rf.join(n int, r int) RETURNS text LANGUAGE sql AS $$
  SELECT rf.as_user(rf.u(n), format('SELECT public.claim_referral(%L)::text', rf.code(r))) $$;
CREATE FUNCTION rf.trip(n int, _destino text DEFAULT 'Lisboa') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.trips (user_id, destino) VALUES (rf.u(n), _destino) $$;
-- Referido completo: correo comprobado, se une y crea su viaje.
CREATE FUNCTION rf.valid(n int, r int, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rf.mk(n, 'rf-' || n || '@example.test', _name, true);
  PERFORM rf.join(n, r);
  PERFORM rf.trip(n);
END $$;
CREATE FUNCTION rf.rewards(n int) RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM public.referral_rewards WHERE user_id = rf.u(n) $$;
CREATE FUNCTION rf.until(n int) RETURNS timestamptz LANGUAGE sql AS $$ SELECT comped_until FROM public.subscriptions WHERE user_id = rf.u(n) $$;
CREATE FUNCTION rf.days_left(n int) RETURNS numeric LANGUAGE sql AS $$
  SELECT round((extract(epoch FROM (rf.until(n) - now())) / 86400)::numeric) $$;
CREATE FUNCTION rf.st(n int) RETURNS text LANGUAGE sql AS $$ SELECT coalesce((SELECT status FROM public.subscriptions WHERE user_id = rf.u(n)), '-') $$;
CREATE FUNCTION rf.progress(n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN x LIKE 'ERR:%' THEN jsonb_build_object('err', x) ELSE x::jsonb END
    FROM rf.as_user(rf.u(n), 'SELECT public.referral_progress()::text') x $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rf TO authenticated, anon;

SELECT rf.mk(1, 'ana.lopez@gmail.com', 'Ana López', true);
SELECT rf.mk(6, 'rf-sofia@example.test', 'Sofía Ruiz', true);

-- ===================================================================== acceso
SELECT rf.ok('RF1 anon no lee premios, huellas ni referidos y no puede pedir progreso',
  rf.as_anon('SELECT count(*)::text FROM public.referral_rewards') LIKE 'ERR:%permission denied%'
  AND rf.as_anon('SELECT count(*)::text FROM public.stripe_card_customers') LIKE 'ERR:%permission denied%'
  AND rf.as_anon('SELECT count(*)::text FROM public.referrals') LIKE 'ERR:%permission denied%'
  AND rf.as_anon('SELECT public.referral_progress()::text') LIKE 'ERR:%permission denied%'
  AND rf.as_anon('SELECT public.admin_referral_rewards()::text') LIKE 'ERR:%permission denied%',
  rf.as_anon('SELECT public.referral_progress()::text'));
SELECT rf.ok('RF2 anon y authenticated no ejecutan las funciones internas (evaluar, aplicar, barrer, Stripe, reglas)',
  NOT has_function_privilege('authenticated', 'public.referral_evaluate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_apply_reward(uuid, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_rewards_sweep(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_claim_stripe_rewards(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_mark_stripe_reward(uuid, boolean, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_status(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.referral_reward_route(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.referral_evaluate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.referral_progress()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.referral_progress()', 'EXECUTE')
  AND rf.as_user(rf.u(1), format('SELECT public.referral_evaluate(%L)::text', rf.u(1))) LIKE 'ERR:%permission denied%');

-- ===================================================================== no autoreferido
SELECT rf.ok('RF3 nadie se refiere a sí mismo: claim_referral con su propio código no crea nada',
  rf.as_user(rf.u(1), format('SELECT public.claim_referral(%L)::text', rf.code(1))) = 'false'
  AND NOT EXISTS (SELECT 1 FROM public.referrals WHERE user_id = rf.u(1)), rf.code(1));
-- Misma persona con otro correo (Gmail ignora los puntos y la +etiqueta).
SELECT rf.mk(10, 'analopez+viajes@googlemail.com', 'Ana Otra', true);
SELECT rf.join(10, 1);
SELECT rf.trip(10);
SELECT rf.ok('RF4 una cuenta con el mismo correo normalizado (ana.lopez@gmail = analopez+viajes@googlemail) no cuenta',
  public.referral_status(rf.u(10), rf.u(1)) = 'no_cuenta'
  AND public.referral_email_key('Ana.Lopez+x@GoogleMail.com') = 'analopez@gmail.com'
  AND public.referral_email_key('a.b+c@empresa.mx') = 'a.b@empresa.mx',
  public.referral_status(rf.u(10), rf.u(1)));

-- ===================================================================== estados de cada referido
SELECT rf.mk(11, 'rf-11@example.test', 'Bea Ramírez Soto', false);        -- sin confirmar
SELECT rf.join(11, 1);
SELECT rf.ok('RF5a recién unida y sin correo comprobado: "falta_correo"', public.referral_status(rf.u(11), rf.u(1)) = 'falta_correo');
-- Autoconfirm (confirmado en el mismo instante del registro, proveedor email) no es prueba de correo.
UPDATE auth.users SET email_confirmed_at = created_at WHERE id = rf.u(11);
SELECT rf.ok('RF5b el autoconfirm de Supabase no cuenta como correo confirmado', public.referral_status(rf.u(11), rf.u(1)) = 'falta_correo');
-- Abre el enlace del buzón minutos después: comprobado.
UPDATE auth.users SET email_confirmed_at = created_at + interval '2 minutes' WHERE id = rf.u(11);
SELECT rf.ok('RF5c con el correo comprobado y sin viaje: "falta_viaje"', public.referral_status(rf.u(11), rf.u(1)) = 'falta_viaje');
SELECT rf.trip(11, '   ');
SELECT rf.ok('RF5d un viaje sin destino no cuenta', public.referral_status(rf.u(11), rf.u(1)) = 'falta_viaje');
SELECT rf.as_user(rf.u(11), 'WITH t AS (INSERT INTO public.trips (user_id, destino) VALUES (auth.uid(), ''Oaxaca'') RETURNING 1) SELECT count(*)::text FROM t');
SELECT rf.ok('RF5e al crear su primer viaje (desde la app, con RLS) "cuenta"', public.referral_status(rf.u(11), rf.u(1)) = 'cuenta');

-- ===================================================================== no cuenta dos veces
SELECT rf.join(11, 6) AS rejoin \gset
SELECT rf.ok('RF6 una persona ya referida no puede ser referida otra vez (ni por otro)',
  :'rejoin' = 'false' AND (SELECT count(*) FROM public.referrals WHERE user_id = rf.u(11)) = 1
  AND (SELECT referrer_id FROM public.referrals WHERE user_id = rf.u(11)) = rf.u(1), :'rejoin');
SELECT rf.ok('RF7 un usuario no puede escribir referidos, ligarlos a premios ni crearse premios',
  rf.as_user(rf.u(1), format('INSERT INTO public.referrals (user_id, referrer_id, code) VALUES (%L, %L, ''X'') RETURNING 1', rf.u(6), rf.u(1))) LIKE 'ERR:%permission denied%'
  AND rf.as_user(rf.u(1), 'UPDATE public.referrals SET reward_id = NULL RETURNING 1') LIKE 'ERR:%permission denied%'
  AND rf.as_user(rf.u(1), format('INSERT INTO public.referral_rewards (user_id, seq, status, route, plan_at_award) VALUES (%L, 9, ''applied'', ''comp'', ''x'') RETURNING 1', rf.u(1))) LIKE 'ERR:%permission denied%'
  AND rf.as_user(rf.u(1), 'DELETE FROM public.referrals RETURNING 1') LIKE 'ERR:%permission denied%');

-- 3 válidos más (4 en total): todavía sin premio.
SELECT rf.valid(12, 1, 'Carla Núñez');
SELECT rf.valid(13, 1, 'Dani');
SELECT rf.valid(14, 1, NULL);
SELECT rf.ok('RF8 con 4 referidos válidos no hay premio y el progreso dice 4',
  rf.rewards(1) = 0 AND (rf.progress(1)->>'counting')::int = 4 AND rf.st(1) = '-',
  rf.progress(1)::text);
SELECT rf.ok('RF9 el progreso muestra nombre de pila e inicial, y nunca correos',
  (SELECT jsonb_agg(j->>'name' ORDER BY j->>'name') FROM jsonb_array_elements(rf.progress(1)->'joined') j)::text
    = '["Ana O.", "Bea R.", "Carla N.", "Dani", null]'
  AND rf.progress(1)::text NOT LIKE '%@%' AND rf.progress(1)::text NOT LIKE '%Ramírez%',
  rf.progress(1)->>'joined');

-- ===================================================================== premio (plan gratuito)
SELECT rf.mk(15, 'rf-15@example.test', 'Eva Paz', true);
SELECT rf.join(15, 1);
SELECT rf.ok('RF10a el 5.º sin viaje aún no da premio', rf.rewards(1) = 0);
SELECT rf.trip(15);   -- el trigger de trips lo vuelve válido y da el premio
SELECT rf.ok('RF10b al 5.º válido: 1 premio aplicado como 30 días de cortesía y PRO activo',
  rf.rewards(1) = 1 AND rf.st(1) = 'comped' AND rf.days_left(1) = 30 AND public.is_pro(rf.u(1))
  AND (SELECT status || '/' || route || '/' || plan_at_award || '/' || referrals_covered || '/' || days
         FROM public.referral_rewards WHERE user_id = rf.u(1)) = 'applied/comp/free/5/30',
  rf.st(1) || ' ' || coalesce(rf.days_left(1)::text, '-'));
SELECT rf.ok('RF10c cada uno de los 5 quedó ligado a ese premio (y el alias de Ana no)',
  (SELECT count(*) FROM public.referrals WHERE referrer_id = rf.u(1) AND reward_id IS NOT NULL) = 5
  AND (SELECT reward_id FROM public.referrals WHERE user_id = rf.u(10)) IS NULL);
SELECT rf.until(1) AS until1 \gset
-- El trigger corre otra vez (más viajes, otra confirmación, evaluar a mano dos veces): nada cambia.
SELECT rf.trip(12, 'Roma');
UPDATE auth.users SET email_confirmed_at = email_confirmed_at WHERE id = rf.u(13);
SELECT public.referral_evaluate(rf.u(1)) AS ev1 \gset
SELECT public.referral_evaluate(rf.u(1)) AS ev2 \gset
SELECT public.referral_rewards_sweep() AS sw1 \gset
SELECT rf.ok('RF11 el premio no se duplica si el trigger o la evaluación corren de nuevo',
  rf.rewards(1) = 1 AND rf.until(1) = :'until1'::timestamptz AND :'ev1' = '0' AND :'ev2' = '0'
  AND (:'sw1'::jsonb->>'new_rewards')::int = 0, :'sw1');
SELECT rf.ok('RF12 un aviso "¡Ganaste 1 mes de PRO!" en la app, una sola vez',
  (SELECT count(*) FROM public.notifications WHERE user_id = rf.u(1) AND title = '¡Ganaste 1 mes de PRO!') = 1
  AND (SELECT body FROM public.notifications WHERE user_id = rf.u(1) AND title = '¡Ganaste 1 mes de PRO!')
      LIKE '5 amigos ya cuentan. Tienes IATOS PRO de cortesía hasta el __/__/____.');
SELECT rf.ok('RF13 el progreso tras el premio: 1 premio, 0 de 5 hacia el siguiente, todos "cuenta"',
  (rf.progress(1)->>'rewards')::int = 1 AND (rf.progress(1)->>'counting')::int = 0
  AND (rf.progress(1)->'last_reward'->>'status') = 'applied' AND rf.progress(1)->>'comped_until' IS NOT NULL
  AND (SELECT count(*) FROM jsonb_array_elements(rf.progress(1)->'joined') j WHERE j->>'status' = 'cuenta') = 5
  AND (SELECT count(*) FROM jsonb_array_elements(rf.progress(1)->'joined') j WHERE j->>'status' = 'no_cuenta') = 1,
  rf.progress(1)::text);

-- 7 válidos: 2 hacia el siguiente. 10 válidos: 2 premios y 60 días (se suman).
SELECT rf.valid(16, 1, 'Fer Gil');
SELECT rf.valid(17, 1, 'Gabo Luna');
SELECT rf.ok('RF14 con 7 válidos: sigue 1 premio y el progreso dice 2 de 5',
  rf.rewards(1) = 1 AND (rf.progress(1)->>'counting')::int = 2, rf.progress(1)->>'counting');
SELECT rf.valid(18, 1, 'Hugo Mar');
SELECT rf.valid(19, 1, 'Iris Sol');
SELECT rf.valid(20, 1, 'Juan Paz');
SELECT rf.ok('RF15 con 10 válidos: 2 premios y los días se suman (60)',
  rf.rewards(1) = 2 AND rf.days_left(1) = 60 AND (SELECT max(seq) FROM public.referral_rewards WHERE user_id = rf.u(1)) = 2,
  rf.rewards(1) || ' ' || coalesce(rf.days_left(1)::text, '-'));

-- ===================================================================== solo responde por uno mismo
SELECT rf.ok('RF16 referral_progress no recibe parámetros y cada quien ve solo lo suyo',
  (SELECT count(*) FROM pg_proc WHERE proname = 'referral_progress' AND pronamespace = 'public'::regnamespace) = 1
  AND (SELECT pronargs FROM pg_proc WHERE proname = 'referral_progress' AND pronamespace = 'public'::regnamespace) = 0
  AND jsonb_array_length(rf.progress(6)->'joined') = 0 AND (rf.progress(6)->>'rewards')::int = 0
  AND jsonb_array_length(rf.progress(12)->'joined') = 0
  AND rf.as_user(rf.u(6), 'SELECT count(*)::text FROM public.referrals') = '0'
  AND rf.as_user(rf.u(6), format('SELECT public.referral_progress(%L)::text', rf.u(1))) LIKE 'ERR:%does not exist%',
  rf.progress(6)::text);
SELECT rf.ok('RF17 un usuario no puede darse días de cortesía (la fila de suscripción no cambia)',
  rf.as_user(rf.u(6), $q$WITH x AS (UPDATE public.subscriptions SET status = 'comped', comped_until = now() + interval '1 year' WHERE user_id = auth.uid() RETURNING 1) SELECT count(*)::text FROM x$q$) IN ('0', 'ERR:permission denied for table subscriptions')
  AND rf.as_user(rf.u(1), $q$WITH x AS (UPDATE public.subscriptions SET comped_until = now() + interval '1 year' WHERE user_id = auth.uid() RETURNING 1) SELECT count(*)::text FROM x$q$) IN ('0', 'ERR:permission denied for table subscriptions')
  AND rf.days_left(1) = 60 AND rf.st(6) = '-');

-- ===================================================================== misma tarjeta
SELECT rf.mk(7, 'rf-tarjeta-a@example.test', 'Tere', true);
INSERT INTO public.subscriptions (user_id, status, stripe_customer_id) VALUES (rf.u(7), 'canceled', 'cus_rf_7');
SELECT rf.mk(8, 'rf-tarjeta-b@example.test', 'Ulises Vega', true);
SELECT rf.join(8, 7);
SELECT rf.trip(8);
INSERT INTO public.subscriptions (user_id, status, stripe_customer_id) VALUES (rf.u(8), 'canceled', 'cus_rf_8');
SELECT rf.ok('RF18a antes de ver la tarjeta, el referido cuenta', public.referral_status(rf.u(8), rf.u(7)) = 'cuenta');
SELECT public.claim_trial_fingerprint('fp_rf_misma_tarjeta', 'sub_rf_7', 'cus_rf_7') AS c7 \gset
SELECT public.claim_trial_fingerprint('fp_rf_misma_tarjeta', 'sub_rf_8', 'cus_rf_8') AS c8 \gset
SELECT rf.ok('RF18b la misma huella de tarjeta en quien invita y su referido: no cuenta (y la prueba de 30 días sigue igual)',
  public.referral_status(rf.u(8), rf.u(7)) = 'no_cuenta'
  AND (:'c7'::jsonb->>'reason') = 'new_card' AND (:'c8'::jsonb->>'reason') = 'card_already_had_trial'
  AND (SELECT count(*) FROM public.stripe_card_customers WHERE fingerprint = 'fp_rf_misma_tarjeta') = 2,
  :'c7' || ' ' || :'c8');

-- ===================================================================== quien ya paga en Stripe
SELECT rf.mk(2, 'rf-pablo@example.test', 'Pablo', true);
SELECT public.apply_stripe_subscription(rf.u(2), 'cus_rf_2', 'sub_rf_2', 'active', NULL, now() + interval '12 days', false, 'price_rf', 'mxn', now());
SELECT md5(row(s.*)::text) AS sub2 FROM public.subscriptions s WHERE user_id = rf.u(2) \gset
SELECT rf.valid(21, 2, 'Ka'); SELECT rf.valid(22, 2, 'Lu'); SELECT rf.valid(23, 2, 'Mo'); SELECT rf.valid(24, 2, 'Ni'); SELECT rf.valid(25, 2, 'Ñu');
SELECT rf.ok('RF19 quien paga en Stripe: premio pendiente (route stripe) y su suscripción NO cambia',
  rf.rewards(2) = 1
  AND (SELECT status || '/' || route || '/' || plan_at_award FROM public.referral_rewards WHERE user_id = rf.u(2)) = 'pending/stripe/stripe_active'
  AND (SELECT md5(row(s.*)::text) FROM public.subscriptions s WHERE user_id = rf.u(2)) = :'sub2'
  AND public.is_pro(rf.u(2)),
  (SELECT status || '/' || route FROM public.referral_rewards WHERE user_id = rf.u(2)));
SELECT rf.ok('RF20 con el flag apagado: el aviso dice "guardado" y Stripe no recibe nada',
  (SELECT body FROM public.notifications WHERE user_id = rf.u(2) AND title = '¡Ganaste 1 mes de PRO!')
    = '5 amigos ya cuentan. Tu mes gratis está guardado; te avisaremos cuando se aplique.'
  AND public.referral_claim_stripe_rewards(10) = '{"enabled": false, "rewards": []}'::jsonb
  AND (rf.progress(2)->>'stripe_apply_enabled')::boolean = false
  AND public.referral_rewards_sweep() IS NOT NULL
  AND (SELECT status FROM public.referral_rewards WHERE user_id = rf.u(2)) = 'pending'
  AND (SELECT md5(row(s.*)::text) FROM public.subscriptions s WHERE user_id = rf.u(2)) = :'sub2');
-- Encendido (solo en la prueba): entrega el premio una vez, con su cliente; luego se confirma.
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'referral_stripe_apply_enabled';
SELECT public.referral_claim_stripe_rewards(10) AS cl1 \gset
SELECT public.referral_claim_stripe_rewards(10) AS cl2 \gset
SELECT rf.ok('RF21 flag encendido: el reclamo entrega el premio de Pablo con su cliente, y no dos veces',
  (:'cl1'::jsonb->>'enabled')::boolean AND jsonb_array_length(:'cl1'::jsonb->'rewards') = 1
  AND (:'cl1'::jsonb->'rewards'->0->>'customer_id') = 'cus_rf_2'
  AND jsonb_array_length(:'cl2'::jsonb->'rewards') = 0
  AND (rf.progress(2)->>'stripe_apply_enabled')::boolean, :'cl1' || ' ' || :'cl2');
SELECT public.referral_mark_stripe_reward((:'cl1'::jsonb->'rewards'->0->>'id')::uuid, false, NULL, 'Stripe 500') AS mk_fail \gset
SELECT rf.ok('RF22 si Stripe falla, vuelve a pendiente con el error (no se pierde)',
  (SELECT status || '/' || last_error || '/' || stripe_attempts FROM public.referral_rewards WHERE user_id = rf.u(2)) = 'pending/Stripe 500/1');
UPDATE public.referral_rewards SET claimed_at = NULL WHERE user_id = rf.u(2);
SELECT public.referral_claim_stripe_rewards(10) AS cl3 \gset
SELECT public.referral_mark_stripe_reward((:'cl3'::jsonb->'rewards'->0->>'id')::uuid, true, 'cbtxn_rf_1', NULL) AS mk_ok \gset
SELECT public.referral_mark_stripe_reward((:'cl3'::jsonb->'rewards'->0->>'id')::uuid, true, 'cbtxn_rf_2', NULL) AS mk_again \gset
SELECT rf.ok('RF23 confirmado: aplicado con la referencia de Stripe; confirmar otra vez no cambia nada',
  (SELECT status || '/' || stripe_ref FROM public.referral_rewards WHERE user_id = rf.u(2)) = 'applied/cbtxn_rf_1'
  AND :'mk_ok' = 't' AND :'mk_again' = 'f'
  AND (SELECT count(*) FROM public.notifications WHERE user_id = rf.u(2) AND title = 'Tu mes gratis de PRO ya se aplicó') = 1
  AND (SELECT md5(row(s.*)::text) FROM public.subscriptions s WHERE user_id = rf.u(2)) = :'sub2');
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'referral_stripe_apply_enabled';

-- ===================================================================== Privé y cortesía indefinida
SELECT rf.mk(3, 'rf-rita@example.test', 'Rita', true);
INSERT INTO public.prive_memberships (user_id, status, basis) VALUES (rf.u(3), 'active', 'grant');
SELECT rf.valid(31, 3, 'Oli'); SELECT rf.valid(32, 3, 'Pia'); SELECT rf.valid(33, 3, 'Quim'); SELECT rf.valid(34, 3, 'Rosa'); SELECT rf.valid(35, 3, 'Saúl');
SELECT rf.ok('RF24a miembro de Privé: el premio queda guardado (route prive), sin tocar su suscripción',
  (SELECT status || '/' || route FROM public.referral_rewards WHERE user_id = rf.u(3)) = 'pending/prive' AND rf.st(3) = '-');
UPDATE public.prive_memberships SET status = 'revoked', revoked_at = now(), revoke_kind = 'other' WHERE user_id = rf.u(3);
SELECT public.referral_rewards_sweep() AS sw3 \gset
SELECT rf.ok('RF24b no se pierde: si deja Privé y queda sin PRO, el barrido lo aplica como 30 días de cortesía',
  (SELECT status || '/' || route FROM public.referral_rewards WHERE user_id = rf.u(3)) = 'applied/comp'
  AND rf.st(3) = 'comped' AND rf.days_left(3) = 30 AND public.is_pro(rf.u(3))
  AND (SELECT count(*) FROM public.notifications WHERE user_id = rf.u(3) AND title = 'Tu mes gratis de PRO ya está activo') = 1, :'sw3');

SELECT rf.mk(4, 'rf-ciro@example.test', 'Ciro', true);
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (rf.u(4), 'comped', 'pro');
SELECT rf.valid(41, 4, 'Tito'); SELECT rf.valid(42, 4, 'Uma'); SELECT rf.valid(43, 4, 'Vero'); SELECT rf.valid(44, 4, 'Wen'); SELECT rf.valid(45, 4, 'Xime');
SELECT rf.ok('RF25 cortesía indefinida: sigue sin vencimiento y el premio queda guardado',
  (SELECT status || '/' || route || '/' || plan_at_award FROM public.referral_rewards WHERE user_id = rf.u(4)) = 'pending/cortesia_indefinida/comped'
  AND rf.st(4) = 'comped' AND rf.until(4) IS NULL AND public.is_pro(rf.u(4)));

-- ===================================================================== prueba sin tarjeta: se suman días
SELECT rf.mk(5, 'rf-nora@example.test', 'Nora', true);
INSERT INTO public.subscriptions (user_id, status, plan, trial_end, current_period_end)
VALUES (rf.u(5), 'trialing', 'pro', now() + interval '10 days', now() + interval '10 days')
ON CONFLICT (user_id) DO UPDATE SET status = 'trialing', trial_end = EXCLUDED.trial_end, current_period_end = EXCLUDED.current_period_end;
SELECT rf.valid(51, 5, 'Yaz'); SELECT rf.valid(52, 5, 'Zoe'); SELECT rf.valid(53, 5, 'Alo'); SELECT rf.valid(54, 5, 'Bru'); SELECT rf.valid(55, 5, 'Cata');
SELECT rf.ok('RF26 con prueba sin tarjeta vigente (10 días): pasa a cortesía y se suman los 30 (40)',
  rf.st(5) = 'comped' AND rf.days_left(5) = 40 AND public.is_pro(rf.u(5)), rf.st(5) || ' ' || coalesce(rf.days_left(5)::text, '-'));

-- ===================================================================== vencimiento y Stripe
UPDATE public.subscriptions SET comped_until = now() - interval '1 minute' WHERE user_id = rf.u(5);
SELECT rf.ok('RF27a la cortesía de referidos vencida ya no es PRO (y la indefinida sí)',
  NOT public.is_pro(rf.u(5)) AND rf.st(5) = 'comped' AND public.is_pro(rf.u(4)));
SELECT public.apply_stripe_subscription(rf.u(5), 'cus_rf_5', 'sub_rf_5', 'active', NULL, now() + interval '30 days', false, 'price_rf', 'mxn', now()) AS ap5 \gset
SELECT rf.ok('RF27b vencida, ya no bloquea a Stripe: si empieza a pagar, se aplica su suscripción y se borra la fecha',
  (:'ap5'::jsonb->>'applied')::boolean AND rf.st(5) = 'active' AND rf.until(5) IS NULL AND public.is_pro(rf.u(5)), :'ap5');
SELECT public.apply_stripe_subscription(rf.u(1), 'cus_rf_1', 'sub_rf_1_viejo', 'canceled', NULL, now() - interval '1 day', false, 'price_rf', 'mxn', now()) AS ap1 \gset
SELECT rf.ok('RF28 vigente, un evento de Stripe que no da acceso no le quita la cortesía',
  (:'ap1'::jsonb->>'reason') = 'comped' AND rf.st(1) = 'comped' AND rf.days_left(1) = 60, :'ap1');
SELECT rf.ok('RF29 una cortesía indefinida sigue intocable para Stripe (como siempre)',
  (public.apply_stripe_subscription(rf.u(4), 'cus_rf_4', 'sub_rf_4', 'active', NULL, now() + interval '30 days', false, 'price_rf', 'mxn', now())->>'reason') = 'comped'
  AND rf.st(4) = 'comped' AND rf.until(4) IS NULL);
UPDATE public.subscriptions SET comped_until = now() - interval '1 minute' WHERE user_id = rf.u(3);
SELECT public.referral_rewards_sweep() AS sw4 \gset
SELECT rf.ok('RF30 el barrido devuelve al plan gratuito las cortesías de referidos vencidas',
  rf.st(3) = 'canceled' AND rf.until(3) IS NULL AND NOT public.is_pro(rf.u(3)) AND (:'sw4'::jsonb->>'expired')::int >= 1, :'sw4');
-- La cortesía de la lista (comp_grants) no vence aunque la fila traiga una fecha de referidos.
INSERT INTO public.comp_grants (email) VALUES ('rf-ana-lista@example.test') ON CONFLICT DO NOTHING;
UPDATE auth.users SET email = 'rf-ana-lista@example.test' WHERE id = rf.u(6);
UPDATE auth.users SET email_confirmed_at = clock_timestamp() + interval '1 second' WHERE id = rf.u(6);
INSERT INTO public.subscriptions (user_id, status, plan, comped_until) VALUES (rf.u(6), 'comped', 'pro', now() + interval '3 days')
ON CONFLICT (user_id) DO UPDATE SET status = 'comped', comped_until = now() + interval '3 days';
SELECT rf.ok('RF31 si la persona está en comp_grants, su cortesía queda sin vencimiento',
  public.has_comp_grant(rf.u(6)) AND rf.st(6) = 'comped' AND rf.until(6) IS NULL, coalesce(rf.until(6)::text, 'null'));

-- ===================================================================== cuentas borradas
DELETE FROM public.referrals WHERE user_id = rf.u(20);   -- lo que hace purge_account_data al borrar la cuenta
DELETE FROM auth.users WHERE id = rf.u(20);
SELECT public.referral_evaluate(rf.u(1)) AS ev3 \gset
SELECT rf.ok('RF32 si un referido borra su cuenta, el premio ya dado se queda y no se da otro',
  rf.rewards(1) = 2 AND :'ev3' = '0' AND rf.days_left(1) = 60);

-- ===================================================================== administración
INSERT INTO public.admins (user_id) VALUES (rf.u(7)) ON CONFLICT DO NOTHING;
SELECT rf.ok('RF33 el panel de admin ve cuántos premios se dieron; los demás no',
  rf.as_user(rf.u(1), 'SELECT public.admin_referral_rewards()::text') LIKE 'ERR:%not_authorized%'
  AND (rf.as_user(rf.u(7), 'SELECT public.admin_referral_rewards()::text')::jsonb->>'total')::int
      = (SELECT count(*) FROM public.referral_rewards)
  AND (rf.as_user(rf.u(7), 'SELECT public.admin_referral_rewards()::text')::jsonb->>'applied')::int
      = (SELECT count(*) FROM public.referral_rewards WHERE status = 'applied'),
  rf.as_user(rf.u(7), 'SELECT public.admin_referral_rewards()::text'));
DELETE FROM public.admins WHERE user_id = rf.u(7);

-- ===================================================================== limpieza
DELETE FROM public.notifications WHERE user_id IN (SELECT id FROM auth.users WHERE id::text LIKE 'c8000000-%');
DELETE FROM public.referrals WHERE referrer_id IN (SELECT id FROM auth.users WHERE id::text LIKE 'c8000000-%');
DELETE FROM public.referral_rewards WHERE user_id IN (SELECT id FROM auth.users WHERE id::text LIKE 'c8000000-%');
DELETE FROM public.stripe_card_customers WHERE fingerprint LIKE 'fp_rf_%';
DELETE FROM public.stripe_trial_fingerprints WHERE fingerprint LIKE 'fp_rf_%';
DELETE FROM public.comp_grants WHERE email LIKE 'rf-%@example.test';
DROP SCHEMA rf CASCADE;
