-- Cuota gratuita con reserva → confirmación → liberación (IATOS-P1-FREE-01 / FREE-02).
-- Antes, el análisis gratuito se descontaba al empezar: si la IA, un proveedor o el guardado
-- fallaban, la persona perdía su única oportunidad. Ahora:
--   reserve_quota  aparta el cupo (atómico, idempotente por request_key);
--   commit_quota   lo confirma solo cuando el viaje quedó guardado;
--   release_quota  lo devuelve si algo falló.
-- Una reserva sin confirmar caduca a los 10 minutos (si la función se cae, el cupo regresa solo).
-- usage_limits.trips_analyzed_used sigue siendo el contador de análisis CONFIRMADOS (incluye los
-- de antes de esta migración), así que get_access_state no cambia.
-- Idempotente: se puede correr más de una vez. Solo service_role ejecuta las funciones.

CREATE TABLE IF NOT EXISTS public.quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('trip_analysis', 'concierge')),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  -- false para PRO: su uso no gasta el cupo gratuito (si deja de ser PRO, conserva su análisis gratis).
  counted boolean NOT NULL DEFAULT true,
  trip_id uuid,
  -- Resultado guardado cuando el servidor no crea el viaje (logistics-plan): un reintento lo recibe sin pagar otra vez.
  result jsonb,
  release_reason text,
  attempts int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  committed_at timestamptz,
  UNIQUE (user_id, kind, request_key)
);
CREATE INDEX IF NOT EXISTS quota_reservations_live_idx
  ON public.quota_reservations (user_id, kind) WHERE status = 'RESERVED';
ALTER TABLE public.quota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quota_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.quota_reservations TO service_role;

-- Los contadores solo los escribe el servidor. RLS ya impedía escribir (solo hay política de lectura);
-- quitamos además el permiso de escritura que Supabase da por defecto, como segunda barrera.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.usage_limits FROM anon, authenticated;

-- Límites en un solo lugar (los mismos que get_access_state).
CREATE OR REPLACE FUNCTION public.free_quota_limit(_kind text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _kind WHEN 'concierge' THEN 3 WHEN 'trip_analysis' THEN 1 END;
$$;
REVOKE ALL ON FUNCTION public.free_quota_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_quota_limit(text) TO service_role;

-- 1) consume_free_quota: misma firma y permisos; ahora devuelve también limit, used y renews_at
--    (para que el servidor arme el aviso FREE_LIMIT_REACHED con datos reales) y, para trip_analysis,
--    respeta las reservas en curso. Las funciones de análisis ya usan reserve_quota.
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
  v_limit int := public.free_quota_limit(_kind);
BEGIN
  IF public.is_pro(_user_id) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'pro', 'remaining', null);
  END IF;
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;

  INSERT INTO public.usage_limits (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF _kind = 'concierge' THEN
    UPDATE public.usage_limits
       SET concierge_messages_used =
             CASE WHEN concierge_period = v_period THEN concierge_messages_used ELSE 0 END + 1,
           concierge_period = v_period
     WHERE user_id = _user_id
       AND (concierge_period <> v_period OR concierge_messages_used < v_limit)
    RETURNING concierge_messages_used INTO v_used;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0,
                                'limit', v_limit, 'used', v_limit, 'renews_at', v_renews,
                                'quota', 'concierge_monthly', 'upgrade_available', true);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', GREATEST(0, v_limit - v_used),
                              'limit', v_limit, 'used', v_used, 'renews_at', v_renews);
  END IF;

  -- trip_analysis (de una sola vez): el candado de la fila serializa contra reserve_quota.
  PERFORM 1 FROM public.usage_limits WHERE user_id = _user_id FOR UPDATE;
  UPDATE public.usage_limits
     SET trips_analyzed_used = trips_analyzed_used + 1
   WHERE user_id = _user_id
     AND trips_analyzed_used < v_limit
     AND NOT EXISTS (
       SELECT 1 FROM public.quota_reservations r
        WHERE r.user_id = _user_id AND r.kind = 'trip_analysis' AND r.counted
          AND r.status = 'RESERVED' AND r.expires_at > now())
  RETURNING trips_analyzed_used INTO v_used;
  IF NOT FOUND THEN
    SELECT trips_analyzed_used INTO v_used FROM public.usage_limits WHERE user_id = _user_id;
    RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0,
                              'limit', v_limit, 'used', GREATEST(v_used, v_limit), 'renews_at', null,
                              'quota', 'trip_analysis_once', 'upgrade_available', true);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', GREATEST(0, v_limit - v_used),
                            'limit', v_limit, 'used', v_used, 'renews_at', null);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_free_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_free_quota(uuid, text) TO service_role;

