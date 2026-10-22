-- Cierre de auditoría (grupo prive): AUD-01 (validez de la sesión de Auth en prive_require) y NEW-01
-- (revocar una concesión con la invitación pendiente). La corre run.sh después de prive.sql, sobre la
-- misma base desechable. Cada caso imprime "OK <id> …" o "FALLA <id> …".
--
-- Roles reales: cada llamada "como usuario" pone los claims del JWT (request.jwt.claims, como PostgREST)
-- y hace SET ROLE authenticated; las funciones de servidor se llaman como service_role.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;

DROP SCHEMA IF EXISTS aud CASCADE;
CREATE SCHEMA aud;
GRANT USAGE ON SCHEMA aud TO anon, authenticated, service_role;

CREATE FUNCTION aud.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION aud.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'b1000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION aud.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION aud.pw(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Aud-clave-larga-' || n $$;

-- Miembro activo: PRO vigente, 100 días pagados, invitación aceptada y contraseña Privé.
CREATE FUNCTION aud.member(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (aud.u(n), 'aud' || n || '@example.test', now(), jsonb_build_object('full_name', 'Aud ' || n)) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, full_name, email) VALUES (aud.u(n), 'Aud ' || n, 'aud' || n || '@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (aud.u(n), 'active', 'sub_aud' || n, 'cus_aud' || n, now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  PERFORM public.prive_record_paid_period(aud.u(n), 'in_aud_' || n, 'sub_aud' || n, 'cus_aud' || n,
    now() - interval '100 days', now() + interval '1 day', 19900, 'mxn', 'test');
  PERFORM public.prive_invite_user(aud.u(n), 'tenure', 'system');
  PERFORM public.prive_accept_invitation(aud.u(n), NULL);
  PERFORM public.prive_set_password(aud.u(n), aud.pw(n), 'ok');
END $$;
-- Inicio de sesión en IATOS: crea la fila de auth.sessions (lo hace GoTrue).
CREATE FUNCTION aud.auth_login(n int, sid int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.sessions (id, user_id) VALUES (aud.sid(sid)::uuid, aud.u(n)) ON CONFLICT DO NOTHING $$;
-- Desbloqueo como lo hace prive-access (service_role) con el session_id del JWT (NULL = sin claim).
CREATE FUNCTION aud.unlock(n int, sid int) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.prive_unlock(aud.u(n), aud.pw(n), NULL, CASE WHEN sid IS NULL THEN NULL ELSE aud.sid(sid) END);
  RESET ROLE;
  RETURN r;
END $$;
-- prive_require como usuario n con un JWT cuyo session_id es sid (NULL = sin claim) y un exp futuro
-- (el JWT sigue vigente aunque la sesión de Auth ya no exista).
CREATE FUNCTION aud.req_as(n int, sid int, ps text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', aud.u(n)::text, true),
          set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', aud.u(n), 'role', 'authenticated',
            'aud', 'authenticated', 'exp', extract(epoch FROM now() + interval '50 minutes')::bigint,
            'session_id', CASE WHEN sid IS NULL THEN NULL ELSE aud.sid(sid) END))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.prive_require(ps);
    v := 'OK';
  EXCEPTION WHEN raise_exception THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'ERROR ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v;
END $$;
-- Llama TODAS las RPC Privé que authenticated puede ejecutar y que reciben _ps (descubiertas en el
-- catálogo, no una lista fija), como usuario n en la sesión de Auth sid. Devuelve "fn=resultado" por
-- RPC: "ERR:<mensaje>" si la base negó, "RET" si devolvió algo.
CREATE FUNCTION aud.call_all(n int, sid int, ps text) RETURNS TABLE (fn text, result text) LANGUAGE plpgsql AS $$
DECLARE r record; v_args text; v_sql text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', aud.u(n)::text, true),
          set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', aud.u(n), 'role', 'authenticated',
            'session_id', CASE WHEN sid IS NULL THEN NULL ELSE aud.sid(sid) END))::text, true);
  FOR r IN SELECT p.proname, p.proargnames, p.proargtypes::oid[] AS types, p.pronargs, p.proretset FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'prive_require'
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND '_ps' = ANY (coalesce(p.proargnames, '{}')) ORDER BY p.proname LOOP
    SELECT string_agg(CASE WHEN r.proargnames[i] = '_ps' THEN quote_literal(ps) || '::text'
                           ELSE 'NULL::' || format_type(r.types[i - 1], NULL) END, ', ' ORDER BY i)
      INTO v_args FROM generate_series(1, r.pronargs) i;
    v_sql := CASE WHEN r.proretset THEN format('SELECT count(*)::text FROM public.%I(%s)', r.proname, v_args)
                  ELSE format('SELECT public.%I(%s)::text', r.proname, v_args) END;
    fn := r.proname;
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE v_sql INTO result;
      result := 'RET';
    EXCEPTION WHEN OTHERS THEN result := 'ERR:' || SQLERRM;
    END;
    RESET ROLE;
    RETURN NEXT;
  END LOOP;
