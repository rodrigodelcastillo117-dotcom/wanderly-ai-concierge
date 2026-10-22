-- Avatar que se parece a la persona y evoluciona con sus viajes (grupo avatar-viajes). Idempotente.
--
-- 1) Una sola fuente del avatar: profiles.avatar_url. Antes generate-avatar lo guardaba solo en
--    ai_user_preferences.perfil_ia.avatar_url (y evolucionar-dna lo borraba al reescribir perfil_ia):
--    el encabezado del perfil y Social leían profiles.avatar_url y mostraban la inicial ("R") mientras
--    la tarjeta del Travel DNA sí mostraba la imagen. Aquí se rescata ese avatar huérfano.
-- 2) avatar_profiles: estado del avatar (imagen base privada sin recuerdos, imagen pública actual,
--    parecido medido, versión). Solo el servidor escribe.
-- 3) avatar_variants: las 2 variantes que se ofrecen al crear; viven en un bucket PRIVADO hasta que la
--    persona elige una (las no elegidas se borran). La selfie NUNCA se guarda.
-- 4) avatar_souvenirs: un recuerdo por viaje (idempotente por viaje) = la línea de "Evolución".
-- 5) avatar_image_usage + avatar_take_images(): cupo diario de imágenes por persona (costo acotado).

-- ───── 1) rescate del avatar huérfano ─────
UPDATE public.profiles p
   SET avatar_url = ap.perfil_ia->>'avatar_url'
  FROM public.ai_user_preferences ap
 WHERE ap.user_id = p.id
   AND p.avatar_url IS NULL
   AND ap.perfil_ia ? 'avatar_url'
   AND ap.perfil_ia->>'avatar_url' LIKE 'https://%';

-- ───── bucket privado (imagen base y variantes) ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatar-private', 'avatar-private', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Sin políticas para authenticated/anon en storage.objects de este bucket: solo service_role lo toca
-- y la app recibe enlaces firmados de 15 minutos para ver las variantes.

-- ───── 2) avatar_profiles ─────
CREATE TABLE IF NOT EXISTS public.avatar_profiles (
  user_id        uuid PRIMARY KEY,
  base_path      text CHECK (base_path IS NULL OR base_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]+$'),
  current_url    text CHECK (current_url IS NULL OR current_url LIKE 'https://%'),
  current_path   text,
  likeness_score smallint CHECK (likeness_score IS NULL OR likeness_score BETWEEN 0 AND 100),
  model          text,
  version        integer NOT NULL DEFAULT 0,
  visible_keys   text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ───── 3) avatar_variants ─────
CREATE TABLE IF NOT EXISTS public.avatar_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  storage_path   text NOT NULL UNIQUE,
  model          text,
  likeness_score smallint CHECK (likeness_score IS NULL OR likeness_score BETWEEN 0 AND 100),
  diferencias    text[] NOT NULL DEFAULT '{}',
  origen         text NOT NULL DEFAULT 'selfie' CHECK (origen IN ('selfie', 'rasgos')),
  status         text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'elegida', 'descartada')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_variants_path_own CHECK (storage_path LIKE user_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS idx_avatar_variants_user ON public.avatar_variants (user_id, created_at DESC);

-- ───── 4) avatar_souvenirs ─────
CREATE TABLE IF NOT EXISTS public.avatar_souvenirs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  -- Si el viaje se borra, el recuerdo se queda en la colección (con su nombre) y trip_key evita
  -- que se vuelva a otorgar.
  trip_id        uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  trip_key       text NOT NULL,
  trip_label     text NOT NULL DEFAULT '' CHECK (length(trip_label) <= 200),
  trip_end       date,
  fuente         text NOT NULL DEFAULT 'fin_de_viaje' CHECK (fuente IN ('fin_de_viaje', 'documento', 'retroactivo')),
  souvenir_key   text NOT NULL CHECK (souvenir_key ~ '^(ciudad|pais|generico):[A-Za-z0-9-]{2,40}$'),
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  lugar          text NOT NULL CHECK (length(lugar) BETWEEN 1 AND 120),
  pais           text CHECK (pais IS NULL OR pais ~ '^[A-Z]{2}$'),
  emoji          text NOT NULL DEFAULT '' CHECK (length(emoji) <= 16),
  slot           text NOT NULL DEFAULT 'pin' CHECK (slot IN ('pin', 'dije', 'accesorio')),
  prompt         text NOT NULL DEFAULT '' CHECK (length(prompt) <= 400),
  status         text NOT NULL DEFAULT 'pendiente'
                 CHECK (status IN ('pendiente', 'aplicado', 'repetido', 'sin_avatar', 'sin_cupo', 'fallido')),
  visible        boolean NOT NULL DEFAULT false,
  likeness_score smallint CHECK (likeness_score IS NULL OR likeness_score BETWEEN 0 AND 100),
  model          text,
  attempts       integer NOT NULL DEFAULT 1,
  error          text,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_souvenirs_one_per_trip UNIQUE (user_id, trip_key)
);
CREATE INDEX IF NOT EXISTS idx_avatar_souvenirs_user ON public.avatar_souvenirs (user_id, unlocked_at);

