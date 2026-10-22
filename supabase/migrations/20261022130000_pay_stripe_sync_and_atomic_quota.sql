-- Pagos: sincronía Stripe a prueba de eventos desordenados, cortesía (comped) que no pisa un pago,
-- y cuota gratuita atómica. Idempotente: se puede correr más de una vez.

-- 1) Fecha del último evento de Stripe aplicado a la fila. Sirve para ignorar eventos viejos que
--    Stripe reintenta o entrega tarde (un payment_failed viejo no debe dejar sin PRO a quien ya pagó).
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_event_created timestamptz;

-- 2) ¿La fila representa una suscripción de Stripe viva (la persona paga o pagará)?
--    past_due cuenta como viva: Stripe sigue reintentando el cobro de esa suscripción.
CREATE OR REPLACE FUNCTION public.stripe_sub_is_live(_status text, _subscription_id text, _period_end timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT _subscription_id IS NOT NULL
     AND (_status = 'past_due'
          OR (_status IN ('active', 'trialing') AND (_period_end IS NULL OR _period_end > now())));
$$;
REVOKE ALL ON FUNCTION public.stripe_sub_is_live(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_sub_is_live(text, text, timestamptz) TO service_role;

-- ¿El correo (confirmado) de la persona está en la lista de cortesía?
CREATE OR REPLACE FUNCTION public.has_comp_grant(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.comp_grants g ON g.email = lower(u.email)
    WHERE u.id = _user_id AND u.email_confirmed_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.has_comp_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_comp_grant(uuid) TO service_role;

-- 3) Cuota gratuita atómica. Misma firma, mismo resultado y mismos permisos (solo service_role).
--    Antes, trip_analysis hacía SELECT y luego UPDATE sin candado: dos análisis en paralelo pasaban
--    los dos. Ahora un único UPDATE ... WHERE usado < límite RETURNING decide; Postgres bloquea la
--    fila y re-evalúa la condición, así que la segunda llamada simultánea ve el contador ya en 1.
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

  IF _kind NOT IN ('concierge', 'trip_analysis') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unknown_kind');
  END IF;

  INSERT INTO public.usage_limits (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF _kind = 'concierge' THEN
    v_limit := 3;
    -- Un mes nuevo reinicia el contador en el mismo UPDATE.
    UPDATE public.usage_limits
       SET concierge_messages_used =
             CASE WHEN concierge_period = v_period THEN concierge_messages_used ELSE 0 END + 1,
           concierge_period = v_period
     WHERE user_id = _user_id
       AND (concierge_period <> v_period OR concierge_messages_used < v_limit)
    RETURNING concierge_messages_used INTO v_used;
  ELSE
    v_limit := 1;
    UPDATE public.usage_limits
       SET trips_analyzed_used = trips_analyzed_used + 1
     WHERE user_id = _user_id
       AND trips_analyzed_used < v_limit
    RETURNING trips_analyzed_used INTO v_used;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'kind', _kind, 'remaining', 0);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'free_quota', 'remaining', GREATEST(0, v_limit - v_used));
END;
$$;
REVOKE ALL ON FUNCTION public.consume_free_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_free_quota(uuid, text) TO service_role;

-- 4) Aplicar el estado de una suscripción de Stripe (lo llama solo stripe-webhook, con service_role).
--    Toma un candado sobre la fila del usuario para que dos eventos simultáneos no se pisen, y:
--    - nunca toca una fila 'comped' (la cortesía no la quita Stripe);
--    - si la fila ya tiene OTRA suscripción viva, ignora el evento (un 'deleted' de una suscripción
--      vieja no le quita PRO a quien paga una nueva);
--    - ignora eventos más viejos que el último aplicado a esa misma suscripción;
--    - si la suscripción terminó y el correo está en comp_grants, deja la fila como 'comped'.
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription(
  _user_id uuid,
  _customer_id text,
  _subscription_id text,
  _status text,
  _trial_end timestamptz,
  _current_period_end timestamptz,
  _cancel_at_period_end boolean,
  _price_id text,
  _currency text,
  _event_created timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := _user_id;
  v_row public.subscriptions%ROWTYPE;
  v_status text := _status;
  v_reason text := 'applied';
BEGIN
  IF _subscription_id IS NULL OR _status IS NULL THEN
    RAISE EXCEPTION 'apply_stripe_subscription: falta subscription_id o status';
  END IF;

  IF v_uid IS NULL AND _customer_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.subscriptions
     WHERE stripe_customer_id = _customer_id
     ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'unknown_user');
  END IF;
  -- Cuenta borrada: no hay a quién asignarle el estado (y reintentar no lo arregla).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'user_not_found', 'user_id', v_uid);
  END IF;

  -- Si la suscripción ya no da acceso y la persona tiene cortesía, queda como cortesía.
  IF NOT public.stripe_sub_is_live(_status, _subscription_id, _current_period_end)
     AND public.has_comp_grant(v_uid) THEN
    v_status := 'comped';
    v_reason := 'applied_comped';
  END IF;

  SELECT * INTO v_row FROM public.subscriptions WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (
      user_id, status, stripe_subscription_id, stripe_customer_id, trial_end, current_period_end,
      cancel_at_period_end, price_id, currency, plan, stripe_event_created, updated_at
    ) VALUES (
      v_uid, v_status, _subscription_id, _customer_id, _trial_end,
      CASE WHEN v_status = 'comped' THEN NULL ELSE _current_period_end END,
      COALESCE(_cancel_at_period_end, false), _price_id, COALESCE(upper(_currency), 'MXN'), 'pro',
      _event_created, now()
    )
    ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN
      RETURN jsonb_build_object('applied', true, 'reason', v_reason, 'user_id', v_uid, 'status', v_status);
    END IF;
    -- Otro evento creó la fila al mismo tiempo: la bloqueamos y seguimos con las reglas.
    SELECT * INTO v_row FROM public.subscriptions WHERE user_id = v_uid FOR UPDATE;
  END IF;

  IF v_row.status = 'comped' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'comped', 'user_id', v_uid, 'status', v_row.status);
  END IF;

  IF v_row.stripe_subscription_id IS DISTINCT FROM _subscription_id
     AND public.stripe_sub_is_live(v_row.status, v_row.stripe_subscription_id, v_row.current_period_end) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'other_live_subscription', 'user_id', v_uid,
                              'status', v_row.status);
  END IF;

  IF v_row.stripe_subscription_id = _subscription_id
     AND v_row.stripe_event_created IS NOT NULL
     AND _event_created IS NOT NULL
     AND _event_created < v_row.stripe_event_created THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'stale_event', 'user_id', v_uid, 'status', v_row.status);
  END IF;

  UPDATE public.subscriptions SET
    status = v_status,
    stripe_subscription_id = _subscription_id,
    stripe_customer_id = COALESCE(_customer_id, stripe_customer_id),
    trial_end = _trial_end,
    current_period_end = CASE WHEN v_status = 'comped' THEN NULL ELSE _current_period_end END,
    cancel_at_period_end = COALESCE(_cancel_at_period_end, false),
    price_id = _price_id,
    currency = COALESCE(upper(_currency), currency),
    plan = 'pro',
    stripe_event_created = CASE
      WHEN v_row.stripe_subscription_id = _subscription_id
        THEN GREATEST(v_row.stripe_event_created, _event_created)
      ELSE _event_created END,
    updated_at = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('applied', true, 'reason', v_reason, 'user_id', v_uid, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_stripe_subscription(uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription(uuid, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz)
  TO service_role;

-- 5) Cortesía al registrarse: solo con correo CONFIRMADO (antes bastaba con registrarse con un
--    correo de la lista, aunque no fuera tuyo) y sin pisar una suscripción pagada viva: si la persona
--    ya paga, se queda su suscripción de Stripe (para dejar de cobrarle hay que cancelarla; al
--    terminar, apply_stripe_subscription la deja como cortesía).
CREATE OR REPLACE FUNCTION public.apply_comp_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email_confirmed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.comp_grants WHERE email = lower(NEW.email)) THEN
    INSERT INTO public.subscriptions (user_id, status, plan)
    VALUES (NEW.id, 'comped', 'pro')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'comped', plan = 'pro', current_period_end = NULL,
          cancel_at_period_end = false, updated_at = now()
      WHERE NOT public.stripe_sub_is_live(public.subscriptions.status,
                                          public.subscriptions.stripe_subscription_id,
                                          public.subscriptions.current_period_end);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_comp_grant: %', SQLERRM;  -- nunca bloquea un registro
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_comp_grant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_comp_grant ON auth.users;
CREATE TRIGGER on_auth_user_comp_grant
  AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_comp_grant();

