-- Tarjetas de rango de IATOS (pedido del dueño, 23-oct-2026): "en el MENÚ PRINCIPAL la tarjeta que
-- tengas dependiendo tu suscripción. Nadie más que Carlo y Rodrigo tienen la NEGRA (creadores y
-- fundadores). AZUL = Free, DORADA = PRO, PLATINUM 1 = Privé, PLATINUM 2 = 1 año de Privé".
--
-- El rango SIEMPRE lo calcula el servidor (my_member_card, solo para auth.uid()); el navegador solo lo
-- pinta. Ningún dato que mande el cliente lo cambia:
--   * founders: quién tiene la negra. Por PERSONA (una persona puede tener varias cuentas). Solo dos
--     personas posibles ('rodrigo', 'carlo'): CHECK + trigger que además impide una tercera persona
--     aunque alguien quite el CHECK, y un máximo de 2 cuentas por persona. RLS sin políticas: solo
--     service_role y migraciones escriben. Esta migración NO trae ningún user_id: las filas las
--     inserta el coordinador al desplegar (ver docs del reporte).
--   * member_card_grants: otorgamiento manual de rango (p. ej. Platinum II a una persona concreta).
--     Nunca 'founder_black' (CHECK). Nunca baja un rango: gana el mayor entre automático y otorgado.
--     Decisión: el otorgamiento se muestra aunque la persona no tenga Privé activo (el dueño lo pidió
--     "ahorita" para dos personas); NO da acceso a Privé, solo cambia la tarjeta.
-- Prioridad: founder_black > platinum_2 > platinum_1 > gold > blue.
--   platinum_2 = Privé vigente (prive_entitled) y ≥ 365 días desde activated_at (la misma antigüedad
--                que muestra THE PRIVÉ PASSPORT; aquí ambos días se cuentan en hora de Ciudad de México, para
--                que el aniversario no se adelante en la noche, cuando en UTC ya es el día siguiente).
--   platinum_1 = Privé vigente.   gold = is_pro (fuente de verdad del PRO).   blue = lo demás.
-- Idempotente.

