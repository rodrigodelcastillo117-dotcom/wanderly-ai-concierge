-- Social · perfil de un amigo con su avatar, sus viajes y su actividad (pedido del dueño, 23-oct-2026).
-- Idempotente.
--
-- Qué agrega (todo detrás de amistad ACEPTADA y de lo que cada persona decidió compartir):
--   1. Avatar del amigo: amigos_avatares() devuelve la RUTA del avatar actual (travel-moments/avatars/<id>/…,
--      que solo escribe el servidor) y una política de storage deja que un amigo aceptado pida un enlace
--      FIRMADO de ese objeto, y solo si el dueño no apagó "Mi avatar". amigo_perfil, friend_profiles y
--      solicitudes_amistad también dejan de mandar avatar_url cuando la persona lo apagó.
--   2. Viajes: amigo_viajes() con los viajes pasados (por defecto, con mes y año) y los próximos (solo
--      si la persona lo prende). Nunca precios, presupuesto, documentos, itinerario ni ids de viajes
--      ajenos; un viaje de los dos sale como "Viajaron juntos" (con id y fechas, que los dos ya ven).
--   3. Actividad: reservas confirmadas o marcadas "Ya lo compré" (restaurante, hotel, experiencia),
--      recomendaciones con estrellas, favoritos, lugares visitados y momentos con foto marcados como
--      compartibles. Cada tipo es opt-in (apagado por defecto). Sin precio, sin código de confirmación,
--      sin proveedor, sin horario ni fecha de la reserva, sin notas privadas. La actividad aparece 24 h
--      después de ocurrir y solo con el día (nunca la hora): nadie ve dónde está alguien en vivo.
--   4. Interacción: reacciones (❤️ 🔥 😋, el conteo solo lo ve el dueño), preguntas con respuesta en la
--      actividad y avisos con plantilla fija por el sistema de notificaciones que ya existe.
--   5. Si la amistad termina (quitar, bloquear, borrar cuenta), el acceso se acaba en ese momento (todo
--      se calcula con la amistad vigente) y se borran reacciones, preguntas y sus avisos entre los dos.
-- No existe el concepto "amigos cercanos": todo es para amigos aceptados.
-- Las tablas nuevas no tienen permisos para clientes: todo pasa por las funciones de abajo.