-- 2) reserve_quota: aparta un análisis (trip_analysis) o un mensaje de Iato (concierge, con llave
--    's:' aleatoria por mensaje: el mensaje solo se cobra si Iato de verdad responde; una pregunta de
--    aclaración o un error lo liberan). Respuestas (jsonb):
--    {allowed:true, reason:'reserved'|'pro', reservation_id}            → hacer el trabajo
--    {allowed:false, reason:'replay', trip_id, result}                   → ya se hizo con esta llave
--    {allowed:false, reason:'in_progress'|'too_many_in_progress'}        → hay otro en curso
--    {allowed:false, reason:'quota_exceeded', limit, used, renews_at}    → sin cupo gratuito
--    request_key que empieza con 'c:' viene del cliente (una por intento): un reintento con la
--    misma llave tras guardar el viaje lo devuelve sin cobrar. Las llaves 'd:' las deriva el
--    servidor de los datos del viaje: protegen del doble clic y reutilizan la reserva de un intento
--    fallido, pero NO devuelven un viaje viejo (re-analizar el mismo viaje es un análisis nuevo).
CREATE OR REPLACE FUNCTION public.reserve_quota(_user_id uuid, _kind text, _request_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := public.free_quota_limit(_kind);
  v_period text := to_char(now(), 'YYYY-MM');
  v_renews timestamptz := date_trunc('month', now()) + interval '1 month';
  v_pro boolean;
  v_used int;
  v_live int;
  v_row public.quota_reservations%ROWTYPE;
  c_max_live_pro constant int := 3;
BEGIN
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;
  IF _user_id IS NULL OR _request_key IS NULL OR length(_request_key) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'reserve_quota: argumentos inválidos';
  END IF;

  -- Candado por usuario: todas las reservas, confirmaciones y consumos de este usuario se forman.
  INSERT INTO public.usage_limits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT CASE WHEN _kind = 'trip_analysis' THEN trips_analyzed_used
              WHEN concierge_period = v_period THEN concierge_messages_used ELSE 0 END
    INTO v_used FROM public.usage_limits WHERE user_id = _user_id FOR UPDATE;

  UPDATE public.quota_reservations SET status = 'EXPIRED', updated_at = now()
   WHERE user_id = _user_id AND kind = _kind AND status = 'RESERVED' AND expires_at <= now();

  SELECT * INTO v_row FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND request_key = _request_key FOR UPDATE;

  IF FOUND AND v_row.status = 'COMMITTED' THEN
    IF left(_request_key, 2) = 'c:' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'replay', 'reservation_id', v_row.id,
                                'trip_id', v_row.trip_id, 'result', v_row.result);
    END IF;
    -- Llave derivada ya usada: se archiva y esta petición cuenta como análisis nuevo.
    UPDATE public.quota_reservations SET request_key = left(request_key, 250) || '#' || id::text, updated_at = now()
     WHERE id = v_row.id;
    v_row := NULL;
  ELSIF FOUND AND v_row.status = 'RESERVED' THEN
    -- Doble clic / misma petición todavía corriendo.
    RETURN jsonb_build_object('allowed', false, 'reason', 'in_progress', 'reservation_id', v_row.id);
  END IF;

  v_pro := public.is_pro(_user_id);
  SELECT count(*) INTO v_live FROM public.quota_reservations
   WHERE user_id = _user_id AND kind = _kind AND status = 'RESERVED'
     AND (v_pro OR counted);

  IF v_pro THEN
    IF v_live >= c_max_live_pro THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_in_progress');
    END IF;
  ELSE
    IF v_used >= v_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind,
                                'limit', v_limit, 'used', v_used,
                                'renews_at', CASE WHEN _kind = 'concierge' THEN v_renews END,
                                'quota', CASE WHEN _kind = 'concierge' THEN 'concierge_monthly' ELSE 'trip_analysis_once' END,
                                'upgrade_available', true);
    END IF;
    IF v_used + v_live >= v_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'in_progress');
    END IF;
  END IF;

  IF v_row.id IS NOT NULL THEN
    -- Reintento de un intento fallido o caducado con la misma llave: se reutiliza la fila.
    UPDATE public.quota_reservations
       SET status = 'RESERVED', counted = NOT v_pro, release_reason = NULL, trip_id = NULL, result = NULL,
           attempts = attempts + 1, expires_at = now() + interval '10 minutes', updated_at = now()
     WHERE id = v_row.id;
  ELSE
    INSERT INTO public.quota_reservations (user_id, kind, request_key, counted)
    VALUES (_user_id, _kind, _request_key, NOT v_pro)
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', CASE WHEN v_pro THEN 'pro' ELSE 'reserved' END,
                            'reservation_id', v_row.id);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, text) TO service_role;

