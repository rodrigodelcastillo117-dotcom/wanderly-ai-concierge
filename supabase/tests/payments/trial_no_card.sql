-- Pruebas de DEC-02: prueba de 30 días sin tarjeta (migración 20261022135200), con el interruptor
-- apagado (producción hoy) y encendido.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

DO $$
BEGIN
  -- T1: interruptor apagado → registrarse y confirmar NO da prueba (comportamiento de hoy).
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('66666666-0000-0000-0000-000000000001', 'apagado@test.mx', now());
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000001')
     OR public.is_pro('66666666-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'T1'; END IF;
  RAISE NOTICE 'OK T1 interruptor apagado: sin prueba, plan gratuito';

  UPDATE public.app_flags SET value = 'true' WHERE key = 'trial_no_card_enabled';

  -- T2: encendido: el correo sin confirmar no recibe nada; al confirmar, 30 días de PRO sin Stripe.
  INSERT INTO auth.users (id, email) VALUES ('66666666-0000-0000-0000-000000000002', 'Ana.Perez+viajes@Gmail.com');
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'T2a'; END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = '66666666-0000-0000-0000-000000000002';
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = '66666666-0000-0000-0000-000000000002'
       AND s.status = 'trialing' AND s.stripe_subscription_id IS NULL AND s.stripe_customer_id IS NULL
       AND s.trial_end BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour'
       AND s.current_period_end = s.trial_end)
     OR NOT public.is_pro('66666666-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'T2b'; END IF;
  IF (SELECT count(*) FROM public.trial_grants WHERE user_id = '66666666-0000-0000-0000-000000000002') <> 1 THEN RAISE EXCEPTION 'T2c'; END IF;
  IF EXISTS (SELECT 1 FROM public.trial_grants WHERE email_hash LIKE '%@%') THEN RAISE EXCEPTION 'T2d guarda el correo en claro'; END IF;
  RAISE NOTICE 'OK T2 encendido: al confirmar el correo, 30 días de PRO sin tarjeta ni Stripe; se registra solo el hash';

  -- T3: otra cuenta con el mismo correo normalizado (puntos, +etiqueta, mayúsculas) no recibe otra prueba.
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('66666666-0000-0000-0000-000000000003', 'anaperez@googlemail.com', now());
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'T3'; END IF;
  RAISE NOTICE 'OK T3 mismo correo normalizado: sin segunda prueba';

  -- T4: borrar la cuenta y recrearla con el mismo correo no da otra prueba.
  DELETE FROM auth.users WHERE id = '66666666-0000-0000-0000-000000000002';
  IF (SELECT user_id FROM public.trial_grants WHERE email_hash = public.email_trial_hash('anaperez@gmail.com')) IS NOT NULL THEN RAISE EXCEPTION 'T4a'; END IF;
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('66666666-0000-0000-0000-000000000004', 'ana.perez@gmail.com', now());
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000004') THEN RAISE EXCEPTION 'T4b'; END IF;
  RAISE NOTICE 'OK T4 borrar y recrear la cuenta: sin nueva prueba (el registro sobrevive sin user_id)';

  -- T5: correo con cortesía: gana la cortesía, no se gasta la prueba.
  INSERT INTO public.comp_grants (email) VALUES ('vip@test.mx') ON CONFLICT DO NOTHING;
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('66666666-0000-0000-0000-000000000005', 'vip@test.mx', now());
  IF (SELECT status FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000005') <> 'comped'
     OR EXISTS (SELECT 1 FROM public.trial_grants WHERE user_id = '66666666-0000-0000-0000-000000000005') THEN RAISE EXCEPTION 'T5'; END IF;
  RAISE NOTICE 'OK T5 correo con cortesía: comped, sin consumir prueba';

  -- T6: al vencer, vuelve a FREE automáticamente y conserva sus datos (viajes intactos).
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('66666666-0000-0000-0000-000000000006', 'vence@test.mx', now());
  INSERT INTO public.trips (user_id, destino) VALUES ('66666666-0000-0000-0000-000000000006', 'Oaxaca');
  UPDATE public.subscriptions SET trial_end = now() - interval '1 minute', current_period_end = now() - interval '1 minute'
   WHERE user_id = '66666666-0000-0000-0000-000000000006';
  IF public.is_pro('66666666-0000-0000-0000-000000000006')
     OR (public.get_access_state('66666666-0000-0000-0000-000000000006')->>'plan') <> 'free'
     OR (SELECT count(*) FROM public.trips WHERE user_id = '66666666-0000-0000-0000-000000000006') <> 1 THEN RAISE EXCEPTION 'T6'; END IF;
  RAISE NOTICE 'OK T6 prueba vencida: plan gratuito, sin cobro y con sus viajes';

  -- T7: si después contrata en Stripe, el webhook reemplaza la fila de prueba (no hay suscripción viva que proteger).
  PERFORM public.apply_stripe_subscription('66666666-0000-0000-0000-000000000006', 'cus_6', 'sub_6', 'active', NULL,
    now() + interval '30 days', false, 'price', 'mxn', now());
  IF (SELECT stripe_subscription_id FROM public.subscriptions WHERE user_id = '66666666-0000-0000-0000-000000000006') <> 'sub_6'
    THEN RAISE EXCEPTION 'T7'; END IF;
  RAISE NOTICE 'OK T7 contratar después de la prueba: el webhook guarda la suscripción de Stripe';

  -- T8: el cliente no puede leer el registro de pruebas.
  IF has_table_privilege('authenticated', 'public.trial_grants', 'SELECT') THEN RAISE EXCEPTION 'T8'; END IF;
  RAISE NOTICE 'OK T8 trial_grants solo para el servidor';

  UPDATE public.app_flags SET value = 'false' WHERE key = 'trial_no_card_enabled';
END $$;
