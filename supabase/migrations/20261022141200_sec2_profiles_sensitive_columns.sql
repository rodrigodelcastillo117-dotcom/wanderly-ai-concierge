-- F-09 (IATOS-052): el usuario podía cambiar columnas sensibles de su propio perfil. Idempotente.
--   email       → es adonde se manda el correo de cotización (analizar-viaje);
--   invite_code → sin índice único, copiar el código de otro desviaba amistades y referidos;
--   tier, id, created_at → datos del sistema.
-- Lo que la app sí edita sigue igual: avatar_url (Perfil, onboarding), active_trip_id (Concierge,
-- con su propio guard), food_dna (update-food-dna con la sesión del usuario), nombre, ciudad,
-- país, nacionalidad, moneda, fecha de nacimiento, lealtad y username.
-- Se usa un trigger y no GRANT por columna: un "GRANT ALL ON profiles" futuro (Lovable lo hace al
-- crear tablas) desharía en silencio una restricción por columnas; el trigger no.
CREATE OR REPLACE FUNCTION public.profiles_guard_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo sentencias de clientes (PostgREST con la sesión del usuario). handle_new_user, los RPC
  -- SECURITY DEFINER y el service role no pasan por aquí.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- El perfil lo crea handle_new_user al registrarse; ninguna pantalla lo inserta.
    RAISE EXCEPTION 'El perfil lo crea el sistema' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.invite_code IS DISTINCT FROM OLD.invite_code
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Ese dato del perfil no se puede cambiar desde la app' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_sensitive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_sensitive ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_sensitive();

-- Ningún cliente inserta perfiles (lo hace handle_new_user). Si alguien borra su fila, la
-- recuperación es por soporte/servicio, no re-insertando con un email o código a elección.
REVOKE INSERT ON public.profiles FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;

-- Códigos de invitación únicos (sin distinguir mayúsculas). Solo se crea si hoy no hay
-- duplicados: en producción hay que revisarlos primero (consulta en docs/ops/LEEME.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'profiles_invite_code_upper_key') THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles WHERE invite_code IS NOT NULL
       GROUP BY upper(invite_code) HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'profiles.invite_code tiene duplicados: no se creó el índice único (ver docs/ops/LEEME.md)';
    ELSE
      CREATE UNIQUE INDEX profiles_invite_code_upper_key ON public.profiles (upper(invite_code));
    END IF;
  END IF;
END $$;
