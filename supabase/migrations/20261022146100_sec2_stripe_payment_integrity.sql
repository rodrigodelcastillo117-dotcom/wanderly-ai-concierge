-- Reembolsos y disputas con integridad económica (decisión del dueño, ronda sec2-b). Idempotente.
--
-- Política (la aplica stripe-webhook/handler.ts con el estado VIVO de Stripe):
--   * reembolso total del pago vigente → se revoca el acceso que pagó ese cargo, salvo otro derecho
--     válido (cortesía, otra suscripción viva, prueba vigente);
--   * reembolso parcial → se conserva el acceso y se registra para revisión;
--   * disputa abierta → se registra y se avisa a los administradores; no se cancela;
--   * disputa perdida → igual que un reembolso total;
--   * disputa ganada → se vuelve a leer la suscripción en Stripe y se escribe su estado real.
-- Cada evento queda en stripe_payment_events (idempotencia por event_id y trazabilidad: decisión
-- y estado antes/después, sin datos personales).

-- 1) Trazabilidad. account_id (no user_id) a propósito: purge_account_data borra toda tabla con
--    columna user_id, y este registro financiero debe sobrevivir al borrado de la cuenta.
ALTER TABLE public.stripe_payment_events ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.stripe_payment_events ADD COLUMN IF NOT EXISTS dispute_id text;
ALTER TABLE public.stripe_payment_events ADD COLUMN IF NOT EXISTS before_state jsonb;
ALTER TABLE public.stripe_payment_events ADD COLUMN IF NOT EXISTS after_state jsonb;
ALTER TABLE public.stripe_payment_events ADD COLUMN IF NOT EXISTS alert_status text;
COMMENT ON COLUMN public.stripe_payment_events.action IS
  'Decisión tomada por stripe-webhook (revoked, kept_other_entitlement, partial_kept_for_review, dispute_opened_alerted, …)';
CREATE INDEX IF NOT EXISTS stripe_payment_events_charge_idx ON public.stripe_payment_events (charge_id);

-- 2) Foto del acceso de una cuenta (para before/after). Solo servidor.
CREATE OR REPLACE FUNCTION public.access_snapshot(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN _user_id IS NULL THEN NULL ELSE jsonb_build_object(
    'is_pro', public.is_pro(_user_id),
    'status', s.status,
    'stripe_subscription_id', s.stripe_subscription_id,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end
  ) END
  FROM (SELECT 1) one LEFT JOIN public.subscriptions s ON s.user_id = _user_id;
$$;
REVOKE ALL ON FUNCTION public.access_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_snapshot(uuid) TO service_role;

-- 3) Revocar el acceso pagado por una suscripción concreta (reembolso total o disputa perdida).
--    - Solo toca la fila cuyo stripe_subscription_id es ESA suscripción: si la cuenta hoy vive de
--      otra suscripción o de una prueba, no se toca ('other_entitlement').
--    - Nunca toca una cortesía ('comped'); si la persona tiene cortesía autorizada, queda comped.
--    - Nunca crea filas ni da PRO. Sube stripe_event_created para que un evento viejo que llegue
--      tarde (p. ej. un invoice.paid anterior al reembolso) se ignore por 'stale_event'.
CREATE OR REPLACE FUNCTION public.revoke_paid_access(
  _subscription_id text,
  _customer_id text,
  _event_created timestamptz,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.subscriptions%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_reason text := 'revoked';
BEGIN
  IF _subscription_id IS NULL THEN
    RAISE EXCEPTION 'revoke_paid_access: falta subscription_id';
  END IF;

  SELECT * INTO v_row FROM public.subscriptions WHERE stripe_subscription_id = _subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    IF _customer_id IS NOT NULL THEN
      SELECT * INTO v_row FROM public.subscriptions WHERE stripe_customer_id = _customer_id
       ORDER BY updated_at DESC LIMIT 1;
      IF FOUND THEN
        v_before := public.access_snapshot(v_row.user_id);
        RETURN jsonb_build_object('applied', false, 'reason', 'other_entitlement', 'user_id', v_row.user_id,
                                  'before', v_before, 'after', v_before);
      END IF;
    END IF;
    RETURN jsonb_build_object('applied', false, 'reason', 'no_row');
  END IF;

  v_before := public.access_snapshot(v_row.user_id);
  IF v_row.status = 'comped' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'comped', 'user_id', v_row.user_id,
                              'before', v_before, 'after', v_before);
  END IF;

  IF public.has_comp_grant(v_row.user_id) THEN
    UPDATE public.subscriptions
       SET status = 'comped', current_period_end = NULL, cancel_at_period_end = false,
           stripe_event_created = GREATEST(coalesce(stripe_event_created, _event_created), _event_created),
           updated_at = now()
     WHERE user_id = v_row.user_id;
    v_reason := 'kept_comped_grant';
  ELSE
    UPDATE public.subscriptions
       SET status = 'canceled', current_period_end = LEAST(coalesce(current_period_end, now()), now()),
           cancel_at_period_end = false,
           stripe_event_created = GREATEST(coalesce(stripe_event_created, _event_created), _event_created),
           updated_at = now()
     WHERE user_id = v_row.user_id;
  END IF;
  v_after := public.access_snapshot(v_row.user_id);
  RETURN jsonb_build_object('applied', true, 'reason', v_reason, 'detail', _reason, 'user_id', v_row.user_id,
                            'before', v_before, 'after', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_paid_access(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_paid_access(text, text, timestamptz, text) TO service_role;

-- 4) Aviso a administradores (campana) con llave única por evento: un reintento no duplica.
CREATE OR REPLACE FUNCTION public.notify_admins(_dedup_key text, _title text, _body text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_n int := 0;
BEGIN
  FOR a IN SELECT user_id FROM public.admins LOOP
    IF public.notify_once(a.user_id, 'payment_alert', _title, _body, NULL, _dedup_key) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admins(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins(text, text, text) TO service_role;
