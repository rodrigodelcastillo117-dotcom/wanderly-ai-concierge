-- 1) Completar tabla subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS price_id text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'MXN';

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_idx ON public.subscriptions(stripe_subscription_id);

-- 2) Politicas: dejar una sola de lectura propia
DROP POLICY IF EXISTS "Users view own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- 3) is_pro
CREATE OR REPLACE FUNCTION public.is_pro(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status IN ('active', 'trialing', 'comped')
      AND (s.status = 'comped' OR s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

-- 4) Tabla de limites de uso gratuito
CREATE TABLE IF NOT EXISTS public.usage_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  concierge_messages_used integer NOT NULL DEFAULT 0,
  concierge_period text NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),
  trips_analyzed_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.usage_limits TO authenticated;
GRANT ALL ON public.usage_limits TO service_role;

ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_limits_select_own" ON public.usage_limits;
CREATE POLICY "usage_limits_select_own" ON public.usage_limits
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_usage_limits_updated ON public.usage_limits;
CREATE TRIGGER trg_usage_limits_updated
  BEFORE UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Cuotas gratuitas
CREATE OR REPLACE FUNCTION public.get_access_state(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro boolean := public.is_pro(_user_id);
  v_row public.usage_limits%ROWTYPE;
  v_period text := to_char(now(), 'YYYY-MM');
  v_msgs int := 0;
BEGIN
  SELECT * INTO v_row FROM public.usage_limits WHERE user_id = _user_id;
  IF FOUND AND v_row.concierge_period = v_period THEN
    v_msgs := v_row.concierge_messages_used;
  END IF;

  RETURN jsonb_build_object(
    'is_pro', v_pro,
    'concierge_used', v_msgs,
    'concierge_limit', 3,
    'concierge_remaining', GREATEST(0, 3 - v_msgs),
    'trips_used', COALESCE(v_row.trips_analyzed_used, 0),
    'trips_limit', 1,
    'trips_remaining', GREATEST(0, 1 - COALESCE(v_row.trips_analyzed_used, 0))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_free_quota(_user_id uuid, _kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text := to_char(now(), 'YYYY-MM');
  v_used int;
  v_limit int;
BEGIN
  IF public.is_pro(_user_id) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'pro', 'remaining', null);
  END IF;

  INSERT INTO public.usage_limits (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF _kind = 'concierge' THEN
    v_limit := 3;
    UPDATE public.usage_limits
       SET concierge_messages_used = CASE WHEN concierge_period = v_period THEN concierge_messages_used ELSE 0 END,
           concierge_period = v_period
     WHERE user_id = _user_id;

    SELECT concierge_messages_used INTO v_used FROM public.usage_limits WHERE user_id = _user_id;
    IF v_used >= v_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0);
    END IF;
    UPDATE public.usage_limits SET concierge_messages_used = concierge_messages_used + 1 WHERE user_id = _user_id;
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', v_limit - v_used - 1);

  ELSIF _kind = 'trip_analysis' THEN
    v_limit := 1;
    SELECT trips_analyzed_used INTO v_used FROM public.usage_limits WHERE user_id = _user_id;
    IF v_used >= v_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0);
    END IF;
    UPDATE public.usage_limits SET trips_analyzed_used = trips_analyzed_used + 1 WHERE user_id = _user_id;
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', v_limit - v_used - 1);
  END IF;

  RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_pro(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_access_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_free_quota(uuid, text) TO service_role;