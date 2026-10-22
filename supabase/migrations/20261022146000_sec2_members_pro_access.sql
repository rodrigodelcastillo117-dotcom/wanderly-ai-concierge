-- Members Only = exclusivo de PRO (decisión del dueño, ronda sec2-b). Idempotente.
--
-- Antes: cualquier usuario con sesión leía TODO nightlife_premium (nombre, dirección, sitio,
-- coordenadas, precios), el panel de Concierge no tenía ningún candado y la "contraseña de
-- miembro" era una sola, compartida y ya comprometida (estuvo en el código y en el historial).
--
-- Ahora el acceso = derecho del servidor:
--   members_access() = is_pro(auth.uid())  → PRO pagado, prueba vigente reconocida (con o sin
--   tarjeta) o cortesía (comped) autorizada; la misma regla que el resto de la app.
-- Compatibilidad temporal (APAGADA por defecto): una contraseña rotada con caducidad, guardada
-- solo como hash en members_gate (service_role). Un desbloqueo con contraseña da acceso solo hasta
-- la caducidad de ESA contraseña; los desbloqueos anteriores (sin caducidad, con la contraseña
-- comprometida) dejan de contar.
-- El contenido reservado (nombre del lugar, dirección, sitio, coordenadas, descripción, por qué,
-- dress code, precio, etiquetas) solo lo leen quienes tienen acceso (RLS). Los demás ven un
-- adelanto: ciudades, categorías y conteos (members_teaser).

-- 1) Contraseña temporal: caducidad obligatoria e interruptor apagado por defecto.
ALTER TABLE public.members_gate ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.members_gate ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;
-- Un hash puesto con la versión anterior (sin caducidad) queda apagado.
UPDATE public.members_gate SET enabled = false WHERE expires_at IS NULL;

ALTER TABLE public.nightlife_access ADD COLUMN IF NOT EXISTS password_access_expires_at timestamptz;

-- La versión sin caducidad se retira: ya no existe forma de poner una contraseña permanente.
DROP FUNCTION IF EXISTS public.set_members_password(text);

