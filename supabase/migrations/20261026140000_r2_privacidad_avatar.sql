-- T-P2-5 y N-L1 (segunda auditoría): profiles.avatar_url solo la escribe el servidor. Idempotente.
--
-- Antes: cualquier usuario podía poner cualquier URL como su avatar (UPDATE directo: el guard no
-- protegía avatar_url) y sus amigos la cargaban con <img> (rastreo de IP/hora o contenido
-- inapropiado). En producción, además, handle_new_user copiaba raw_user_meta_data->>'avatar_url',
-- que controla quien se registra (signUp({ options: { data } })).
-- Ahora:
--   * profiles_guard_sensitive también rechaza cambios de avatar_url hechos por anon/authenticated.
--     generate-avatar (crear/elegir/eliminar) y avatar-evolve escriben con la llave de servicio.
--   * handle_new_user: id, email y full_name (de full_name o name), ON CONFLICT DO NOTHING, sin
--     avatar_url. INFORME_produccion.md describe la versión de producción (D2) pero no trae su texto;
--     esta conserva todo lo que ahí se describe salvo el avatar.
--   * Las URL ya guardadas que no son un avatar nuestro (travel-moments/avatars/<su id>/ del
--     proyecto o el current_url de avatar_profiles) se borran: la persona vuelve a ver su inicial y
--     puede crear su avatar.

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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- N-L1: el avatar lo publica el servidor (generate-avatar / avatar-evolve).
     OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    RAISE EXCEPTION 'Ese dato del perfil no se puede cambiar desde la app' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_sensitive() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_guard_sensitive ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_sensitive();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- URL de avatar que no son nuestras (plantadas desde el cliente o desde el metadato de registro).
UPDATE public.profiles p
   SET avatar_url = NULL
 WHERE p.avatar_url IS NOT NULL
   AND p.avatar_url !~ ('^https://uhkdewinscffhdonhhmt\.supabase\.co/storage/v1/object/public/travel-moments/avatars/'
                        || p.id::text || '/[A-Za-z0-9._-]+$')
   AND p.avatar_url IS DISTINCT FROM (SELECT ap.current_url FROM public.avatar_profiles ap WHERE ap.user_id = p.id);
