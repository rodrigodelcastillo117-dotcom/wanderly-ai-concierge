-- F-16 (IATOS, auditoría F): la contraseña de "Members" estaba escrita en el frontend
-- (src/pages/Members.tsx) y nightlife_access.password_unlocked lo podía poner en true el propio
-- usuario con un UPDATE. Idempotente.
--
-- Ahora:
--   * la contraseña vive como hash bcrypt en public.members_gate (nadie del lado cliente la lee);
--   * unlock_members_access(p_password) la compara en el servidor, con límite de intentos, y es la
--     única vía para marcar password_unlocked;
--   * un trigger impide que el cliente escriba password_unlocked / password_unlocked_at.
-- La migración NO siembra ninguna contraseña: la anterior quedó expuesta en el código y en el
-- historial de git. Mientras el dueño no la configure (docs/ops/LEEME.md → set_members_password),
-- el desbloqueo responde "no configurado"; quien ya había desbloqueado conserva su acceso.

CREATE TABLE IF NOT EXISTS public.members_gate (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.members_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.members_gate FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.members_gate TO service_role;

-- Para el dueño (SQL editor o service role). Guarda solo el hash; normaliza como el desbloqueo.
CREATE OR REPLACE FUNCTION public.set_members_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := lower(btrim(coalesce(p_password, '')));
BEGIN
  IF length(v_clean) < 8 THEN
    RAISE EXCEPTION 'La contraseña de Members debe tener al menos 8 caracteres';
  END IF;
  INSERT INTO public.members_gate (id, password_hash, updated_at)
  VALUES (true, extensions.crypt(v_clean, extensions.gen_salt('bf', 10)), now())
  ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_members_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_members_password(text) TO service_role;

CREATE OR REPLACE FUNCTION public.unlock_members_access(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_hash text;
  v_rl jsonb;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;
  -- 10 intentos por hora por usuario: sin esto la contraseña se adivina por fuerza bruta.
  v_rl := public.check_rate_limit('user:' || v_me::text, 'members-unlock:h', 10, 3600);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  END IF;
  SELECT password_hash INTO v_hash FROM public.members_gate WHERE id;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_configurado');
  END IF;
  IF extensions.crypt(lower(btrim(coalesce(p_password, ''))), v_hash) IS DISTINCT FROM v_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contrasena_incorrecta');
  END IF;
  INSERT INTO public.nightlife_access AS na (user_id, confirmed_adult, confirmed_adult_at, password_unlocked, password_unlocked_at)
  VALUES (v_me, true, now(), true, now())
  ON CONFLICT (user_id) DO UPDATE
    SET confirmed_adult = true,
        confirmed_adult_at = coalesce(na.confirmed_adult_at, now()),
        password_unlocked = true,
        password_unlocked_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.unlock_members_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_members_access(text) TO authenticated, service_role;

-- El cliente sigue pudiendo confirmar que es mayor de edad (upsert de confirmed_adult desde
-- Members.tsx), pero password_unlocked solo lo cambia unlock_members_access (que corre como el
-- dueño de la función, no como 'authenticated').
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
  ELSE
    NEW.password_unlocked := OLD.password_unlocked;
    NEW.password_unlocked_at := OLD.password_unlocked_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.nightlife_access_guard_unlock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nightlife_access_guard_unlock ON public.nightlife_access;
CREATE TRIGGER nightlife_access_guard_unlock BEFORE INSERT OR UPDATE ON public.nightlife_access
  FOR EACH ROW EXECUTE FUNCTION public.nightlife_access_guard_unlock();
