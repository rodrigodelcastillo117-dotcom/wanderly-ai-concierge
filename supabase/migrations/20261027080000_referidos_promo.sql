-- Promoción "Invita 5 amigos y gana 1 mes de PRO" (rama claude/referidos-promo). Idempotente.
-- REQUIERE AUTORIZACIÓN para aplicarse en producción. Reúsa lo que ya existe: referrals/claim_referral
-- (20261018120000), la cortesía 'comped' (20261021090000, 20261026210000), la prueba de correo
-- (auth_email_proven), is_pro (20261026250000), la huella de tarjeta (20261026230000) y app_flags.
--
-- Regla (la calcula SIEMPRE el servidor):
--   * Cada 5 referidos VÁLIDOS = 1 premio de 30 días de PRO. Se acumula (10 válidos = 2 premios).
--     Cada referido válido queda ligado a un solo premio (referrals.reward_id): nunca cuenta dos veces.
--     Si una cuenta referida se borra, su fila desaparece pero el premio ya dado se queda; y como solo
--     cuentan los referidos sin premio, borrar y volver a invitar no vuelve a dar un premio ya ganado.
--   * Un referido es válido (public.referral_status = 'cuenta') cuando:
--       1. su correo está comprobado (public.auth_email_proven: OAuth o enlace del buzón; el autoconfirm
--          de Supabase NO cuenta, igual que en la cortesía);
--       2. creó al menos un viaje propio con destino (public.trips.user_id = él y destino no vacío): una
--          cuenta vacía no cuenta; y crear un viaje consume su cuota gratuita, así que cuesta fabricarlo;
--       3. no es la misma persona: no es quien invita, su correo normalizado (sin +etiqueta y, en Gmail,
--          sin puntos) no es el de quien invita y no comparte huella de tarjeta con quien invita
--          (stripe_card_customers, que llena claim_trial_fingerprint);
--       4. no fue referido antes por otro: referrals.user_id es UNIQUE y claim_referral solo atribuye
--          cuentas de menos de 24 h (ya existía).
--
-- Premio (public.referral_apply_reward), según el estado de quien lo gana:
--   * Gratis (sin fila, prueba sin tarjeta, suscripción de Stripe terminada) o con cortesía de referidos:
--     'comped' con fecha de fin (subscriptions.comped_until); si ya tenía una vigente se suman 30 días.
--   * Paga PRO en Stripe (suscripción no terminada): NO se toca Stripe. Queda "pendiente" (route
--     'stripe'). El código que lo aplica como saldo a favor en Stripe existe pero está APAGADO con
--     app_flags.referral_stripe_apply_enabled = false (referral_claim_stripe_rewards no entrega nada).
--   * Miembro activo de Privé: queda "guardado" (route 'prive'); no se pierde: se aplica en Stripe cuando
--     el flag esté prendido y, si deja de tener PRO pagado y Privé, como días de cortesía.
--   * Cortesía indefinida (comp_grants o PRO dado a mano): queda "guardado" (route 'cortesia_indefinida');
--     sumar días a algo sin fin no aporta. Si la cortesía se revoca, el barrido la aplica.
--   Cada premio queda en public.referral_rewards (quién, cuándo, cuántos referidos cubrió, días, cómo se
--   aplicó) con UNIQUE (user_id, seq): auditoría y nunca dos veces.
--
-- Cuándo se evalúa (public.referral_evaluate, idempotente, con candado por persona que invita):
--   al registrarse la atribución (AFTER INSERT ON referrals), al confirmar o cambiar el correo (AFTER
--   UPDATE ON auth.users) y al crear un viaje (AFTER INSERT/UPDATE OF destino ON trips). Los triggers
--   nunca bloquean el registro ni el viaje. El barrido public.referral_rewards_sweep lo corre prive-cron
--   (cron diario que ya existe): vence cortesías de referidos, aplica premios guardados y reevalúa.
--
-- Cambios a piezas existentes (mínimos):
--   * subscriptions.comped_until (NULL = cortesía sin vencimiento, como todas las de hoy). Un trigger
--     BEFORE lo limpia si la fila deja de ser 'comped' o si la persona tiene cortesía de comp_grants.
--   * is_pro: 'comped' es PRO si comped_until es NULL o futuro (las cortesías de hoy no cambian).
--   * apply_stripe_subscription: igual que antes; solo la cortesía con fecha cede ante una suscripción
--     viva y, vencida, deja de bloquear los eventos de Stripe.
--   * claim_trial_fingerprint: igual que antes y además anota (huella, cliente de Stripe).
--
-- Prueba: supabase/tests/referidos/referidos.sql (run.sh) y src/test/inviteFriendsCard.test.tsx.

