-- PRO de cortesía por correo: comp_grants lista correos y un trigger en auth.users
-- les asigna subscriptions.status='comped' al registrarse. Se llena a mano (docs/ops).

-- 1) Lista de correos con PRO de cortesía (solo el servidor puede leerla).
CREATE TABLE IF NOT EXISTS public.comp_grants (
  email text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.comp_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comp_grants FROM anon, authenticated;

-- 2) Al registrarse (o cambiar su correo), si está en la lista, queda PRO.
CREATE OR REPLACE FUNCTION public.apply_comp_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.comp_grants WHERE email = lower(NEW.email)) THEN
    INSERT INTO public.subscriptions (user_id, status, plan)
    VALUES (NEW.id, 'comped', 'pro')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'comped', plan = 'pro', current_period_end = NULL,
          cancel_at_period_end = false, updated_at = now();
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_comp_grant: %', SQLERRM;  -- nunca bloquea un registro
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_comp_grant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_comp_grant ON auth.users;
CREATE TRIGGER on_auth_user_comp_grant
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.apply_comp_grant();