-- ───── 5) cupo diario de imágenes ─────
CREATE TABLE IF NOT EXISTS public.avatar_image_usage (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('crear', 'evolucion')),
  images     smallint NOT NULL CHECK (images BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avatar_image_usage_user ON public.avatar_image_usage (user_id, kind, created_at DESC);

-- ───── RLS: cada quien lee lo suyo; nadie escribe desde la app ─────
ALTER TABLE public.avatar_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avatar_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avatar_souvenirs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avatar_image_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.avatar_profiles, public.avatar_variants, public.avatar_souvenirs, public.avatar_image_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.avatar_profiles, public.avatar_variants, public.avatar_souvenirs, public.avatar_image_usage FROM authenticated;
GRANT SELECT ON public.avatar_profiles, public.avatar_variants, public.avatar_souvenirs TO authenticated;
REVOKE ALL ON public.avatar_image_usage FROM authenticated;
GRANT ALL ON public.avatar_profiles, public.avatar_variants, public.avatar_souvenirs, public.avatar_image_usage TO service_role;

DROP POLICY IF EXISTS avatar_profiles_select_own ON public.avatar_profiles;
CREATE POLICY avatar_profiles_select_own ON public.avatar_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS avatar_variants_select_own ON public.avatar_variants;
CREATE POLICY avatar_variants_select_own ON public.avatar_variants FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS avatar_souvenirs_select_own ON public.avatar_souvenirs;
CREATE POLICY avatar_souvenirs_select_own ON public.avatar_souvenirs FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Reserva hasta p_n imágenes del cupo de 24 h (p_max). Regresa cuántas se permitieron (0..p_n).
-- Candado por persona: dos pestañas al mismo tiempo no rebasan el cupo.
CREATE OR REPLACE FUNCTION public.avatar_take_images(p_user uuid, p_kind text, p_n integer, p_max integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_used integer;
  v_ok integer;
BEGIN
  IF p_user IS NULL OR p_kind NOT IN ('crear', 'evolucion') OR p_n IS NULL OR p_n < 1 OR p_n > 10 OR p_max IS NULL OR p_max < 0 THEN
    RAISE EXCEPTION 'avatar_take_images: parámetros inválidos';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('avatar:' || p_user::text, 0));
  SELECT coalesce(sum(images), 0) INTO v_used
    FROM public.avatar_image_usage
   WHERE user_id = p_user AND kind = p_kind AND created_at > now() - interval '24 hours';
  v_ok := greatest(0, least(p_n, p_max - v_used));
  IF v_ok > 0 THEN
    INSERT INTO public.avatar_image_usage (user_id, kind, images) VALUES (p_user, p_kind, v_ok);
  END IF;
  RETURN v_ok;
END;
$$;
REVOKE ALL ON FUNCTION public.avatar_take_images(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avatar_take_images(uuid, text, integer, integer) TO service_role;

-- Reclama un viaje para darle su recuerdo. Idempotente por (persona, viaje):
--   · primera vez → crea la fila 'pendiente' y regresa su id;
--   · ya resuelto (aplicado, repetido, sin_avatar) → NULL;
--   · pendiente/sin_cupo/fallido con más de 20 min sin cambios y < 4 intentos → se retoma (id);
--   · en proceso por otra corrida → NULL.
-- El viaje tiene que ser de esa persona.
CREATE OR REPLACE FUNCTION public.avatar_claim_trip(p_user uuid, p_trip uuid, p_fuente text, p_souvenir jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t record;
  v_id uuid;
BEGIN
  SELECT id, user_id, destino, coalesce(fecha_regreso, fecha_salida) AS fin INTO t FROM public.trips WHERE id = p_trip;
  IF NOT FOUND OR t.user_id IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'avatar_claim_trip: el viaje no es de esta persona' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.avatar_souvenirs (user_id, trip_id, trip_key, trip_label, trip_end, fuente, souvenir_key, nombre, lugar, pais, emoji, slot, prompt)
  VALUES (p_user, p_trip, p_trip::text, left(coalesce(t.destino, ''), 200), t.fin, coalesce(p_fuente, 'fin_de_viaje'),
          p_souvenir->>'key', p_souvenir->>'nombre', p_souvenir->>'lugar', nullif(p_souvenir->>'pais', ''),
          coalesce(p_souvenir->>'emoji', ''), coalesce(p_souvenir->>'slot', 'pin'), left(coalesce(p_souvenir->>'prompt', ''), 400))
  ON CONFLICT (user_id, trip_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.avatar_souvenirs s
     SET status = 'pendiente', attempts = s.attempts + 1, updated_at = now(), error = NULL,
         souvenir_key = p_souvenir->>'key', nombre = p_souvenir->>'nombre', lugar = p_souvenir->>'lugar',
         pais = nullif(p_souvenir->>'pais', ''), emoji = coalesce(p_souvenir->>'emoji', ''),
         slot = coalesce(p_souvenir->>'slot', 'pin'), prompt = left(coalesce(p_souvenir->>'prompt', ''), 400)
   WHERE s.user_id = p_user AND s.trip_key = p_trip::text
     AND s.status IN ('pendiente', 'sin_cupo', 'fallido')
     AND s.updated_at < now() - interval '20 minutes'
     AND s.attempts < 4
  RETURNING s.id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.avatar_claim_trip(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avatar_claim_trip(uuid, uuid, text, jsonb) TO service_role;

-- Viajes que ya terminaron (últimos 45 días) de personas CON avatar y sin recuerdo resuelto, para la
-- corrida diaria de avatar-evolve. Quien aún no tiene avatar recibe sus recuerdos al crearlo.
CREATE OR REPLACE FUNCTION public.avatar_trips_due(p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, trip_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.user_id, t.id
    FROM public.trips t
    JOIN public.avatar_profiles ap ON ap.user_id = t.user_id AND ap.base_path IS NOT NULL
   WHERE coalesce(t.fecha_regreso, t.fecha_salida) < current_date
     AND coalesce(t.fecha_regreso, t.fecha_salida) >= current_date - 45
     AND NOT EXISTS (
       SELECT 1 FROM public.avatar_souvenirs s
        WHERE s.user_id = t.user_id AND s.trip_key = t.id::text
          AND (s.status IN ('aplicado', 'repetido', 'sin_avatar')
               OR s.updated_at >= now() - interval '20 minutes'
               OR s.attempts >= 4))
   ORDER BY coalesce(t.fecha_regreso, t.fecha_salida) DESC
   LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;
REVOKE ALL ON FUNCTION public.avatar_trips_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avatar_trips_due(integer) TO service_role;