END $$;
-- Resumen: cuántas RPC hay y cuáles NO respondieron con el código esperado.
CREATE FUNCTION aud.all_denied(n int, sid int, ps text, code text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN count(*) >= 10 AND count(*) FILTER (WHERE result <> 'ERR:' || code) = 0 THEN 'OK'
              ELSE count(*) || ' rpc; no negadas con ' || code || ': ' ||
                   coalesce(string_agg(fn || '=' || left(result, 40), ', ') FILTER (WHERE result <> 'ERR:' || code), '') END
    FROM aud.call_all(n, sid, ps) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA aud TO anon, authenticated, service_role;

SELECT count(*) FROM (SELECT aud.member(n) FROM generate_series(1, 12) n) t;

-- ===================================================================== AUD-01 · sesión de Auth
-- S01 válida.
SELECT aud.auth_login(1, 101);
SELECT (aud.unlock(1, 101))->>'token' AS t1 \gset
SELECT aud.ok('S01 sesión de Auth viva + sesión Privé vigente → OK', aud.req_as(1, 101, :'t1') = 'OK', aud.req_as(1, 101, :'t1'));
SELECT aud.ok('S01b control: con una sesión válida las RPC de contenido pasan prive_require (la prueba S11 no es vacía)',
  (SELECT count(*) FILTER (WHERE result LIKE 'ERR:PRIVE\_%') = 0 AND count(*) >= 10 FROM aud.call_all(1, 101, :'t1')),
  (SELECT string_agg(fn || '=' || left(result, 50), ', ') FROM aud.call_all(1, 101, :'t1')));

-- S02 cerrar sesión en IATOS (GoTrue borra la fila) con el JWT aún vigente (exp en 50 min).
SELECT aud.auth_login(2, 201);
SELECT (aud.unlock(2, 201))->>'token' AS t2 \gset
DELETE FROM auth.sessions WHERE id = aud.sid(201)::uuid;
SELECT aud.ok('S02 sesión de Auth cerrada (JWT sin vencer) → PRIVE_SESSION_INVALID', aud.req_as(2, 201, :'t2') = 'PRIVE_SESSION_INVALID', aud.req_as(2, 201, :'t2'));

-- S03 cierre global (signOut scope=global borra TODAS las sesiones de la cuenta).
SELECT aud.auth_login(3, 301), aud.auth_login(3, 302);
SELECT (aud.unlock(3, 301))->>'token' AS t3a \gset
SELECT (aud.unlock(3, 302))->>'token' AS t3b \gset
SELECT aud.req_as(3, 301, :'t3a') AS r3a0 \gset
DELETE FROM auth.sessions WHERE user_id = aud.u(3);
SELECT aud.ok('S03 cierre global: las sesiones Privé de todos los dispositivos dejan de valer',
  :'r3a0' = 'OK' AND aud.req_as(3, 301, :'t3a') = 'PRIVE_SESSION_INVALID' AND aud.req_as(3, 302, :'t3b') = 'PRIVE_SESSION_INVALID');

-- S04 cuenta suspendida (auth.users.banned_until en el futuro) con su sesión de Auth intacta.
SELECT aud.auth_login(4, 401);
SELECT (aud.unlock(4, 401))->>'token' AS t4 \gset
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = aud.u(4);
SELECT aud.req_as(4, 401, :'t4') AS r4 \gset
SELECT aud.unlock(4, 401) AS u4 \gset
UPDATE auth.users SET banned_until = now() - interval '1 minute' WHERE id = aud.u(4);
SELECT aud.ok('S04 cuenta suspendida → PRIVE_SESSION_INVALID y no puede desbloquear; al vencer la suspensión vuelve a entrar',
  :'r4' = 'PRIVE_SESSION_INVALID' AND (:'u4'::jsonb->>'ok') = 'false' AND aud.req_as(4, 401, :'t4') = 'OK',
  'req=' || :'r4' || ' unlock=' || :'u4');

-- S05 cuenta borrada en modo suave (auth.users.deleted_at) y S05b borrada de verdad.
SELECT aud.auth_login(5, 501);
SELECT (aud.unlock(5, 501))->>'token' AS t5 \gset
UPDATE auth.users SET deleted_at = now() WHERE id = aud.u(5);
SELECT aud.ok('S05 cuenta borrada (deleted_at) → PRIVE_SESSION_INVALID', aud.req_as(5, 501, :'t5') = 'PRIVE_SESSION_INVALID', aud.req_as(5, 501, :'t5'));
SELECT aud.auth_login(6, 601);
SELECT (aud.unlock(6, 601))->>'token' AS t6 \gset
DELETE FROM auth.users WHERE id = aud.u(6);
SELECT aud.ok('S05b cuenta eliminada: el JWT que sobrevive no abre nada y no quedan sesiones',
  aud.req_as(6, 601, :'t6') <> 'OK' AND NOT EXISTS (SELECT 1 FROM prive_sessions WHERE user_id = aud.u(6))
  AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = aud.u(6)), aud.req_as(6, 601, :'t6'));