-- Para el dueño. Recomendado: generar el hash FUERA de producción (ver docs/ops/LEEME.md) para que
-- la contraseña en claro no quede en el historial del editor SQL.
CREATE OR REPLACE FUNCTION public.set_members_password_hash(p_hash text, p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^\$2[abxy]\$[0-9]{2}\$.{53}$' THEN
    RAISE EXCEPTION 'Se espera un hash bcrypt ($2a$…)';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'La caducidad es obligatoria y de máximo 30 días';
  END IF;
  INSERT INTO public.members_gate (id, password_hash, expires_at, enabled, updated_at)
  VALUES (true, p_hash, p_expires_at, true, now())
  ON CONFLICT (id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, expires_at = EXCLUDED.expires_at, enabled = true, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_members_password_hash(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_members_password_hash(text, timestamptz) TO service_role;

-- Variante con la contraseña en claro (solo si se ejecuta por una conexión que no guarde historial).
CREATE OR REPLACE FUNCTION public.set_members_password(p_password text, p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := lower(btrim(coalesce(p_password, '')));
BEGIN
  IF length(v_clean) < 12 THEN
    RAISE EXCEPTION 'La contraseña temporal debe tener al menos 12 caracteres';
  END IF;
  PERFORM public.set_members_password_hash(extensions.crypt(v_clean, extensions.gen_salt('bf', 10)), p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.set_members_password(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_members_password(text, timestamptz) TO service_role;

-- Apaga la contraseña temporal y, con p_revoke_unlocks, corta también los accesos que dio.
CREATE OR REPLACE FUNCTION public.disable_members_password(p_revoke_unlocks boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revoked int := 0;
BEGIN
  UPDATE public.members_gate SET enabled = false, updated_at = now();
  IF p_revoke_unlocks THEN
    UPDATE public.nightlife_access
       SET password_access_expires_at = now(), updated_at = now()
     WHERE password_unlocked AND (password_access_expires_at IS NULL OR password_access_expires_at > now());
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('gate_enabled', false, 'unlocks_revoked', v_revoked);
END;
$$;
REVOKE ALL ON FUNCTION public.disable_members_password(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_members_password(boolean) TO service_role;

-- 2) ¿El usuario en sesión tiene acceso? Solo responde sobre auth.uid() (no es un oráculo).
CREATE OR REPLACE FUNCTION public.members_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_pro(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.nightlife_access na
       WHERE na.user_id = auth.uid() AND na.password_unlocked
         AND na.password_access_expires_at IS NOT NULL AND na.password_access_expires_at > now()
    )
  );
$$;
REVOKE ALL ON FUNCTION public.members_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_access() TO authenticated, service_role;

-- Estado para la pantalla: si tiene acceso, por qué vía, y si la contraseña temporal está activa.
CREATE OR REPLACE FUNCTION public.members_access_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_plan boolean;
  v_pw timestamptz;
  v_gate boolean;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('access', false, 'via', null, 'password_gate', false);
  END IF;
  v_plan := public.is_pro(v_me);
  SELECT na.password_access_expires_at INTO v_pw FROM public.nightlife_access na
   WHERE na.user_id = v_me AND na.password_unlocked AND na.password_access_expires_at > now();
  SELECT coalesce(bool_or(g.enabled AND g.expires_at > now()), false) INTO v_gate FROM public.members_gate g;
  RETURN jsonb_build_object(
    'access', v_plan OR v_pw IS NOT NULL,
    'via', CASE WHEN v_plan THEN 'plan' WHEN v_pw IS NOT NULL THEN 'password' END,
    'access_expires_at', CASE WHEN NOT v_plan THEN v_pw END,
    'password_gate', v_gate
  );
END;
$$;
REVOKE ALL ON FUNCTION public.members_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_access_state() TO authenticated, service_role;

-- 3) Desbloqueo con la contraseña temporal: solo si está encendida y vigente; el acceso dura
--    hasta la caducidad de la contraseña (no para siempre).
CREATE OR REPLACE FUNCTION public.unlock_members_access(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  g record;
  v_rl jsonb;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;
  IF public.is_pro(v_me) THEN
    RETURN jsonb_build_object('ok', true, 'via', 'plan');
  END IF;
  SELECT * INTO g FROM public.members_gate WHERE id;
  IF NOT FOUND OR NOT g.enabled OR g.expires_at IS NULL OR g.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_configurado');
  END IF;
  -- 10 intentos por hora por usuario: sin esto la contraseña se adivina por fuerza bruta.
  v_rl := public.check_rate_limit('user:' || v_me::text, 'members-unlock:h', 10, 3600);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  END IF;
  IF extensions.crypt(lower(btrim(coalesce(p_password, ''))), g.password_hash) IS DISTINCT FROM g.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contrasena_incorrecta');
  END IF;
  INSERT INTO public.nightlife_access AS na (user_id, confirmed_adult, confirmed_adult_at, password_unlocked, password_unlocked_at, password_access_expires_at)
  VALUES (v_me, true, now(), true, now(), g.expires_at)
  ON CONFLICT (user_id) DO UPDATE
    SET confirmed_adult = true,
        confirmed_adult_at = coalesce(na.confirmed_adult_at, now()),
        password_unlocked = true,
        password_unlocked_at = now(),
        password_access_expires_at = g.expires_at;
  RETURN jsonb_build_object('ok', true, 'via', 'password', 'expires_at', g.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.unlock_members_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_members_access(text) TO authenticated, service_role;

-- El cliente tampoco escribe la caducidad del desbloqueo (además de password_unlocked).
CREATE OR REPLACE FUNCTION public.nightlife_access_guard_unlock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.password_unlocked := false;
    NEW.password_unlocked_at := NULL;
    NEW.password_access_expires_at := NULL;
  ELSE
    NEW.password_unlocked := OLD.password_unlocked;
    NEW.password_unlocked_at := OLD.password_unlocked_at;
    NEW.password_access_expires_at := OLD.password_access_expires_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nightlife_access_guard_unlock() FROM PUBLIC, anon, authenticated;

-- 4) Contenido reservado solo con acceso (RLS). Antes: active = true para todo authenticated.
DROP POLICY IF EXISTS "nightlife_premium_read_authenticated" ON public.nightlife_premium;
DROP POLICY IF EXISTS nightlife_premium_read_entitled ON public.nightlife_premium;
CREATE POLICY nightlife_premium_read_entitled ON public.nightlife_premium FOR SELECT TO authenticated
  USING (active AND public.members_access());

-- 5) Adelanto para todos con sesión: ciudades, categorías y cuántos lugares hay. Sin nombres,
--    direcciones, sitios, coordenadas ni textos del lugar.
CREATE OR REPLACE FUNCTION public.members_teaser(p_ciudad text DEFAULT NULL)
RETURNS TABLE (ciudad text, ciudad_display text, pais text, categoria text, venues int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.ciudad, min(n.ciudad_display), min(n.pais), n.categoria, count(*)::int
    FROM public.nightlife_premium n
   WHERE auth.uid() IS NOT NULL AND n.active
     AND (p_ciudad IS NULL OR n.ciudad = p_ciudad)
   GROUP BY n.ciudad, n.categoria
   ORDER BY n.ciudad, n.categoria;
$$;
REVOKE ALL ON FUNCTION public.members_teaser(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.members_teaser(text) TO authenticated, service_role;
