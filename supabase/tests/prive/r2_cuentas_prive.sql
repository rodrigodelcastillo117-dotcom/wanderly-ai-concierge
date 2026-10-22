-- Ronda r2 (grupo cuentas): regresiones de Privé que no cubre aud2_prive.sql. Imprime "OK RPnn" o
-- "FALLA RPnn". Corre con run.sh sobre una base con TODAS las migraciones.
\set ON_ERROR_STOP off
\pset tuples_only on
RESET ROLE;
DROP SCHEMA IF EXISTS rp CASCADE;
CREATE SCHEMA rp;
GRANT USAGE ON SCHEMA rp TO anon, authenticated, service_role;
CREATE FUNCTION rp.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c8000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION rp.sid(n int) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'c9000000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
CREATE FUNCTION rp.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
-- Cuenta con PRO pagado vigente (sin antigüedad) y correo confirmado con el enlace.
CREATE FUNCTION rp.pro(n int) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at)
  VALUES (rp.u(n), 'rp' || n || '@example.test', now(), now() - interval '1 day') ON CONFLICT DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end, price_id, currency)
  VALUES (rp.u(n), 'active', 'sub_rp' || n, 'cus_rp' || n, now() + interval '20 days', 'price_rp', 'MXN')
  ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = now() + interval '20 days';
  RETURN rp.u(n);
