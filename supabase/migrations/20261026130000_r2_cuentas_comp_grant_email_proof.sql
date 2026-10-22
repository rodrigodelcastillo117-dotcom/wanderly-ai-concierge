-- Segunda auditoría · grupo cuentas · N-01 / D-P2-1 (P2). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción.
--
-- Problema: con "Confirm email" apagado en Supabase Auth (mailer_autoconfirm=true, producción hoy),
-- GoTrue llena email_confirmed_at en el mismo instante del registro. apply_comp_grant solo exigía
-- email_confirmed_at IS NOT NULL, así que quien registrara primero un correo de comp_grants (sin ser
-- su dueño) recibía PRO de cortesía sin vencimiento. Lo mismo al CAMBIAR el correo de una cuenta ya
-- confirmada: el trigger AFTER UPDATE OF email veía la confirmación vieja (la del correo anterior).
--
-- Regla nueva (public.auth_email_proven): el correo actual de la cuenta está comprobado solo si
--   1. email_confirmed_at no es nulo, y
--   2. lo comprobó un proveedor OAuth (raw_app_meta_data.provider distinto de 'email'/'phone': Google
--      o Apple solo entregan correos verificados), o la confirmación llegó al menos 10 s DESPUÉS de
--      crear la cuenta (un enlace abierto desde el buzón; el autoconfirm ocurre en el mismo instante), y
--   3. el correo no cambió después de esa confirmación (public.auth_email_changes guarda cuándo
--      cambió por última vez; GoTrue no vuelve a llenar email_confirmed_at al cambiar el correo).
-- La cortesía se aplica en el momento en que el correo queda comprobado: al registrarse con OAuth o
-- cuando el trigger AFTER UPDATE OF email_confirmed_at ve la confirmación por enlace. Un cambio de
-- correo nunca da la cortesía por sí solo: el dueño la aplica a mano después de verificar a la persona.
--
-- Lo que NO cambia: las filas que ya son 'comped' siguen igual (nada aquí las toca) y Stripe nunca pisa
-- una cortesía. La corrección de fondo sigue siendo encender "Confirm email" en Supabase Auth.
--
-- Prueba: supabase/tests/payments/aud2_pagos_adversarial.sql (X10, X11) y r2_cuentas.sql (RC1–RC6).

-- Última vez que cambió el correo de cada cuenta (solo la fecha; nunca el correo).
CREATE TABLE IF NOT EXISTS public.auth_email_changes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_email_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_email_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_email_changes TO service_role;

-- Regla pura (sin leer tablas): sirve para el trigger, que ya tiene la fila nueva en NEW.
CREATE OR REPLACE FUNCTION public.auth_email_proven_parts(
  _email text, _provider text, _created_at timestamptz, _confirmed_at timestamptz, _changed_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _email IS NOT NULL AND _confirmed_at IS NOT NULL
     AND (coalesce(_provider, 'email') NOT IN ('email', 'phone')
          OR _confirmed_at >= _created_at + interval '10 seconds')
     AND (_changed_at IS NULL OR _confirmed_at > _changed_at);
$$;
REVOKE ALL ON FUNCTION public.auth_email_proven_parts(text, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_email_proven_parts(text, text, timestamptz, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.auth_email_proven(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT public.auth_email_proven_parts(u.email, u.raw_app_meta_data->>'provider', u.created_at,
                                          u.email_confirmed_at, c.changed_at)
      FROM auth.users u LEFT JOIN public.auth_email_changes c ON c.user_id = u.id
     WHERE u.id = _user_id), false);
$$;
REVOKE ALL ON FUNCTION public.auth_email_proven(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_email_proven(uuid) TO service_role;

-- Registra el cambio de correo. Nunca bloquea el cambio.
CREATE OR REPLACE FUNCTION public.note_auth_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(coalesce(OLD.email, '')) IS DISTINCT FROM lower(coalesce(NEW.email, '')) THEN
    INSERT INTO public.auth_email_changes (user_id, changed_at) VALUES (NEW.id, now())
    ON CONFLICT (user_id) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'note_auth_email_change: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.note_auth_email_change() FROM PUBLIC, anon, authenticated;

-- El nombre empieza con "on_auth_user_0" para correr antes que los demás triggers de auth.users
-- (Postgres los ordena por nombre). De todos modos apply_comp_grant y apply_prive_grant no dependen
-- del orden: también ven el cambio en OLD/NEW.
DROP TRIGGER IF EXISTS on_auth_user_0_email_change ON auth.users;
CREATE TRIGGER on_auth_user_0_email_change
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.note_auth_email_change();

-- ¿El correo (comprobado) de la persona está en la lista de cortesía?
CREATE OR REPLACE FUNCTION public.has_comp_grant(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_email_proven(_user_id) AND EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.comp_grants g ON g.email = lower(u.email)
    WHERE u.id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.has_comp_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_comp_grant(uuid) TO service_role;

-- Cortesía cuando el correo queda comprobado. Sin pisar una suscripción pagada viva.
CREATE OR REPLACE FUNCTION public.apply_comp_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_changed timestamptz;
BEGIN
  -- Un cambio de correo nunca da la cortesía: la confirmación que trae la fila es la del correo anterior.
  IF TG_OP = 'UPDATE' AND lower(coalesce(OLD.email, '')) IS DISTINCT FROM lower(coalesce(NEW.email, '')) THEN
    RETURN NEW;
  END IF;
  SELECT c.changed_at INTO v_changed FROM public.auth_email_changes c WHERE c.user_id = NEW.id;
  IF public.auth_email_proven_parts(NEW.email, NEW.raw_app_meta_data->>'provider', NEW.created_at,
                                    NEW.email_confirmed_at, v_changed)
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

-- Operación (docs/ops/LEEME.md): aplica la lista a cuentas existentes con la misma regla. Ahora
-- también reporta a quién NO se le aplicó porque su correo no está comprobado.
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
    ELSIF NOT public.auth_email_proven(r.id) THEN
      email := r.email;
      result := 'NO aplicado: el correo no está comprobado (confirmado al instante del registro o cambiado después); verifica a la persona antes de dar la cortesía a mano';
      RETURN NEXT;
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
