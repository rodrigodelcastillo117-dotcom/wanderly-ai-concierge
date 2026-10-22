-- AUD-05 (auditoría de cierre, grupo pagos): reembolsos y disputas de Stripe sin efectos a medias
-- ni fuera de orden sobre los periodos pagados de Privé. Idempotente: se puede correr más de una vez.
-- REQUIERE AUTORIZACIÓN DEL DUEÑO para aplicarse en producción (y publicar stripe-webhook después).
--
-- Defectos que corrige (pruebas: supabase/tests/payments/stripe_events.sql AP08–AP16 y run.sh CC3–CC4;
-- src/test/stripeAtomicity.test.ts):
--   1. Un reembolso o disputa que se procesaba ANTES de que existiera el periodo pagado de su factura
--      (invoice.paid falló y Stripe lo reintentó después, o llegó tarde) quedaba registrado como hecho
--      con 'no_period'; cuando por fin se registraba el periodo, nacía 'paid' y un cargo REEMBOLSADO
--      contaba para la antigüedad de Privé. Ahora prive_record_paid_period, al insertar, reaplica las
--      decisiones ya registradas en stripe_payment_events para esa factura, en el orden de Stripe.
--   2. Carrera: si el invoice.paid registraba el periodo entre la marca y el registro del reembolso,
--      ninguno de los dos veía al otro. Ahora las dos rutas toman el mismo candado por factura
--      (pg_advisory_xact_lock) y el webhook escribe registro + antigüedad en UNA transacción
--      (stripe_commit_payment_event), con el event_id como llave de idempotencia.
--   3. Un charge.dispute.created que llegaba después de su charge.dispute.closed (ganada) dejaba el
--      periodo 'disputed' para siempre. Ahora la apertura tardía de una disputa ya cerrada no marca.

-- Candado por factura (lo usan las tres funciones; se libera al terminar la transacción).
CREATE OR REPLACE FUNCTION public.pro_paid_period_lock(_invoice_id text)
RETURNS void LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('pro_paid_period:' || coalesce(_invoice_id, ''), 0));
$$;
REVOKE ALL ON FUNCTION public.pro_paid_period_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_paid_period_lock(text) TO service_role;