-- ───────────── Tablas ─────────────
CREATE TABLE IF NOT EXISTS public.social_privacidad (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar           boolean NOT NULL DEFAULT true,
  viajes_pasados   boolean NOT NULL DEFAULT true,
  viajes_proximos  boolean NOT NULL DEFAULT false,
  fechas_completas boolean NOT NULL DEFAULT false,
  reservas         boolean NOT NULL DEFAULT false,
  recomendaciones  boolean NOT NULL DEFAULT false,
  favoritos        boolean NOT NULL DEFAULT false,
  visitados        boolean NOT NULL DEFAULT false,
  momentos         boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Lo que la persona escondió una por una (un viaje o una actividad).
CREATE TABLE IF NOT EXISTS public.social_ocultos (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clave      text NOT NULL CHECK (clave ~ '^(viaje|reserva|reco|fav|visita|momento):[0-9a-f-]{36}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clave)
);

CREATE TABLE IF NOT EXISTS public.social_recomendaciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 120),
  ciudad     text CHECK (ciudad IS NULL OR char_length(ciudad) <= 80),
  categoria  text NOT NULL DEFAULT 'lugar' CHECK (categoria IN ('restaurant', 'hotel', 'activity', 'lugar')),
  estrellas  smallint NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  nota       text CHECK (nota IS NULL OR char_length(nota) <= 280),
  place_id   text CHECK (place_id IS NULL OR (char_length(place_id) <= 300 AND place_id ~ '^[A-Za-z0-9_-]{10,}$')),
  photo_ref  text CHECK (photo_ref IS NULL OR photo_ref ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_recomendaciones_user_idx ON public.social_recomendaciones (user_id, created_at DESC);

-- Momentos (fotos privadas ya sin metadatos: travel-moments-private) que la persona marcó compartibles.
CREATE TABLE IF NOT EXISTS public.social_momentos_compartidos (
  moment_id  uuid PRIMARY KEY REFERENCES public.travel_moments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_momentos_user_idx ON public.social_momentos_compartidos (user_id);

-- Reacción de user_id (quien reacciona) a una actividad de owner_id.
CREATE TABLE IF NOT EXISTS public.social_reacciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clave      text NOT NULL,
  emoji      text NOT NULL CHECK (emoji IN ('corazon', 'fuego', 'antojo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_reacciones_no_self CHECK (user_id <> owner_id),
  CONSTRAINT social_reacciones_unica UNIQUE (user_id, owner_id, clave)
);
CREATE INDEX IF NOT EXISTS social_reacciones_owner_idx ON public.social_reacciones (owner_id, clave);

-- Pregunta de user_id sobre una actividad de owner_id; solo owner_id responde.
CREATE TABLE IF NOT EXISTS public.social_preguntas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clave         text NOT NULL,
  pregunta      text NOT NULL CHECK (char_length(btrim(pregunta)) BETWEEN 2 AND 280),
  respuesta     text CHECK (respuesta IS NULL OR char_length(btrim(respuesta)) BETWEEN 1 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  respondida_at timestamptz,
  CONSTRAINT social_preguntas_no_self CHECK (user_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS social_preguntas_owner_idx ON public.social_preguntas (owner_id, clave, created_at);
CREATE INDEX IF NOT EXISTS social_preguntas_user_idx ON public.social_preguntas (user_id, owner_id);

ALTER TABLE public.social_privacidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_ocultos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_recomendaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_momentos_compartidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_reacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_preguntas ENABLE ROW LEVEL SECURITY;
-- Sin políticas: los clientes no leen ni escriben estas tablas directamente.
REVOKE ALL ON public.social_privacidad, public.social_ocultos, public.social_recomendaciones,
  public.social_momentos_compartidos, public.social_reacciones, public.social_preguntas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_privacidad, public.social_ocultos, public.social_recomendaciones,
  public.social_momentos_compartidos, public.social_reacciones, public.social_preguntas TO service_role;

-- ───────────── Ayudantes internos (sin permiso para clientes) ─────────────
-- ¿La persona comparte este tipo? Sin fila: avatar y viajes pasados sí; lo demás no.
CREATE OR REPLACE FUNCTION public._social_pref(p_user uuid, p_tipo text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_tipo IN ('avatar', 'viajes_pasados', 'viajes_proximos', 'fechas_completas', 'reservas',
                    'recomendaciones', 'favoritos', 'visitados', 'momentos')
     AND coalesce((SELECT (to_jsonb(s) ->> p_tipo)::boolean FROM public.social_privacidad s WHERE s.user_id = p_user),
                  p_tipo IN ('avatar', 'viajes_pasados'));
$$;

CREATE OR REPLACE FUNCTION public._social_puede_ver(p_viewer uuid, p_owner uuid, p_tipo text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public._social_son_amigos(p_viewer, p_owner) AND public._social_pref(p_owner, p_tipo);
$$;

CREATE OR REPLACE FUNCTION public._social_ajustes(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'avatar', public._social_pref(p_user, 'avatar'),
    'viajes_pasados', public._social_pref(p_user, 'viajes_pasados'),
    'viajes_proximos', public._social_pref(p_user, 'viajes_proximos'),
    'fechas_completas', public._social_pref(p_user, 'fechas_completas'),
    'reservas', public._social_pref(p_user, 'reservas'),
    'recomendaciones', public._social_pref(p_user, 'recomendaciones'),
    'favoritos', public._social_pref(p_user, 'favoritos'),
    'visitados', public._social_pref(p_user, 'visitados'),
    'momentos', public._social_pref(p_user, 'momentos'));
$$;

-- Imagen que se puede mandar a un amigo: solo de proveedores conocidos o de nuestro storage público
-- (una URL cualquiera puesta a mano serviría para rastrear la IP y la hora de quien la abre).
CREATE OR REPLACE FUNCTION public._social_img_segura(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN length(p) <= 1000 AND (
      p ~ '^https://([A-Za-z0-9-]+\.)*(pexels\.com|googleusercontent\.com|ggpht\.com|gstatic\.com|tripadvisor\.com|bstatic\.com)/[^[:space:]"''<>]*$'
      OR p ~ '^https://uhkdewinscffhdonhhmt\.supabase\.co/storage/v1/object/public/[^[:space:]"''<>]*$')
    THEN p END;
$$;

-- Texto para un aviso: sin puntos, diagonales ni signos que formen enlaces; espacios colapsados.
CREATE OR REPLACE FUNCTION public._social_texto_aviso(p text, n int DEFAULT 60)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[^[:alnum:][:space:]À-ÖØ-öø-ÿ,''&()-]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$$;

-- Ruta del avatar ACTUAL de la persona en travel-moments (avatars/<id>/<archivo>). Esa carpeta solo la
-- escribe el servidor (la política de subida exige que la primera carpeta sea el id de quien sube).
CREATE OR REPLACE FUNCTION public._social_avatar_path(p_user uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.p FROM (
    SELECT coalesce(
      (SELECT ap.current_path FROM public.avatar_profiles ap
        WHERE ap.user_id = p_user AND ap.current_path ~ ('^avatars/' || p_user::text || '/[A-Za-z0-9._-]+$')),
      (SELECT substring(pr.avatar_url FROM '/storage/v1/object/(?:public|sign|authenticated)/travel-moments/(avatars/' || p_user::text || '/[A-Za-z0-9._-]+)')
         FROM public.profiles pr WHERE pr.id = p_user),
      (SELECT substring(up.perfil_ia ->> 'avatar_url' FROM '/storage/v1/object/(?:public|sign|authenticated)/travel-moments/(avatars/' || p_user::text || '/[A-Za-z0-9._-]+)')
         FROM public.ai_user_preferences up WHERE up.user_id = p_user)) AS p
  ) x
  WHERE x.p IS NOT NULL AND x.p !~ '\.\.';
$$;

-- Toda la actividad de una persona. p_todo = vista de la propia persona (todo, aunque esté apagado,
-- escondido o tenga menos de 24 h); si no, solo lo que comparte con sus amigos.
CREATE OR REPLACE FUNCTION public._social_items(p_owner uuid, p_todo boolean)
RETURNS TABLE (clave text, tipo text, fecha timestamptz, item jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH x AS (
    -- Reservas confirmadas o marcadas "Ya lo compré" (no los clics a un socio, que quedan "pending").
    SELECT 'reserva:' || b.id::text AS clave, 'reserva'::text AS tipo, b.created_at AS fecha,
           jsonb_build_object('categoria', b.category, 'titulo', left(b.title, 120), 'ciudad', left(b.city, 60),
                              'pais', left(b.country, 60), 'imagen', public._social_img_segura(b.image_url)) AS item
      FROM public.bookings b
     WHERE b.user_id = p_owner AND (p_todo OR public._social_pref(p_owner, 'reservas'))
       AND b.category IN ('restaurant', 'hotel', 'activity')
       AND (b.status = 'confirmed' OR (b.status = 'pending' AND b.raw_payload ->> 'marcado_por_usuario' = 'true'))
    UNION ALL
    SELECT 'reco:' || r.id::text, 'recomendacion', r.created_at,
           jsonb_build_object('categoria', r.categoria, 'titulo', r.nombre, 'ciudad', r.ciudad, 'estrellas', r.estrellas,
                              'nota', r.nota, 'place_id', r.place_id, 'photo_ref', r.photo_ref)
      FROM public.social_recomendaciones r
     WHERE r.user_id = p_owner AND (p_todo OR public._social_pref(p_owner, 'recomendaciones'))
    UNION ALL
    SELECT 'fav:' || f.id::text, 'favorito', f.created_at,
           jsonb_build_object('categoria', CASE WHEN f.tipo = 'destination_ai' THEN 'destino' ELSE 'lugar' END,
                              'titulo', left(btrim(f.titulo), 120),
                              'pais', CASE WHEN f.tipo = 'destination_ai' THEN left(f.descripcion, 60) END,
                              'imagen', public._social_img_segura(f.imagen_url))
      FROM public.recomendaciones f
     WHERE f.user_id = p_owner AND f.guardado IS TRUE AND nullif(btrim(f.titulo), '') IS NOT NULL
       AND (p_todo OR public._social_pref(p_owner, 'favoritos'))
    UNION ALL
    SELECT 'visita:' || v.id::text, 'visitado', v.visited_at,
           jsonb_build_object('categoria', CASE WHEN v.cuisine IS NOT NULL OR 'restaurant' = ANY (coalesce(v.types, '{}')) THEN 'restaurant' ELSE 'lugar' END,
                              'titulo', left(v.name, 120), 'cocina', left(v.cuisine, 40),
                              'place_id', CASE WHEN char_length(v.place_id) <= 300 AND v.place_id ~ '^[A-Za-z0-9_-]{10,}$' THEN v.place_id END,
                              'photo_ref', CASE WHEN v.photo_ref ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$' THEN v.photo_ref END)
      FROM public.visited_places v
     WHERE v.user_id = p_owner AND v.status = 'visited' AND (p_todo OR public._social_pref(p_owner, 'visitados'))
    UNION ALL
    -- Solo momentos de la carpeta privada (JPEG ya sin EXIF/GPS); los viejos con URL pública, no.
    SELECT 'momento:' || m.id::text, 'momento', m.created_at,
           jsonb_build_object('titulo', left(coalesce(nullif(btrim(m.place_name), ''), nullif(btrim(m.destino), ''), nullif(btrim(m.trip_name), ''), 'Momento del viaje'), 120),
                              'ciudad', left(m.destino, 60), 'nota', left(m.caption, 280), 'foto_path', m.image_path)
      FROM public.travel_moments m
      JOIN public.social_momentos_compartidos s ON s.moment_id = m.id AND s.user_id = m.user_id
     WHERE m.user_id = p_owner AND m.image_path IS NOT NULL AND (p_todo OR public._social_pref(p_owner, 'momentos'))
  )
  SELECT x.clave, x.tipo, x.fecha, x.item FROM x
   WHERE p_todo OR (
     x.fecha < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.social_ocultos o WHERE o.user_id = p_owner AND o.clave = x.clave));
$$;

-- Lo que ve quien NO es el dueño de un elemento: el elemento, su reacción y sus preguntas (no las de otros).
CREATE OR REPLACE FUNCTION public._social_item_para(p_viewer uuid, p_owner uuid, p_clave text, p_tipo text, p_fecha timestamptz, p_item jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_item || jsonb_build_object(
    'clave', p_clave, 'tipo', p_tipo, 'fecha', to_char(p_fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'mi_reaccion', (SELECT r.emoji FROM public.social_reacciones r WHERE r.user_id = p_viewer AND r.owner_id = p_owner AND r.clave = p_clave),
    'mis_preguntas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'pregunta', q.pregunta, 'respuesta', q.respuesta,
                                                                  'fecha', to_char(q.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) ORDER BY q.created_at)
                                 FROM public.social_preguntas q
                                WHERE q.user_id = p_viewer AND q.owner_id = p_owner AND q.clave = p_clave), '[]'::jsonb));
$$;

-- ¿Ese elemento de p_owner lo puede ver hoy p_viewer? (Para reaccionar o preguntar.)
CREATE OR REPLACE FUNCTION public._social_item_visible(p_viewer uuid, p_owner uuid, p_clave text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN public._social_son_amigos(p_viewer, p_owner) THEN
    (SELECT jsonb_build_object('tipo', i.tipo, 'titulo', i.item ->> 'titulo') FROM public._social_items(p_owner, false) i WHERE i.clave = p_clave LIMIT 1)
  END;
$$;

REVOKE ALL ON FUNCTION public._social_pref(uuid, text), public._social_puede_ver(uuid, uuid, text), public._social_ajustes(uuid),
  public._social_img_segura(text), public._social_texto_aviso(text, int), public._social_avatar_path(uuid),
  public._social_items(uuid, boolean), public._social_item_para(uuid, uuid, text, text, timestamptz, jsonb),
  public._social_item_visible(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ───────────── Storage: enlaces firmados para amigos ─────────────
-- La usan las políticas de abajo (corren como el usuario que pide el enlace). Solo responde sí/no por
-- el propio auth.uid(): avatar ACTUAL de un amigo que no lo apagó, o foto de un momento que el amigo
-- marcó compartible (con "Momentos" prendido, no escondido y de hace más de 24 h).
CREATE OR REPLACE FUNCTION public.social_puede_ver_objeto(p_bucket text, p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_parts text[];
  v_owner uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_me IS NULL OR p_name IS NULL OR p_name ~ '\.\.' THEN RETURN false; END IF;
  v_parts := string_to_array(p_name, '/');
  IF p_bucket = 'travel-moments' THEN
    IF coalesce(array_length(v_parts, 1), 0) <> 3 OR v_parts[1] <> 'avatars' OR v_parts[2] !~ uuid_re THEN RETURN false; END IF;
    v_owner := v_parts[2]::uuid;
    RETURN v_owner <> v_me AND public._social_puede_ver(v_me, v_owner, 'avatar')
       AND p_name = public._social_avatar_path(v_owner);
  ELSIF p_bucket = 'travel-moments-private' THEN
    IF coalesce(array_length(v_parts, 1), 0) <> 2 OR v_parts[1] !~ uuid_re THEN RETURN false; END IF;
    v_owner := v_parts[1]::uuid;
    IF v_owner = v_me OR NOT public._social_son_amigos(v_me, v_owner) THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM public._social_items(v_owner, false) i
                    WHERE i.tipo = 'momento' AND i.item ->> 'foto_path' = p_name);
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.social_puede_ver_objeto(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_puede_ver_objeto(text, text) TO authenticated;

DROP POLICY IF EXISTS social_amigos_avatar_select ON storage.objects;
CREATE POLICY social_amigos_avatar_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'travel-moments' AND (storage.foldername(name))[1] = 'avatars'
         AND public.social_puede_ver_objeto(bucket_id, name));
DROP POLICY IF EXISTS social_amigos_momento_select ON storage.objects;
CREATE POLICY social_amigos_momento_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'travel-moments-private' AND public.social_puede_ver_objeto(bucket_id, name));

-- ───────────── Avatares de amigos ─────────────
-- [{id, path}] de los amigos aceptados (o de p_ids, si se pasa) que tienen avatar y no lo apagaron.
-- La app pide con su sesión el enlace firmado de travel-moments/<path> (la política de arriba lo permite).
CREATE OR REPLACE FUNCTION public.amigos_avatares(p_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'bucket', 'travel-moments', 'path', a.path) ORDER BY a.id), '[]'::jsonb)
    FROM (
      SELECT f.amigo AS id, public._social_avatar_path(f.amigo) AS path
        FROM (SELECT DISTINCT CASE WHEN fr.requester_id = auth.uid() THEN fr.addressee_id ELSE fr.requester_id END AS amigo
                FROM public.friendships fr
               WHERE auth.uid() IS NOT NULL AND fr.status = 'accepted'
                 AND (fr.requester_id = auth.uid() OR fr.addressee_id = auth.uid())) f
       WHERE (p_ids IS NULL OR f.amigo = ANY (p_ids[1:200]))
         AND public._social_pref(f.amigo, 'avatar')
       LIMIT 200
    ) a
   WHERE a.path IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.amigos_avatares(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigos_avatares(uuid[]) TO authenticated;

-- friend_profiles (F-10) respeta "Mi avatar": si la persona lo apagó, avatar_url sale vacío.
CREATE OR REPLACE FUNCTION public.friend_profiles(p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, full_name text, username text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.username, CASE WHEN public._social_pref(p.id, 'avatar') THEN p.avatar_url END
    FROM public.profiles p
   WHERE auth.uid() IS NOT NULL
     AND p.id <> auth.uid()
     AND (p_ids IS NULL OR p.id = ANY (p_ids))
     AND EXISTS (
       SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = auth.uid() AND f.addressee_id = p.id)
            OR (f.addressee_id = auth.uid() AND f.requester_id = p.id))
     )
   ORDER BY p.full_name NULLS LAST, p.id;
$$;
REVOKE ALL ON FUNCTION public.friend_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_profiles(uuid[]) TO authenticated, service_role;

-- solicitudes_amistad: igual que en 20261026110000, pero el avatar de quien pide respeta "Mi avatar".
CREATE OR REPLACE FUNCTION public.solicitudes_amistad()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('recibidas', '[]'::jsonb, 'enviadas', '[]'::jsonb, 'bloqueados', '[]'::jsonb)
  ELSE jsonb_build_object(
    'recibidas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', left(p.full_name, 80), 'username', left(p.username, 40),
                                          'avatar_url', CASE WHEN public._social_pref(p.id, 'avatar') THEN p.avatar_url END,
                                          'created_at', f.created_at) ORDER BY f.created_at DESC)
        FROM public.friendships f JOIN public.profiles p ON p.id = f.requester_id
       WHERE f.addressee_id = auth.uid() AND f.status = 'pending'), '[]'::jsonb),
    'enviadas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.addressee_id, 'created_at', f.created_at) ORDER BY f.created_at DESC)
        FROM public.friendships f
       WHERE f.requester_id = auth.uid() AND f.status = 'pending'), '[]'::jsonb),
    'bloqueados', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.addressee_id, 'nombre', public._social_nombre_seguro(f.addressee_id)) ORDER BY f.updated_at DESC)
        FROM public.friendships f
       WHERE f.requester_id = auth.uid() AND f.status = 'blocked'), '[]'::jsonb))
  END;