-- S06 sesión de Auth vencida por time-box (not_after en el pasado).
SELECT aud.auth_login(7, 701);
SELECT (aud.unlock(7, 701))->>'token' AS t7 \gset
UPDATE auth.sessions SET not_after = now() - interval '1 second' WHERE id = aud.sid(701)::uuid;
SELECT aud.ok('S06 sesión de Auth vencida (not_after) → PRIVE_SESSION_INVALID', aud.req_as(7, 701, :'t7') = 'PRIVE_SESSION_INVALID', aud.req_as(7, 701, :'t7'));

-- S07 falla al leer auth.sessions: el dueño de la función no tiene privilegios (como si Supabase
-- quitara el SELECT a postgres). Se simula cambiando el dueño dentro de una transacción.
-- S07: USAGE en el esquema auth pero sin SELECT en auth.sessions (insufficient_privilege al leer).
-- S07b: ni USAGE en el esquema auth.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aud_noread') THEN CREATE ROLE aud_noread NOLOGIN; END IF; END $$;
SELECT aud.auth_login(8, 801);
SELECT (aud.unlock(8, 801))->>'token' AS t8 \gset
BEGIN;
GRANT USAGE ON SCHEMA auth TO aud_noread;
ALTER FUNCTION public.prive_auth_session_alive(uuid, text) OWNER TO aud_noread;
SELECT aud.req_as(8, 801, :'t8') AS r8 \gset
ROLLBACK;
SELECT aud.ok('S07 sin SELECT en auth.sessions → se niega (fail closed)', :'r8' = 'PRIVE_SESSION_INVALID', :'r8');
BEGIN;
ALTER FUNCTION public.prive_auth_session_alive(uuid, text) OWNER TO aud_noread;
SELECT aud.req_as(8, 801, :'t8') AS r8s \gset
ROLLBACK;
SELECT aud.ok('S07b sin USAGE en el esquema auth → se niega con el código del contrato (no un error 500)', :'r8s' = 'PRIVE_SESSION_INVALID', :'r8s');

-- S08 la tabla no existe / S08b falta una columna (cambio de esquema de GoTrue).
BEGIN;
ALTER TABLE auth.sessions RENAME TO sessions_gone;
SELECT aud.req_as(8, 801, :'t8') AS r8b \gset
ROLLBACK;
SELECT aud.ok('S08 auth.sessions no existe → se niega (fail closed)', :'r8b' = 'PRIVE_SESSION_INVALID', :'r8b');
BEGIN;
ALTER TABLE auth.sessions RENAME COLUMN not_after TO not_after_old;
SELECT aud.req_as(8, 801, :'t8') AS r8c \gset
ROLLBACK;
SELECT aud.ok('S08b columna faltante en auth.sessions → se niega (fail closed)', :'r8c' = 'PRIVE_SESSION_INVALID', :'r8c');
SELECT aud.ok('S08c al recuperar la tabla la sesión legítima sigue sirviendo (no se bloqueó a nadie)', aud.req_as(8, 801, :'t8') = 'OK', aud.req_as(8, 801, :'t8'));

-- S09 sesión Privé sin ligar a una sesión de Auth (JWT sin session_id al desbloquear).
SELECT aud.auth_login(9, 901);
SELECT aud.unlock(9, NULL) AS u9 \gset
SELECT coalesce(:'u9'::jsonb->>'token', '') AS t9 \gset
SELECT aud.ok('S09 desbloquear sin session_id de Auth no emite sesión Privé',
  (:'u9'::jsonb->>'ok') = 'false' AND (:'u9'::jsonb ? 'token') = false, :'u9');
-- Aunque existiera una sesión sin ligar (emitida antes de esta corrección), no autoriza.
INSERT INTO prive_sessions (user_id, token_hash, auth_session_id, credential_version, expires_at, last_seen_at)
VALUES (aud.u(9), public.prive_sha256_hex('legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx'), NULL,
        (SELECT version FROM prive_credentials WHERE user_id = aud.u(9)), now() + interval '12 hours', now());
