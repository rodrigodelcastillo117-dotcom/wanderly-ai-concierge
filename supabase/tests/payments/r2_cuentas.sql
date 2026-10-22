-- Ronda r2 (grupo cuentas): pruebas de regresión de la segunda auditoría que no cubre
-- aud2_pagos_adversarial.sql. Imprime "OK RCnn" o "FALLA RCnn". Corre con run.sh sobre una base desechable.
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;
DROP SCHEMA IF EXISTS rc CASCADE;
CREATE SCHEMA rc;
CREATE FUNCTION rc.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('c7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION rc.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '') END $$;
CREATE FUNCTION rc.st(n int) RETURNS text LANGUAGE sql AS $$ SELECT coalesce((SELECT status FROM public.subscriptions WHERE user_id = rc.u(n)), '-') $$;

-- ===================================================================== N-01 / D-P2-1 cortesía con correo comprobado
INSERT INTO public.comp_grants (email) VALUES ('rc-link@example.test'), ('rc-oauth@example.test'), ('rc-auto@example.test'),
  ('rc-cambio@example.test'), ('rc-viejo@example.test'), ('rc-tarde@example.test') ON CONFLICT DO NOTHING;
-- RC1: registro con "Confirm email" encendido: la fila nace sin confirmar y la persona abre el enlace después.
INSERT INTO auth.users (id, email, created_at) VALUES (rc.u(1), 'rc-link@example.test', now() - interval '5 minutes');
SELECT rc.ok('RC1a sin confirmar el correo no hay cortesía', rc.st(1) = '-', rc.st(1));
UPDATE auth.users SET email_confirmed_at = now() WHERE id = rc.u(1);
SELECT rc.ok('RC1b al confirmar con el enlace (trigger AFTER UPDATE OF email_confirmed_at) se aplica la cortesía',
  rc.st(1) = 'comped' AND public.is_pro(rc.u(1)) AND public.has_comp_grant(rc.u(1)), rc.st(1));
-- RC2: registro con Google (el proveedor entrega el correo verificado en el mismo instante).
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data)
VALUES (rc.u(2), 'rc-oauth@example.test', now(), '{"provider":"google","providers":["google"]}');
SELECT rc.ok('RC2 registro con OAuth (correo verificado por el proveedor) recibe la cortesía', rc.st(2) = 'comped', rc.st(2));
-- RC3: autoconfirm (correo y contraseña, confirmado en el mismo instante): no se comprobó el buzón.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data)
VALUES (rc.u(3), 'rc-auto@example.test', now(), '{"provider":"email","providers":["email"]}');
SELECT rc.ok('RC3a registro autoconfirmado con un correo de la lista: sin cortesía y has_comp_grant=false',
  rc.st(3) = '-' AND NOT public.has_comp_grant(rc.u(3)) AND NOT public.is_pro(rc.u(3)), rc.st(3));
SELECT rc.ok('RC3b apply_comp_grants_now tampoco se la da y explica por qué',
  (SELECT result FROM public.apply_comp_grants_now() WHERE email = 'rc-auto@example.test') LIKE 'NO aplicado: el correo no está comprobado%'
  AND rc.st(3) = '-', (SELECT result FROM public.apply_comp_grants_now() WHERE email = 'rc-auto@example.test'));
-- RC4: cuenta vieja (confirmada hace días) que cambia su correo a uno de la lista y luego paga y cancela.
INSERT INTO auth.users (id, email, email_confirmed_at, created_at)
VALUES (rc.u(4), 'rc-otro@example.test', now() - interval '3 days', now() - interval '4 days');
UPDATE auth.users SET email = 'rc-cambio@example.test' WHERE id = rc.u(4);
SELECT public.apply_stripe_subscription(rc.u(4), 'cus_rc4', 'sub_rc4', 'active', NULL, now() + interval '20 days', false, 'price_rc', 'mxn', now() - interval '1 hour');
SELECT public.apply_stripe_subscription(rc.u(4), 'cus_rc4', 'sub_rc4', 'canceled', NULL, now() - interval '1 second', false, 'price_rc', 'mxn', now()) AS rc4 \gset
SELECT rc.ok('RC4 cambiar el correo a uno de la lista no da cortesía, ni al terminar su suscripción pagada',
  rc.st(4) = 'canceled' AND NOT public.has_comp_grant(rc.u(4)) AND NOT public.is_pro(rc.u(4)),
  rc.st(4) || ' ' || (:'rc4'::jsonb->>'reason'));
-- RC5: una cortesía que ya existía (fila comped) no cambia aunque su correo no cumpla la regla nueva.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (rc.u(5), 'rc-viejo@example.test', now());
INSERT INTO public.subscriptions (user_id, status, plan) VALUES (rc.u(5), 'comped', 'pro')
  ON CONFLICT (user_id) DO UPDATE SET status = 'comped';
SELECT rc.ok('RC5 una cortesía ya otorgada (comped) sigue siendo PRO', public.is_pro(rc.u(5)) AND rc.st(5) = 'comped', rc.st(5));
-- RC6: registro sin confirmar, cambia el correo (a uno de la lista) y luego lo confirma con el enlace.
INSERT INTO auth.users (id, email, created_at) VALUES (rc.u(6), 'rc-antes@example.test', now() - interval '10 minutes');
UPDATE auth.users SET email = 'rc-tarde@example.test' WHERE id = rc.u(6);
SELECT rc.ok('RC6a el cambio de correo sin confirmar no da cortesía', rc.st(6) = '-', rc.st(6));
UPDATE auth.users SET email_confirmed_at = clock_timestamp() + interval '1 second' WHERE id = rc.u(6);
SELECT rc.ok('RC6b al confirmar el correo nuevo con el enlace sí se aplica', rc.st(6) = 'comped', rc.st(6));

DROP SCHEMA rc CASCADE;
DELETE FROM public.comp_grants WHERE email LIKE 'rc-%@example.test';