-- ───────────── Fundadores ─────────────
CREATE TABLE IF NOT EXISTS public.founders (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  person     text NOT NULL,
  note       text CHECK (note IS NULL OR length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.founders DROP CONSTRAINT IF EXISTS founders_person_check;
ALTER TABLE public.founders ADD CONSTRAINT founders_person_check CHECK (person IN ('rodrigo', 'carlo'));
ALTER TABLE public.founders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.founders TO service_role;

-- Tope: como mucho 2 personas distintas y 2 cuentas por persona. Bloquea la tabla para que dos
-- inserciones simultáneas no se salten el conteo. Clientes (anon/authenticated) nunca escriben aquí.
CREATE OR REPLACE FUNCTION public.founders_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_people int; v_accounts int;
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'La tarjeta de fundador no se asigna desde la app' USING ERRCODE = '42501';
  END IF;
  LOCK TABLE public.founders IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(DISTINCT person) INTO v_people
    FROM (SELECT person FROM public.founders WHERE user_id IS DISTINCT FROM NEW.user_id
            AND (TG_OP = 'INSERT' OR user_id IS DISTINCT FROM OLD.user_id)
          UNION ALL SELECT NEW.person) x;
  IF v_people > 2 THEN
    RAISE EXCEPTION 'Solo existen dos fundadores de IATOS: no puede haber una tercera persona' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_accounts FROM public.founders
   WHERE person = NEW.person AND user_id IS DISTINCT FROM NEW.user_id
     AND (TG_OP = 'INSERT' OR user_id IS DISTINCT FROM OLD.user_id);
  IF v_accounts >= 2 THEN
    RAISE EXCEPTION 'Cada fundador puede tener como mucho 2 cuentas' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.founders_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS founders_guard ON public.founders;
CREATE TRIGGER founders_guard BEFORE INSERT OR UPDATE ON public.founders
  FOR EACH ROW EXECUTE FUNCTION public.founders_guard();

-- ───────────── Otorgamientos manuales ─────────────
CREATE TABLE IF NOT EXISTS public.member_card_grants (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier       text NOT NULL,
  reason     text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text
);
ALTER TABLE public.member_card_grants DROP CONSTRAINT IF EXISTS member_card_grants_tier_check;
ALTER TABLE public.member_card_grants ADD CONSTRAINT member_card_grants_tier_check CHECK (tier IN ('platinum_2', 'platinum_1', 'gold'));
ALTER TABLE public.member_card_grants DROP CONSTRAINT IF EXISTS member_card_grants_reason_check;
ALTER TABLE public.member_card_grants ADD CONSTRAINT member_card_grants_reason_check CHECK (length(btrim(reason)) >= 3);
ALTER TABLE public.member_card_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_card_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.member_card_grants TO service_role;

-- Sin políticas: anon y authenticated no leen ni escriben estas tablas (además no tienen GRANT). Las
-- funciones SECURITY DEFINER de abajo las leen como su dueño (RLS no forzada para el dueño).

-- ───────────── Rango ─────────────
CREATE OR REPLACE FUNCTION public.member_card_rank(_tier text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _tier WHEN 'founder_black' THEN 5 WHEN 'platinum_2' THEN 4 WHEN 'platinum_1' THEN 3
                    WHEN 'gold' THEN 2 WHEN 'blue' THEN 1 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.member_card_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_card_rank(text) TO service_role;

-- Número de miembro no sensible para quien no tiene código Privé: IA-XXXX-XXXX derivado del id (mismo
-- alfabeto que IP-XXXX-XXXX, sin 0/O/1/I). Estable, no se guarda y no sirve para entrar a nada.
CREATE OR REPLACE FUNCTION public.member_card_number(_user uuid)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(md5('iatos-member-card:' || _user::text), 'hex');
  v_code text := 'IA-';
  i int;
BEGIN
  FOR i IN 0..7 LOOP
    IF i = 4 THEN v_code := v_code || '-'; END IF;
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.member_card_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_card_number(uuid) TO service_role;

-- Cálculo interno (para cualquier usuario; solo service_role). my_member_card lo llama con auth.uid().
CREATE OR REPLACE FUNCTION public.member_card_for(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m          public.prive_memberships;
  v_founder  boolean;
  v_prive    boolean;
  v_pdays    int;
  v_auto     text;
  v_grant    text;
  v_tier     text;
  v_created  timestamptz;
  v_since    timestamptz;
  v_name     text;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user;
  v_founder := EXISTS (SELECT 1 FROM public.founders f WHERE f.user_id = _user);
  v_prive := public.prive_entitled(_user);
  v_pdays := CASE WHEN v_prive AND m.activated_at IS NOT NULL
                  THEN greatest(0, (now() AT TIME ZONE 'America/Mexico_City')::date - (m.activated_at AT TIME ZONE 'America/Mexico_City')::date) END;
  v_auto := CASE
    WHEN v_founder THEN 'founder_black'
    WHEN v_prive AND coalesce(v_pdays, 0) >= 365 THEN 'platinum_2'
    WHEN v_prive THEN 'platinum_1'
    WHEN public.is_pro(_user) THEN 'gold'
    ELSE 'blue' END;
  SELECT g.tier INTO v_grant FROM public.member_card_grants g WHERE g.user_id = _user;
  v_tier := CASE WHEN v_grant IS NOT NULL AND public.member_card_rank(v_grant) > public.member_card_rank(v_auto)
                 THEN v_grant ELSE v_auto END;
  SELECT coalesce(u.created_at, p.created_at) INTO v_created
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = _user;
  -- "Miembro desde": en Platinum, la activación de Privé (como el Passport); si no, la cuenta.
  v_since := CASE WHEN v_tier IN ('platinum_1', 'platinum_2') AND m.activated_at IS NOT NULL THEN m.activated_at
                  ELSE v_created END;
  v_name := nullif(left(btrim(regexp_replace(coalesce(
              (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = _user),
              (SELECT nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '')
                 FROM auth.users u WHERE u.id = _user), ''), '\s+', ' ', 'g')), 40), '');
  RETURN jsonb_build_object(
    'tier', v_tier,
    'since', v_since,
    'number', coalesce(m.member_code, public.member_card_number(_user)),
    'tenure_days', CASE WHEN v_since IS NOT NULL
                        THEN greatest(0, (now() AT TIME ZONE 'America/Mexico_City')::date - (v_since AT TIME ZONE 'America/Mexico_City')::date) END,
    'prive_days', v_pdays,
    'granted', v_tier IS DISTINCT FROM v_auto,
    'name', v_name);
END $$;
REVOKE ALL ON FUNCTION public.member_card_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_card_for(uuid) TO service_role;

-- Lo que llama la app: SOLO tu tarjeta (auth.uid()); no recibe parámetros.
CREATE OR REPLACE FUNCTION public.my_member_card()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para ver tu tarjeta' USING ERRCODE = '42501';
  END IF;
  RETURN public.member_card_for(v_uid);
END $$;
REVOKE ALL ON FUNCTION public.my_member_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_member_card() TO authenticated, service_role;