SELECT aud.ok('S09b sesión Privé sin ligar → PRIVE_SESSION_INVALID con cualquier JWT (con o sin session_id)',
  aud.req_as(9, 901, 'legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx') = 'PRIVE_SESSION_INVALID'
  AND aud.req_as(9, NULL, 'legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx') = 'PRIVE_SESSION_INVALID',
  aud.req_as(9, 901, 'legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx'));
SELECT aud.ok('S09c desbloquear con un session_id que no existe (o de otra cuenta) no emite sesión',
  (aud.unlock(9, 999))->>'ok' = 'false' AND (aud.unlock(9, 101))->>'ok' = 'false', (aud.unlock(9, 999))::text);

-- S10 nueva sesión de Auth (volver a iniciar sesión) exige desbloquear otra vez; desbloquear sí funciona.
SELECT aud.auth_login(10, 1001), aud.auth_login(10, 1002);
SELECT (aud.unlock(10, 1001))->>'token' AS t10 \gset
SELECT (aud.unlock(10, 1002))->>'token' AS t10b \gset
SELECT aud.ok('S10 la sesión Privé no se hereda a otro inicio de sesión; desbloquear en el nuevo sí',
  aud.req_as(10, 1002, :'t10') = 'PRIVE_SESSION_INVALID' AND aud.req_as(10, 1002, :'t10b') = 'OK' AND aud.req_as(10, 1001, :'t10') = 'OK');

-- S11 llamada directa a CADA RPC Privé con token viejo.
SELECT aud.ok('S11 token Privé de una sesión de Auth cerrada: todas las RPC con _ps → PRIVE_SESSION_INVALID', aud.all_denied(2, 201, :'t2', 'PRIVE_SESSION_INVALID') = 'OK', aud.all_denied(2, 201, :'t2', 'PRIVE_SESSION_INVALID'));
SELECT aud.ok('S11b token Privé sin ligar: todas las RPC → PRIVE_SESSION_INVALID', aud.all_denied(9, 901, 'legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx', 'PRIVE_SESSION_INVALID') = 'OK', aud.all_denied(9, 901, 'legacy-unbound-token-aud-9-xxxxxxxxxxxxxxxxxx', 'PRIVE_SESSION_INVALID'));
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = aud.u(4);
SELECT aud.ok('S11c cuenta suspendida: todas las RPC → PRIVE_SESSION_INVALID', aud.all_denied(4, 401, :'t4', 'PRIVE_SESSION_INVALID') = 'OK', aud.all_denied(4, 401, :'t4', 'PRIVE_SESSION_INVALID'));
SET ROLE service_role; SELECT public.prive_lock_session(aud.u(10), public.prive_sha256_hex(:'t10')); RESET ROLE;
SELECT aud.ok('S11d sesión Privé bloqueada (lock): todas las RPC → PRIVE_SESSION_INVALID', aud.all_denied(10, 1001, :'t10', 'PRIVE_SESSION_INVALID') = 'OK', aud.all_denied(10, 1001, :'t10', 'PRIVE_SESSION_INVALID'));
UPDATE prive_sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = public.prive_sha256_hex(:'t10b');
SELECT aud.ok('S11e sesión Privé inactiva > 2 h: todas las RPC → PRIVE_SESSION_EXPIRED', aud.all_denied(10, 1002, :'t10b', 'PRIVE_SESSION_EXPIRED') = 'OK', aud.all_denied(10, 1002, :'t10b', 'PRIVE_SESSION_EXPIRED'));

-- S12 termina PRO: con la contraseña correcta y la sesión Privé vieja, nada (camino real: claims +
-- SET ROLE authenticated + prive_require + RPC de contenido).
SELECT aud.auth_login(11, 1101);
SELECT (aud.unlock(11, 1101))->>'token' AS t11 \gset
SELECT aud.req_as(11, 1101, :'t11') AS r11a \gset
UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = aud.u(11);
SELECT aud.ok('S12 PRO terminado: prive_require → PRIVE_NOT_PRO con la sesión Privé vieja y la de Auth viva',
  :'r11a' = 'OK' AND aud.req_as(11, 1101, :'t11') = 'PRIVE_NOT_PRO', aud.req_as(11, 1101, :'t11'));
SELECT aud.ok('S12b PRO terminado: la contraseña correcta no abre sesión', (aud.unlock(11, 1101))->>'reason' = 'PRIVE_NOT_PRO', (aud.unlock(11, 1101))::text);
SELECT aud.ok('S12c PRO terminado: todas las RPC de contenido → PRIVE_NOT_PRO', aud.all_denied(11, 1101, :'t11', 'PRIVE_NOT_PRO') = 'OK', aud.all_denied(11, 1101, :'t11', 'PRIVE_NOT_PRO'));
UPDATE subscriptions SET status = 'canceled', current_period_end = now() + interval '5 days' WHERE user_id = aud.u(11);
SELECT aud.ok('S12d suscripción cancelada en Stripe (status canceled) → PRIVE_NOT_PRO', aud.req_as(11, 1101, :'t11') = 'PRIVE_NOT_PRO', aud.req_as(11, 1101, :'t11'));

