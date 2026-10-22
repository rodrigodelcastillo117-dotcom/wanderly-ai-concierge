-- Límites RECOMENDADOS por el análisis de costos (docs/iatos/IATOS_PROPUESTA_PLANES_Y_PRUEBA.md),
-- todavía detrás de interruptores: el dueño no los ha aprobado. Idempotente.
-- 1) is_pro: una fila 'trialing' sin current_period_end ya NO es PRO para siempre (una prueba sin
--    tarjeta mal creada nunca se vuelve permanente). active y comped se comportan igual que antes.
-- 2) plan_limits: plan 'trial' (prueba sin tarjeta), tope diario (daily_limit), límites "suaves"
--    (soft: al pasarse se muestran precios en caché en vez de bloquear) y periodos day/trial/active.
-- 3) reserve_quota aplica mes/una vez/prueba + tope diario a concierge y trip_analysis. Los demás
--    tipos (price_watches, tracked_flights, live_searches) solo se siembran y se exponen con
--    plan_limit(); aplicarlos queda para otro paso.

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
      AND (
        s.status = 'comped'
        OR (s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        OR (s.status = 'trialing' AND s.current_period_end IS NOT NULL AND s.current_period_end > now())
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_pro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pro(uuid) TO service_role;

-- plan_limits: nuevas columnas y valores permitidos.
ALTER TABLE public.plan_limits ADD COLUMN IF NOT EXISTS daily_limit int CHECK (daily_limit IS NULL OR daily_limit >= 0);
ALTER TABLE public.plan_limits ADD COLUMN IF NOT EXISTS soft boolean NOT NULL DEFAULT false;
ALTER TABLE public.plan_limits DROP CONSTRAINT IF EXISTS plan_limits_plan_check;
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_plan_check CHECK (plan IN ('free', 'pro', 'trial'));
ALTER TABLE public.plan_limits DROP CONSTRAINT IF EXISTS plan_limits_period_check;
-- month = por mes calendario (UTC) · once = de una sola vez · day = por día (UTC)
-- trial = durante toda la prueba · active = cuántos activos a la vez (alertas, vuelos seguidos)
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_period_check
  CHECK (period IN ('month', 'once', 'day', 'trial', 'active'));

ALTER TABLE public.quota_reservations DROP CONSTRAINT IF EXISTS quota_reservations_plan_check;
ALTER TABLE public.quota_reservations ADD CONSTRAINT quota_reservations_plan_check CHECK (plan IN ('free', 'pro', 'trial'));

-- El renglón de la propuesta anterior con otro nombre (price_alerts → price_watches), si no se editó.
DELETE FROM public.plan_limits WHERE kind = 'price_alerts' AND note LIKE 'PROPUESTO%';

-- Valores recomendados. Solo pisan renglones que siguen con la semilla automática (nota
-- PROPUESTO/RECOMENDADO): lo que el dueño ya editó a mano se respeta.
INSERT INTO public.plan_limits AS pl (plan, kind, period, limit_value, daily_limit, soft, note) VALUES
  ('free',  'concierge',       'month',  3,    NULL, false, 'RECOMENDADO: mensajes de Iato al mes'),
  ('free',  'trip_analysis',   'once',   1,    NULL, false, 'RECOMENDADO: análisis de cortesía, una sola vez'),
  ('free',  'price_watches',   'active', 0,    NULL, false, 'RECOMENDADO: alertas de precio activas (aún no se aplica)'),
  ('free',  'tracked_flights', 'active', 1,    NULL, false, 'RECOMENDADO: 1 vuelo seguido, solo el día del vuelo (aún no se aplica)'),
  ('free',  'live_searches',   'day',    5,    NULL, false, 'RECOMENDADO: búsquedas en vivo al día (aún no se aplica)'),
  ('pro',   'concierge',       'month',  100,  20,   false, 'RECOMENDADO: 100 al mes, máx. 20 al día; solo con pro_limits_enforced'),
  ('pro',   'trip_analysis',   'month',  10,   3,    false, 'RECOMENDADO: 10 al mes, máx. 3 al día; solo con pro_limits_enforced'),
  ('pro',   'price_watches',   'active', 5,    NULL, false, 'RECOMENDADO: alertas activas (aún no se aplica)'),
  ('pro',   'tracked_flights', 'active', 4,    NULL, false, 'RECOMENDADO: vuelos seguidos a la vez (aún no se aplica)'),
  ('pro',   'live_searches',   'month',  80,   NULL, true,  'RECOMENDADO: uso justo; al pasarse, precios en caché en vez de bloquear (aún no se aplica)'),
  ('trial', 'concierge',       'trial',  50,   NULL, false, 'RECOMENDADO: durante los 30 días de prueba sin tarjeta'),
  ('trial', 'trip_analysis',   'trial',  5,    NULL, false, 'RECOMENDADO: durante los 30 días de prueba sin tarjeta'),
  ('trial', 'price_watches',   'active', 2,    NULL, false, 'RECOMENDADO: durante la prueba (aún no se aplica)'),
  ('trial', 'tracked_flights', 'active', 2,    NULL, false, 'RECOMENDADO: durante la prueba (aún no se aplica)'),
  ('trial', 'live_searches',   'trial',  30,   NULL, false, 'RECOMENDADO: durante la prueba (aún no se aplica)')
ON CONFLICT (plan, kind) DO UPDATE
  SET period = EXCLUDED.period, limit_value = EXCLUDED.limit_value, daily_limit = EXCLUDED.daily_limit,
      soft = EXCLUDED.soft, note = EXCLUDED.note, updated_at = now()
  WHERE pl.note LIKE 'PROPUESTO%' OR pl.note LIKE 'RECOMENDADO%';

-- Plan efectivo: 'trial' = prueba sin tarjeta vigente (trialing sin suscripción de Stripe); una
-- prueba de Stripe con tarjeta es 'pro'.
CREATE OR REPLACE FUNCTION public.effective_plan(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT public.is_pro(_user_id) THEN 'free'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user_id
                  AND s.status = 'trialing' AND s.stripe_subscription_id IS NULL) THEN 'trial'
    ELSE 'pro' END;
$$;
REVOKE ALL ON FUNCTION public.effective_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_plan(uuid) TO service_role;

-- Regla vigente (cambia el tipo de retorno: se recrea).
--   free  → siempre se aplica (si falta su renglón: 3 / 1 de siempre, nunca ilimitado por error)
--   pro   → solo con app_flags.pro_limits_enforced
--   trial → siempre (la prueba solo existe si el dueño encendió trial_no_card_enabled)
DROP FUNCTION IF EXISTS public.quota_rule(uuid, text);
CREATE FUNCTION public.quota_rule(_user_id uuid, _kind text)
RETURNS TABLE (plan text, period text, limit_value int, daily_limit int, soft boolean, enforced boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  r public.plan_limits%ROWTYPE;
  v_found boolean;
BEGIN
  plan := public.effective_plan(_user_id);
  SELECT * INTO r FROM public.plan_limits pl WHERE pl.plan = quota_rule.plan AND pl.kind = _kind;
  v_found := FOUND;
  enforced := CASE plan WHEN 'pro' THEN public.app_flag('pro_limits_enforced') ELSE true END;
  soft := COALESCE(r.soft, false);
  IF plan = 'free' AND NOT v_found THEN
    period := CASE WHEN _kind = 'trip_analysis' THEN 'once' ELSE 'month' END;
    limit_value := public.free_quota_limit(_kind);
    daily_limit := NULL;
  ELSE
    period := COALESCE(r.period, 'month');
    limit_value := CASE WHEN enforced AND v_found THEN r.limit_value END;
    daily_limit := CASE WHEN enforced AND v_found THEN r.daily_limit END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.quota_rule(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quota_rule(uuid, text) TO service_role;

-- Para las funciones que aún no aplican límite (price-watch, track-flight, búsquedas en vivo): el
-- límite configurado para este usuario, para usarlo cuando el dueño lo apruebe.
CREATE OR REPLACE FUNCTION public.plan_limit(_user_id uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM public.quota_rule(_user_id, _kind);
  RETURN jsonb_build_object('plan', v.plan, 'kind', _kind, 'period', v.period, 'limit', v.limit_value,
                            'daily_limit', v.daily_limit, 'soft', v.soft, 'enforced', v.enforced);
END;
$$;
REVOKE ALL ON FUNCTION public.plan_limit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_limit(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.quota_used(_user_id uuid, _kind text, _plan text, _period text)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v int;
BEGIN
  IF _plan = 'free' AND _kind = 'trip_analysis' AND _period = 'once' THEN
    SELECT trips_analyzed_used INTO v FROM public.usage_limits WHERE user_id = _user_id;
    RETURN COALESCE(v, 0);
  ELSIF _plan = 'free' AND _kind = 'concierge' AND _period = 'month' THEN
    SELECT CASE WHEN concierge_period = to_char(now(), 'YYYY-MM') THEN concierge_messages_used ELSE 0 END
      INTO v FROM public.usage_limits WHERE user_id = _user_id;
    RETURN COALESCE(v, 0);
  END IF;
  -- 'trial' cuenta todo lo usado con el plan de prueba (hay una sola prueba por persona).
  SELECT count(*) INTO v FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND plan = _plan AND status = 'COMMITTED'
     AND CASE _period
           WHEN 'month' THEN committed_at >= date_trunc('month', now())
           WHEN 'day' THEN committed_at >= date_trunc('day', now())
           ELSE true END;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.quota_used(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quota_used(uuid, text, text, text) TO service_role;

-- reserve_quota: misma firma, respuestas y permisos; agrega plan de prueba y tope diario.
CREATE OR REPLACE FUNCTION public.reserve_quota(_user_id uuid, _kind text, _request_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_used int;
  v_live int;
  v_row public.quota_reservations%ROWTYPE;
  c_max_live_paid constant int := 3;
BEGIN
  IF public.free_quota_limit(_kind) IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;
  IF _user_id IS NULL OR _request_key IS NULL OR length(_request_key) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'reserve_quota: argumentos inválidos';
  END IF;

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

  IF v_rule.plan <> 'free' AND v_live >= c_max_live_paid THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_in_progress');
  END IF;

  -- Límite del periodo (mes, una vez o toda la prueba).
  IF v_rule.limit_value IS NOT NULL THEN
    v_used := public.quota_used(_user_id, _kind, v_rule.plan, v_rule.period);
    IF v_used >= v_rule.limit_value THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind,
        'limit', v_rule.limit_value, 'used', v_used, 'plan', v_rule.plan,
        'quota', _kind || CASE v_rule.period WHEN 'month' THEN '_monthly' WHEN 'trial' THEN '_trial' ELSE '_once' END,
        'renews_at', CASE WHEN v_rule.period = 'month' THEN date_trunc('month', now()) + interval '1 month' END,
        -- Un PRO que llega a su límite no recibe oferta de "mejorar"; la prueba sí puede contratar PRO.
        'upgrade_available', v_rule.plan <> 'pro');
    END IF;
    IF v_used + v_live >= v_rule.limit_value THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'in_progress');
    END IF;
  END IF;

  -- Tope diario (PRO con pro_limits_enforced).
  IF v_rule.daily_limit IS NOT NULL THEN
    v_used := public.quota_used(_user_id, _kind, v_rule.plan, 'day');
    IF v_used >= v_rule.daily_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind,
        'limit', v_rule.daily_limit, 'used', v_used, 'plan', v_rule.plan, 'quota', _kind || '_daily',
        'renews_at', date_trunc('day', now()) + interval '1 day',
        'upgrade_available', v_rule.plan <> 'pro');
    END IF;
    IF v_used + v_live >= v_rule.daily_limit THEN
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

  RETURN jsonb_build_object('allowed', true, 'reason', CASE WHEN v_rule.plan = 'free' THEN 'reserved' ELSE 'pro' END,
                            'reservation_id', v_row.id, 'plan', v_rule.plan);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, text) TO service_role;

-- consume_free_quota (compatibilidad): la prueba sin tarjeta, como PRO, no gasta el cupo gratuito.
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
  IF v_rule.plan <> 'free' THEN
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
    'is_pro', v_c.plan <> 'free',
    'plan', v_c.plan,
    'limits_enforced', v_c.limit_value IS NOT NULL OR v_t.limit_value IS NOT NULL,
    'concierge_used', v_c_used,
    'concierge_limit', v_c.limit_value,
    'concierge_remaining', CASE WHEN v_c.limit_value IS NULL THEN NULL ELSE GREATEST(0, v_c.limit_value - v_c_used) END,
    'concierge_daily_limit', v_c.daily_limit,
    'concierge_renews_at', CASE WHEN v_c.period = 'month' THEN date_trunc('month', now()) + interval '1 month' END,
    'trips_used', v_t_used,
    'trips_limit', v_t.limit_value,
    'trips_remaining', CASE WHEN v_t.limit_value IS NULL THEN NULL ELSE GREATEST(0, v_t.limit_value - v_t_used) END,
    'trips_daily_limit', v_t.daily_limit,
    'trips_period', v_t.period
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_access_state(uuid) TO authenticated, service_role;
