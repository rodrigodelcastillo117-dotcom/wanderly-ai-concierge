-- Límites por plan configurables en UN solo lugar + interruptores (decisión del dueño).
-- Los valores sembrados son PROPUESTOS, no finales: un análisis de costos dirá los definitivos y
-- se cambian con un UPDATE a public.plan_limits, sin desplegar código.
-- Comportamiento por omisión = el de producción hoy: FREE con límites (3 mensajes al mes, 1 análisis
-- de una sola vez) y PRO sin límites. Los límites de PRO solo se aplican si el dueño enciende
-- app_flags.pro_limits_enforced. Idempotente: re-correrla no pisa valores ya editados.

CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan text NOT NULL CHECK (plan IN ('free', 'pro')),
  kind text NOT NULL,
  period text NOT NULL CHECK (period IN ('month', 'once')),
  limit_value int CHECK (limit_value IS NULL OR limit_value >= 0),  -- NULL = ilimitado
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, kind)
);
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.plan_limits TO service_role;

INSERT INTO public.plan_limits (plan, kind, period, limit_value, note) VALUES
  ('free', 'concierge',     'month', 3,   'PROPUESTO: mensajes de Iato al mes'),
  ('free', 'trip_analysis', 'once',  1,   'PROPUESTO: análisis de cortesía, una sola vez'),
  ('pro',  'concierge',     'month', 100, 'PROPUESTO: solo aplica con pro_limits_enforced'),
  ('pro',  'trip_analysis', 'month', 10,  'PROPUESTO: análisis completos (uno o varios destinos); solo con pro_limits_enforced'),
  ('pro',  'price_alerts',  'once',  5,   'PROPUESTO: alertas de precio activas a la vez; price-watch aún no lo lee')
ON CONFLICT (plan, kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_flags TO service_role;

INSERT INTO public.app_flags (key, value, note) VALUES
  ('pro_limits_enforced', 'false'::jsonb, 'Aplicar los límites de PRO de plan_limits (requiere aprobación del dueño)'),
  ('trial_no_card_enabled', 'false'::jsonb, 'DEC-02: 30 días de PRO sin tarjeta al confirmar el correo')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_flag(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value = 'true'::jsonb FROM public.app_flags WHERE key = _key), false);