-- ===================================================================== 1) cortesía con fecha de fin
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS comped_until timestamptz;
COMMENT ON COLUMN public.subscriptions.comped_until IS
  'Fin de una cortesía con fecha (premio de referidos). NULL = cortesía sin vencimiento.';

CREATE OR REPLACE FUNCTION public.subscriptions_comped_until_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'comped' THEN
    NEW.comped_until := NULL;
  ELSIF NEW.comped_until IS NOT NULL AND public.has_comp_grant(NEW.user_id) THEN
    -- La cortesía de la lista (comp_grants) no vence: una fecha de referidos no la acorta.
    NEW.comped_until := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.subscriptions_comped_until_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscriptions_comped_until_guard ON public.subscriptions;
CREATE TRIGGER subscriptions_comped_until_guard
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_comped_until_guard();

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
        (s.status = 'comped' AND (s.comped_until IS NULL OR s.comped_until > now()))
        OR (s.status IN ('active', 'trialing')
            AND s.current_period_end IS NOT NULL AND s.current_period_end > now()
            AND (s.stripe_subscription_id IS NULL OR public.pro_price_ok(s.price_id, s.currency)))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_pro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pro(uuid) TO service_role;

-- 2) apply_stripe_subscription (20261022130000) con un único cambio: la guarda de 'comped'.
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

  -- Cortesía: la indefinida (comped_until NULL) nunca la toca Stripe, como siempre. La de referidos
  -- (comped_until con fecha) ignora eventos que no dan acceso mientras está vigente, cede ante una
  -- suscripción viva (la persona empezó a pagar) y, ya vencida, se comporta como una fila normal.
  IF v_row.status = 'comped'
     AND (v_row.comped_until IS NULL
          OR (v_row.comped_until > now()
              AND NOT public.stripe_sub_is_live(_status, _subscription_id, _current_period_end))) THEN
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

-- ===================================================================== 3) huella de tarjeta por cliente
-- La tabla de la prueba (stripe_trial_fingerprints) guarda solo la PRIMERA suscripción de cada tarjeta.
-- Para saber si quien invita y su referido usaron la misma tarjeta hace falta cada (huella, cliente).
-- Solo el identificador opaco de Stripe: ni el número de la tarjeta ni la cuenta de IATOS.
CREATE TABLE IF NOT EXISTS public.stripe_card_customers (
  fingerprint text NOT NULL CHECK (length(fingerprint) BETWEEN 8 AND 64),
  customer_id text NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 255),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fingerprint, customer_id)
);
CREATE INDEX IF NOT EXISTS stripe_card_customers_customer_idx ON public.stripe_card_customers (customer_id);
ALTER TABLE public.stripe_card_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_card_customers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stripe_card_customers TO service_role;

