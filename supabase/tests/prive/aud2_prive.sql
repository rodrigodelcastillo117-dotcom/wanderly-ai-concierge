-- Segunda auditoría (grupo prive): casos adversariales nuevos sobre AUD-01, REMEMBER, NEW-01 y N-02.
-- Copia de /home/user/audit2/prive/codigo/supabase/tests/prive/aud2_prive.sql convertida en prueba de
-- regresión (ronda r2, grupo cuentas). Corre con run.sh sobre una base con TODAS las migraciones.
-- Imprime "OK"/"FALLA"/"INFO". Único ajuste: NEW01-b acepta su invitación por concesión con el token
-- del correo (N-02: sin token ya no se acepta una concesión).
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS a2 CASCADE;
CREATE SCHEMA a2;
GRANT USAGE ON SCHEMA a2 TO anon, authenticated, service_role;
CREATE FUNCTION a2.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION a2.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'b2000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION a2.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
CREATE FUNCTION a2.pw(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'A2-clave-larga-' || n $$;
CREATE FUNCTION a2.member(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(n), 'a2m' || n || '@example.test', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
  VALUES (a2.u(n), 'active', 'sub_a2' || n, 'cus_a2' || n, now() + interval '20 days')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  PERFORM public.prive_record_paid_period(a2.u(n), 'in_a2_' || n, 'sub_a2' || n, 'cus_a2' || n,
    now() - interval '100 days', now() + interval '1 day', 19900, 'mxn', 'test');
  PERFORM public.prive_invite_user(a2.u(n), 'tenure', 'system');
  PERFORM public.prive_accept_invitation(a2.u(n), NULL);
  PERFORM public.prive_set_password(a2.u(n), a2.pw(n), 'ok');
END $$;
CREATE FUNCTION a2.login(n int, sid int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.sessions (id, user_id) VALUES (a2.sid(sid)::uuid, a2.u(n)) ON CONFLICT DO NOTHING $$;
CREATE FUNCTION a2.unlock(n int, sid int, pw text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.prive_unlock(a2.u(n), coalesce(pw, a2.pw(n)), NULL, CASE WHEN sid IS NULL THEN NULL ELSE a2.sid(sid) END);
  RESET ROLE;
  RETURN r;
END $$;
-- prive_require como usuario n con JWT session_id=sid; extra = claims adicionales (p. ej. iat/exp distintos).
CREATE FUNCTION a2.req_as(n int, sid int, ps text, extra jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', a2.u(n)::text, true),
          set_config('request.jwt.claims', (jsonb_strip_nulls(jsonb_build_object('sub', a2.u(n), 'role', 'authenticated',
            'session_id', CASE WHEN sid IS NULL THEN NULL ELSE a2.sid(sid) END)) || extra)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.prive_require(ps);
    v := 'OK';
  EXCEPTION WHEN OTHERS THEN v := SQLERRM;
  END;
  RESET ROLE;
  RETURN v;
END $$;
CREATE FUNCTION a2.remember(n int, tok text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.prive_remember_session(a2.u(n), (SELECT id FROM public.prive_sessions WHERE token_hash = public.prive_sha256_hex(tok)));
  RESET ROLE;
  RETURN r;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA a2 TO anon, authenticated, service_role;
SELECT count(*) FROM (SELECT a2.member(n) FROM generate_series(1, 9) n) t;

-- ===================================================================== C1 token robado, MISMO usuario, otra sesión de Auth
SELECT a2.login(1, 11), a2.login(1, 12);
SELECT (a2.unlock(1, 11))->>'token' AS t1 \gset
SELECT a2.ok('C1 token Privé de la sesión de Auth A usado desde la sesión de Auth B del MISMO usuario → PRIVE_SESSION_INVALID',
  a2.req_as(1, 11, :'t1') = 'OK' AND a2.req_as(1, 12, :'t1') = 'PRIVE_SESSION_INVALID', a2.req_as(1, 12, :'t1'));
SELECT a2.ok('C1b y sin claim session_id (JWT de servicio o manipulado) → PRIVE_SESSION_INVALID',
  a2.req_as(1, NULL, :'t1') = 'PRIVE_SESSION_INVALID', a2.req_as(1, NULL, :'t1'));
-- C1c: una sesión de Auth B "viva" y el token de A: aunque el atacante ponga en su JWT el session_id de A
-- (no puede sin la firma) — lo que importa es que la fila A siga en auth.sessions; se documenta.

-- ===================================================================== C2 sesión de Auth refrescada
-- GoTrue al refrescar: nuevo access token (iat/exp distintos), MISMO session_id; actualiza refreshed_at/updated_at.
UPDATE auth.sessions SET refreshed_at = now()::timestamp, updated_at = now() WHERE id = a2.sid(11)::uuid;
SELECT a2.ok('C2 sesión de Auth refrescada (otro access token, mismo session_id) → la sesión Privé sigue',
  a2.req_as(1, 11, :'t1', jsonb_build_object('iat', extract(epoch FROM now())::bigint, 'exp', extract(epoch FROM now() + interval '1 hour')::bigint)) = 'OK');
-- C2b: GoTrue con "time-box"/inactividad: not_after en el futuro → sigue; en el pasado → se niega.
UPDATE auth.sessions SET not_after = now() + interval '1 hour' WHERE id = a2.sid(11)::uuid;
SELECT a2.ok('C2b not_after futuro → sigue', a2.req_as(1, 11, :'t1') = 'OK');
-- C2c session_id en MAYÚSCULAS en el JWT (mismo uuid): ¿se acepta?
SELECT a2.req_as(1, NULL, :'t1', jsonb_build_object('session_id', upper(a2.sid(11)))) AS c2c \gset
SELECT 'INFO C2c session_id del JWT en mayúsculas → ' || :'c2c' || ' (comparación de texto exacta; GoTrue emite minúsculas)';

-- ===================================================================== C3 "recordar" con una sesión vieja reactivada
SELECT a2.login(2, 21);
SELECT (a2.unlock(2, 21))->>'token' AS t2 \gset
UPDATE prive_sessions SET created_at = now() - interval '3 hours', last_seen_at = now() WHERE token_hash = public.prive_sha256_hex(:'t2');
SELECT a2.ok('C3 sesión abierta hace 3 h pero usada hace un instante: no se puede convertir en recordada',
  (a2.remember(2, :'t2'))->>'code' = 'PRIVE_SESSION_INVALID'
  AND (SELECT NOT remember AND expires_at <= now() + interval '12 hours' FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t2')));
SELECT (a2.unlock(2, 21))->>'token' AS t2b \gset
SET ROLE service_role; SELECT public.prive_lock_session(a2.u(2), public.prive_sha256_hex(:'t2b')); RESET ROLE;
SELECT a2.ok('C3b sesión recién abierta pero bloqueada (lock) no se puede recordar', (a2.remember(2, :'t2b'))->>'ok' = 'false');
SELECT (a2.unlock(2, 21))->>'token' AS t2c \gset
DELETE FROM auth.sessions WHERE id = a2.sid(21)::uuid;
SELECT a2.ok('C3c sesión recién abierta cuya sesión de Auth ya se cerró no se puede recordar', (a2.remember(2, :'t2c'))->>'ok' = 'false');
-- C3d: "recordar" dos veces no alarga el plazo (expires_at fijo en created_at + 30 d).
SELECT a2.login(2, 22);
SELECT (a2.unlock(2, 22))->>'token' AS t2d \gset
SELECT a2.remember(2, :'t2d') AS r2d1 \gset
SELECT a2.remember(2, :'t2d') AS r2d2 \gset
SELECT a2.ok('C3d recordar dos veces es idempotente y no extiende los 30 días',
  (:'r2d1'::jsonb->>'expires_at') = (:'r2d2'::jsonb->>'expires_at') AND (:'r2d2'::jsonb->>'already')::boolean);
-- C3e: cambio de contraseña dentro de los 5 min: recordar la sesión vieja "funciona" pero la sesión ya no vale.
SELECT (a2.unlock(2, 22))->>'token' AS t2e \gset
SET ROLE service_role; SELECT public.prive_change_password(a2.u(2), a2.pw(2), 'A2-otra-clave-larga-2', 'ok') AS cp2 \gset
SELECT public.prive_remember_session(a2.u(2), (SELECT id FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t2e'))) AS r2e \gset
RESET ROLE;
SELECT a2.ok('C3e tras cambiar la contraseña, la sesión vieja no autoriza aunque se "recuerde"',
  a2.req_as(2, 22, :'t2e') = 'PRIVE_SESSION_INVALID', 'remember=' || :'r2e' || ' req=' || a2.req_as(2, 22, :'t2e'));
SELECT 'INFO C3e prive_remember_session respondió ' || :'r2e' || ' para una sesión revocada por cambio de contraseña';
-- C3f recordada + reset de contraseña por correo → revocada.
SELECT (a2.unlock(2, 22, 'A2-otra-clave-larga-2'))->>'token' AS t2f \gset
SELECT a2.remember(2, :'t2f');
SET ROLE service_role;
SELECT public.prive_request_reset(a2.u(2)) AS rt2 \gset
SELECT public.prive_complete_reset(a2.u(2), :'rt2', 'A2-tercera-clave-2', 'ok');
RESET ROLE;
SELECT a2.ok('C3f recordada: restablecer la contraseña por correo la revoca', a2.req_as(2, 22, :'t2f') = 'PRIVE_SESSION_INVALID', a2.req_as(2, 22, :'t2f'));
-- C3g recordada + "mi contraseña está comprometida" → revocada.
SELECT (a2.unlock(2, 22, 'A2-tercera-clave-2'))->>'token' AS t2g \gset
SELECT a2.remember(2, :'t2g');
SET ROLE service_role; SELECT public.prive_report_compromised(a2.u(2)); RESET ROLE;
SELECT a2.ok('C3g recordada: "contraseña comprometida" la revoca', a2.req_as(2, 22, :'t2g') = 'PRIVE_SESSION_INVALID', a2.req_as(2, 22, :'t2g'));
-- C3h recordada sobrevive 12 h absolutas (vence a los 30 d) pero NO un cierre de sesión global.
SELECT a2.login(3, 31);
SELECT (a2.unlock(3, 31))->>'token' AS t3 \gset
SELECT a2.remember(3, :'t3');
UPDATE prive_sessions SET last_seen_at = now() - interval '6 days' WHERE token_hash = public.prive_sha256_hex(:'t3');
SELECT a2.ok('C3h recordada con 6 días sin uso todavía vale (límite 7 d)', a2.req_as(3, 31, :'t3') = 'OK', a2.req_as(3, 31, :'t3'));
DELETE FROM auth.sessions WHERE user_id = a2.u(3);
SELECT a2.ok('C3i recordada: cierre global de IATOS la invalida', a2.req_as(3, 31, :'t3') = 'PRIVE_SESSION_INVALID');

-- C3j "propia" con las dos cuentas CON derecho vigente (R06 lo prueba con una cuenta que ya perdió PRO,
-- así que el NOT_PRO responde antes que el filtro por user_id).
SELECT a2.login(3, 32);
SELECT (a2.unlock(3, 32))->>'token' AS t3j \gset
SELECT a2.ok('C3j una cuenta con derecho vigente no puede convertir en recordada la sesión recién abierta de OTRA cuenta',
  (a2.remember(1, :'t3j'))->>'ok' = 'false'
  AND (SELECT NOT remember AND expires_at <= now() + interval '12 hours' FROM prive_sessions WHERE token_hash = public.prive_sha256_hex(:'t3j')));

-- ===================================================================== C6 fuerza bruta (escalera)
SELECT a2.login(4, 41);
CREATE TABLE a2.ladder (i int, reason text, locked_min numeric, hard boolean);
DO $$ DECLARE i int; r jsonb; BEGIN
  FOR i IN 1..15 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = a2.u(4);  -- se "espera" a que pase el bloqueo
    r := public.prive_unlock(a2.u(4), 'mala-clave-a2-' || i, NULL, a2.sid(41));
    INSERT INTO a2.ladder SELECT i, r->>'reason',
      round(extract(epoch FROM ((r->>'locked_until')::timestamptz - now())) / 60), (SELECT hard_locked FROM prive_credentials WHERE user_id = a2.u(4));
  END LOOP;
END $$;
SELECT 'INFO C6 escalera: ' || string_agg(i || '=' || reason || coalesce('(' || locked_min || 'm)', ''), ' ' ORDER BY i) FROM a2.ladder;
SELECT a2.ok('C6 escalera exacta 5→1 min, 8→5, 10→15, 12→60, 15→bloqueo total',
  (SELECT string_agg(i::text, ',' ORDER BY i) FROM a2.ladder WHERE reason = 'LOCKED') = '5,8,10,12'
  AND (SELECT array_agg(locked_min ORDER BY i) FROM a2.ladder WHERE reason = 'LOCKED') = ARRAY[1,5,15,60]::numeric[]
  AND (SELECT reason FROM a2.ladder WHERE i = 15) = 'HARD_LOCKED'
  AND (SELECT count(*) FROM a2.ladder WHERE reason = 'WRONG_PASSWORD') = 10);
SELECT a2.ok('C6b con bloqueo total la contraseña CORRECTA tampoco entra', (a2.unlock(4, 41))->>'reason' = 'HARD_LOCKED');
-- C6c bloqueado temporalmente: la contraseña correcta no se compara (no "regala" un oráculo) y no suma fallos.
SELECT a2.login(5, 51);
DO $$ DECLARE i int; BEGIN FOR i IN 1..5 LOOP PERFORM public.prive_unlock(a2.u(5), 'mala-' || i || '-xxxxxxxx', NULL, a2.sid(51)); END LOOP; END $$;
SELECT a2.unlock(5, 51) AS u5 \gset
SELECT a2.ok('C6c durante el bloqueo de 1 min la contraseña correcta responde LOCKED y no cuenta como fallo',
  (:'u5'::jsonb->>'reason') = 'LOCKED' AND (SELECT failed_count FROM prive_credentials WHERE user_id = a2.u(5)) = 5, :'u5');
-- C6d el contador se reinicia tras 24 h sin fallos: 14 intentos por día sin llegar nunca al bloqueo total.
SELECT a2.login(6, 61);
DO $$ DECLARE d int; i int; BEGIN
  FOR d IN 1..3 LOOP
    FOR i IN 1..14 LOOP
      UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = a2.u(6);
      PERFORM public.prive_unlock(a2.u(6), 'mala-' || d || '-' || i || '-xxxxxx', NULL, a2.sid(61));
    END LOOP;
    -- pasan 24 h y 1 min sin fallos
    UPDATE public.prive_credentials SET last_failed_at = now() - interval '24 hours 1 minute', locked_until = NULL WHERE user_id = a2.u(6);
  END LOOP;
END $$;
SELECT 'INFO C6d tras 3 "días" de 14 intentos (42 fallos) hard_locked=' || hard_locked || ' failed_count=' || failed_count
  FROM prive_credentials WHERE user_id = a2.u(6);
-- C6e ip_hash: más de 30 fallos en 1 h entre cuentas bloquea la IP; el mismo IP al día siguiente = otro hash (sin bloqueo).
SELECT a2.login(7, 71), a2.login(8, 81);
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..31 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL, failed_count = 0 WHERE user_id = a2.u(7);
    PERFORM public.prive_unlock(a2.u(7), 'mala-ip-' || i || '-xxxxxx', 'aaaaaaaaaaaaaaaa', a2.sid(71));
  END LOOP;
END $$;
SET ROLE service_role;
SELECT public.prive_unlock(a2.u(8), a2.pw(8), 'aaaaaaaaaaaaaaaa', a2.sid(81)) AS ip8 \gset
SELECT public.prive_unlock(a2.u(8), a2.pw(8), 'bbbbbbbbbbbbbbbb', a2.sid(81)) AS ip8b \gset
RESET ROLE;
SELECT a2.ok('C6e la ip_hash bloqueada niega también a otra cuenta con la clave correcta; otra ip_hash (otro día) entra',
  (:'ip8'::jsonb->>'reason') = 'LOCKED' AND (:'ip8b'::jsonb->>'ok')::boolean, :'ip8' || ' ' || :'ip8b');
-- C6f ip_hash nula (sin PRIVE_IP_SALT): no hay límite por IP en absoluto.
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..40 LOOP
    UPDATE public.prive_credentials SET locked_until = NULL, failed_count = 0 WHERE user_id = a2.u(7);
    PERFORM public.prive_unlock(a2.u(7), 'mala-noip-' || i || '-xxxxxx', NULL, a2.sid(71));
  END LOOP;
END $$;
SELECT 'INFO C6f sin sal: ' || count(*) || ' bloqueos de IP creados con ip_hash NULL (esperado 0: el límite por IP desaparece)' FROM prive_ip_blocks WHERE ip_hash IS NULL;

-- ===================================================================== NEW-01 (re-verificación adversarial)
-- U20: PRO sin días; concesión → invitado → se revoca la concesión con una SEGUNDA concesión vigente: conserva.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(20), 'a2c20@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (a2.u(20), 'active', 'sub_a220', 'cus_a220', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.admin_grant_prive('a2c20@example.test', 'Primera', NULL, 'dueno@iatos.test') AS g20 \gset
RESET ROLE;
INSERT INTO prive_grants (email, user_id, reason, granted_by) VALUES ('a2c20@example.test', a2.u(20), 'Segunda', 'dueno');
SET ROLE service_role;
SELECT public.admin_revoke_prive_grant((:'g20'::jsonb->>'grant_id')::uuid, 'Fin primera', 'dueno@iatos.test') AS rv20 \gset
RESET ROLE;
SELECT a2.ok('NEW01-a revocar una concesión con otra concesión vigente conserva la invitación',
  (SELECT status FROM prive_memberships WHERE user_id = a2.u(20)) = 'invited'
  AND EXISTS (SELECT 1 FROM prive_invitations WHERE user_id = a2.u(20) AND revoked_at IS NULL), :'rv20');
-- U21: miembro ACTIVO por concesión (sin antigüedad) con sesión Privé viva: revocar → sesiones cerradas, sin acceso.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(21), 'a2c21@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end)
VALUES (a2.u(21), 'active', 'sub_a221', 'cus_a221', now() + interval '20 days') ON CONFLICT (user_id) DO NOTHING;
SET ROLE service_role;
SELECT public.admin_grant_prive('a2c21@example.test', 'Cortesía', NULL, 'dueno@iatos.test') AS g21 \gset
SELECT token AS it21 FROM public.prive_claim_invitation_emails(10, a2.u(21)) \gset
SELECT public.prive_accept_invitation(a2.u(21), public.prive_sha256_hex(:'it21'));
SELECT public.prive_set_password(a2.u(21), 'A2-clave-larga-21', 'ok');
RESET ROLE;
SELECT a2.login(21, 2101);
SELECT (a2.unlock(21, 2101, 'A2-clave-larga-21'))->>'token' AS t21 \gset
SELECT a2.req_as(21, 2101, :'t21') AS r21a \gset
SET ROLE service_role;
SELECT public.admin_revoke_prive_grant((:'g21'::jsonb->>'grant_id')::uuid, 'Fin', 'dueno@iatos.test') AS rv21 \gset
RESET ROLE;
SELECT a2.ok('NEW01-b miembro activo por concesión: revocarla cierra sus sesiones y niega el acceso (membresía queda en pausa)',
  :'r21a' = 'OK' AND a2.req_as(21, 2101, :'t21') IN ('PRIVE_NOT_ELIGIBLE', 'PRIVE_SESSION_INVALID')
  AND (:'rv21'::jsonb->>'sessions_closed')::int >= 1 AND (SELECT status FROM prive_memberships WHERE user_id = a2.u(21)) = 'active',
  :'r21a' || ' ' || a2.req_as(21, 2101, :'t21') || ' ' || :'rv21');
-- U22: concesión "pending_signup" (sin cuenta) revocada antes del registro: al registrarse NO se liga.
SET ROLE service_role;
SELECT public.admin_grant_prive('a2c22@example.test', 'Pendiente', NULL, 'dueno@iatos.test') AS g22 \gset
SELECT public.admin_revoke_prive_grant((:'g22'::jsonb->>'grant_id')::uuid, 'Ya no', 'dueno@iatos.test');
RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(22), 'a2c22@example.test', now());
SELECT a2.ok('NEW01-c concesión pendiente revocada antes del registro no se liga al registrarse',
  NOT EXISTS (SELECT 1 FROM prive_grants WHERE email = 'a2c22@example.test' AND user_id IS NOT NULL));

-- ===================================================================== N-02 concesión ligada sin confirmar el correo
-- La concesión se da a invitada@ ANTES de que tenga cuenta (pending_signup). Un atacante se registra con
-- ese correo. Caso A: correo SIN confirmar (lo que pasaría con "Confirm email" ON). Caso B: con autoconfirm.
SET ROLE service_role;
SELECT public.admin_grant_prive('invitada-a@example.test', 'VIP', NULL, 'dueno@iatos.test') AS ga \gset
SELECT public.admin_grant_prive('invitada-b@example.test', 'VIP', NULL, 'dueno@iatos.test') AS gb \gset
RESET ROLE;
INSERT INTO public.comp_grants (email) VALUES ('invitada-b@example.test') ON CONFLICT DO NOTHING;
-- A: GoTrue inserta la fila de auth.users al registrarse aunque el correo no esté confirmado.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(30), 'invitada-a@example.test', NULL);
SELECT a2.ok('N02-A (prueba del DEFECTO) con el correo SIN confirmar la concesión NO debería ligarse',
  (SELECT user_id IS NULL FROM prive_grants WHERE id = (:'ga'::jsonb->>'grant_id')::uuid),
  'ligada a la cuenta sin confirmar ' || coalesce((SELECT user_id::text FROM prive_grants WHERE id = (:'ga'::jsonb->>'grant_id')::uuid), 'null'));
-- B: mailer_autoconfirm=true (producción hoy): email_confirmed_at = now() al registrarse.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (a2.u(31), 'invitada-b@example.test', now());
SELECT 'INFO N02-B autoconfirm: concesión ligada al atacante=' || ((SELECT user_id FROM prive_grants WHERE id = (:'gb'::jsonb->>'grant_id')::uuid) = a2.u(31))
  || ' PRO de cortesía=' || coalesce((SELECT status FROM subscriptions WHERE user_id = a2.u(31)), 'ninguna');
-- El cron (o el dueño corriendo prive_evaluate_eligibility) lo invita; acepta; fija contraseña; entra.
SET ROLE service_role;
SELECT count(*) FROM public.prive_evaluate_eligibility(500);
SELECT public.prive_accept_invitation(a2.u(31), NULL) AS acb \gset
SELECT public.prive_set_password(a2.u(31), 'Atacante-clave-larga-1', 'ok') AS spb \gset
RESET ROLE;
SELECT a2.login(31, 3101);
SELECT coalesce((a2.unlock(31, 3101, 'Atacante-clave-larga-1'))->>'token', '') AS tb \gset
SELECT a2.ok('N02-B (prueba del DEFECTO) quien se registra con el correo de una invitada pendiente NO debería obtener Privé',
  a2.req_as(31, 3101, :'tb') <> 'OK',
  'accept=' || :'acb' || ' req=' || a2.req_as(31, 3101, :'tb') || ' (PRO comped + concesión, sin pagar nada)');
-- C: cambio de correo de una cuenta existente al de una invitada pendiente (UPDATE OF email).
SET ROLE service_role;
SELECT public.admin_grant_prive('invitada-c@example.test', 'VIP', NULL, 'dueno@iatos.test') AS gc \gset
RESET ROLE;
UPDATE auth.users SET email = 'invitada-c@example.test' WHERE id = a2.u(9);
SELECT a2.ok('N02-C (prueba del DEFECTO) cambiar el correo de una cuenta al de una invitada pendiente NO debería ligar la concesión sin confirmación',
  (SELECT user_id IS DISTINCT FROM a2.u(9) FROM prive_grants WHERE id = (:'gc'::jsonb->>'grant_id')::uuid),
  'ligada a la cuenta 9 por UPDATE OF email (email_confirmed_at de la fila no se revisa)');

-- ===================================================================== pérdida de PRO con concesión / antigüedad
SELECT a2.login(1, 13);
SELECT (a2.unlock(1, 13))->>'token' AS t1c \gset
UPDATE subscriptions SET status = 'past_due' WHERE user_id = a2.u(1);
SELECT a2.ok('P-PRO1 antigüedad ≥ 90 días pero PRO en past_due → PRIVE_NOT_PRO', a2.req_as(1, 13, :'t1c') = 'PRIVE_NOT_PRO', a2.req_as(1, 13, :'t1c'));
UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '20 days' WHERE user_id = a2.u(1);
SELECT a2.ok('P-PRO2 al volver a PRO, la misma sesión vuelve a servir (no se revocó sin barrido)', a2.req_as(1, 13, :'t1c') = 'OK', a2.req_as(1, 13, :'t1c'));
-- Concesión + PRO de cortesía (comped, sin vencimiento): Privé indefinido mientras no se revoque.
SELECT 'INFO P-PRO3 cuenta 31 (concesión + comped) is_pro=' || public.is_pro(a2.u(31)) || ' acceso=' || coalesce(public.prive_access_code(a2.u(31)), 'SÍ');

DROP SCHEMA a2 CASCADE;