-- S13 RPC de administración: authenticated (sin ser admin) y anon.
SELECT aud.auth_login(12, 1201);
DO $$
DECLARE f text; denied int := 0; allowed text := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', aud.u(12)::text, true), set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', jsonb_build_object('sub', aud.u(12), 'role', 'authenticated', 'session_id', aud.sid(1201))::text, true);
  SET LOCAL ROLE authenticated;
  FOREACH f IN ARRAY ARRAY[
    $q$SELECT public.admin_prive_metrics(30)$q$, $q$SELECT public.admin_prive_requests(NULL)$q$,
    $q$SELECT public.prive_request_transition(gen_random_uuid(), 'cancelado', NULL, NULL, NULL, NULL)$q$,
    $q$SELECT public.admin_grant_prive('x@example.test', 'motivo', NULL, 'yo mismo')$q$,
    $q$SELECT public.admin_revoke_prive_grant(gen_random_uuid(), 'motivo', 'yo mismo')$q$,
    $q$SELECT public.admin_revoke_prive(auth.uid(), 'admin', 'motivo', 'yo mismo')$q$,
    $q$SELECT public.admin_restore_prive(auth.uid(), 'motivo', 'yo mismo')$q$,
    $q$SELECT public.prive_sweep()$q$, $q$SELECT public.prive_evaluate_eligibility(10)$q$,
    $q$SELECT public.prive_auth_session_alive(auth.uid(), 'x')$q$]
  LOOP
    BEGIN
      EXECUTE f;
      allowed := allowed || ' | ' || f;
    EXCEPTION WHEN OTHERS THEN denied := denied + 1;
    END;
  END LOOP;
  RESET ROLE;
  IF allowed = '' THEN RAISE NOTICE 'OK S13 authenticated sin ser admin: % RPC de administración negadas', denied;
  ELSE RAISE NOTICE 'FALLA S13 permitidas:%', allowed; END IF;
END $$;
SELECT aud.ok('S13b anon y authenticated no tienen EXECUTE en las RPC admin_* de Privé ni en prive_sweep/prive_auth_session_alive',
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('admin_grant_prive', 'admin_revoke_prive_grant', 'admin_revoke_prive', 'admin_restore_prive', 'prive_sweep',
                       'prive_auth_session_alive', 'prive_withdraw_invitation', 'prive_remember_session', 'prive_session_idle_limit')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))));

-- ===================================================================== NEW-01 · revocar concesión con invitación pendiente
-- U13: PRO sin días pagados; la concesión lo invita; el correo sale (token emitido); se revoca.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (aud.u(13), 'aud13@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email) VALUES (aud.u(13), 'Aud 13', 'aud13@example.test') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (aud.u(13), 'active', 'sub_aud13', 'cus_aud13', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.admin_grant_prive('aud13@example.test', 'Cortesía de prueba', NULL, 'dueno@iatos.test') AS g13 \gset
SELECT token AS it13 FROM public.prive_claim_invitation_emails(10, aud.u(13)) \gset
SELECT public.admin_revoke_prive_grant((:'g13'::jsonb->>'grant_id')::uuid, 'Fin de la cortesía', 'dueno@iatos.test') AS rv13 \gset
SELECT public.admin_revoke_prive_grant((:'g13'::jsonb->>'grant_id')::uuid, 'Fin de la cortesía', 'dueno@iatos.test') AS rv13b \gset
RESET ROLE;
SELECT aud.ok('N01 revocar la concesión revoca la invitación pendiente y retira la membresía "invited" (auditado)',
  (:'g13'::jsonb->>'action') = 'invited'
  AND NOT EXISTS (SELECT 1 FROM prive_invitations WHERE user_id = aud.u(13) AND accepted_at IS NULL AND revoked_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = aud.u(13) AND status = 'invited')
  AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = aud.u(13) AND event = 'invitation_withdrawn')
  AND NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = aud.u(13) AND dedup_key = 'prive_invite:' || aud.u(13)),
  'inv=' || (SELECT string_agg(coalesce(revoked_at::text, 'viva'), ',') FROM prive_invitations WHERE user_id = aud.u(13))
  || ' memb=' || coalesce((SELECT status FROM prive_memberships WHERE user_id = aud.u(13)), 'none'));