-- Evento de antigüedad que corresponde a una fila de stripe_payment_events (misma tabla de
-- decisiones que tenureEventFor en supabase/functions/_shared/prive-tenure.ts).
CREATE OR REPLACE FUNCTION public.stripe_payment_tenure_event(_type text, _action text, _dispute_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _action LIKE 'cuenta_eliminada%' THEN NULL
    WHEN _type = 'charge.refunded' AND _action LIKE 'reembolso_total%' THEN 'refund_full'
    WHEN _type = 'charge.refunded' THEN 'refund_partial'
    WHEN _type = 'charge.dispute.created' THEN 'dispute_opened'
    WHEN _type = 'charge.dispute.closed' AND _dispute_status = 'lost' THEN 'dispute_lost'
    WHEN _type = 'charge.dispute.closed' AND _dispute_status IN ('won', 'warning_closed') THEN 'dispute_won'
  END;
$$;
REVOKE ALL ON FUNCTION public.stripe_payment_tenure_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_payment_tenure_event(text, text, text) TO service_role;

-- prive_mark_paid_period: mismo comportamiento que 20261023090300, ahora bajo el candado de la factura.
CREATE OR REPLACE FUNCTION public.prive_mark_paid_period(_invoice_id text, _event text, _amount_refunded int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.pro_paid_periods%ROWTYPE;
  v_before text;
  v_after text;
  v_prior text;
  v_closed int := 0;
BEGIN
  IF _event NOT IN ('refund_full', 'refund_partial', 'dispute_opened', 'dispute_lost', 'dispute_won') THEN
    RAISE EXCEPTION 'prive_mark_paid_period: evento inválido %', _event;
  END IF;
  PERFORM public.pro_paid_period_lock(_invoice_id);
  SELECT * INTO p FROM public.pro_paid_periods WHERE stripe_invoice_id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'no_period'); END IF;
  v_before := p.status;
  v_after := p.status;
  v_prior := p.status_before_dispute;
  CASE _event
    WHEN 'refund_full' THEN
      v_after := 'refunded'; v_prior := NULL;
    WHEN 'refund_partial' THEN
      IF p.status IN ('paid', 'partially_refunded') THEN v_after := 'partially_refunded';
      ELSIF p.status = 'disputed' THEN v_prior := 'partially_refunded';
      END IF;
    WHEN 'dispute_opened' THEN
      IF p.status IN ('paid', 'partially_refunded') THEN v_prior := p.status; v_after := 'disputed'; END IF;
    WHEN 'dispute_lost' THEN
      IF p.status <> 'refunded' THEN v_after := 'dispute_lost'; v_prior := NULL; END IF;
    WHEN 'dispute_won' THEN
      IF p.status = 'disputed' THEN v_after := coalesce(p.status_before_dispute, 'paid'); v_prior := NULL; END IF;
  END CASE;
  UPDATE public.pro_paid_periods
     SET status = v_after, status_before_dispute = v_prior,
         amount_refunded = greatest(amount_refunded, coalesce(_amount_refunded, 0)), updated_at = now()
   WHERE id = p.id;
  IF public.prive_access_code(p.user_id) IS NOT NULL THEN
    v_closed := public.prive_revoke_sessions(p.user_id, 'tenure_changed');
  END IF;
  PERFORM public.prive_audit(p.user_id, 'paid_period_' || _event, 'system',
    jsonb_build_object('invoice', _invoice_id, 'before', v_before, 'after', v_after,
                       'tenure_days', public.prive_tenure_days(p.user_id), 'sessions_closed', v_closed));
  RETURN jsonb_build_object('applied', v_before IS DISTINCT FROM v_after, 'before', v_before, 'after', v_after,
                            'user_id', p.user_id, 'tenure_days', public.prive_tenure_days(p.user_id),
                            'sessions_closed', v_closed);
END $$;
REVOKE ALL ON FUNCTION public.prive_mark_paid_period(text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_mark_paid_period(text, text, int) TO service_role;

-- prive_record_paid_period: misma firma y respuestas que 20261023090300. Cambios: candado de la
-- factura y, al INSERTAR, se reaplican los reembolsos/disputas ya registrados de esa factura.
CREATE OR REPLACE FUNCTION public.prive_record_paid_period(
  _user uuid, _invoice_id text, _subscription_id text, _customer_id text,
  _period_start timestamptz, _period_end timestamptz, _amount_paid int, _currency text, _source text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_id uuid;
  v_inserted boolean;
  e record;
  v_ev text;
  v_replayed int := 0;
BEGIN
  IF _source NOT IN ('webhook', 'backfill', 'test') THEN RAISE EXCEPTION 'prive_record_paid_period: origen inválido'; END IF;
  IF _invoice_id IS NULL OR _invoice_id = '' THEN RETURN jsonb_build_object('recorded', false, 'reason', 'no_invoice'); END IF;
  IF _amount_paid IS NULL OR _amount_paid <= 0 THEN RETURN jsonb_build_object('recorded', false, 'reason', 'zero_amount'); END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end <= _period_start THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'invalid_period');
  END IF;
  SELECT u.id INTO v_user FROM auth.users u WHERE u.id = _user;
  IF v_user IS NULL AND _subscription_id IS NOT NULL THEN
    SELECT s.user_id INTO v_user FROM public.subscriptions s WHERE s.stripe_subscription_id = _subscription_id LIMIT 1;
  END IF;
  IF v_user IS NULL AND _customer_id IS NOT NULL THEN
    SELECT s.user_id INTO v_user FROM public.subscriptions s WHERE s.stripe_customer_id = _customer_id
     ORDER BY s.updated_at DESC LIMIT 1;
  END IF;
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'unknown_user');
  END IF;

  PERFORM public.pro_paid_period_lock(_invoice_id);
  INSERT INTO public.pro_paid_periods AS p (user_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id,
                                            period, amount_paid, currency, status, source)
  VALUES (v_user, _invoice_id, _subscription_id, _customer_id, tstzrange(_period_start, _period_end, '[)'),
          _amount_paid, upper(left(_currency, 3)), 'paid', _source)
  ON CONFLICT (stripe_invoice_id) DO UPDATE
     SET period = EXCLUDED.period, amount_paid = EXCLUDED.amount_paid,
         stripe_subscription_id = coalesce(p.stripe_subscription_id, EXCLUDED.stripe_subscription_id),
         stripe_customer_id = coalesce(p.stripe_customer_id, EXCLUDED.stripe_customer_id), updated_at = now()
   WHERE p.user_id = EXCLUDED.user_id
  RETURNING p.id, (xmax = 0) INTO v_id, v_inserted;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'invoice_belongs_to_other_account');
  END IF;
  IF v_inserted THEN
    PERFORM public.prive_audit(v_user, 'paid_period_recorded', 'system',
      jsonb_build_object('invoice', _invoice_id, 'source', _source, 'start', _period_start, 'end', _period_end));
    -- Reembolsos y disputas de ESTA factura que el webhook ya decidió antes de que existiera el periodo.
    FOR e IN
      SELECT s.type, s.action, s.dispute_id, s.dispute_status, s.amount_refunded
        FROM public.stripe_payment_events s
       WHERE s.invoice_id = _invoice_id
       ORDER BY s.event_created NULLS FIRST, s.created_at
    LOOP
      v_ev := public.stripe_payment_tenure_event(e.type, e.action, e.dispute_status);
      CONTINUE WHEN v_ev IS NULL;
      CONTINUE WHEN v_ev = 'dispute_opened' AND e.dispute_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.stripe_payment_events c
         WHERE c.dispute_id = e.dispute_id AND c.type = 'charge.dispute.closed');
      PERFORM public.prive_mark_paid_period(_invoice_id, v_ev, e.amount_refunded::int);
      v_replayed := v_replayed + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('recorded', true, 'inserted', v_inserted, 'user_id', v_user,
                            'replayed', v_replayed, 'tenure_days', public.prive_tenure_days(v_user));
