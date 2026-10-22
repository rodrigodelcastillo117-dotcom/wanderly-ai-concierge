-- Control de costos (grupo cost). Idempotente.
-- 1) public.serp_cache: caché compartida entre usuarios de las respuestas de SerpApi (vuelos 6 h,
--    hoteles 12 h, Maps 7 días, estado de vuelo 10 min), de Pexels (7 días) y de la cotización en
--    vivo de viajes manuales (24 h). Solo la usa el servidor (service_role). Una respuesta vencida
--    nunca se sirve como "en vivo": el servidor manda fetched_at y el estado del dato.
-- 2) public.ai_usage_log: una fila por llamada a un proveedor pagado (tokens, búsquedas y costo
--    estimado). Inserta solo el servidor; leen solo los administradores.
-- 3) public.live_search_usage + live_search_take/live_search_refund: cuenta cada búsqueda REAL de
--    SerpApi por usuario (los aciertos de caché no cuentan) y aplica plan_limits.live_searches:
--    FREE tope duro diario, TRIAL tope duro de la prueba, PRO "uso justo" suave (solo con
--    pro_limits_enforced): al pasarse se sirven precios guardados, nunca se bloquea.
-- 4) admin_cost_metrics(): costo de los últimos N días por plan y por función (solo admins).
-- 5) serp_burn_rate(): búsquedas de SerpApi por día (promedio de 7 días) para el chequeo de salud.

-- ───────────────────────────────────────────── 1) serp_cache
CREATE TABLE IF NOT EXISTS public.serp_cache (
  key_hash    text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  engine      text NOT NULL CHECK (length(engine) BETWEEN 1 AND 40),
  response    jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 1 AND 2592000),
  hits        integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz
);
CREATE INDEX IF NOT EXISTS serp_cache_fetched_idx ON public.serp_cache (fetched_at);
ALTER TABLE public.serp_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.serp_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.serp_cache TO service_role;

