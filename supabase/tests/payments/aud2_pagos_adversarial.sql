-- Segunda auditoría (grupo pagos): casos adversariales nuevos sobre las funciones SQL REALES.
-- Copia de /home/user/audit2/pagos/codigo/supabase/tests/payments/aud2_pagos_adversarial.sql convertida
-- en prueba de regresión (ronda r2, grupo cuentas): "OK Xnn" = correcto; "FALLA Xnn" = defecto.
-- X04 y X05 (D-P3-2, doble suscripción) no son de esta ronda: imprimen "PENDIENTE" en lugar de FALLA.
-- X09 se ajustó al contrato nuevo de notify_admins (D-P3-3: -1 = sin destinatarios). Corre con run.sh.
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
RESET ROLE;
DROP SCHEMA IF EXISTS ax CASCADE;
CREATE SCHEMA ax;
CREATE FUNCTION ax.u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('ab000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION ax.chk(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'FALLA ' || name || ' ' || coalesce(detail, '') END $$;
-- Casos documentados como pendientes de otra ronda: no cuentan como falla de la suite.
CREATE FUNCTION ax.pend(name text, cond boolean, detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'OK ' || name ELSE 'PENDIENTE ' || name || ' ' || coalesce(detail, '') END $$;
CREATE FUNCTION ax.mk(n int) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (ax.u(n), 'ax' || n || '@example.test', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.subscriptions (user_id, status, plan, stripe_customer_id, currency)
  VALUES (ax.u(n), 'incomplete', 'pro', 'cus_ax' || n, 'MXN') ON CONFLICT (user_id) DO NOTHING;
  RETURN ax.u(n);
END $$;
CREATE FUNCTION ax.apply(n int, st text, ev timestamptz, sub text, price text DEFAULT 'price_pro_mxn', cur text DEFAULT 'mxn',
                         period_end timestamptz DEFAULT now() + interval '30 days') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.apply_stripe_subscription(ax.u(n), 'cus_ax' || n, sub, st, NULL, period_end, false, price, cur, ev) $$;

-- X01 (N-06) customer.subscription.updated a OTRO precio y OTRA moneda (p. ej. USD 1.00): ¿sigue PRO?
SELECT ax.mk(1);
SELECT ax.apply(1, 'active', now() - interval '1 hour', 'sub_ax1');
SELECT ax.apply(1, 'active', now(), 'sub_ax1', 'price_otro_usd_1', 'usd') AS x1 \gset
SELECT ax.chk('X01 un cambio a otro precio/moneda deja de dar PRO (is_pro revisa el precio)',
  NOT public.is_pro(ax.u(1)),
  'is_pro=' || public.is_pro(ax.u(1)) || ' price_id=' || (SELECT price_id FROM subscriptions WHERE user_id = ax.u(1))
  || ' currency=' || (SELECT currency FROM subscriptions WHERE user_id = ax.u(1)));

-- X02 'active' sin current_period_end (payload sin periodo, versión de API distinta): PRO sin vencimiento
SELECT ax.mk(2);
SELECT ax.apply(2, 'active', now(), 'sub_ax2', 'price_pro_mxn', 'mxn', NULL);
SELECT ax.chk('X02 una fila active sin current_period_end no da PRO indefinido',
  NOT public.is_pro(ax.u(2)), 'is_pro=' || public.is_pro(ax.u(2)) || ' (active + period_end NULL => PRO sin fecha de fin)');

-- X03 estados que no deben dar PRO
SELECT ax.mk(3);
SELECT ax.apply(3, 'past_due', now() - interval '4 minutes', 'sub_ax3');
SELECT public.is_pro(ax.u(3)) AS x3a \gset
SELECT ax.apply(3, 'paused', now() - interval '3 minutes', 'sub_ax3');
SELECT public.is_pro(ax.u(3)) AS x3b \gset
SELECT ax.apply(3, 'unpaid', now() - interval '2 minutes', 'sub_ax3');
SELECT public.is_pro(ax.u(3)) AS x3c \gset
SELECT ax.apply(3, 'incomplete', now() - interval '1 minutes', 'sub_ax3');
SELECT public.is_pro(ax.u(3)) AS x3d \gset
SELECT ax.chk('X03 past_due/paused/unpaid/incomplete no dan PRO', NOT (:'x3a'::boolean OR :'x3b'::boolean OR :'x3c'::boolean OR :'x3d'::boolean),
  'past_due=' || :'x3a' || ' paused=' || :'x3b' || ' unpaid=' || :'x3c' || ' incomplete=' || :'x3d');

-- X04 doble suscripción viva: la 2a (sub_b) se ignora; si después termina la 1a (sub_a), la persona
-- se queda SIN PRO aunque sub_b sigue cobrando en Stripe (nadie relee las otras suscripciones del cliente).
SELECT ax.mk(4);
SELECT ax.apply(4, 'active', now() - interval '2 days', 'sub_ax4_a');
SELECT ax.apply(4, 'active', now() - interval '1 day', 'sub_ax4_b') AS x4b \gset
SELECT ax.apply(4, 'canceled', now(), 'sub_ax4_a', 'price_pro_mxn', 'mxn', now() - interval '1 second') AS x4c \gset
SELECT ax.pend('X04 doble suscripción: al cancelar la 1a, la 2a (viva y cobrando) sigue dando PRO',
  public.is_pro(ax.u(4)),
  '2a=' || (:'x4b'::jsonb->>'reason') || ' fin_1a=' || (:'x4c'::jsonb->>'reason') || ' is_pro=' || public.is_pro(ax.u(4)));

-- X05 doble suscripción + reembolso total de la 1a: revoke_paid_access cancela la fila aunque la 2a cobra.
SELECT ax.mk(5);
SELECT ax.apply(5, 'active', now() - interval '2 days', 'sub_ax5_a');
SELECT ax.apply(5, 'active', now() - interval '1 day', 'sub_ax5_b');
SELECT public.revoke_paid_access('sub_ax5_a', 'cus_ax5', now(), 'charge.refunded') AS x5 \gset
SELECT ax.pend('X05 doble suscripción: reembolsar la duplicada equivocada no deja sin PRO a quien sigue pagando la otra',
  public.is_pro(ax.u(5)), 'revoke=' || (:'x5'::jsonb->>'reason') || ' is_pro=' || public.is_pro(ax.u(5)));

-- X06 reembolso parcial y luego total entregados AL REVÉS y antes del periodo: el periodo nace refunded
SELECT ax.mk(6);
INSERT INTO public.stripe_payment_events (event_id, type, invoice_id, amount, amount_refunded, action, event_created)
VALUES ('evt_ax6_full', 'charge.refunded', 'in_ax6', 9900, 9900, 'reembolso_total_revocado', now() - interval '1 hour'),
       ('evt_ax6_part', 'charge.refunded', 'in_ax6', 9900, 3000, 'reembolso_parcial_conserva_revision', now() - interval '2 hours');
SELECT public.prive_record_paid_period(ax.u(6), 'in_ax6', 'sub_ax6', 'cus_ax6', now() - interval '20 days', now() + interval '10 days', 9900, 'mxn', 'webhook');
SELECT ax.chk('X06 parcial + total (fuera de orden) antes del periodo: refunded y 0 días',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ax6') = 'refunded' AND public.prive_tenure_days(ax.u(6)) = 0,
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ax6'));

-- X07 disputa abierta + ganada, ambas ANTES del periodo: el periodo cuenta (paid)
SELECT ax.mk(7);
INSERT INTO public.stripe_payment_events (event_id, type, invoice_id, dispute_id, dispute_status, action, event_created)
VALUES ('evt_ax7_open', 'charge.dispute.created', 'in_ax7', 'dp_ax7', 'needs_response', 'disputa_abierta_aviso', now() - interval '3 days'),
       ('evt_ax7_won', 'charge.dispute.closed', 'in_ax7', 'dp_ax7', 'won', 'disputa_ganada_estado_stripe', now() - interval '1 day');
SELECT public.prive_record_paid_period(ax.u(7), 'in_ax7', 'sub_ax7', 'cus_ax7', now() - interval '20 days', now() + interval '10 days', 9900, 'mxn', 'webhook');
SELECT ax.chk('X07 disputa abierta y ganada antes del periodo: paid',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ax7') = 'paid', (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ax7'));

-- X08 reembolso total de una factura ANTERIOR (decisión "factura_anterior_revision"): el periodo deja de contar
SELECT ax.mk(8);
SELECT public.prive_record_paid_period(ax.u(8), 'in_ax8', 'sub_ax8', 'cus_ax8', now() - interval '40 days', now() - interval '10 days', 9900, 'mxn', 'webhook');
SELECT public.stripe_commit_payment_event(jsonb_build_object('event_id','evt_ax8','type','charge.refunded','invoice_id','in_ax8',
       'amount',9900,'amount_refunded',9900,'action','reembolso_total_factura_anterior_revision','event_created',now()), 'refund_full', 9900);
SELECT ax.chk('X08 reembolso total de factura anterior: periodo refunded',
  (SELECT status FROM pro_paid_periods WHERE stripe_invoice_id = 'in_ax8') = 'refunded');

-- X09 disputa: si no hay administradores, notify_admins devuelve 0 y el webhook lo toma como
-- "campana_ya_enviada" (éxito): nadie se entera de la disputa.
SELECT count(*) AS x9admins FROM public.admins \gset
SELECT public.notify_admins('stripe:evt_ax9', 'Disputa abierta en Stripe', 'prueba') AS x9 \gset
SELECT ax.chk('X09 sin administradores, el aviso de disputa no se da por enviado',
  :x9admins > 0 OR :x9 > 0, 'admins=' || :x9admins || ' notify_admins=' || :x9 || ' (index.ts lo traduce a "campana_ya_enviada" y responde 200)');

-- X10 cortesía por correo: con email_confirmed_at lleno al registrarse (mailer_autoconfirm=true),
-- quien registre primero un correo de comp_grants obtiene PRO comped sin vencimiento y plan 'pro'
-- (sin topes mientras pro_limits_enforced esté apagado).
INSERT INTO public.comp_grants (email) VALUES ('vip-ajeno@example.test') ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (ax.u(10), 'vip-ajeno@example.test', now());
SELECT ax.chk('X10 (N-01) registro con correo ajeno de comp_grants (autoconfirm) NO da PRO',
  NOT public.is_pro(ax.u(10)),
  'is_pro=' || public.is_pro(ax.u(10)) || ' status=' || coalesce((SELECT status FROM subscriptions WHERE user_id = ax.u(10)), '-')
  || ' plan=' || public.effective_plan(ax.u(10)) || ' limite_concierge=' || coalesce((SELECT limit_value::text FROM public.quota_rule(ax.u(10), 'concierge')), 'NULL(sin tope)'));

-- X11 cambio de correo de una cuenta existente a un correo de comp_grants (si Auth no exige confirmar el
-- correo nuevo): el trigger AFTER UPDATE OF email también da PRO comped.
INSERT INTO public.comp_grants (email) VALUES ('vip-ajeno2@example.test') ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (ax.u(11), 'atacante@example.test', now());
UPDATE auth.users SET email = 'vip-ajeno2@example.test' WHERE id = ax.u(11);
SELECT ax.chk('X11 cambiar el correo a uno de comp_grants NO da PRO',
  NOT public.is_pro(ax.u(11)), 'is_pro=' || public.is_pro(ax.u(11)));

-- X12 pérdida de PRO por reembolso total: arrastra Privé (PRIVE_NOT_PRO) y la cuota vuelve a FREE.
SELECT ax.mk(12);
SELECT ax.apply(12, 'active', now() - interval '1 day', 'sub_ax12');
INSERT INTO public.prive_grants (email, user_id, reason, granted_by) VALUES ('ax12@example.test', ax.u(12), 'prueba aud2', 'auditor');
INSERT INTO public.prive_memberships (user_id, status, basis, activated_at) VALUES (ax.u(12), 'active', 'grant', now());
SELECT coalesce(public.prive_access_code(ax.u(12)), 'OK') AS x12a, public.effective_plan(ax.u(12)) AS x12p \gset
SELECT public.revoke_paid_access('sub_ax12', 'cus_ax12', now(), 'charge.refunded');
SELECT ax.chk('X12 reembolso total: Privé pasa a PRIVE_NOT_PRO y el plan a free',
  :'x12a' = 'OK' AND :'x12p' = 'pro' AND public.prive_access_code(ax.u(12)) = 'PRIVE_NOT_PRO' AND public.effective_plan(ax.u(12)) = 'free',
  'antes=' || :'x12a' || '/' || :'x12p' || ' despues=' || coalesce(public.prive_access_code(ax.u(12)), 'OK') || '/' || public.effective_plan(ax.u(12)));

-- X13 la antigüedad de Privé (90 días pagados = elegible) cuenta facturas de CUALQUIER precio/moneda.
SELECT ax.mk(13);
SELECT public.prive_record_paid_period(ax.u(13), 'in_ax13_usd', 'sub_ax13', 'cus_ax13', now() - interval '95 days', now() - interval '1 day', 100, 'usd', 'webhook');
SELECT ax.chk('X13 una factura de USD 1.00 no cuenta como antigüedad PRO de $99 MXN',
  public.prive_tenure_days(ax.u(13)) = 0,
  'tenure=' || public.prive_tenure_days(ax.u(13)) || ' elegible_privé=' || public.prive_is_eligible(ax.u(13)));

DROP SCHEMA ax CASCADE;
DELETE FROM public.comp_grants WHERE email IN ('vip-ajeno@example.test', 'vip-ajeno2@example.test');