END $$;
REVOKE ALL ON FUNCTION public.prive_record_paid_period(uuid, text, text, text, timestamptz, timestamptz, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_record_paid_period(uuid, text, text, text, timestamptz, timestamptz, int, text, text) TO service_role;

-- Último paso de un reembolso o disputa en el webhook: guarda la decisión (stripe_payment_events,
-- llave = event_id) y ajusta la antigüedad de la factura en la MISMA transacción. Si algo falla no
-- queda ninguno de los dos y Stripe reintenta; si el event_id ya existe es un duplicado y no se
-- repite nada. _row lleva las columnas de stripe_payment_events (las que falten quedan NULL).
CREATE OR REPLACE FUNCTION public.stripe_commit_payment_event(_row jsonb, _tenure_event text, _amount_refunded int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.stripe_payment_events%ROWTYPE;
  v_prev text;
  v_tenure jsonb := NULL;
BEGIN
  r := jsonb_populate_record(NULL::public.stripe_payment_events, _row);
  IF r.event_id IS NULL OR r.type IS NULL OR r.action IS NULL THEN
    RAISE EXCEPTION 'stripe_commit_payment_event: faltan event_id, type o action';
  END IF;
  IF _tenure_event IS NOT NULL AND _tenure_event NOT IN ('refund_full', 'refund_partial', 'dispute_opened', 'dispute_lost', 'dispute_won') THEN
    RAISE EXCEPTION 'stripe_commit_payment_event: evento de antigüedad inválido %', _tenure_event;
  END IF;
  IF r.invoice_id IS NOT NULL THEN PERFORM public.pro_paid_period_lock(r.invoice_id); END IF;

  INSERT INTO public.stripe_payment_events (event_id, type, charge_id, invoice_id, subscription_id, customer_id,
      amount, amount_refunded, currency, dispute_reason, dispute_status, action, event_created,
      account_id, dispute_id, before_state, after_state, alert_status)
  VALUES (r.event_id, r.type, r.charge_id, r.invoice_id, r.subscription_id, r.customer_id,
      r.amount, r.amount_refunded, r.currency, r.dispute_reason, r.dispute_status, r.action, r.event_created,
      r.account_id, r.dispute_id, r.before_state, r.after_state, r.alert_status)
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT action INTO v_prev FROM public.stripe_payment_events WHERE event_id = r.event_id;
    RETURN jsonb_build_object('logged', false, 'duplicate', true, 'action', v_prev);
  END IF;

  IF _tenure_event IS NOT NULL AND r.invoice_id IS NOT NULL THEN
    IF _tenure_event = 'dispute_opened' AND r.dispute_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.stripe_payment_events c
          WHERE c.dispute_id = r.dispute_id AND c.type = 'charge.dispute.closed') THEN
      -- La disputa ya se cerró (Stripe entregó el cierre primero): abrirla ahora la dejaría abierta para siempre.
      v_tenure := jsonb_build_object('applied', false, 'reason', 'dispute_already_closed');
    ELSE
      v_tenure := public.prive_mark_paid_period(r.invoice_id, _tenure_event, _amount_refunded);
    END IF;
  END IF;
  RETURN jsonb_build_object('logged', true, 'duplicate', false, 'tenure', v_tenure);
END $$;
REVOKE ALL ON FUNCTION public.stripe_commit_payment_event(jsonb, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_commit_payment_event(jsonb, text, int) TO service_role;

CREATE INDEX IF NOT EXISTS stripe_payment_events_invoice_idx ON public.stripe_payment_events (invoice_id);
CREATE INDEX IF NOT EXISTS stripe_payment_events_dispute_idx ON public.stripe_payment_events (dispute_id) WHERE dispute_id IS NOT NULL;