END $$;
CREATE FUNCTION rp.req_as(n int, sid int, ps text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rp.u(n)::text, true),
          set_config('request.jwt.claims', jsonb_build_object('sub', rp.u(n), 'role', 'authenticated', 'session_id', rp.sid(sid))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.prive_require(ps); v := 'OK'; EXCEPTION WHEN OTHERS THEN v := SQLERRM; END;
  RESET ROLE;
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rp TO anon, authenticated, service_role;

-- ===================================================================== N-02 aceptar una concesión exige el enlace del correo
SELECT rp.pro(1);
SET ROLE service_role;
SELECT public.admin_grant_prive('rp1@example.test', 'Invitada del dueño', NULL, 'dueno@iatos.test') AS g1 \gset
SELECT public.prive_accept_invitation(rp.u(1), NULL) AS a1 \gset
RESET ROLE;
SELECT rp.ok('RP1a concesión (basis grant) sin antigüedad: desde la app sin token → INVITATION_LINK_REQUIRED y sigue invitada',
  (:'g1'::jsonb->>'action') = 'invited' AND (:'a1'::jsonb->>'code') = 'INVITATION_LINK_REQUIRED'
  AND (SELECT status FROM prive_memberships WHERE user_id = rp.u(1)) = 'invited'
  AND EXISTS (SELECT 1 FROM prive_auth_attempts WHERE user_id = rp.u(1) AND kind = 'accept' AND reason = 'link_required'), :'a1');
SET ROLE service_role;
SELECT coalesce((SELECT token FROM public.prive_claim_invitation_emails(10, rp.u(1)) LIMIT 1), '') AS it1 \gset
SELECT public.prive_accept_invitation(rp.u(1), public.prive_sha256_hex(:'it1')) AS a1b \gset
SELECT public.prive_accept_invitation(rp.u(1), NULL) AS a1c \gset
RESET ROLE;
SELECT rp.ok('RP1b con el token del correo se acepta; después, abrir desde la app responde "already"',
  (:'a1b'::jsonb->>'ok')::boolean AND (:'a1c'::jsonb->>'already')::boolean
  AND (SELECT status FROM prive_memberships WHERE user_id = rp.u(1)) = 'active', :'a1b' || ' ' || :'a1c');

-- RP2: un miembro que YA estaba activo (como el dueño y su hermana en producción: cortesía PRO +
-- concesión, invitación aceptada) sigue entrando igual: aceptar sin token = "already" y prive_require OK.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (rp.u(2), 'rp2@example.test', now()) ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (rp.u(2), 'comped', 'pro') ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
INSERT INTO public.prive_grants (email, user_id, reason, granted_by) VALUES ('rp2@example.test', rp.u(2), 'Familia', 'dueno');
INSERT INTO public.prive_memberships (user_id, status, basis, activated_at) VALUES (rp.u(2), 'active', 'grant', now() - interval '2 days');
INSERT INTO public.prive_invitations (user_id, token_hash, accepted_at) VALUES (rp.u(2), repeat('c', 64), now() - interval '2 days');
SET ROLE service_role;
SELECT public.prive_set_password(rp.u(2), 'Rp-clave-larga-dos', 'ok');
RESET ROLE;
INSERT INTO auth.sessions (id, user_id) VALUES (rp.sid(2)::uuid, rp.u(2));
SET ROLE service_role;
SELECT public.prive_accept_invitation(rp.u(2), NULL) AS a2 \gset
SELECT coalesce((public.prive_unlock(rp.u(2), 'Rp-clave-larga-dos', NULL, rp.sid(2)))->>'token', '') AS t2 \gset
RESET ROLE;
SELECT rp.ok('RP2 miembro activo por concesión (cortesía): sin cambios, sigue entrando a Privé',
  (:'a2'::jsonb->>'already')::boolean AND rp.req_as(2, 2, :'t2') = 'OK', :'a2' || ' ' || rp.req_as(2, 2, :'t2'));

-- RP3: concesión + 90 días pagados: la antigüedad ya le da derecho, se acepta desde la app.
SELECT rp.pro(3);
SELECT public.prive_record_paid_period(rp.u(3), 'in_rp3', 'sub_rp3', 'cus_rp3', now() - interval '100 days', now() + interval '1 day', 9900, 'mxn', 'test');
SET ROLE service_role;
SELECT public.admin_grant_prive('rp3@example.test', 'Concesión extra', NULL, 'dueno@iatos.test');
SELECT public.prive_accept_invitation(rp.u(3), NULL) AS a3 \gset
RESET ROLE;
SELECT rp.ok('RP3 concesión pero con 90 días pagados: se acepta desde la app como siempre', (:'a3'::jsonb->>'ok')::boolean, :'a3');

-- RP4: invitación por antigüedad (basis tenure): sin cambios, desde la app.
SELECT rp.pro(4);
SELECT public.prive_record_paid_period(rp.u(4), 'in_rp4', 'sub_rp4', 'cus_rp4', now() - interval '100 days', now() + interval '1 day', 9900, 'mxn', 'test');
SET ROLE service_role;
SELECT public.prive_invite_user(rp.u(4), 'tenure', 'system');
SELECT public.prive_accept_invitation(rp.u(4), NULL) AS a4 \gset
RESET ROLE;
SELECT rp.ok('RP4 invitación por antigüedad: se acepta desde la app', (:'a4'::jsonb->>'ok')::boolean, :'a4');

-- RP5: registro con "Confirm email" encendido: la concesión espera a que la persona confirme con el
-- enlace y entonces se liga (trigger AFTER UPDATE OF email_confirmed_at).
SET ROLE service_role;
SELECT public.admin_grant_prive('rp5@example.test', 'Pendiente de registro', NULL, 'dueno@iatos.test') AS g5 \gset
RESET ROLE;
INSERT INTO auth.users (id, email, created_at) VALUES (rp.u(5), 'rp5@example.test', now() - interval '5 minutes');
SELECT (SELECT user_id IS NULL FROM prive_grants WHERE id = (:'g5'::jsonb->>'grant_id')::uuid) AS l5a \gset
UPDATE auth.users SET email_confirmed_at = now() WHERE id = rp.u(5);
SELECT rp.ok('RP5 la concesión pendiente se liga al confirmar el correo con el enlace (no antes)',
  :'l5a'::boolean AND (SELECT user_id FROM prive_grants WHERE id = (:'g5'::jsonb->>'grant_id')::uuid) = rp.u(5));

-- RP6: el dueño puede ligar a mano, después de verificar, una concesión que no se ligó por un cambio de correo.
SELECT rp.pro(6);
SET ROLE service_role;
SELECT public.admin_grant_prive('rp6-nuevo@example.test', 'Prensa', NULL, 'dueno@iatos.test');
RESET ROLE;
UPDATE auth.users SET email = 'rp6-nuevo@example.test' WHERE id = rp.u(6);
SELECT (SELECT user_id IS NULL FROM prive_grants WHERE email = 'rp6-nuevo@example.test') AS l6a \gset
SET ROLE service_role;
SELECT public.admin_grant_prive('rp6-nuevo@example.test', 'Prensa (verificada)', NULL, 'dueno@iatos.test') AS g6 \gset
RESET ROLE;
SELECT rp.ok('RP6 el cambio de correo no liga; volver a conceder (admin_grant_prive) sí, y la invitación pide el enlace',
  :'l6a'::boolean AND (:'g6'::jsonb->>'user_id')::uuid = rp.u(6) AND (:'g6'::jsonb->>'action') = 'invited'
  AND (public.prive_accept_invitation(rp.u(6), NULL)->>'code') = 'INVITATION_LINK_REQUIRED', :'g6');

-- RP7: el ataque N-02 sin cortesía (el auditor: "le basta pagar PRO"). Con autoconfirm alguien registra
-- el correo de una invitada pendiente, paga PRO y el cron lo invita por la concesión: sin el token
-- que llegó al buzón real no puede aceptar ni entrar.
SET ROLE service_role;
SELECT public.admin_grant_prive('rp7-invitada@example.test', 'VIP', NULL, 'dueno@iatos.test');
RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (rp.u(7), 'rp7-invitada@example.test', now());
INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id, stripe_customer_id, current_period_end, price_id, currency)
VALUES (rp.u(7), 'active', 'sub_rp7', 'cus_rp7', now() + interval '20 days', 'price_rp', 'MXN');
INSERT INTO auth.sessions (id, user_id) VALUES (rp.sid(7)::uuid, rp.u(7));
SET ROLE service_role;
SELECT count(*) FROM public.prive_evaluate_eligibility(500);
SELECT public.prive_accept_invitation(rp.u(7), NULL) AS a7 \gset
SELECT public.prive_set_password(rp.u(7), 'Atacante-rp7-clave-larga', 'ok') AS s7 \gset
SELECT coalesce((public.prive_unlock(rp.u(7), 'Atacante-rp7-clave-larga', NULL, rp.sid(7)))->>'token', '') AS t7 \gset
RESET ROLE;
SELECT rp.ok('RP7 quien registra (autoconfirm) el correo de una invitada y paga PRO no obtiene Privé sin el enlace del correo',
  (SELECT status FROM prive_memberships WHERE user_id = rp.u(7)) = 'invited'
  AND (:'a7'::jsonb->>'code') = 'INVITATION_LINK_REQUIRED' AND rp.req_as(7, 7, :'t7') <> 'OK',
  :'a7' || ' ' || :'s7' || ' req=' || rp.req_as(7, 7, :'t7'));

