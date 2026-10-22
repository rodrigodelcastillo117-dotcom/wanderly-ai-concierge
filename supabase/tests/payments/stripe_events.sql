-- AUD-05 · Atomicidad e idempotencia de los efectos de Stripe en la base (auditoría de cierre).
-- Llama a las funciones SQL reales que usa stripe-webhook: apply_stripe_subscription,
-- revoke_paid_access, prive_record_paid_period, prive_mark_paid_period y (desde
-- 20261024051500_aud_pagos_payment_event_atomic.sql) stripe_commit_payment_event.
-- Cada caso imprime "OK AP.. …" o "FALLA AP.. …". La concurrencia (dos transacciones a la vez) está
-- en run.sh. La corre run.sh sobre una base desechable, nunca producción.
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;

DROP SCHEMA IF EXISTS ap CASCADE;
CREATE SCHEMA ap;
CREATE FUNCTION ap.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('aa000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION ap.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '(sin detalle)') END $$;
-- Usuario + fila que deja stripe-checkout antes de pagar (customer guardado, sin suscripción).
CREATE FUNCTION ap.mk(n int) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (ap.u(n), 'ap' || n || '@example.test', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, plan, stripe_customer_id, currency)
  VALUES (ap.u(n), 'incomplete', 'pro', 'cus_ap' || n, 'MXN') ON CONFLICT (user_id) DO NOTHING;
  RETURN ap.u(n);
END $$;
-- apply_stripe_subscription como lo llama el webhook (estado vivo de Stripe + fecha del evento).
CREATE FUNCTION ap.apply(n int, st text, ev timestamptz, period_end timestamptz DEFAULT now() + interval '30 days',
                         cancel_end boolean DEFAULT false, sub text DEFAULT NULL, uid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.apply_stripe_subscription(coalesce(uid, ap.u(n)), 'cus_ap' || n, coalesce(sub, 'sub_ap' || n), st, NULL, period_end,
                                          cancel_end, 'price_pro_mxn', 'mxn', ev) $$;
CREATE FUNCTION ap.record(n int, inv text, a timestamptz, b timestamptz, uid uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.prive_record_paid_period(uid, inv, 'sub_ap' || n, 'cus_ap' || n, a, b, 9900, 'mxn', 'webhook') $$;
-- Fila de stripe_payment_events tal como la deja el webhook al terminar un reembolso o disputa.
CREATE FUNCTION ap.logged(evt text, typ text, inv text, act text, created timestamptz, refunded int DEFAULT 9900,
                          dp text DEFAULT NULL, dp_status text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.stripe_payment_events (event_id, type, charge_id, invoice_id, subscription_id, customer_id, dispute_id,
                                            amount, amount_refunded, currency, dispute_status, action, event_created)
  VALUES (evt, typ, 'ch_' || inv, inv, NULL, NULL, dp, 9900, refunded, 'mxn', dp_status, act, created)
  ON CONFLICT (event_id) DO NOTHING $$;
CREATE FUNCTION ap.pstatus(inv text) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.pro_paid_periods WHERE stripe_invoice_id = inv $$;

-- ===================================================================== A. evento repetido
SELECT ap.mk(1);
SELECT ap.apply(1, 'active', now() - interval '1 hour') AS a1 \gset
SELECT ap.apply(1, 'active', now() - interval '1 hour') AS a1b \gset
SELECT ap.ok('AP01 el mismo evento dos veces: una fila, mismo estado, PRO una sola vez',
  (:'a1'::jsonb->>'applied')::boolean AND (SELECT count(*) FROM subscriptions WHERE user_id = ap.u(1)) = 1
  AND public.is_pro(ap.u(1)) AND (SELECT status FROM subscriptions WHERE user_id = ap.u(1)) = 'active', :'a1b');

SELECT ap.record(1, 'in_ap1', now() - interval '1 day', now() + interval '29 days') AS r1 \gset
SELECT ap.record(1, 'in_ap1', now() - interval '1 day', now() + interval '29 days') AS r1b \gset
SELECT ap.ok('AP02 invoice.paid + invoice.payment_succeeded de la misma factura: un solo periodo pagado',
  (SELECT count(*) FROM pro_paid_periods WHERE user_id = ap.u(1)) = 1 AND (:'r1'::jsonb->>'inserted')::boolean
  AND NOT (:'r1b'::jsonb->>'inserted')::boolean, :'r1b');

-- ===================================================================== B. fuera de orden (suscripción)
SELECT ap.mk(2);
SELECT ap.apply(2, 'active', now() - interval '10 minutes');                   -- subscription.updated (nuevo)
-- subscription.created (viejo) llega después:
SELECT ap.apply(2, 'trialing', now() - interval '20 minutes') AS b2 \gset
SELECT ap.ok('AP03 updated antes que created: el viejo se ignora (stale_event) y queda active',
  :'b2'::jsonb->>'reason' = 'stale_event' AND (SELECT status FROM subscriptions WHERE user_id = ap.u(2)) = 'active', :'b2');

SELECT ap.mk(3);
-- invoice.paid (con metadata de la persona) antes del checkout.session.completed.
SELECT ap.apply(3, 'active', now() - interval '5 minutes');
SELECT ap.record(3, 'in_ap3', now() - interval '5 minutes', now() + interval '30 days');
SELECT ap.apply(3, 'active', now() - interval '4 minutes') AS b3 \gset
SELECT ap.ok('AP04 invoice.paid antes del checkout: PRO desde el primero, el checkout no duplica fila ni periodo',
  public.is_pro(ap.u(3)) AND (SELECT count(*) FROM subscriptions WHERE user_id = ap.u(3)) = 1
  AND (SELECT count(*) FROM pro_paid_periods WHERE user_id = ap.u(3)) = 1, :'b3');
-- Suscripción sin metadata: la persona se encuentra por su customer (fila del checkout).
SELECT ap.mk(4);
SELECT public.apply_stripe_subscription(NULL, 'cus_ap4', 'sub_ap4', 'active', NULL, now() + interval '30 days', false, 'p', 'mxn', now()) AS b4 \gset
SELECT ap.ok('AP05 sin metadata: se aplica a la cuenta dueña del customer', :'b4'::jsonb->>'user_id' = ap.u(4)::text AND public.is_pro(ap.u(4)), :'b4');

-- ===================================================================== C. periodos encimados
SELECT ap.mk(5);
SELECT ap.record(5, 'in_ap5a', now() - interval '60 days', now() - interval '30 days'),
       ap.record(5, 'in_ap5b', now() - interval '40 days', now() - interval '10 days');  -- prorrateo encimado 10 días
SELECT ap.ok('AP06 periodos encimados: se cuentan una vez (50 días, no 60)', public.prive_tenure_days(ap.u(5)) = 50,
  'tenure=' || public.prive_tenure_days(ap.u(5)));

-- ===================================================================== D. reembolso en orden y reintentos
SELECT ap.mk(6);
SELECT ap.apply(6, 'active', now() - interval '3 days');
SELECT ap.record(6, 'in_ap6', now() - interval '3 days', now() + interval '27 days');
SELECT public.revoke_paid_access('sub_ap6', 'cus_ap6', now() - interval '1 day', 'charge.refunded') AS d6 \gset
SELECT public.prive_mark_paid_period('in_ap6', 'refund_full', 9900);
-- Reintento de Stripe tras una falla posterior: se repite todo.
SELECT public.revoke_paid_access('sub_ap6', 'cus_ap6', now() - interval '1 day', 'charge.refunded') AS d6b \gset
SELECT public.prive_mark_paid_period('in_ap6', 'refund_full', 9900);
-- invoice.paid viejo reenviado después del reembolso.
SELECT ap.apply(6, 'active', now() - interval '3 days') AS d6c \gset
SELECT ap.record(6, 'in_ap6', now() - interval '3 days', now() + interval '27 days');
SELECT ap.ok('AP07 reembolso total: sin PRO, periodo reembolsado; reintento idempotente; el invoice.paid viejo no revive nada',
  NOT public.is_pro(ap.u(6)) AND ap.pstatus('in_ap6') = 'refunded' AND public.prive_tenure_days(ap.u(6)) = 0
  AND :'d6c'::jsonb->>'reason' = 'stale_event' AND (SELECT count(*) FROM pro_paid_periods WHERE user_id = ap.u(6)) = 1,
  'revoke=' || :'d6' || ' viejo=' || :'d6c' || ' periodo=' || coalesce(ap.pstatus('in_ap6'), '-'));

-- ===================================================================== E. reembolso/disputa ANTES de registrar el periodo
-- (el invoice.paid falló o llegó tarde; el reembolso ya quedó registrado como hecho)
SELECT ap.mk(7);
SELECT ap.apply(7, 'canceled', now() - interval '1 day');
SELECT public.prive_mark_paid_period('in_ap7', 'refund_full', 9900) AS e7m \gset
SELECT ap.logged('evt_ap7_refund', 'charge.refunded', 'in_ap7', 'reembolso_total_revocado', now() - interval '1 day');
SELECT ap.record(7, 'in_ap7', now() - interval '20 days', now() + interval '10 days', ap.u(7)) AS e7 \gset
SELECT ap.ok('AP08 reembolso total registrado antes que el periodo: el periodo nace "refunded" y no cuenta para Privé',
  :'e7m'::jsonb->>'reason' = 'no_period' AND ap.pstatus('in_ap7') = 'refunded' AND public.prive_tenure_days(ap.u(7)) = 0,
  'periodo=' || coalesce(ap.pstatus('in_ap7'), '-') || ' dias=' || public.prive_tenure_days(ap.u(7)));

SELECT ap.mk(8);
SELECT ap.logged('evt_ap8_open', 'charge.dispute.created', 'in_ap8', 'disputa_abierta_aviso', now() - interval '2 days', 0, 'dp_ap8', 'needs_response');
SELECT ap.record(8, 'in_ap8', now() - interval '20 days', now() + interval '10 days', ap.u(8));
SELECT ap.pstatus('in_ap8') AS e8a \gset
SELECT ap.logged('evt_ap8_won', 'charge.dispute.closed', 'in_ap8', 'disputa_ganada_estado_stripe', now() - interval '1 day', 0, 'dp_ap8', 'won');
SELECT public.prive_mark_paid_period('in_ap8', 'dispute_won', NULL);
SELECT ap.ok('AP09 disputa abierta antes del periodo: nace "disputed"; al ganarse vuelve a "paid"',
  :'e8a' = 'disputed' AND ap.pstatus('in_ap8') = 'paid', 'al_registrar=' || :'e8a' || ' final=' || coalesce(ap.pstatus('in_ap8'), '-'));

SELECT ap.mk(9);
SELECT ap.logged('evt_ap9_open', 'charge.dispute.created', 'in_ap9', 'disputa_abierta_aviso', now() - interval '3 days', 0, 'dp_ap9', 'needs_response');
SELECT ap.logged('evt_ap9_lost', 'charge.dispute.closed', 'in_ap9', 'disputa_perdida_revocado', now() - interval '1 day', 0, 'dp_ap9', 'lost');
SELECT ap.record(9, 'in_ap9', now() - interval '20 days', now() + interval '10 days', ap.u(9));
SELECT ap.ok('AP10 disputa perdida antes del periodo: nace "dispute_lost"', ap.pstatus('in_ap9') = 'dispute_lost', coalesce(ap.pstatus('in_ap9'), '-'));

SELECT ap.mk(10);
SELECT ap.logged('evt_ap10_part', 'charge.refunded', 'in_ap10', 'reembolso_parcial_conserva_revision', now() - interval '1 day', 3000);
SELECT ap.record(10, 'in_ap10', now() - interval '20 days', now() + interval '10 days', ap.u(10));
SELECT ap.ok('AP11 reembolso parcial antes del periodo: "partially_refunded" (sigue contando) con su monto',
  ap.pstatus('in_ap10') = 'partially_refunded' AND (SELECT amount_refunded FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ap10') = 3000
  AND public.prive_tenure_days(ap.u(10)) = 20, coalesce(ap.pstatus('in_ap10'), '-'));

-- Cuenta eliminada: el registro "cuenta_eliminada_sin_cambios" no toca nada.
SELECT ap.mk(11);
SELECT ap.logged('evt_ap11_del', 'charge.refunded', 'in_ap11', 'cuenta_eliminada_sin_cambios', now() - interval '1 day');
SELECT ap.record(11, 'in_ap11', now() - interval '20 days', now() + interval '10 days', ap.u(11));
SELECT ap.ok('AP12 una decisión "cuenta_eliminada_sin_cambios" no se reaplica', ap.pstatus('in_ap11') = 'paid', coalesce(ap.pstatus('in_ap11'), '-'));

-- ===================================================================== F. registro + antigüedad en una transacción (llave = event_id)
SELECT ap.mk(12);
SELECT ap.record(12, 'in_ap12', now() - interval '20 days', now() + interval '10 days', ap.u(12));
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap12_won', 'type', 'charge.dispute.closed', 'invoice_id', 'in_ap12',
         'dispute_id', 'dp_ap12', 'dispute_status', 'won', 'action', 'disputa_ganada_estado_stripe', 'event_created', now() - interval '1 day'),
       'dispute_won', NULL) AS f12a \gset
-- El charge.dispute.created de esa misma disputa llega DESPUÉS (Stripe no garantiza el orden).
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap12_open', 'type', 'charge.dispute.created', 'invoice_id', 'in_ap12',
         'dispute_id', 'dp_ap12', 'dispute_status', 'needs_response', 'action', 'disputa_abierta_aviso', 'event_created', now() - interval '5 days'),
       'dispute_opened', NULL) AS f12b \gset
SELECT ap.ok('AP13 disputa cerrada antes que su apertura: la apertura tardía no deja el periodo "en disputa"',
  ap.pstatus('in_ap12') = 'paid' AND :'f12b'::jsonb->'tenure'->>'reason' = 'dispute_already_closed',
  'periodo=' || coalesce(ap.pstatus('in_ap12'), '-') || ' r=' || coalesce(:'f12b', '-'));

SELECT ap.mk(13);
SELECT ap.record(13, 'in_ap13', now() - interval '20 days', now() + interval '10 days', ap.u(13));
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap13', 'type', 'charge.refunded', 'invoice_id', 'in_ap13',
         'amount', 9900, 'amount_refunded', 9900, 'action', 'reembolso_total_revocado', 'event_created', now()), 'refund_full', 9900) AS f13a \gset
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap13', 'type', 'charge.refunded', 'invoice_id', 'in_ap13',
         'amount', 9900, 'amount_refunded', 9900, 'action', 'reembolso_total_revocado', 'event_created', now()), 'refund_full', 9900) AS f13b \gset