$$;
REVOKE ALL ON FUNCTION public.solicitudes_amistad() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitudes_amistad() TO authenticated;

-- amigo_perfil: igual que en 20261024140000, salvo que avatar_url respeta "Mi avatar".
CREATE OR REPLACE FUNCTION public.amigo_perfil(p_amigo uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_prof record; v_pref record; v_tp record;
  v_desde timestamptz;
  v_viajes jsonb; v_total int;
  v_lugares jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_amigo = v_me THEN RETURN jsonb_build_object('ok', false, 'error', 'eres_tu'); END IF;
  IF NOT public._social_son_amigos(v_me, p_amigo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'privado');
  END IF;

  SELECT id, full_name, username, avatar_url, ciudad_origen, pais_origen INTO v_prof
    FROM public.profiles WHERE id = p_amigo;
  IF v_prof.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'privado'); END IF;
  SELECT ritmo_viaje, estilo_comida, actividades_tarde, hospedaje_preferencias, perfil_ia INTO v_pref
    FROM public.ai_user_preferences WHERE user_id = p_amigo;
  SELECT perfil_ia INTO v_tp FROM public.travel_profiles WHERE user_id = p_amigo;
  SELECT min(f.created_at) INTO v_desde FROM public.friendships f
   WHERE f.status = 'accepted'
     AND ((f.requester_id = v_me AND f.addressee_id = p_amigo) OR (f.requester_id = p_amigo AND f.addressee_id = v_me));

  SELECT count(*) INTO v_total FROM public._social_shared_trip_ids(v_me, p_amigo);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'destino', t.destino, 'pais_destino', t.pais_destino,
           'fecha_salida', t.fecha_salida, 'fecha_regreso', t.fecha_regreso,
           'cover_image_url', t.cover_image_url, 'status', t.status)
         ORDER BY t.fecha_salida DESC NULLS LAST, t.created_at DESC), '[]'::jsonb)
    INTO v_viajes
    FROM (SELECT tr.* FROM public.trips tr
           WHERE tr.id IN (SELECT trip_id FROM public._social_shared_trip_ids(v_me, p_amigo))
           ORDER BY tr.fecha_salida DESC NULLS LAST, tr.created_at DESC LIMIT 50) t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('ciudad', l.ciudad, 'pais', l.pais)), '[]'::jsonb)
    INTO v_lugares FROM public._social_lugares(p_amigo) l;

  RETURN jsonb_build_object(
    'ok', true,
    'amigo', jsonb_build_object(
      'id', v_prof.id, 'full_name', v_prof.full_name, 'username', v_prof.username,
      'avatar_url', CASE WHEN public._social_pref(p_amigo, 'avatar') THEN v_prof.avatar_url END,
      'ciudad_origen', v_prof.ciudad_origen, 'pais_origen', v_prof.pais_origen,
      'is_prive', public._social_is_prive(p_amigo)),
    'yo_prive', public._social_is_prive(v_me),
    'amigos_desde', v_desde,
    'dna', jsonb_build_object(
      'estilo', left(nullif(trim(coalesce(v_pref.perfil_ia->>'estilo_dominante', v_tp.perfil_ia->>'estilo_dominante')), ''), 60),
      'ritmo', v_pref.ritmo_viaje,
      'comida', to_jsonb(public._social_clean(v_pref.estilo_comida)),
      'tardes', to_jsonb(public._social_clean(v_pref.actividades_tarde)),
      'hospedaje', to_jsonb(public._social_clean(v_pref.hospedaje_preferencias))),
    'en_comun', public._social_en_comun(v_me, p_amigo),
    'viajes_juntos', v_viajes,
    'viajes_juntos_total', v_total,
    'lugares', v_lugares,
    'saludos', public._social_saludos(v_me, p_amigo));