-- ===================================================================== P3-5 el contador de fallos no se reinicia a las 24 h
CREATE FUNCTION rp.member(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rp.pro(n);
  PERFORM public.prive_record_paid_period(rp.u(n), 'in_rp' || n, 'sub_rp' || n, 'cus_rp' || n, now() - interval '100 days', now() + interval '1 day', 9900, 'mxn', 'test');
  PERFORM public.prive_invite_user(rp.u(n), 'tenure', 'system');
  PERFORM public.prive_accept_invitation(rp.u(n), NULL);
  PERFORM public.prive_set_password(rp.u(n), 'Rp-clave-larga-' || n, 'ok');
  INSERT INTO auth.sessions (id, user_id) VALUES (rp.sid(n)::uuid, rp.u(n)) ON CONFLICT DO NOTHING;
END $$;
SELECT rp.member(10), rp.member(11);
-- RP10: 14 fallos por "día" durante 3 días (lo que la escalera permite sin esperar de más).
DO $$ DECLARE d int; i int; BEGIN
  FOR d IN 1..3 LOOP
    FOR i IN 1..14 LOOP
      UPDATE public.prive_credentials SET locked_until = NULL WHERE user_id = rp.u(10);
      PERFORM public.prive_unlock(rp.u(10), 'mala-' || d || '-' || i || '-xxxxxx', NULL, rp.sid(10));
    END LOOP;
    UPDATE public.prive_credentials SET last_failed_at = now() - interval '24 hours 1 minute', locked_until = NULL WHERE user_id = rp.u(10);
  END LOOP;
END $$;
SELECT rp.ok('RP10 (C6d) 14 intentos por día repartidos en varios días llegan al bloqueo total',
  (SELECT hard_locked FROM prive_credentials WHERE user_id = rp.u(10))
  AND (public.prive_unlock(rp.u(10), 'Rp-clave-larga-10', NULL, rp.sid(10)))->>'reason' = 'HARD_LOCKED',
  (SELECT 'hard_locked=' || hard_locked || ' failed_count=' || failed_count FROM prive_credentials WHERE user_id = rp.u(10)));
-- RP11: quien se equivoca y luego entra no acumula: el contador vuelve a 0 con la entrada correcta.
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..4 LOOP PERFORM public.prive_unlock(rp.u(11), 'mala-a-' || i || '-xxxxxx', NULL, rp.sid(11)); END LOOP;
END $$;
SELECT (public.prive_unlock(rp.u(11), 'Rp-clave-larga-11', NULL, rp.sid(11)))->>'ok' AS ok11 \gset
UPDATE public.prive_credentials SET last_failed_at = now() - interval '3 days' WHERE user_id = rp.u(11);
DO $$ DECLARE i int; BEGIN
  FOR i IN 1..4 LOOP PERFORM public.prive_unlock(rp.u(11), 'mala-b-' || i || '-xxxxxx', NULL, rp.sid(11)); END LOOP;
END $$;
SELECT rp.ok('RP11 con una entrada correcta en medio, el contador empieza de nuevo (4, no 8) y no hay bloqueo',
  :'ok11' = 'true' AND (SELECT failed_count = 4 AND NOT hard_locked AND locked_until IS NULL FROM prive_credentials WHERE user_id = rp.u(11)),
  (SELECT 'failed_count=' || failed_count FROM prive_credentials WHERE user_id = rp.u(11)));
-- RP12: el bloqueo total se sigue quitando solo con el restablecimiento por correo.
SET ROLE service_role;
SELECT public.prive_request_reset(rp.u(10)) AS rt10 \gset
SELECT public.prive_complete_reset(rp.u(10), :'rt10', 'Rp-nueva-clave-larga-10', 'ok') AS cr10 \gset
RESET ROLE;
SELECT rp.ok('RP12 tras el restablecimiento por correo entra y el contador queda en 0',
  (public.prive_unlock(rp.u(10), 'Rp-nueva-clave-larga-10', NULL, rp.sid(10)))->>'ok' = 'true'
  AND (SELECT failed_count = 0 AND NOT hard_locked FROM prive_credentials WHERE user_id = rp.u(10)), :'cr10');

DROP SCHEMA rp CASCADE;
