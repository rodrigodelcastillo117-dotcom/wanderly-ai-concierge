-- IATOS Privé (grupo core) · 4/4: registro de periodos PAGADOS desde Stripe (stripe-webhook y
-- prive-tenure-backfill) y su estado ante reembolsos y disputas. Contrato §1, §3 y D3. Idempotente.
--
-- Política (docs/iatos/IATOS_PRIVE_MEMBERSHIP_POLICY.md):
--   * invoice.paid con monto > 0 → un periodo 'paid' (el del renglón de la suscripción). Monto 0
--     (prueba, cupón del 100 %) → no se registra: la prueba nunca cuenta.
--   * reembolso total → 'refunded' (deja de contar). Reembolso parcial → 'partially_refunded' (cuenta).
--   * disputa abierta → 'disputed' (no cuenta mientras esté abierta); ganada → vuelve a su estado;
--     perdida → 'dispute_lost' (no cuenta).
--   * Si por eso la persona baja de 90 días, su acceso se pausa (sus sesiones Privé se cierran) hasta
--     volver a 90; no es una revocación por fraude.
-- Reutiliza la decisión de payments.ts (sec2): esto solo ajusta la ANTIGÜEDAD; el acceso PRO lo
-- sigue decidiendo revoke_paid_access.

CREATE OR REPLACE FUNCTION public.prive_record_paid_period(
  _user uuid, _invoice_id text, _subscription_id text, _customer_id text,
  _period_start timestamptz, _period_end timestamptz, _amount_paid int, _currency text, _source text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_id uuid;
  v_inserted boolean;
BEGIN
  IF _source NOT IN ('webhook', 'backfill', 'test') THEN RAISE EXCEPTION 'prive_record_paid_period: origen inválido'; END IF;
  IF _invoice_id IS NULL OR _invoice_id = '' THEN RETURN jsonb_build_object('recorded', false, 'reason', 'no_invoice'); END IF;
  IF _amount_paid IS NULL OR _amount_paid <= 0 THEN RETURN jsonb_build_object('recorded', false, 'reason', 'zero_amount'); END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end <= _period_start THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'invalid_period');
  END IF;
  -- Cuenta: la de la metadata de Stripe si existe; si no, la fila de subscriptions de esa
  -- suscripción o de ese cliente.
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
    -- La factura ya existe ligada a OTRA cuenta: no se mueve (se registra para revisión).
    RETURN jsonb_build_object('recorded', false, 'reason', 'invoice_belongs_to_other_account');
  END IF;
  IF v_inserted THEN
    PERFORM public.prive_audit(v_user, 'paid_period_recorded', 'system',
      jsonb_build_object('invoice', _invoice_id, 'source', _source, 'start', _period_start, 'end', _period_end));
  END IF;
  RETURN jsonb_build_object('recorded', true, 'inserted', v_inserted, 'user_id', v_user,
                            'tenure_days', public.prive_tenure_days(v_user));
END $$;
REVOKE ALL ON FUNCTION public.prive_record_paid_period(uuid, text, text, text, timestamptz, timestamptz, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prive_record_paid_period(uuid, text, text, text, timestamptz, timestamptz, int, text, text) TO service_role;

-- Cambia el estado del periodo de una factura según la decisión de payments.ts.
-- _event: refund_full | refund_partial | dispute_opened | dispute_lost | dispute_won
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
  -- Bajó de 90 días (o ya no tiene derecho): el acceso se pausa en la siguiente llamada; además se
  -- cierran sus sesiones Privé ya.
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