SELECT ap.ok('AP14 commit: primera vez registra y marca; la segunda es duplicado y no repite nada',
  (:'f13a'::jsonb->>'logged')::boolean AND (:'f13b'::jsonb->>'duplicate')::boolean
  AND (SELECT count(*) FROM stripe_payment_events WHERE event_id = 'evt_ap13') = 1 AND ap.pstatus('in_ap13') = 'refunded',
  :'f13a' || ' / ' || :'f13b');

-- Falla de la base a mitad: la transacción se deshace completa (ni registro ni marca) y el reintento aplica.
SELECT ap.mk(14);
SELECT ap.record(14, 'in_ap14', now() - interval '20 days', now() + interval '10 days', ap.u(14));
-- (subtransacción: el error de en medio deshace TODO lo que hizo la función, como un ROLLBACK)
DO $$ BEGIN
  PERFORM public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap14', 'type', 'charge.refunded', 'invoice_id', 'in_ap14',
         'amount', 9900, 'amount_refunded', 9900, 'action', 'reembolso_total_revocado', 'event_created', now()), 'refund_full', 9900);
  PERFORM 1 / 0;  -- la conexión se cae / la base falla antes del COMMIT
EXCEPTION WHEN division_by_zero THEN NULL; END $$;
SELECT ap.pstatus('in_ap14') AS f14a \gset
SELECT (SELECT count(*) FROM stripe_payment_events WHERE event_id = 'evt_ap14') AS f14n \gset
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id', 'evt_ap14', 'type', 'charge.refunded', 'invoice_id', 'in_ap14',
         'amount', 9900, 'amount_refunded', 9900, 'action', 'reembolso_total_revocado', 'event_created', now()), 'refund_full', 9900);