SELECT aud.ok('N01b idempotente: revocar otra vez no duplica nada',
  (:'rv13b'::jsonb->>'ok') = 'false' AND (SELECT count(*) FROM prive_membership_events WHERE user_id = aud.u(13) AND event IN ('grant_revoked', 'invitation_withdrawn')) <= 2,
  :'rv13b');
SET ROLE service_role;
SELECT public.prive_accept_invitation(aud.u(13), public.prive_sha256_hex(:'it13')) AS ac13 \gset
SELECT public.prive_set_password(aud.u(13), 'Trece-aud-clave-larga', 'ok') AS sp13 \gset
SELECT count(*) AS cl13 FROM public.prive_claim_invitation_emails(10, aud.u(13)) \gset
RESET ROLE;
SELECT aud.ok('N01c el enlace de la invitación revocada no se acepta, no fija contraseña y no se vuelve a enviar',
  (:'ac13'::jsonb->>'ok') = 'false' AND (:'sp13'::jsonb->>'ok') = 'false' AND :cl13 = 0, :'ac13' || ' ' || :'sp13');
-- Más tarde cumple 90 días pagados: el enlace viejo (de la concesión) sigue sin servir; el cron lo
-- invita de nuevo por antigüedad, con invitación nueva.
SELECT public.prive_record_paid_period(aud.u(13), 'in_aud_13', 'sub_aud13', 'cus_aud13', now() - interval '95 days', now() + interval '1 day', 19900, 'mxn', 'test');
SET ROLE service_role;
SELECT public.prive_accept_invitation(aud.u(13), public.prive_sha256_hex(:'it13')) AS ac13b \gset
SELECT count(*) FROM (SELECT * FROM public.prive_evaluate_eligibility(500)) e;
RESET ROLE;
SELECT aud.ok('N01d al cumplir 90 días: el enlace viejo da INVITATION_EXPIRED y el cron crea una invitación nueva por antigüedad',
  (:'ac13b'::jsonb->>'code') = 'INVITATION_EXPIRED'
  AND (SELECT status = 'invited' AND basis = 'tenure' FROM prive_memberships WHERE user_id = aud.u(13))
  AND (SELECT count(*) FROM prive_invitations WHERE user_id = aud.u(13) AND accepted_at IS NULL AND revoked_at IS NULL) = 1,
  :'ac13b' || ' memb=' || coalesce((SELECT status || '/' || basis FROM prive_memberships WHERE user_id = aud.u(13)), 'none'));

-- U14: concesión + 100 días pagados: revocar la concesión NO le quita la invitación (sigue cumpliendo).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (aud.u(14), 'aud14@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (aud.u(14), 'active', 'sub_aud14', 'cus_aud14', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.admin_grant_prive('aud14@example.test', 'Cortesía de prueba', NULL, 'dueno@iatos.test') AS g14 \gset
RESET ROLE;
SELECT public.prive_record_paid_period(aud.u(14), 'in_aud_14', 'sub_aud14', 'cus_aud14', now() - interval '100 days', now() + interval '1 day', 19900, 'mxn', 'test');
SET ROLE service_role;
SELECT public.admin_revoke_prive_grant((:'g14'::jsonb->>'grant_id')::uuid, 'Fin de la cortesía', 'dueno@iatos.test');
SELECT public.prive_accept_invitation(aud.u(14), NULL) AS ac14 \gset
RESET ROLE;
SELECT aud.ok('N02 si sigue cumpliendo por antigüedad, revocar la concesión no le quita la invitación',
  (:'ac14'::jsonb->>'ok') = 'true' AND (SELECT status FROM prive_memberships WHERE user_id = aud.u(14)) = 'active', :'ac14');

-- U15: la concesión VENCE (valid_until) con la invitación pendiente: el barrido la retira.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (aud.u(15), 'aud15@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (aud.u(15), 'active', 'sub_aud15', 'cus_aud15', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.admin_grant_prive('aud15@example.test', 'Cortesía corta', now() + interval '1 day', 'dueno@iatos.test') AS g15 \gset
RESET ROLE;
UPDATE prive_grants SET valid_from = now() - interval '3 days', valid_until = now() - interval '1 second' WHERE id = (:'g15'::jsonb->>'grant_id')::uuid;
SET ROLE service_role; SELECT public.prive_sweep() AS sw15 \gset
RESET ROLE;
SELECT aud.ok('N03 concesión vencida con invitación pendiente: el barrido revoca la invitación y retira la membresía',
  NOT EXISTS (SELECT 1 FROM prive_invitations WHERE user_id = aud.u(15) AND accepted_at IS NULL AND revoked_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = aud.u(15) AND status = 'invited')
  AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = aud.u(15) AND event = 'invitation_withdrawn'), :'sw15');
-- Un miembro ACTIVO cuya concesión se revoca no pierde su membresía (queda en pausa, como P18).
SELECT aud.ok('N04 el barrido no toca membresías activas ni invitaciones de quien sí cumple',
  (SELECT status FROM prive_memberships WHERE user_id = aud.u(14)) = 'active'
  AND (SELECT count(*) FROM prive_memberships WHERE user_id IN (SELECT aud.u(n) FROM generate_series(1, 12) n) AND status = 'active') >= 10);

-- N05 limpieza única de la migración (caso real de producción: concesión revocada con invitación viva
-- de antes de la corrección). Se recrea el estado viejo y se vuelve a aplicar la migración.
INSERT INTO auth.users (id, email) VALUES (aud.u(17), 'aud17@example.test'), (aud.u(18), 'aud18@example.test') ON CONFLICT DO NOTHING;
INSERT INTO prive_grants (email, user_id, reason, granted_by, revoked_at) VALUES ('aud17@example.test', aud.u(17), 'prueba', 'dueno', now());
INSERT INTO prive_grants (email, user_id, reason, granted_by) VALUES ('aud18@example.test', aud.u(18), 'prueba', 'dueno');
INSERT INTO prive_memberships (user_id, status, basis, member_code) VALUES (aud.u(17), 'invited', 'grant', 'IP-AUDA-AAAA'), (aud.u(18), 'invited', 'grant', 'IP-AUDA-AAAB');
INSERT INTO prive_invitations (user_id, token_hash) VALUES (aud.u(17), repeat('a', 64)), (aud.u(18), repeat('b', 64));
\ir ../../migrations/20261024020000_aud_prive_grant_revoke_invitation.sql
SELECT aud.ok('N05 la limpieza de la migración retira solo la invitación de la concesión revocada; la vigente sigue',
  NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = aud.u(17))
  AND (SELECT revoked_at IS NOT NULL FROM prive_invitations WHERE user_id = aud.u(17))
  AND (SELECT status FROM prive_memberships WHERE user_id = aud.u(18)) = 'invited'
  AND (SELECT revoked_at IS NULL FROM prive_invitations WHERE user_id = aud.u(18)));