$$;
REVOKE ALL ON FUNCTION public.app_flag(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_flag(text) TO service_role;

-- Regla vigente para un usuario: plan, periodo y límite (NULL = ilimitado).
-- Si falta la fila del plan gratuito se usan los valores de siempre (3 / 1): borrar una fila por
-- error nunca deja el plan gratuito ilimitado. Una fila con limit_value NULL sí lo hace, a propósito.
CREATE OR REPLACE FUNCTION public.quota_rule(_user_id uuid, _kind text)
RETURNS TABLE (plan text, period text, limit_value int, enforced boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_pro boolean := public.is_pro(_user_id);
  r public.plan_limits%ROWTYPE;
BEGIN
  plan := CASE WHEN v_pro THEN 'pro' ELSE 'free' END;
  SELECT * INTO r FROM public.plan_limits pl WHERE pl.plan = quota_rule.plan AND pl.kind = _kind;
  IF v_pro THEN
    enforced := public.app_flag('pro_limits_enforced');
    period := COALESCE(r.period, 'month');
    limit_value := CASE WHEN enforced AND FOUND THEN r.limit_value END;
  ELSE
    enforced := true;
    IF FOUND THEN
      period := r.period; limit_value := r.limit_value;
    ELSE
      period := CASE WHEN _kind = 'trip_analysis' THEN 'once' ELSE 'month' END;
      limit_value := public.free_quota_limit(_kind);
    END IF;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.quota_rule(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quota_rule(uuid, text) TO service_role;

-- Plan con el que se apartó cada reserva: el uso de PRO se cuenta desde aquí (por mes) y nunca toca
-- los contadores gratuitos de usage_limits.
ALTER TABLE public.quota_reservations ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'pro'));
UPDATE public.quota_reservations SET plan = 'pro' WHERE NOT counted AND plan = 'free';
CREATE INDEX IF NOT EXISTS quota_reservations_committed_idx
  ON public.quota_reservations (user_id, kind, plan, committed_at) WHERE status = 'COMMITTED';

-- Uso confirmado del periodo vigente según el plan.
CREATE OR REPLACE FUNCTION public.quota_used(_user_id uuid, _kind text, _plan text, _period text)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v int;
BEGIN
  -- Plan gratuito con los periodos de siempre: contadores de usage_limits (incluyen el uso anterior
  -- a las reservas).
  IF _plan = 'free' AND _kind = 'trip_analysis' AND _period = 'once' THEN
    SELECT trips_analyzed_used INTO v FROM public.usage_limits WHERE user_id = _user_id;
    RETURN COALESCE(v, 0);
  ELSIF _plan = 'free' AND _kind = 'concierge' AND _period = 'month' THEN
    SELECT CASE WHEN concierge_period = to_char(now(), 'YYYY-MM') THEN concierge_messages_used ELSE 0 END
      INTO v FROM public.usage_limits WHERE user_id = _user_id;
    RETURN COALESCE(v, 0);
  END IF;
  SELECT count(*) INTO v FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND plan = _plan AND status = 'COMMITTED'
     AND (_period = 'once' OR committed_at >= date_trunc('month', now()));
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.quota_used(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quota_used(uuid, text, text, text) TO service_role;

-- reserve_quota: misma firma, respuestas y permisos; ahora lee el límite de plan_limits.
CREATE OR REPLACE FUNCTION public.reserve_quota(_user_id uuid, _kind text, _request_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_renews timestamptz := date_trunc('month', now()) + interval '1 month';
  v_used int;
  v_live int;
  v_row public.quota_reservations%ROWTYPE;
  v_quota text;
  c_max_live_pro constant int := 3;
BEGIN
  IF public.free_quota_limit(_kind) IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;
  IF _user_id IS NULL OR _request_key IS NULL OR length(_request_key) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'reserve_quota: argumentos inválidos';
  END IF;

  -- Candado por usuario (mismo orden que commit_quota).
  INSERT INTO public.usage_limits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.usage_limits WHERE user_id = _user_id FOR UPDATE;

  UPDATE public.quota_reservations SET status = 'EXPIRED', updated_at = now()
   WHERE user_id = _user_id AND kind = _kind AND status = 'RESERVED' AND expires_at <= now();

  SELECT * INTO v_row FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND request_key = _request_key FOR UPDATE;
  IF FOUND AND v_row.status = 'COMMITTED' THEN
    IF left(_request_key, 2) = 'c:' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'replay', 'reservation_id', v_row.id,
                                'trip_id', v_row.trip_id, 'result', v_row.result);
    END IF;
    UPDATE public.quota_reservations SET request_key = left(request_key, 250) || '#' || id::text, updated_at = now()
     WHERE id = v_row.id;
    v_row := NULL;
  ELSIF FOUND AND v_row.status = 'RESERVED' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'in_progress', 'reservation_id', v_row.id);
  END IF;

  SELECT * INTO v_rule FROM public.quota_rule(_user_id, _kind);
  SELECT count(*) INTO v_live FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND status = 'RESERVED' AND plan = v_rule.plan;

  IF v_rule.plan = 'pro' AND v_live >= c_max_live_pro THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_in_progress');
  END IF;

  IF v_rule.limit_value IS NOT NULL THEN
    v_used := public.quota_used(_user_id, _kind, v_rule.plan, v_rule.period);
    v_quota := _kind || CASE WHEN v_rule.period = 'month' THEN '_monthly' ELSE '_once' END;
    IF v_used >= v_rule.limit_value THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind,
                                'limit', v_rule.limit_value, 'used', v_used,
                                'renews_at', CASE WHEN v_rule.period = 'month' THEN v_renews END,
                                'quota', v_quota, 'plan', v_rule.plan,
                                -- Un PRO que llega a su límite no recibe oferta de "mejorar".
                                'upgrade_available', v_rule.plan = 'free');
    END IF;
    IF v_used + v_live >= v_rule.limit_value THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'in_progress');
    END IF;
  END IF;

  IF v_row.id IS NOT NULL THEN
    UPDATE public.quota_reservations
       SET status = 'RESERVED', plan = v_rule.plan, counted = (v_rule.plan = 'free'), release_reason = NULL,
           trip_id = NULL, result = NULL, attempts = attempts + 1,
           expires_at = now() + interval '10 minutes', updated_at = now()
     WHERE id = v_row.id;
  ELSE
    INSERT INTO public.quota_reservations (user_id, kind, request_key, counted, plan)
    VALUES (_user_id, _kind, _request_key, v_rule.plan = 'free', v_rule.plan)
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', CASE WHEN v_rule.plan = 'pro' THEN 'pro' ELSE 'reserved' END,
                            'reservation_id', v_row.id, 'plan', v_rule.plan);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, text) TO service_role;