INSERT INTO public.stripe_card_customers (fingerprint, customer_id, first_seen_at)
SELECT fingerprint, customer_id, first_seen_at FROM public.stripe_trial_fingerprints WHERE customer_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 20261026230000 con un solo agregado: anota (huella, cliente). Misma firma y mismo resultado.
CREATE OR REPLACE FUNCTION public.claim_trial_fingerprint(_fingerprint text, _subscription_id text, _customer_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.stripe_trial_fingerprints%ROWTYPE;
BEGIN
  IF _fingerprint IS NULL OR length(_fingerprint) NOT BETWEEN 8 AND 64 OR _subscription_id IS NULL OR _subscription_id = '' THEN
    RAISE EXCEPTION 'claim_trial_fingerprint: huella o suscripción inválida';
  END IF;
  -- Promoción de referidos: misma tarjeta = misma persona (public.referral_status).
  IF _customer_id IS NOT NULL AND length(_customer_id) BETWEEN 1 AND 255 THEN
    INSERT INTO public.stripe_card_customers (fingerprint, customer_id) VALUES (_fingerprint, _customer_id)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.stripe_trial_fingerprints (fingerprint, subscription_id, customer_id)
  VALUES (_fingerprint, _subscription_id, _customer_id)
  ON CONFLICT (fingerprint) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('first', true, 'reason', 'new_card'); END IF;
  SELECT * INTO v FROM public.stripe_trial_fingerprints WHERE fingerprint = _fingerprint;
  IF v.subscription_id = _subscription_id THEN
    RETURN jsonb_build_object('first', true, 'reason', 'same_subscription');
  END IF;
  RETURN jsonb_build_object('first', false, 'reason', 'card_already_had_trial',
                            'first_seen_at', v.first_seen_at);
END $$;
REVOKE ALL ON FUNCTION public.claim_trial_fingerprint(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_trial_fingerprint(text, text, text) TO service_role;

-- ===================================================================== 4) premios
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- quien invitó y gana
  seq int NOT NULL CHECK (seq >= 1),                                     -- 1.º, 2.º… premio de esa persona
  referrals_covered int NOT NULL DEFAULT 5 CHECK (referrals_covered = 5),
  days int NOT NULL DEFAULT 30 CHECK (days = 30),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'applied')),
  route text NOT NULL CHECK (route IN ('comp', 'stripe', 'prive', 'cortesia_indefinida')),
  plan_at_award text NOT NULL,                                           -- estado al ganarlo (auditoría)
  comped_until_after timestamptz,                                        -- route comp: nueva fecha de fin
  stripe_ref text,                                                       -- route stripe: id del saldo a favor
  stripe_attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (user_id, seq)
);
CREATE INDEX IF NOT EXISTS referral_rewards_pending_idx ON public.referral_rewards (status, created_at) WHERE status <> 'applied';
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_rewards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_rewards TO service_role;