-- 6) Para operación (docs/ops/LEEME.md): aplica la lista de cortesía a cuentas ya existentes con
--    las mismas reglas y devuelve a quién NO se le aplicó porque tiene una suscripción pagada viva.
CREATE OR REPLACE FUNCTION public.apply_comp_grants_now()
RETURNS TABLE (email text, result text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT u.id, lower(u.email) AS email, s.status, s.stripe_subscription_id, s.current_period_end
      FROM auth.users u
      JOIN public.comp_grants g ON g.email = lower(u.email)
      LEFT JOIN public.subscriptions s ON s.user_id = u.id
     WHERE u.email_confirmed_at IS NOT NULL
  LOOP
    IF r.status = 'comped' THEN
      email := r.email; result := 'ya era cortesía'; RETURN NEXT;
    ELSIF public.stripe_sub_is_live(r.status, r.stripe_subscription_id, r.current_period_end) THEN
      email := r.email; result := 'NO aplicado: paga una suscripción viva; cancélala en Stripe primero';
      RETURN NEXT;
    ELSE
      INSERT INTO public.subscriptions (user_id, status, plan)
      VALUES (r.id, 'comped', 'pro')
      ON CONFLICT (user_id) DO UPDATE
        SET status = 'comped', plan = 'pro', current_period_end = NULL,
            cancel_at_period_end = false, updated_at = now();
      email := r.email; result := 'cortesía aplicada'; RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_comp_grants_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_comp_grants_now() TO service_role;