-- Lee una entrada (vigente o vencida: quien llama decide con fetched_at + ttl_seconds) y cuenta un
-- acierto solo si sigue vigente.
CREATE OR REPLACE FUNCTION public.serp_cache_get(_key_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.serp_cache%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.serp_cache WHERE key_hash = _key_hash;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF r.fetched_at + make_interval(secs => r.ttl_seconds) > now() THEN
    UPDATE public.serp_cache SET hits = hits + 1, last_hit_at = now() WHERE key_hash = _key_hash;
  END IF;
  RETURN jsonb_build_object('response', r.response, 'fetched_at', r.fetched_at,
                            'ttl_seconds', r.ttl_seconds, 'engine', r.engine);
END;
$$;
REVOKE ALL ON FUNCTION public.serp_cache_get(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serp_cache_get(text) TO service_role;

-- Guarda una respuesta recién consultada. De vez en cuando borra lo que tiene más de 30 días
-- (se conserva un tiempo lo vencido: es el "último precio conocido" del uso justo de PRO).
CREATE OR REPLACE FUNCTION public.serp_cache_put(_key_hash text, _engine text, _response jsonb, _ttl_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.serp_cache AS c (key_hash, engine, response, fetched_at, ttl_seconds)
  VALUES (_key_hash, _engine, _response, now(), _ttl_seconds)
  ON CONFLICT (key_hash) DO UPDATE
    SET engine = EXCLUDED.engine, response = EXCLUDED.response, fetched_at = now(), ttl_seconds = EXCLUDED.ttl_seconds;
  IF random() < 0.01 THEN
    DELETE FROM public.serp_cache WHERE fetched_at < now() - interval '30 days';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.serp_cache_put(text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serp_cache_put(text, text, jsonb, integer) TO service_role;

-- ───────────────────────────────────────────── 2) ai_usage_log
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Al borrar la cuenta se conserva el costo, sin el usuario.
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  function          text NOT NULL CHECK (length(function) BETWEEN 1 AND 60),
  provider          text NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  model             text CHECK (model IS NULL OR length(model) <= 80),
  input_tokens      integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens     integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  searches          integer NOT NULL DEFAULT 0 CHECK (searches >= 0),
  cost_estimate_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_estimate_usd >= 0),
  -- Plan del usuario en el momento de la llamada (free/trial/pro; 'system' para tareas programadas).
  plan              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx ON public.ai_usage_log (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_provider_created_idx ON public.ai_usage_log (provider, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_created_idx ON public.ai_usage_log (user_id, created_at);

-- El plan y la fecha los pone la base: quien inserta no puede falsearlos.
CREATE OR REPLACE FUNCTION public.ai_usage_log_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  NEW.plan := CASE WHEN NEW.user_id IS NULL THEN 'system' ELSE public.effective_plan(NEW.user_id) END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_log_before_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ai_usage_log_before_insert ON public.ai_usage_log;
CREATE TRIGGER ai_usage_log_before_insert BEFORE INSERT ON public.ai_usage_log
  FOR EACH ROW EXECUTE FUNCTION public.ai_usage_log_before_insert();

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ai_usage_log TO service_role;
GRANT SELECT ON public.ai_usage_log TO authenticated;
DROP POLICY IF EXISTS ai_usage_log_admin_read ON public.ai_usage_log;
CREATE POLICY ai_usage_log_admin_read ON public.ai_usage_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

-- ───────────────────────────────────────────── 3) búsquedas en vivo por usuario
CREATE TABLE IF NOT EXISTS public.live_search_usage (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  plan       text NOT NULL CHECK (plan IN ('free', 'trial', 'pro')),
  searches   integer NOT NULL DEFAULT 0 CHECK (searches >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, plan)
);
ALTER TABLE public.live_search_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_search_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.live_search_usage TO service_role;

-- Búsquedas usadas en el periodo vigente del plan (día y mes en UTC; 'trial' = toda la prueba).
CREATE OR REPLACE FUNCTION public.live_search_used(_user_id uuid, _plan text, _period text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(searches), 0)::int FROM public.live_search_usage
   WHERE user_id = _user_id AND plan = _plan
     AND CASE _period
           WHEN 'day' THEN day = (now() AT TIME ZONE 'UTC')::date
           WHEN 'month' THEN day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date
           ELSE true END;
$$;
REVOKE ALL ON FUNCTION public.live_search_used(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_search_used(uuid, text, text) TO service_role;

-- Aparta _units búsquedas reales ANTES de llamar a SerpApi. Si el plan no alcanza:
--   tope duro (FREE / TRIAL)  → allowed=false, reason='quota_exceeded' (aviso FREE_LIMIT_REACHED)
--   uso justo (PRO, soft)     → allowed=false, reason='fair_use', soft=true (precios guardados)
-- PRO sin pro_limits_enforced: siempre permite, pero igual se cuenta (para medir).
CREATE OR REPLACE FUNCTION public.live_search_take(_user_id uuid, _units integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule record;
  v_plan text;
  v_period text;
  v_limit int;
  v_daily int;
  v_soft boolean;
  v_used int;
  v_check_period text;
  v_check_limit int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF _user_id IS NULL OR _units IS NULL OR _units NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'live_search_take: argumentos inválidos';
  END IF;
  -- Un candado por usuario: dos búsquedas simultáneas no pueden pasarse del tope.
  PERFORM pg_advisory_xact_lock(hashtextextended('live_search:' || _user_id::text, 0));

  SELECT * INTO v_rule FROM public.quota_rule(_user_id, 'live_searches');
  v_plan := v_rule.plan; v_period := v_rule.period; v_limit := v_rule.limit_value;
  v_daily := v_rule.daily_limit; v_soft := COALESCE(v_rule.soft, false);
  -- Si alguien borra el renglón de FREE por error, nunca queda ilimitado: 5 al día.
  IF v_plan = 'free' AND NOT EXISTS (SELECT 1 FROM public.plan_limits WHERE plan = 'free' AND kind = 'live_searches') THEN
    v_period := 'day'; v_limit := 5; v_daily := NULL; v_soft := false;
  END IF;

  FOR i IN 1..2 LOOP
    v_check_period := CASE i WHEN 1 THEN v_period ELSE 'day' END;
    v_check_limit := CASE i WHEN 1 THEN v_limit ELSE v_daily END;
    CONTINUE WHEN v_check_limit IS NULL;
    v_used := public.live_search_used(_user_id, v_plan, v_check_period);
    IF v_used + _units > v_check_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', CASE WHEN v_soft THEN 'fair_use' ELSE 'quota_exceeded' END,
        'soft', v_soft, 'plan', v_plan, 'kind', 'live_searches',
        'quota', 'live_searches_' || CASE v_check_period WHEN 'day' THEN 'daily' WHEN 'month' THEN 'monthly'
                                                         WHEN 'trial' THEN 'trial' ELSE 'once' END,
        'limit', v_check_limit, 'used', v_used,
        'renews_at', CASE v_check_period
                       WHEN 'day' THEN date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day'
                       WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' END,
        'upgrade_available', v_plan <> 'pro');
    END IF;
  END LOOP;

  INSERT INTO public.live_search_usage AS u (user_id, day, plan, searches)
  VALUES (_user_id, v_today, v_plan, _units)
  ON CONFLICT (user_id, day, plan) DO UPDATE SET searches = u.searches + EXCLUDED.searches, updated_at = now();

  v_used := CASE WHEN v_limit IS NULL THEN NULL ELSE public.live_search_used(_user_id, v_plan, v_period) END;
  RETURN jsonb_build_object('allowed', true, 'reason', 'counted', 'soft', v_soft, 'plan', v_plan,
                            'limit', v_limit, 'used', v_used,
                            'remaining', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(0, v_limit - v_used) END);
END;
$$;
REVOKE ALL ON FUNCTION public.live_search_take(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_search_take(uuid, integer) TO service_role;

-- Devuelve búsquedas apartadas que SerpApi no cobró (error del proveedor, sin respuesta).
CREATE OR REPLACE FUNCTION public.live_search_refund(_user_id uuid, _plan text, _units integer DEFAULT 1)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.live_search_usage
     SET searches = GREATEST(0, searches - GREATEST(0, LEAST(COALESCE(_units, 0), 10))), updated_at = now()
   WHERE user_id = _user_id AND plan = _plan AND day = (now() AT TIME ZONE 'UTC')::date;
$$;
REVOKE ALL ON FUNCTION public.live_search_refund(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_search_refund(uuid, text, integer) TO service_role;

-- Las notas de plan_limits decían "(aún no se aplica)" para estos tipos; ahora sí se aplican.
-- Solo renglones que siguen con la semilla automática (lo editado por el dueño no se toca).
UPDATE public.plan_limits
   SET note = replace(note, '(aún no se aplica)', '(se aplica en el servidor)'), updated_at = now()
 WHERE kind IN ('price_watches', 'tracked_flights', 'live_searches')
   AND note LIKE 'RECOMENDADO%' AND note LIKE '%(aún no se aplica)%';

-- ───────────────────────────────────────────── 4) costo para administradores
CREATE OR REPLACE FUNCTION public.admin_cost_metrics(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 30), 1), 90);
  v_from timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 90));
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'total', (SELECT jsonb_build_object('cost_usd', round(COALESCE(sum(cost_estimate_usd), 0), 4),
                                        'calls', count(*), 'searches', COALESCE(sum(searches), 0),
                                        'users', count(DISTINCT user_id))
                FROM public.ai_usage_log WHERE created_at >= v_from),
    'by_plan', (SELECT COALESCE(jsonb_agg(x ORDER BY x.cost_usd DESC, x.plan), '[]'::jsonb) FROM (
                  SELECT COALESCE(plan, 'system') AS plan, round(sum(cost_estimate_usd), 4) AS cost_usd,
                         count(*) AS calls, sum(searches) AS searches, count(DISTINCT user_id) AS users
                    FROM public.ai_usage_log WHERE created_at >= v_from GROUP BY 1) x),
    'by_function', (SELECT COALESCE(jsonb_agg(x ORDER BY x.cost_usd DESC, x.function), '[]'::jsonb) FROM (
                  SELECT function, provider, round(sum(cost_estimate_usd), 4) AS cost_usd, count(*) AS calls,
                         sum(searches) AS searches, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
                    FROM public.ai_usage_log WHERE created_at >= v_from GROUP BY 1, 2) x),
    'cache', (SELECT jsonb_build_object('entries', count(*), 'hits', COALESCE(sum(hits), 0)) FROM public.serp_cache)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_cost_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cost_metrics(integer) TO authenticated;

-- ───────────────────────────────────────────── 5) ritmo de gasto de SerpApi
-- Promedio diario de búsquedas reales en los últimos _days días (o desde el primer registro, si hay
-- menos historia). avg_per_day NULL = sin datos: el chequeo usa el umbral fijo.
CREATE OR REPLACE FUNCTION public.serp_burn_rate(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 7), 1), 90);
  v_sum bigint;
  v_first timestamptz;
  v_span numeric;
BEGIN
  SELECT COALESCE(sum(searches), 0), min(created_at) INTO v_sum, v_first
    FROM public.ai_usage_log
   WHERE provider = 'serpapi' AND created_at >= now() - make_interval(days => v_days);
  IF v_first IS NULL THEN
    RETURN jsonb_build_object('searches', 0, 'days', 0, 'avg_per_day', NULL);
  END IF;
  -- Al menos un día para no inflar el promedio con pocas horas de historia.
  v_span := LEAST(v_days::numeric, GREATEST(1, extract(epoch FROM now() - v_first) / 86400.0));
  RETURN jsonb_build_object('searches', v_sum, 'days', round(v_span, 2), 'avg_per_day', round(v_sum / v_span, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.serp_burn_rate(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serp_burn_rate(integer) TO service_role;