SELECT ap.ok('AP15 falla antes de confirmar: nada queda a medias (ni registro ni marca); el reintento aplica una vez',
  :'f14a' = 'paid' AND :f14n = 0 AND ap.pstatus('in_ap14') = 'refunded'
  AND (SELECT count(*) FROM stripe_payment_events WHERE event_id = 'evt_ap14') = 1, 'antes=' || :'f14a' || ' filas=' || :f14n);

SELECT ap.ok('AP16 stripe_commit_payment_event solo para service_role',
  NOT has_function_privilege('authenticated', 'public.stripe_commit_payment_event(jsonb, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.stripe_commit_payment_event(jsonb, text, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.stripe_commit_payment_event(jsonb, text, integer)', 'EXECUTE'));

-- ===================================================================== G. falla tras escribir la suscripción y antes del periodo
SELECT ap.mk(15);
SELECT ap.apply(15, 'active', now() - interval '1 hour');                    -- 1a entrega: suscripción escrita…
-- …y prive_record_paid_period falló (500). Reintento de Stripe: mismo evento completo.
SELECT ap.apply(15, 'active', now() - interval '1 hour') AS g15 \gset
SELECT ap.record(15, 'in_ap15', now() - interval '1 hour', now() + interval '30 days');
SELECT ap.ok('AP17 reintento tras falla entre suscripción y periodo: aplica igual, una fila y un periodo',
  (:'g15'::jsonb->>'applied')::boolean AND public.is_pro(ap.u(15)) AND (SELECT count(*) FROM pro_paid_periods WHERE user_id = ap.u(15)) = 1, :'g15');

