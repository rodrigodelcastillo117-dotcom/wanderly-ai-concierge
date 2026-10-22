-- Borrado de cuenta seguro, auditable y reanudable (decisión del dueño, ronda sec2-b). Idempotente.
--
-- Antes delete-account hacía todo en una sola llamada: si un paso externo fallaba a la mitad no
-- quedaba rastro de qué se hizo, y PostHog y el cliente de Stripe nunca se tocaban.
-- Ahora cada borrado es una solicitud con un renglón por paso:
--   stripe_cancel          (bloqueante) cancelar suscripciones vivas y quitar métodos de pago
--   storage                (bloqueante) archivos del usuario en todos los buckets
--   db_purge               (bloqueante) purge_account_data
--   stripe_customer_redact (no bloqueante) quitar nombre/correo/teléfono/dirección del cliente
--   posthog_delete         (no bloqueante) borrar la persona y sus eventos en PostHog
-- La identidad (auth.users) se borra solo cuando los tres bloqueantes terminaron; los no
-- bloqueantes que fallen quedan 'failed' o 'pending_key' y los reintenta account-deletion-retry.
-- Columnas account_id (no user_id): purge_account_data borra toda tabla con user_id, y esta
-- bitácora debe sobrevivir al borrado. Solo service_role.

CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'identity_deleted', 'completed')),
  identity_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- Una sola solicitud abierta por cuenta: repetir "Eliminar cuenta" reanuda la misma.
CREATE UNIQUE INDEX IF NOT EXISTS deletion_requests_open_uniq
  ON public.deletion_requests (account_id) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS deletion_requests_customer_idx ON public.deletion_requests (stripe_customer_id);
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.deletion_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.deletion_request_steps (
  request_id uuid NOT NULL REFERENCES public.deletion_requests(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('stripe_cancel', 'stripe_customer_redact', 'posthog_delete', 'storage', 'db_purge')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'pending_key', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, step)
);
ALTER TABLE public.deletion_request_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_request_steps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.deletion_request_steps TO service_role;

-- Crea (o devuelve la abierta) solicitud con sus 5 pasos. Guarda el cliente de Stripe ANTES del
-- purge (que borra la fila de subscriptions).
CREATE OR REPLACE FUNCTION public.start_account_deletion(_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_cus text;
  v_sub text;
BEGIN
  IF _account_id IS NULL THEN RAISE EXCEPTION 'start_account_deletion: falta la cuenta'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('start_account_deletion'), hashtext(_account_id::text));
  SELECT id INTO v_id FROM public.deletion_requests WHERE account_id = _account_id AND status <> 'completed';
  IF v_id IS NULL THEN
    SELECT stripe_customer_id, stripe_subscription_id INTO v_cus, v_sub
      FROM public.subscriptions WHERE user_id = _account_id;
    INSERT INTO public.deletion_requests (account_id, stripe_customer_id, stripe_subscription_id)
    VALUES (_account_id, v_cus, v_sub) RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.deletion_request_steps (request_id, step)
  SELECT v_id, s FROM unnest(ARRAY['stripe_cancel', 'storage', 'db_purge', 'stripe_customer_redact', 'posthog_delete']) s
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_account_deletion(uuid) TO service_role;

-- ¿Este cliente de Stripe pertenece a una cuenta borrada o en borrado? El webhook lo usa para que un
-- evento tardío no recree filas ni dé acceso.
CREATE OR REPLACE FUNCTION public.is_deleted_stripe_customer(_customer_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _customer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.deletion_requests WHERE stripe_customer_id = _customer_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_deleted_stripe_customer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_deleted_stripe_customer(text) TO service_role;

-- Defensa en la base: apply_stripe_subscription ya responde 'user_not_found' para una cuenta
-- borrada, pero si llega solo con customer y una fila nueva existiera con ese customer, tampoco
-- debe escribir. Se envuelve sin cambiar la función original.
CREATE OR REPLACE FUNCTION public.subscriptions_block_deleted_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stripe_customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id)
     AND EXISTS (SELECT 1 FROM public.deletion_requests d
                  WHERE d.stripe_customer_id = NEW.stripe_customer_id AND d.account_id <> NEW.user_id) THEN
    RAISE EXCEPTION 'Ese cliente de Stripe pertenece a una cuenta eliminada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.subscriptions_block_deleted_customer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS subscriptions_block_deleted_customer ON public.subscriptions;
CREATE TRIGGER subscriptions_block_deleted_customer BEFORE INSERT OR UPDATE OF stripe_customer_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_block_deleted_customer();