-- consume_free_quota (ya no la usan las funciones; se conserva por compatibilidad): límite gratuito
-- desde plan_limits. Misma firma y permisos.
CREATE OR REPLACE FUNCTION public.consume_free_quota(_user_id uuid, _kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text := to_char(now(), 'YYYY-MM');
  v_renews timestamptz := date_trunc('month', now()) + interval '1 month';
  v_used int;
  v_rule record;
BEGIN
  IF public.free_quota_limit(_kind) IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;
  SELECT * INTO v_rule FROM public.quota_rule(_user_id, _kind);
  IF v_rule.plan = 'pro' THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'pro', 'remaining', null);
  END IF;
  IF v_rule.limit_value IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', null);
  END IF;

  INSERT INTO public.usage_limits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  IF _kind = 'concierge' THEN
    UPDATE public.usage_limits
       SET concierge_messages_used =
             CASE WHEN concierge_period = v_period THEN concierge_messages_used ELSE 0 END + 1,
           concierge_period = v_period
     WHERE user_id = _user_id
       AND (concierge_period <> v_period OR concierge_messages_used < v_rule.limit_value)
    RETURNING concierge_messages_used INTO v_used;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0,
                                'limit', v_rule.limit_value, 'used', v_rule.limit_value, 'renews_at', v_renews,
                                'quota', 'concierge_monthly', 'upgrade_available', true);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', GREATEST(0, v_rule.limit_value - v_used),
                              'limit', v_rule.limit_value, 'used', v_used, 'renews_at', v_renews);
  END IF;

  PERFORM 1 FROM public.usage_limits WHERE user_id = _user_id FOR UPDATE;
  UPDATE public.usage_limits
     SET trips_analyzed_used = trips_analyzed_used + 1
   WHERE user_id = _user_id
     AND trips_analyzed_used < v_rule.limit_value
     AND NOT EXISTS (
       SELECT 1 FROM public.quota_reservations r
        WHERE r.user_id = _user_id AND r.kind = 'trip_analysis' AND r.plan = 'free'
          AND r.status = 'RESERVED' AND r.expires_at > now())
  RETURNING trips_analyzed_used INTO v_used;
  IF NOT FOUND THEN
    SELECT trips_analyzed_used INTO v_used FROM public.usage_limits WHERE user_id = _user_id;
    RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0,
                              'limit', v_rule.limit_value, 'used', GREATEST(v_used, v_rule.limit_value), 'renews_at', null,
                              'quota', 'trip_analysis_once', 'upgrade_available', true);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', GREATEST(0, v_rule.limit_value - v_used),
                            'limit', v_rule.limit_value, 'used', v_used, 'renews_at', null);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_free_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_free_quota(uuid, text) TO service_role;

-- get_access_state: misma firma, permisos y llaves de siempre (más plan, límites aplicados y fecha de
-- renovación); los límites salen de plan_limits. *_limit / *_remaining en NULL = ilimitado.
CREATE OR REPLACE FUNCTION public.get_access_state(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), _user_id);
  v_c record;
  v_t record;
  v_c_used int;
  v_t_used int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT * INTO v_c FROM public.quota_rule(v_uid, 'concierge');
  SELECT * INTO v_t FROM public.quota_rule(v_uid, 'trip_analysis');
  v_c_used := public.quota_used(v_uid, 'concierge', v_c.plan, v_c.period);
  v_t_used := public.quota_used(v_uid, 'trip_analysis', v_t.plan, v_t.period);
  RETURN jsonb_build_object(
    'is_pro', v_c.plan = 'pro',
    'plan', v_c.plan,
    'limits_enforced', v_c.limit_value IS NOT NULL OR v_t.limit_value IS NOT NULL,
    'concierge_used', v_c_used,
    'concierge_limit', v_c.limit_value,
    'concierge_remaining', CASE WHEN v_c.limit_value IS NULL THEN NULL ELSE GREATEST(0, v_c.limit_value - v_c_used) END,
    'concierge_renews_at', CASE WHEN v_c.period = 'month' THEN date_trunc('month', now()) + interval '1 month' END,
    'trips_used', v_t_used,
    'trips_limit', v_t.limit_value,
    'trips_remaining', CASE WHEN v_t.limit_value IS NULL THEN NULL ELSE GREATEST(0, v_t.limit_value - v_t_used) END,
    'trips_period', v_t.period
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_access_state(uuid) TO authenticated, service_role;