-- 3) commit_quota: el viaje (o el resultado) ya quedó guardado. Idempotente.
--    Se acepta también una reserva caducada: el trabajo terminó tarde, pero se entregó.
CREATE OR REPLACE FUNCTION public.commit_quota(_reservation_id uuid, _trip_id uuid DEFAULT NULL, _result jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_row public.quota_reservations%ROWTYPE;
BEGIN
  SELECT user_id INTO v_user FROM public.quota_reservations WHERE id = _reservation_id;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'not_found');
  END IF;
  -- Mismo orden de candados que reserve_quota (usage_limits y luego la reserva): sin deadlocks.
  PERFORM 1 FROM public.usage_limits WHERE user_id = v_user FOR UPDATE;
  SELECT * INTO v_row FROM public.quota_reservations WHERE id = _reservation_id FOR UPDATE;

  IF v_row.status = 'COMMITTED' THEN
    RETURN jsonb_build_object('committed', true, 'reason', 'already_committed');
  END IF;
  IF v_row.status = 'RELEASED' THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'released');
  END IF;

  UPDATE public.quota_reservations
     SET status = 'COMMITTED', trip_id = _trip_id, result = _result, committed_at = now(), updated_at = now()
   WHERE id = _reservation_id;
  IF v_row.counted AND v_row.kind = 'trip_analysis' THEN
    UPDATE public.usage_limits SET trips_analyzed_used = trips_analyzed_used + 1 WHERE user_id = v_user;
  ELSIF v_row.counted AND v_row.kind = 'concierge' THEN
    UPDATE public.usage_limits
       SET concierge_messages_used =
             CASE WHEN concierge_period = to_char(now(), 'YYYY-MM') THEN concierge_messages_used ELSE 0 END + 1,
           concierge_period = to_char(now(), 'YYYY-MM')
     WHERE user_id = v_user;
  END IF;
  RETURN jsonb_build_object('committed', true, 'reason', 'committed');
END;
$$;
REVOKE ALL ON FUNCTION public.commit_quota(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_quota(uuid, uuid, jsonb) TO service_role;

-- 4) release_quota: algo falló; el cupo regresa. Nunca deshace una reserva ya confirmada.
CREATE OR REPLACE FUNCTION public.release_quota(_reservation_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE public.quota_reservations
     SET status = 'RELEASED', release_reason = left(coalesce(_reason, 'sin_motivo'), 200), updated_at = now()
   WHERE id = _reservation_id AND status IN ('RESERVED', 'EXPIRED')
  RETURNING status INTO v_status;
  IF FOUND THEN
    RETURN jsonb_build_object('released', true);
  END IF;
  SELECT status INTO v_status FROM public.quota_reservations WHERE id = _reservation_id;
  RETURN jsonb_build_object('released', false, 'reason', CASE
    WHEN v_status IS NULL THEN 'not_found'
    WHEN v_status = 'COMMITTED' THEN 'already_committed'
    ELSE 'already_released' END);
END;
$$;
REVOKE ALL ON FUNCTION public.release_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_quota(uuid, text) TO service_role;