-- A qué premio quedó ligado cada referido (NULL = aún no cubierto por ninguno).
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS reward_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_reward_id_fkey') THEN
    ALTER TABLE public.referrals ADD CONSTRAINT referrals_reward_id_fkey
      FOREIGN KEY (reward_id) REFERENCES public.referral_rewards(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_referrals_reward ON public.referrals (reward_id) WHERE reward_id IS NOT NULL;
-- La tabla sigue siendo de solo lectura para quien invitó (referrals_select_as_referrer); nadie escribe
-- y anon no tiene ningún permiso (antes conservaba el SELECT por defecto de Supabase, sin filas por RLS).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.referrals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.referrals FROM anon;

INSERT INTO public.app_flags (key, value, note) VALUES
  ('referral_stripe_apply_enabled', 'false'::jsonb,
   'Referidos: aplicar el mes gratis como saldo a favor en Stripe a quien ya paga PRO (requiere autorización del dueño)')
ON CONFLICT (key) DO NOTHING;

-- ===================================================================== 5) reglas
-- Correo normalizado para detectar la misma persona: sin +etiqueta; en Gmail, sin puntos.
CREATE OR REPLACE FUNCTION public.referral_email_key(_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH e AS (SELECT lower(btrim(coalesce(_email, ''))) AS v),
       p AS (SELECT split_part(split_part(v, '@', 1), '+', 1) AS l,
                    CASE WHEN split_part(v, '@', 2) = 'googlemail.com' THEN 'gmail.com' ELSE split_part(v, '@', 2) END AS d
               FROM e)
  SELECT CASE WHEN l = '' OR d = '' THEN NULL
              WHEN d = 'gmail.com' THEN replace(l, '.', '') || '@' || d
              ELSE l || '@' || d END
    FROM p;
$$;
REVOKE ALL ON FUNCTION public.referral_email_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_email_key(text) TO service_role;

-- 'cuenta' | 'falta_correo' | 'falta_viaje' | 'no_cuenta' (misma persona o cuenta que ya no existe).
CREATE OR REPLACE FUNCTION public.referral_status(_referred uuid, _referrer uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref_email text;
  v_inv_email text;
BEGIN
  IF _referred IS NULL OR _referrer IS NULL OR _referred = _referrer THEN RETURN 'no_cuenta'; END IF;
  SELECT email INTO v_ref_email FROM auth.users WHERE id = _referred;
  IF NOT FOUND THEN RETURN 'no_cuenta'; END IF;
  SELECT email INTO v_inv_email FROM auth.users WHERE id = _referrer;
  IF public.referral_email_key(v_ref_email) IS NOT NULL
     AND public.referral_email_key(v_ref_email) = public.referral_email_key(v_inv_email) THEN
    RETURN 'no_cuenta';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.stripe_card_customers a
      JOIN public.stripe_card_customers b ON b.fingerprint = a.fingerprint
     WHERE a.customer_id IN (SELECT s.stripe_customer_id FROM public.subscriptions s
                              WHERE s.user_id = _referrer AND s.stripe_customer_id IS NOT NULL)
       AND b.customer_id IN (SELECT s.stripe_customer_id FROM public.subscriptions s
                              WHERE s.user_id = _referred AND s.stripe_customer_id IS NOT NULL)) THEN
    RETURN 'no_cuenta';
  END IF;
  IF NOT public.auth_email_proven(_referred) THEN RETURN 'falta_correo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = _referred AND btrim(coalesce(t.destino, '')) <> '') THEN
    RETURN 'falta_viaje';
  END IF;
  RETURN 'cuenta';
END $$;
REVOKE ALL ON FUNCTION public.referral_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_status(uuid, uuid) TO service_role;

-- Cómo se entrega un premio a esta persona hoy: 'comp' (días de cortesía ya), 'stripe' (paga en
-- Stripe), 'prive' (miembro activo) o 'cortesia_indefinida' (ya tiene PRO sin fin).
CREATE OR REPLACE FUNCTION public.referral_reward_route(_user uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.subscriptions%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.prive_memberships m WHERE m.user_id = _user AND m.status = 'active') THEN
    RETURN 'prive';
  END IF;
  SELECT * INTO s FROM public.subscriptions WHERE user_id = _user;
  IF NOT FOUND THEN RETURN 'comp'; END IF;
  IF s.status = 'comped' AND s.comped_until IS NULL THEN RETURN 'cortesia_indefinida'; END IF;
  IF s.status = 'comped' THEN RETURN 'comp'; END IF;
  -- Una suscripción de Stripe que no terminó (activa, en prueba, con pago pendiente, pausada…): no se
  -- toca. Solo 'canceled' e 'incomplete_expired' son finales en Stripe.
  IF s.stripe_subscription_id IS NOT NULL AND coalesce(s.status, '') NOT IN ('canceled', 'incomplete_expired') THEN
    RETURN 'stripe';
  END IF;
  RETURN 'comp';
END $$;
REVOKE ALL ON FUNCTION public.referral_reward_route(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_reward_route(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_fmt_date(_t timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_char(_t AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY');
$$;
REVOKE ALL ON FUNCTION public.referral_fmt_date(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_fmt_date(timestamptz) TO service_role;

-- Aplica (o deja guardado) un premio. Idempotente: un premio 'applied' no se vuelve a aplicar.
-- _notify=false cuando el aviso de "¡Ganaste!" ya dice que se aplicó (referral_evaluate).
DROP FUNCTION IF EXISTS public.referral_apply_reward(uuid);
CREATE OR REPLACE FUNCTION public.referral_apply_reward(_reward_id uuid, _notify boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.referral_rewards%ROWTYPE;
  v_route text;
  v_until timestamptz;
BEGIN
  SELECT * INTO r FROM public.referral_rewards WHERE id = _reward_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r.status <> 'pending' THEN RETURN r.status; END IF;
  v_route := public.referral_reward_route(r.user_id);
  IF v_route <> 'comp' THEN
    UPDATE public.referral_rewards SET route = v_route WHERE id = r.id AND route IS DISTINCT FROM v_route;
    RETURN 'pending';
  END IF;

  -- Días de cortesía. Se suman a una cortesía de referidos vigente y a una prueba sin tarjeta que aún
  -- corre; si no, cuentan desde hoy. Una suscripción de Stripe terminada conserva sus ids.
  INSERT INTO public.subscriptions AS s (user_id, status, plan, comped_until)
  VALUES (r.user_id, 'comped', 'pro', now() + make_interval(days => r.days))
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'comped', plan = 'pro', cancel_at_period_end = false, updated_at = now(),
        comped_until = GREATEST(now(),
                                CASE WHEN s.status = 'comped' THEN s.comped_until END,
                                CASE WHEN s.status IN ('active', 'trialing') AND s.stripe_subscription_id IS NULL
                                     THEN s.current_period_end END)
                       + make_interval(days => r.days)
  RETURNING s.comped_until INTO v_until;

  UPDATE public.referral_rewards
     SET status = 'applied', route = 'comp', applied_at = now(), comped_until_after = v_until, last_error = NULL
   WHERE id = r.id;
  IF _notify THEN
    INSERT INTO public.notifications (user_id, type, title, body, dedup_key)
    VALUES (r.user_id, 'info', 'Tu mes gratis de PRO ya está activo',
            'Tienes IATOS PRO de cortesía hasta el ' || public.referral_fmt_date(v_until) || '.',
            'referral_reward_applied:' || r.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.referral_apply_reward(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_apply_reward(uuid, boolean) TO service_role;

-- Crea los premios que tocan a quien invitó (cada 5 válidos sin premio) y los aplica. Idempotente:
-- candado por persona, cada referido se liga a un solo premio y (user_id, seq) es único.
CREATE OR REPLACE FUNCTION public.referral_evaluate(_referrer uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_seq int;
  v_id uuid;
  v_plan text;
  v_route text;
  v_result text;
  v_n int := 0;
BEGIN
  IF _referrer IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _referrer) THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('referral_reward:' || _referrer::text, 0));
  LOOP
    SELECT array_agg(x.user_id ORDER BY x.created_at, x.user_id) INTO v_ids
      FROM (SELECT r.user_id, r.created_at FROM public.referrals r
             WHERE r.referrer_id = _referrer AND r.reward_id IS NULL
               AND public.referral_status(r.user_id, _referrer) = 'cuenta'
             ORDER BY r.created_at, r.user_id LIMIT 5) x;
    EXIT WHEN coalesce(array_length(v_ids, 1), 0) < 5;

    SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.referral_rewards WHERE user_id = _referrer;
    v_route := public.referral_reward_route(_referrer);
    SELECT CASE
             WHEN v_route = 'prive' THEN 'prive'
             WHEN v_route = 'stripe' THEN 'stripe_' || coalesce(s.status, '?')
             WHEN s.user_id IS NULL THEN 'free'
             WHEN s.status = 'comped' THEN CASE WHEN s.comped_until IS NULL THEN 'comped' ELSE 'comped_referidos' END
             ELSE 'free_' || coalesce(s.status, '?') END
      INTO v_plan
      FROM (SELECT 1) one LEFT JOIN public.subscriptions s ON s.user_id = _referrer;

    INSERT INTO public.referral_rewards (user_id, seq, status, route, plan_at_award)
    VALUES (_referrer, v_seq, 'pending', v_route, v_plan)
    RETURNING id INTO v_id;
    UPDATE public.referrals SET reward_id = v_id
     WHERE referrer_id = _referrer AND user_id = ANY (v_ids) AND reward_id IS NULL;

    v_result := public.referral_apply_reward(v_id, false);
    INSERT INTO public.notifications (user_id, type, title, body, dedup_key)
    VALUES (_referrer, 'info', '¡Ganaste 1 mes de PRO!',
            CASE WHEN v_result = 'applied' THEN
                   '5 amigos ya cuentan. Tienes IATOS PRO de cortesía hasta el '
                   || public.referral_fmt_date((SELECT comped_until_after FROM public.referral_rewards WHERE id = v_id)) || '.'
                 WHEN v_route IN ('stripe', 'prive') AND public.app_flag('referral_stripe_apply_enabled') THEN
                   '5 amigos ya cuentan. Tu mes gratis se aplicará en tu próximo cobro.'
                 ELSE '5 amigos ya cuentan. Tu mes gratis está guardado; te avisaremos cuando se aplique.' END,
            'referral_reward:' || v_id)
    ON CONFLICT DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.referral_evaluate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_evaluate(uuid) TO service_role;

-- ===================================================================== 6) cuándo se evalúa (triggers)
-- Nunca bloquean: un error queda como WARNING y el barrido diario lo vuelve a intentar.
CREATE OR REPLACE FUNCTION public.referral_eval_on_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.referral_evaluate(NEW.referrer_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral_eval_on_referral: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.referral_eval_on_referral() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS referrals_eval_reward ON public.referrals;
CREATE TRIGGER referrals_eval_reward AFTER INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.referral_eval_on_referral();

-- Para auth.users (NEW.id) y trips (NEW.user_id): evalúa a quien invitó a esa persona, si lo hay.
CREATE OR REPLACE FUNCTION public.referral_eval_on_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_member uuid;
  v_referrer uuid;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN v_member := NEW.id; ELSE v_member := NEW.user_id; END IF;
  SELECT referrer_id INTO v_referrer FROM public.referrals WHERE user_id = v_member AND reward_id IS NULL;
  IF v_referrer IS NOT NULL THEN
    BEGIN
      PERFORM public.referral_evaluate(v_referrer);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'referral_eval_on_member: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'referral_eval_on_member: %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.referral_eval_on_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_referral_eval ON auth.users;
CREATE TRIGGER on_auth_user_referral_eval
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.referral_eval_on_member();

DROP TRIGGER IF EXISTS trips_referral_eval ON public.trips;
CREATE TRIGGER trips_referral_eval
  AFTER INSERT OR UPDATE OF destino ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.referral_eval_on_member();

-- ===================================================================== 7) barrido (prive-cron, diario)
-- 1. Aplica premios guardados que ya se pueden dar como cortesía (p. ej. dejó de pagar en Stripe).
-- 2. Vence las cortesías de referidos cuya fecha pasó (vuelven al plan gratuito: 'canceled').
-- 3. Reevalúa a quien tenga referidos sin premio de los últimos 120 días (por si un trigger falló).
CREATE OR REPLACE FUNCTION public.referral_rewards_sweep(_limit int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  v_applied int := 0;
  v_expired int := 0;
  v_new int := 0;
  v_lim int := LEAST(GREATEST(coalesce(_limit, 500), 1), 5000);
BEGIN
  FOR v IN SELECT id FROM public.referral_rewards
            WHERE status = 'pending' AND route IN ('comp', 'prive', 'cortesia_indefinida', 'stripe')
            ORDER BY created_at LIMIT v_lim LOOP
    IF public.referral_apply_reward(v.id) = 'applied' THEN v_applied := v_applied + 1; END IF;
  END LOOP;

  WITH x AS (
    UPDATE public.subscriptions SET status = 'canceled', cancel_at_period_end = false, updated_at = now()
     WHERE status = 'comped' AND comped_until IS NOT NULL AND comped_until <= now()
    RETURNING 1)
  SELECT count(*) INTO v_expired FROM x;

  FOR v IN SELECT DISTINCT r.referrer_id FROM public.referrals r
            WHERE r.reward_id IS NULL AND r.created_at > now() - interval '120 days'
            LIMIT v_lim LOOP
    v_new := v_new + public.referral_evaluate(v.referrer_id);
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'expired', v_expired, 'new_rewards', v_new);
END $$;
REVOKE ALL ON FUNCTION public.referral_rewards_sweep(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_rewards_sweep(int) TO service_role;

-- ===================================================================== 8) Stripe (APAGADO)
-- Con app_flags.referral_stripe_apply_enabled = false no entrega nada. Encendido, reclama premios
-- pendientes de quien tiene una suscripción viva y cliente de Stripe; prive-cron crea un saldo a favor
-- (customer balance transaction) por el precio de un mes con llave de idempotencia por premio y lo
-- confirma con referral_mark_stripe_reward. Un reclamo sin confirmar se puede volver a tomar en 1 h.
CREATE OR REPLACE FUNCTION public.referral_claim_stripe_rewards(_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.app_flag('referral_stripe_apply_enabled') THEN
    RETURN jsonb_build_object('enabled', false, 'rewards', '[]'::jsonb);
  END IF;
  WITH c AS (
    SELECT r.id FROM public.referral_rewards r
      JOIN public.subscriptions s ON s.user_id = r.user_id
     WHERE r.route IN ('stripe', 'prive') AND r.stripe_attempts < 5
       AND (r.status = 'pending' OR (r.status = 'processing' AND r.claimed_at < now() - interval '1 hour'))
       AND s.stripe_customer_id IS NOT NULL
       AND public.stripe_sub_is_live(s.status, s.stripe_subscription_id, s.current_period_end)
     ORDER BY r.created_at
     LIMIT LEAST(GREATEST(coalesce(_limit, 20), 1), 100)
     FOR UPDATE OF r SKIP LOCKED),
  u AS (
    UPDATE public.referral_rewards r
       SET status = 'processing', claimed_at = now(), stripe_attempts = r.stripe_attempts + 1
      FROM c WHERE r.id = c.id
    RETURNING r.id, r.user_id, r.days)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'customer_id', s.stripe_customer_id, 'days', u.days)), '[]'::jsonb)
    INTO v_rows
    FROM u JOIN public.subscriptions s ON s.user_id = u.user_id;
  RETURN jsonb_build_object('enabled', true, 'rewards', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.referral_claim_stripe_rewards(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_claim_stripe_rewards(int) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_mark_stripe_reward(_reward_id uuid, _ok boolean, _stripe_ref text, _error text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.referral_rewards%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.referral_rewards WHERE id = _reward_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'processing' THEN RETURN false; END IF;
  IF coalesce(_ok, false) THEN
    UPDATE public.referral_rewards
       SET status = 'applied', applied_at = now(), stripe_ref = left(_stripe_ref, 255), last_error = NULL
     WHERE id = r.id;
    INSERT INTO public.notifications (user_id, type, title, body, dedup_key)
    VALUES (r.user_id, 'info', 'Tu mes gratis de PRO ya se aplicó',
            'Lo verás como saldo a favor en tu próximo cobro de IATOS PRO.', 'referral_reward_applied:' || r.id)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.referral_rewards SET status = 'pending', last_error = left(coalesce(_error, 'error'), 300)
     WHERE id = r.id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.referral_mark_stripe_reward(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_mark_stripe_reward(uuid, boolean, text, text) TO service_role;

-- ===================================================================== 9) lo que ve cada persona
-- Nombre de pila y la inicial del apellido; nunca el correo ni el nombre completo.
CREATE OR REPLACE FUNCTION public.referral_display_name(_full text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v text := btrim(regexp_replace(coalesce(_full, ''), '\s+', ' ', 'g'));
  v_first text;
  v_second text;
BEGIN
  IF v = '' OR v LIKE '%@%' THEN RETURN NULL; END IF;
  v_first := left(split_part(v, ' ', 1), 20);
  v_second := split_part(v, ' ', 2);
  RETURN v_first || CASE WHEN v_second <> '' THEN ' ' || upper(left(v_second, 1)) || '.' ELSE '' END;
END $$;
REVOKE ALL ON FUNCTION public.referral_display_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_display_name(text) TO service_role;

-- Progreso de la promoción de quien llama (sin parámetros: nadie puede pedir el de otra persona).
CREATE OR REPLACE FUNCTION public.referral_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_joined jsonb;
  v_counting int;
  v_rewards int;
  v_last jsonb;
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', j.name, 'status', j.status, 'joined_at', j.joined_at)
                            ORDER BY j.created_at DESC), '[]'::jsonb),
         count(*) FILTER (WHERE j.status = 'cuenta' AND NOT j.covered)
    INTO v_joined, v_counting
    FROM (SELECT r.created_at, (r.created_at AT TIME ZONE 'America/Mexico_City')::date AS joined_at,
                 r.reward_id IS NOT NULL AS covered,
                 public.referral_display_name(p.full_name) AS name,
                 CASE WHEN r.reward_id IS NOT NULL THEN 'cuenta' ELSE public.referral_status(r.user_id, v_uid) END AS status
            FROM public.referrals r LEFT JOIN public.profiles p ON p.id = r.user_id
           WHERE r.referrer_id = v_uid
           ORDER BY r.created_at DESC
           LIMIT 100) j;

  SELECT count(*) INTO v_rewards FROM public.referral_rewards WHERE user_id = v_uid;
  SELECT jsonb_build_object('status', status, 'route', route, 'days', days, 'created_at', created_at,
                            'applied_at', applied_at, 'comped_until', comped_until_after)
    INTO v_last
    FROM public.referral_rewards WHERE user_id = v_uid ORDER BY seq DESC LIMIT 1;
  SELECT comped_until INTO v_until FROM public.subscriptions
   WHERE user_id = v_uid AND status = 'comped' AND comped_until > now();

  RETURN jsonb_build_object(
    'goal', 5,
    'days_per_reward', 30,
    'counting', v_counting,
    'rewards', v_rewards,
    'pending_rewards', (SELECT count(*) FROM public.referral_rewards WHERE user_id = v_uid AND status <> 'applied'),
    'last_reward', v_last,
    'comped_until', v_until,
    'stripe_apply_enabled', public.app_flag('referral_stripe_apply_enabled'),
    'joined', v_joined);
END $$;
REVOKE ALL ON FUNCTION public.referral_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_progress() TO authenticated, service_role;

-- Panel de administración: cuántos premios se han dado (solo agregados).
CREATE OR REPLACE FUNCTION public.admin_referral_rewards()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.referral_rewards),
    'applied', (SELECT count(*) FROM public.referral_rewards WHERE status = 'applied'),
    'pending', (SELECT count(*) FROM public.referral_rewards WHERE status <> 'applied'),
    'last_30d', (SELECT count(*) FROM public.referral_rewards WHERE created_at >= now() - interval '30 days'),
    'people', (SELECT count(DISTINCT user_id) FROM public.referral_rewards),
    'days_given', (SELECT coalesce(sum(days), 0) FROM public.referral_rewards WHERE status = 'applied'),
    'stripe_apply_enabled', public.app_flag('referral_stripe_apply_enabled'));
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_rewards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_rewards() TO authenticated;