\ir ../../migrations/20261024030000_aud_prive_remember_device.sql

-- ===================================================================== R · "mantener mi sesión en este dispositivo (30 días)"
CREATE FUNCTION aud.remember(n int, tok text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.prive_remember_session(aud.u(n), (SELECT id FROM public.prive_sessions WHERE token_hash = public.prive_sha256_hex(tok)));
  RESET ROLE;
  RETURN r;
END $$;
SELECT aud.auth_login(12, 1202);
SELECT (aud.unlock(12, 1202))->>'token' AS t12 \gset
SELECT aud.remember(12, :'t12') AS rm12 \gset
SELECT aud.ok('R01 recordar: la sesión vence a los 30 días, avisa en la app y queda en la bitácora',
  (:'rm12'::jsonb->>'ok')::boolean
  AND (SELECT remember AND expires_at BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 minute'
         FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t12'))
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = aud.u(12) AND dedup_key LIKE 'prive_remember:%')
  AND EXISTS (SELECT 1 FROM prive_membership_events WHERE user_id = aud.u(12) AND event = 'session_remembered'), :'rm12');
UPDATE prive_sessions SET last_seen_at = now() - interval '3 hours' WHERE token_hash = public.prive_sha256_hex(:'t12');
SET ROLE service_role; SELECT public.prive_sweep() AS swr \gset
RESET ROLE;
SELECT aud.ok('R02 recordada: 3 h sin uso no la cierran (ni prive_require ni el barrido)', aud.req_as(12, 1202, :'t12') = 'OK', aud.req_as(12, 1202, :'t12'));
UPDATE prive_sessions SET last_seen_at = now() - interval '8 days' WHERE token_hash = public.prive_sha256_hex(:'t12');
SELECT aud.ok('R03 recordada: 8 días sin uso → PRIVE_SESSION_EXPIRED', aud.req_as(12, 1202, :'t12') = 'PRIVE_SESSION_EXPIRED', aud.req_as(12, 1202, :'t12'));
SELECT (aud.unlock(12, 1202))->>'token' AS t12b \gset
SELECT aud.remember(12, :'t12b');
UPDATE prive_sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE token_hash = public.prive_sha256_hex(:'t12b');
SELECT aud.ok('R03b recordada: a los 30 días vence aunque se use', aud.req_as(12, 1202, :'t12b') = 'PRIVE_SESSION_EXPIRED', aud.req_as(12, 1202, :'t12b'));
-- Sigue sujeta a todo lo de prive_require.
SELECT (aud.unlock(12, 1202))->>'token' AS t12c \gset
SELECT aud.remember(12, :'t12c');
SELECT aud.req_as(12, 1202, :'t12c') AS r12c0 \gset
DELETE FROM auth.sessions WHERE id = aud.sid(1202)::uuid;
SELECT aud.ok('R04 recordada: cerrar sesión en IATOS la invalida al instante', :'r12c0' = 'OK' AND aud.req_as(12, 1202, :'t12c') = 'PRIVE_SESSION_INVALID', aud.req_as(12, 1202, :'t12c'));
SELECT aud.auth_login(12, 1203);
SELECT (aud.unlock(12, 1203))->>'token' AS t12d \gset
SELECT aud.remember(12, :'t12d');
UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = aud.u(12);
SELECT aud.req_as(12, 1203, :'t12d') AS r12d \gset
UPDATE subscriptions SET current_period_end = now() + interval '20 days' WHERE user_id = aud.u(12);
SET ROLE service_role; SELECT public.prive_revoke_sessions(aud.u(12), 'user_revoke_all'); RESET ROLE;
SELECT aud.ok('R05 recordada: sin PRO → PRIVE_NOT_PRO; "cerrar todas mis sesiones" la cierra',
  :'r12d' = 'PRIVE_NOT_PRO' AND aud.req_as(12, 1203, :'t12d') = 'PRIVE_SESSION_INVALID', :'r12d' || ' ' || aud.req_as(12, 1203, :'t12d'));
SELECT (aud.unlock(12, 1203))->>'token' AS t12e \gset
UPDATE prive_sessions SET created_at = now() - interval '10 minutes' WHERE token_hash = public.prive_sha256_hex(:'t12e');
SELECT aud.ok('R06 solo se recuerda una sesión recién abierta y propia',
  (aud.remember(12, :'t12e'))->>'code' = 'PRIVE_SESSION_INVALID' AND (aud.remember(11, :'t12e'))->>'ok' = 'false'
  AND (SELECT NOT remember FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t12e')));
SELECT aud.ok('R07 sin elegir "recordar" la sesión sigue en 12 h / 2 h',
  (SELECT NOT remember AND expires_at <= now() + interval '12 hours' FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t12e')));

-- ===================================================================== L · siempre hay salida para quien quedó bloqueado
-- Bloqueo total (15 fallos) → pedir restablecimiento → completarlo → entrar con la nueva, en su
-- sesión de Auth (lo que exige AUD-01). El restablecimiento no requiere sesión Privé.
SELECT aud.auth_login(10, 1010);
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..15 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = aud.u(10);
    PERFORM public.prive_unlock(aud.u(10), 'mala-clave-numero-' || i, NULL, aud.sid(1010));
  END LOOP;
END $$;
SELECT (aud.unlock(10, 1010))->>'reason' AS l10a \gset
SET ROLE service_role;
SELECT public.prive_request_reset(aud.u(10)) AS rt10 \gset
SELECT public.prive_complete_reset(aud.u(10), :'rt10', 'Nueva-clave-aud-10-tras-reset', 'ok') AS cr10 \gset
SELECT public.prive_unlock(aud.u(10), 'Nueva-clave-aud-10-tras-reset', NULL, aud.sid(1010)) AS ul10 \gset
SELECT public.prive_complete_reset(aud.u(10), :'rt10', 'Otra-clave-aud-10-segunda', 'ok') AS cr10b \gset
RESET ROLE;
SELECT aud.ok('L01 bloqueo total → restablecer por correo → entra con la nueva; el enlace no sirve dos veces',
  :'l10a' = 'HARD_LOCKED' AND (:'cr10'::jsonb->>'ok')::boolean AND (:'ul10'::jsonb->>'ok')::boolean
  AND aud.req_as(10, 1010, :'ul10'::jsonb->>'token') = 'OK' AND (:'cr10b'::jsonb->>'code') = 'RESET_INVALID',
  :'l10a' || ' ' || :'cr10' || ' ' || :'cr10b');

-- ===================================================================== otros puntos de la fase 2
-- members_requires_prive: hoy es solo informativa (el servidor no la aplica). Se deja documentado.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (aud.u(16), 'aud16@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (aud.u(16), 'active', 'sub_aud16', 'cus_aud16', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
UPDATE app_flags SET value = 'true'::jsonb WHERE key = 'members_requires_prive';
SELECT set_config('request.jwt.claim.sub', aud.u(16)::text, false);
SELECT aud.ok('X01 members_requires_prive=true NO cambia members_access (bandera solo informativa; ver PRIVE.md)',
  public.members_access() = true AND NOT EXISTS (SELECT 1 FROM prive_memberships WHERE user_id = aud.u(16)));
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE app_flags SET value = 'false'::jsonb WHERE key = 'members_requires_prive';

DROP SCHEMA aud CASCADE;