-- ===================================================================== H. ciclo de vida
SELECT ap.mk(16);
SELECT ap.apply(16, 'active', now() - interval '2 days', now() + interval '28 days', true) AS h16 \gset
SELECT public.is_pro(ap.u(16)) AS h16pro \gset
SELECT ap.apply(16, 'canceled', now(), now() - interval '1 second', true);
SELECT ap.ok('AP18 cancelación programada: PRO hasta el fin del periodo; al terminar, sin PRO',
  :'h16pro'::boolean AND NOT public.is_pro(ap.u(16)), :'h16');

SELECT ap.mk(17);
SELECT ap.apply(17, 'active', now() - interval '35 days', now() - interval '5 days');
SELECT public.is_pro(ap.u(17)) AS h17a \gset
SELECT ap.apply(17, 'active', now(), now() + interval '30 days', false, 'sub_ap17_nueva') AS h17 \gset
SELECT ap.ok('AP19 periodo vencido sin renovación: sin PRO; una suscripción nueva sí se aplica',
  NOT :'h17a'::boolean AND (:'h17'::jsonb->>'applied')::boolean AND public.is_pro(ap.u(17)), :'h17a' || ' ' || :'h17');

SELECT ap.mk(18);
SELECT ap.apply(18, 'active', now() - interval '2 days', now() + interval '28 days', true);
SELECT ap.apply(18, 'active', now() - interval '1 day', now() + interval '28 days', false);
SELECT ap.ok('AP20 reactivación: sigue PRO y sin cancelación programada',
  public.is_pro(ap.u(18)) AND NOT (SELECT cancel_at_period_end FROM subscriptions WHERE user_id = ap.u(18)));

SELECT ap.mk(19);
SELECT ap.apply(19, 'active', now() - interval '1 day');
SELECT ap.apply(19, 'active', now(), now() + interval '30 days', false, 'sub_ap19_dup') AS h19 \gset
SELECT ap.ok('AP21 segunda suscripción viva (dos checkouts): no pisa la primera (other_live_subscription → el webhook avisa)',
  :'h19'::jsonb->>'reason' = 'other_live_subscription' AND (SELECT stripe_subscription_id FROM subscriptions WHERE user_id = ap.u(19)) = 'sub_ap19',
  :'h19');

DROP SCHEMA ap CASCADE;
