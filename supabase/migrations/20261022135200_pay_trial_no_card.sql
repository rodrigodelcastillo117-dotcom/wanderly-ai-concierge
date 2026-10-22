-- DEC-02 (preparado, APAGADO): 30 días de PRO sin tarjeta y sin cobro automático al confirmar el
-- correo. Al terminar, la persona vuelve a FREE y conserva sus datos (is_pro deja de ser verdadero
-- cuando vence current_period_end; no se borra nada). Solo actúa si el dueño enciende
-- app_flags.trial_no_card_enabled. Una prueba por correo normalizado, aunque se borre la cuenta.
-- Idempotente.

-- Registro de pruebas otorgadas. Se guarda el SHA-256 del correo normalizado, no el correo: basta
-- para impedir una segunda prueba al borrar y recrear la cuenta sin conservar el dato personal
-- después de una baja (derechos ARCO).
CREATE TABLE IF NOT EXISTS public.trial_grants (
  email_hash text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  trial_end timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'no_card'
);
ALTER TABLE public.trial_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trial_grants TO service_role;

-- Normaliza para que "Ana.Perez+viajes@Gmail.com" y "anaperez@gmail.com" cuenten como el mismo
-- correo: minúsculas, sin "+etiqueta" y, en Gmail, sin puntos.
CREATE OR REPLACE FUNCTION public.normalize_email(_email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text := lower(trim(coalesce(_email, '')));
  v_local text;
  v_domain text;
BEGIN
  IF position('@' in v) = 0 THEN RETURN v; END IF;
  v_local := split_part(v, '@', 1);
  v_domain := split_part(v, '@', 2);
  v_local := split_part(v_local, '+', 1);
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;
  RETURN v_local || '@' || v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_trial_hash(_email text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(public.normalize_email(_email), 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public.email_trial_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_trial_hash(text) TO service_role;

-- Otorga la prueba sin tarjeta si: el interruptor está encendido, el correo está confirmado, ese
-- correo nunca tuvo prueba y la persona no tiene ya una fila de suscripción (cortesía, Stripe, etc.).
CREATE OR REPLACE FUNCTION public.apply_no_card_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hash text;
  v_end timestamptz := now() + interval '30 days';
BEGIN
  IF NOT public.app_flag('trial_no_card_enabled') THEN RETURN NEW; END IF;
  IF NEW.email IS NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;

  v_hash := public.email_trial_hash(NEW.email);
  IF EXISTS (SELECT 1 FROM public.trial_grants WHERE email_hash = v_hash) THEN RETURN NEW; END IF;

  INSERT INTO public.subscriptions (user_id, status, plan, trial_end, current_period_end, cancel_at_period_end)
  VALUES (NEW.id, 'trialing', 'pro', v_end, v_end, false)
  ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.trial_grants (email_hash, user_id, trial_end) VALUES (v_hash, NEW.id, v_end)
    ON CONFLICT (email_hash) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_no_card_trial: %', SQLERRM;  -- nunca bloquea un registro
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_no_card_trial() FROM PUBLIC, anon, authenticated;

-- El nombre ordena después de on_auth_user_comp_grant: si el correo tiene cortesía, gana la cortesía.
DROP TRIGGER IF EXISTS on_auth_user_no_card_trial ON auth.users;
CREATE TRIGGER on_auth_user_no_card_trial
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_no_card_trial();