END $$;
REVOKE ALL ON FUNCTION public.amigo_perfil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigo_perfil(uuid) TO authenticated;

-- ───────────── Viajes de un amigo ─────────────
CREATE OR REPLACE FUNCTION public._social_viajes(p_owner uuid, p_viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (
    SELECT tr.*,
           (p_viewer IS NOT NULL AND tr.id IN (SELECT s.trip_id FROM public._social_shared_trip_ids(p_owner, p_viewer) s)) AS juntos,
           CASE
             WHEN tr.fecha_regreso IS NOT NULL AND tr.fecha_regreso < current_date THEN 'pasado'
             WHEN tr.fecha_regreso IS NULL AND tr.fecha_salida IS NOT NULL AND tr.fecha_salida < current_date THEN 'pasado'
             WHEN tr.fecha_salida IS NULL AND tr.realizado THEN 'pasado'
             WHEN tr.fecha_salida IS NULL THEN 'sin_fecha'
             WHEN tr.fecha_salida <= current_date THEN 'en_curso'
             ELSE 'proximo'
           END AS fase,
           EXISTS (SELECT 1 FROM public.social_ocultos o WHERE o.user_id = p_owner AND o.clave = 'viaje:' || tr.id::text) AS oculto
      FROM public.trips tr
     WHERE tr.id IN (SELECT x.trip_id FROM public._social_trip_ids(p_owner) x)
  ), v AS (
    SELECT t.* FROM t
     WHERE t.fase <> 'sin_fecha'
       AND (p_viewer IS NULL OR t.juntos OR (NOT t.oculto AND (
              (t.fase = 'pasado' AND public._social_pref(p_owner, 'viajes_pasados'))
           OR (t.fase IN ('proximo', 'en_curso') AND public._social_pref(p_owner, 'viajes_proximos')))))
     ORDER BY t.fecha_salida DESC NULLS LAST, t.created_at DESC
     LIMIT 60
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', CASE WHEN p_viewer IS NULL OR v.juntos THEN v.id END,
      'clave', CASE WHEN p_viewer IS NULL OR v.juntos THEN v.id::text ELSE md5(p_viewer::text || v.id::text) END,
      'destino', left(v.destino, 80),
      'paises', coalesce((SELECT jsonb_agg(DISTINCT left(btrim(pp), 60)) FROM unnest(regexp_split_to_array(coalesce(v.pais_destino, ''), '\s*[,·/]\s*')) pp WHERE btrim(pp) <> ''), '[]'::jsonb),
      'portada', public._social_img_segura(v.cover_image_url),
      'fase', v.fase,
      'juntos', v.juntos,
      'oculto', CASE WHEN p_viewer IS NULL THEN v.oculto END,
      'mes_salida', to_char(v.fecha_salida, 'YYYY-MM'),
      'mes_regreso', to_char(v.fecha_regreso, 'YYYY-MM'),
      'fecha_salida', CASE WHEN p_viewer IS NULL OR v.juntos OR public._social_pref(p_owner, 'fechas_completas') THEN v.fecha_salida END,
      'fecha_regreso', CASE WHEN p_viewer IS NULL OR v.juntos OR public._social_pref(p_owner, 'fechas_completas') THEN v.fecha_regreso END)
    ORDER BY v.fecha_salida DESC NULLS LAST, v.created_at DESC), '[]'::jsonb)
    FROM v;
$$;
REVOKE ALL ON FUNCTION public._social_viajes(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amigo_viajes(p_amigo uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_amigo IS NULL OR NOT public._social_son_amigos(v_me, p_amigo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'privado');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'comparte', jsonb_build_object('pasados', public._social_pref(p_amigo, 'viajes_pasados'),
                                   'proximos', public._social_pref(p_amigo, 'viajes_proximos'),
                                   'fechas_completas', public._social_pref(p_amigo, 'fechas_completas')),
    'viajes', public._social_viajes(p_amigo, v_me));
END $$;
REVOKE ALL ON FUNCTION public.amigo_viajes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigo_viajes(uuid) TO authenticated;

-- ───────────── Actividad de un amigo y de todos los amigos ─────────────
CREATE OR REPLACE FUNCTION public.amigo_actividad(p_amigo uuid, p_limite int DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid(); v_aj jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_amigo IS NULL OR NOT public._social_son_amigos(v_me, p_amigo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'privado');
  END IF;
  v_aj := public._social_ajustes(p_amigo);
  RETURN jsonb_build_object('ok', true,
    'comparte', jsonb_build_object('reservas', v_aj->'reservas', 'recomendaciones', v_aj->'recomendaciones',
                                   'favoritos', v_aj->'favoritos', 'visitados', v_aj->'visitados', 'momentos', v_aj->'momentos'),
    'items', coalesce((
      SELECT jsonb_agg(public._social_item_para(v_me, p_amigo, i.clave, i.tipo, i.fecha, i.item) ORDER BY i.fecha DESC)
        FROM (SELECT * FROM public._social_items(p_amigo, false) ORDER BY fecha DESC
               LIMIT least(greatest(coalesce(p_limite, 40), 1), 100)) i), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.amigo_actividad(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigo_actividad(uuid, int) TO authenticated;

-- "Lo que hacen tus amigos": lo compartido por todos tus amigos aceptados, del más reciente al más viejo.
CREATE OR REPLACE FUNCTION public.amigos_actividad(p_limite int DEFAULT 40)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(z.j ORDER BY z.fecha DESC) FROM (
      SELECT public._social_item_para(auth.uid(), f.amigo, i.clave, i.tipo, i.fecha, i.item)
               || jsonb_build_object('amigo', jsonb_build_object('id', f.amigo, 'nombre', public._social_nombre_seguro(f.amigo))) AS j,
             i.fecha
        FROM (SELECT DISTINCT CASE WHEN fr.requester_id = auth.uid() THEN fr.addressee_id ELSE fr.requester_id END AS amigo
                FROM public.friendships fr
               WHERE fr.status = 'accepted' AND (fr.requester_id = auth.uid() OR fr.addressee_id = auth.uid())
               LIMIT 200) f
        CROSS JOIN LATERAL (SELECT * FROM public._social_items(f.amigo, false) ORDER BY fecha DESC LIMIT 20) i
       ORDER BY i.fecha DESC
       LIMIT least(greatest(coalesce(p_limite, 40), 1), 100)) z), '[]'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION public.amigos_actividad(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigos_actividad(int) TO authenticated;

-- ───────────── Mis ajustes ("Qué ven mis amigos") ─────────────
CREATE OR REPLACE FUNCTION public.mi_privacidad_social()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('ok', false, 'error', 'no_autenticado')
  ELSE jsonb_build_object('ok', true, 'ajustes', public._social_ajustes(auth.uid()),
                          'guardado', EXISTS (SELECT 1 FROM public.social_privacidad s WHERE s.user_id = auth.uid())) END;
$$;
REVOKE ALL ON FUNCTION public.mi_privacidad_social() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_privacidad_social() TO authenticated;

CREATE OR REPLACE FUNCTION public.guardar_privacidad_social(p_ajustes jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_cur jsonb;
  k text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_ajustes IS NULL OR jsonb_typeof(p_ajustes) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'error', 'ajustes_invalidos'); END IF;
  v_cur := public._social_ajustes(v_me);
  FOR k IN SELECT jsonb_object_keys(p_ajustes) LOOP
    IF NOT v_cur ? k OR jsonb_typeof(p_ajustes -> k) <> 'boolean' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ajustes_invalidos');
    END IF;
  END LOOP;
  v_cur := v_cur || p_ajustes;
  INSERT INTO public.social_privacidad AS s (user_id, avatar, viajes_pasados, viajes_proximos, fechas_completas, reservas,
                                             recomendaciones, favoritos, visitados, momentos, updated_at)
  VALUES (v_me, (v_cur->>'avatar')::boolean, (v_cur->>'viajes_pasados')::boolean, (v_cur->>'viajes_proximos')::boolean,
          (v_cur->>'fechas_completas')::boolean, (v_cur->>'reservas')::boolean, (v_cur->>'recomendaciones')::boolean,
          (v_cur->>'favoritos')::boolean, (v_cur->>'visitados')::boolean, (v_cur->>'momentos')::boolean, now())
  ON CONFLICT (user_id) DO UPDATE SET
    avatar = EXCLUDED.avatar, viajes_pasados = EXCLUDED.viajes_pasados, viajes_proximos = EXCLUDED.viajes_proximos,
    fechas_completas = EXCLUDED.fechas_completas, reservas = EXCLUDED.reservas, recomendaciones = EXCLUDED.recomendaciones,
    favoritos = EXCLUDED.favoritos, visitados = EXCLUDED.visitados, momentos = EXCLUDED.momentos, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'ajustes', public._social_ajustes(v_me));
END $$;
REVOKE ALL ON FUNCTION public.guardar_privacidad_social(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_privacidad_social(jsonb) TO authenticated;

-- Mi actividad tal como la ven mis amigos: cada elemento con "visible" (y desde cuándo), escondido,
-- conteo de reacciones y las preguntas que me hicieron (con el nombre de pila de quien pregunta).
CREATE OR REPLACE FUNCTION public.mi_actividad_social(p_limite int DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  RETURN jsonb_build_object('ok', true, 'ajustes', public._social_ajustes(v_me),
    'items', coalesce((
      SELECT jsonb_agg(i.item || jsonb_build_object(
               'clave', i.clave, 'tipo', i.tipo, 'fecha', to_char(i.fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               'oculto', EXISTS (SELECT 1 FROM public.social_ocultos o WHERE o.user_id = v_me AND o.clave = i.clave),
               'tipo_compartido', public._social_pref(v_me, CASE i.tipo WHEN 'reserva' THEN 'reservas' WHEN 'recomendacion' THEN 'recomendaciones'
                                                           WHEN 'favorito' THEN 'favoritos' WHEN 'visitado' THEN 'visitados' ELSE 'momentos' END),
               'visible_desde', CASE WHEN i.fecha >= now() - interval '24 hours' THEN to_char((i.fecha + interval '24 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
               'reacciones', jsonb_build_object(
                 'corazon', (SELECT count(*) FROM public.social_reacciones r WHERE r.owner_id = v_me AND r.clave = i.clave AND r.emoji = 'corazon'),
                 'fuego', (SELECT count(*) FROM public.social_reacciones r WHERE r.owner_id = v_me AND r.clave = i.clave AND r.emoji = 'fuego'),
                 'antojo', (SELECT count(*) FROM public.social_reacciones r WHERE r.owner_id = v_me AND r.clave = i.clave AND r.emoji = 'antojo')),
               'preguntas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'de', public._social_nombre_seguro(q.user_id),
                                                    'pregunta', q.pregunta, 'respuesta', q.respuesta,
                                                    'fecha', to_char(q.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) ORDER BY q.created_at)
                                        FROM public.social_preguntas q WHERE q.owner_id = v_me AND q.clave = i.clave), '[]'::jsonb))
             ORDER BY i.fecha DESC)
        FROM (SELECT * FROM public._social_items(v_me, true) ORDER BY fecha DESC
               LIMIT least(greatest(coalesce(p_limite, 60), 1), 150)) i), '[]'::jsonb),
    'viajes', public._social_viajes(v_me, NULL),
    'momentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'foto_path', m.image_path,
                                          'titulo', left(coalesce(nullif(btrim(m.place_name), ''), nullif(btrim(m.destino), ''), nullif(btrim(m.trip_name), ''), 'Momento'), 80),
                                          'compartido', EXISTS (SELECT 1 FROM public.social_momentos_compartidos s WHERE s.moment_id = m.id))
                       ORDER BY m.created_at DESC)
        FROM (SELECT * FROM public.travel_moments WHERE user_id = v_me AND image_path IS NOT NULL ORDER BY created_at DESC LIMIT 24) m), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mi_actividad_social(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_actividad_social(int) TO authenticated;

-- Esconder (o volver a mostrar) un viaje o una actividad PROPIA.
CREATE OR REPLACE FUNCTION public.ocultar_social(p_clave text, p_ocultar boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_clave IS NULL OR p_clave !~ '^(viaje|reserva|reco|fav|visita|momento):[0-9a-f-]{36}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_existe');
  END IF;
  IF p_clave LIKE 'viaje:%' THEN
    IF NOT EXISTS (SELECT 1 FROM public._social_trip_ids(v_me) x WHERE 'viaje:' || x.trip_id::text = p_clave) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_existe');
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public._social_items(v_me, true) i WHERE i.clave = p_clave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_existe');
  END IF;
  IF coalesce(p_ocultar, true) THEN
    INSERT INTO public.social_ocultos (user_id, clave) VALUES (v_me, p_clave) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.social_ocultos WHERE user_id = v_me AND clave = p_clave;
  END IF;
  RETURN jsonb_build_object('ok', true, 'oculto', coalesce(p_ocultar, true));
END $$;
REVOKE ALL ON FUNCTION public.ocultar_social(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ocultar_social(text, boolean) TO authenticated;

-- Marcar un momento PROPIO (foto privada, sin metadatos) como compartible con amigos.
CREATE OR REPLACE FUNCTION public.compartir_momento_social(p_moment uuid, p_compartir boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.travel_moments m WHERE m.id = p_moment AND m.user_id = v_me AND m.image_path IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_existe');
  END IF;
  IF coalesce(p_compartir, true) THEN
    INSERT INTO public.social_momentos_compartidos (moment_id, user_id) VALUES (p_moment, v_me) ON CONFLICT (moment_id) DO NOTHING;
  ELSE
    DELETE FROM public.social_momentos_compartidos WHERE moment_id = p_moment AND user_id = v_me;
  END IF;
  RETURN jsonb_build_object('ok', true, 'compartido', coalesce(p_compartir, true));
END $$;
REVOKE ALL ON FUNCTION public.compartir_momento_social(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compartir_momento_social(uuid, boolean) TO authenticated;

-- Recomendar un lugar (estrellas y una nota corta). 30 al día.
CREATE OR REPLACE FUNCTION public.recomendar_lugar(p_nombre text, p_estrellas int, p_categoria text DEFAULT 'lugar',
  p_ciudad text DEFAULT NULL, p_nota text DEFAULT NULL, p_place_id text DEFAULT NULL, p_photo_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rl jsonb;
  v_id uuid;
  v_nombre text := left(btrim(regexp_replace(coalesce(p_nombre, ''), '[[:cntrl:]]', ' ', 'g')), 120);
  v_nota text := nullif(left(btrim(regexp_replace(coalesce(p_nota, ''), '[[:cntrl:]]', ' ', 'g')), 280), '');
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF char_length(v_nombre) < 2 OR p_estrellas IS NULL OR p_estrellas NOT BETWEEN 1 AND 5
     OR coalesce(p_categoria, 'lugar') NOT IN ('restaurant', 'hotel', 'activity', 'lugar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'datos_invalidos');
  END IF;
  v_rl := public.check_rate_limit(v_me::text, 'recomendar_lugar', 30, 86400);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos'); END IF;
  INSERT INTO public.social_recomendaciones (user_id, nombre, ciudad, categoria, estrellas, nota, place_id, photo_ref)
  VALUES (v_me, v_nombre, nullif(left(btrim(coalesce(p_ciudad, '')), 80), ''), coalesce(p_categoria, 'lugar'), p_estrellas, v_nota,
          CASE WHEN char_length(p_place_id) <= 300 AND p_place_id ~ '^[A-Za-z0-9_-]{10,}$' THEN p_place_id END,
          CASE WHEN p_photo_ref ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$' THEN p_photo_ref END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.recomendar_lugar(text, int, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recomendar_lugar(text, int, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.borrar_recomendacion(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  DELETE FROM public.social_recomendaciones WHERE id = p_id AND user_id = v_me;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_existe'); END IF;
  DELETE FROM public.social_reacciones WHERE owner_id = v_me AND clave = 'reco:' || p_id::text;
  DELETE FROM public.social_preguntas WHERE owner_id = v_me AND clave = 'reco:' || p_id::text;
  DELETE FROM public.social_ocultos WHERE user_id = v_me AND clave = 'reco:' || p_id::text;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.borrar_recomendacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.borrar_recomendacion(uuid) TO authenticated;

-- ───────────── Reaccionar, preguntar y responder ─────────────
CREATE OR REPLACE FUNCTION public._social_tipo_txt(p_tipo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_tipo WHEN 'reserva' THEN 'reserva' WHEN 'recomendacion' THEN 'recomendación' WHEN 'favorito' THEN 'favorito'
                     WHEN 'visitado' THEN 'visita' WHEN 'momento' THEN 'momento' ELSE 'actividad' END;
$$;
REVOKE ALL ON FUNCTION public._social_tipo_txt(text) FROM PUBLIC, anon, authenticated;

-- p_emoji NULL quita la reacción. Aviso al dueño solo con una reacción NUEVA, a lo más uno por
-- persona y elemento cada 24 h; tope de 60 reacciones por hora por persona.
CREATE OR REPLACE FUNCTION public.reaccionar_actividad(p_amigo uuid, p_clave text, p_emoji text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_item jsonb;
  v_prev text;
  v_rl jsonb;
  v_nombre text;
  v_title text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_emoji IS NOT NULL AND p_emoji NOT IN ('corazon', 'fuego', 'antojo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reaccion_invalida');
  END IF;
  v_item := public._social_item_visible(v_me, p_amigo, p_clave);
  IF v_item IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_disponible'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('social_reaccion'), hashtext(v_me::text || '>' || p_clave));
  SELECT emoji INTO v_prev FROM public.social_reacciones WHERE user_id = v_me AND owner_id = p_amigo AND clave = p_clave;
  IF p_emoji IS NULL THEN
    DELETE FROM public.social_reacciones WHERE user_id = v_me AND owner_id = p_amigo AND clave = p_clave;
    RETURN jsonb_build_object('ok', true, 'mi_reaccion', NULL);
  END IF;
  IF v_prev = p_emoji THEN RETURN jsonb_build_object('ok', true, 'mi_reaccion', p_emoji); END IF;
  v_rl := public.check_rate_limit(v_me::text, 'reaccionar_actividad', 60, 3600);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos'); END IF;

  INSERT INTO public.social_reacciones (user_id, owner_id, clave, emoji) VALUES (v_me, p_amigo, p_clave, p_emoji)
  ON CONFLICT (user_id, owner_id, clave) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now();

  IF v_prev IS NULL THEN
    v_nombre := public._social_nombre_seguro(v_me);
    v_title := CASE p_emoji
      WHEN 'corazon' THEN 'A ' || v_nombre || ' le encantó tu ' || public._social_tipo_txt(v_item->>'tipo') || ' ❤️'
      WHEN 'fuego' THEN 'A ' || v_nombre || ' le pareció increíble tu ' || public._social_tipo_txt(v_item->>'tipo') || ' 🔥'
      ELSE 'A ' || v_nombre || ' se le antojó tu ' || public._social_tipo_txt(v_item->>'tipo') || ' 😋' END;
    IF NOT EXISTS (SELECT 1 FROM public.notifications n
                    WHERE n.user_id = p_amigo AND n.type = 'social_reaccion' AND n.related_id = v_me
                      AND n.body IS NOT DISTINCT FROM public._social_texto_aviso(v_item->>'titulo')
                      AND n.created_at > now() - interval '24 hours') THEN
      INSERT INTO public.notifications (user_id, type, title, body, related_id)
      VALUES (p_amigo, 'social_reaccion', v_title, public._social_texto_aviso(v_item->>'titulo'), v_me);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'mi_reaccion', p_emoji);
END $$;
REVOKE ALL ON FUNCTION public.reaccionar_actividad(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reaccionar_actividad(uuid, text, text) TO authenticated;

-- Pregunta corta sobre una actividad visible (20 al día). El aviso no copia la pregunta (texto libre).
CREATE OR REPLACE FUNCTION public.preguntar_actividad(p_amigo uuid, p_clave text, p_texto text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_item jsonb;
  v_rl jsonb;
  v_txt text := left(btrim(regexp_replace(coalesce(p_texto, ''), '[[:cntrl:]]', ' ', 'g')), 280);
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF char_length(v_txt) < 2 THEN RETURN jsonb_build_object('ok', false, 'error', 'texto_invalido'); END IF;
  v_item := public._social_item_visible(v_me, p_amigo, p_clave);
  IF v_item IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_disponible'); END IF;
  v_rl := public.check_rate_limit(v_me::text, 'preguntar_actividad', 20, 86400);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos'); END IF;
  INSERT INTO public.social_preguntas (user_id, owner_id, clave, pregunta) VALUES (v_me, p_amigo, p_clave, v_txt) RETURNING id INTO v_id;
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (p_amigo, 'social_pregunta',
          public._social_nombre_seguro(v_me) || ' te preguntó por ' || coalesce(public._social_texto_aviso(v_item->>'titulo'), 'tu ' || public._social_tipo_txt(v_item->>'tipo')),
          'Respóndele en tu perfil, en «Qué ven mis amigos».', v_me);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.preguntar_actividad(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preguntar_actividad(uuid, text, text) TO authenticated;

-- Solo el dueño de la actividad responde, y solo si siguen siendo amigos.
CREATE OR REPLACE FUNCTION public.responder_pregunta_social(p_pregunta uuid, p_texto text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_q record;
  v_txt text := left(btrim(regexp_replace(coalesce(p_texto, ''), '[[:cntrl:]]', ' ', 'g')), 500);
  v_titulo text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF char_length(v_txt) < 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'texto_invalido'); END IF;
  SELECT * INTO v_q FROM public.social_preguntas WHERE id = p_pregunta AND owner_id = v_me;
  IF v_q.id IS NULL OR NOT public._social_son_amigos(v_me, v_q.user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_existe');
  END IF;
  UPDATE public.social_preguntas SET respuesta = v_txt, respondida_at = now() WHERE id = p_pregunta;
  SELECT i.item ->> 'titulo' INTO v_titulo FROM public._social_items(v_me, true) i WHERE i.clave = v_q.clave;
  IF v_q.respuesta IS NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (v_q.user_id, 'social_respuesta', public._social_nombre_seguro(v_me) || ' respondió tu pregunta',
            coalesce('Sobre ' || public._social_texto_aviso(v_titulo) || '. ', '') || 'Ábrelo en su perfil.', v_me);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.responder_pregunta_social(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_pregunta_social(uuid, text) TO authenticated;

-- ───────────── Al terminar una amistad: fuera reacciones, preguntas y sus avisos ─────────────
CREATE OR REPLACE FUNCTION public.social_amigos_fin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'accepted' AND NEW.status IS DISTINCT FROM 'accepted') THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.social_reacciones
   WHERE (user_id = OLD.requester_id AND owner_id = OLD.addressee_id) OR (user_id = OLD.addressee_id AND owner_id = OLD.requester_id);
  DELETE FROM public.social_preguntas
   WHERE (user_id = OLD.requester_id AND owner_id = OLD.addressee_id) OR (user_id = OLD.addressee_id AND owner_id = OLD.requester_id);
  DELETE FROM public.notifications
   WHERE type IN ('social_reaccion', 'social_pregunta', 'social_respuesta')
     AND ((user_id = OLD.requester_id AND related_id = OLD.addressee_id) OR (user_id = OLD.addressee_id AND related_id = OLD.requester_id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.social_amigos_fin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS social_amigos_fin ON public.friendships;
CREATE TRIGGER social_amigos_fin AFTER DELETE OR UPDATE OF status ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.social_amigos_fin();
