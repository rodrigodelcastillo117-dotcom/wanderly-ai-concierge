-- Social: perfil de amigo, viajes juntos y saludos (✈️ / 🥂 / 🧳). Idempotente.
--
-- Privacidad (después de F-10 / IATOS-053 y F-19 / IATOS-109):
--   * Un amigo NO lee tablas ajenas: todo sale de estas funciones SECURITY DEFINER, que primero
--     comprueban la amistad ACEPTADA con auth.uid() y devuelven una lista cerrada de campos.
--   * Nunca salen correo, teléfono, fecha de nacimiento, nacionalidad, lealtad, food_dna,
--     viaje activo, presupuesto, restricciones alimentarias, deal-breakers ni textos libres.
--   * Del historial del amigo solo salen nombres de ciudad/país de viajes YA TERMINADOS (sin
--     fechas ni ids): sus viajes futuros no se revelan (dirían cuándo no está en casa). Los
--     "viajes juntos" sí traen fecha e id porque los dos ya pueden abrirlos.
--   * Viajes juntos = viajes a los que los DOS tienen acceso legítimo hoy: dueño o colaborador
--     con invitación aceptada (una invitación pendiente no cuenta).
--   * Los saludos solo se mandan por saludar_amigo (plantillas fijas, uno cada 24 h por pareja);
--     ningún cliente inserta en social_pokes ni en las notificaciones de otro.
--   * Sello Privé: de la membresía solo sale UN booleano (is_prive = prive_entitled: membresía
--     activa y con derecho vigente), y solo para amigos aceptados. Ni código de socio, ni fechas,
--     ni motivo de revocación.
--   * Si la amistad se borra (o deja de estar aceptada), se borran los saludos entre los dos y sus
--     avisos; purge_account_data borra las amistades primero, así que la baja de cuenta también.

-- ───────────── Saludos ─────────────
CREATE TABLE IF NOT EXISTS public.social_pokes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,   -- quien saluda (columna user_id: la baja de cuenta la borra sola)
  friend_id uuid NOT NULL, -- a quien saluda
  gesto text NOT NULL DEFAULT 'saludo',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_pokes_no_self CHECK (user_id <> friend_id),
  CONSTRAINT social_pokes_gesto CHECK (gesto IN ('saludo', 'brindis', 'maleta', 'devuelta'))
);
CREATE INDEX IF NOT EXISTS social_pokes_pair_idx ON public.social_pokes (user_id, friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_pokes_friend_idx ON public.social_pokes (friend_id, created_at DESC);
ALTER TABLE public.social_pokes ENABLE ROW LEVEL SECURITY;
-- Sin políticas: los clientes no la leen ni la escriben (todo pasa por las funciones de abajo).
REVOKE ALL ON public.social_pokes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.social_pokes TO service_role;

-- ───────────── Ayudantes internos (sin SECURITY DEFINER y sin permiso para clientes) ─────────────
-- Solo los llaman las funciones SECURITY DEFINER de abajo, ya con la amistad comprobada.
CREATE OR REPLACE FUNCTION public._social_son_amigos(a uuid, b uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a IS NOT NULL AND b IS NOT NULL AND a <> b AND EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE f.status = 'accepted'
       AND ((f.requester_id = a AND f.addressee_id = b) OR (f.requester_id = b AND f.addressee_id = a)));
$$;

-- Viajes a los que la persona tiene acceso hoy: suyos o con invitación aceptada.
CREATE OR REPLACE FUNCTION public._social_trip_ids(p_user uuid)
RETURNS TABLE (trip_id uuid) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT t.id FROM public.trips t WHERE t.user_id = p_user
  UNION
  SELECT c.trip_id FROM public.trip_collaborators c JOIN public.trips t ON t.id = c.trip_id
   WHERE c.user_id = p_user AND c.status = 'accepted';
$$;

CREATE OR REPLACE FUNCTION public._social_shared_trip_ids(a uuid, b uuid)
RETURNS TABLE (trip_id uuid) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.trip_id FROM public._social_trip_ids(a) x
  INTERSECT
  SELECT y.trip_id FROM public._social_trip_ids(b) y;
$$;

-- Lugares donde ya estuvo: ciudades de viajes TERMINADOS (sin fechas) + los que declaró en su
-- perfil de viaje. Una fila por ciudad (sin distinguir mayúsculas), máximo 40.
CREATE OR REPLACE FUNCTION public._social_lugares(p_user uuid)
RETURNS TABLE (ciudad text, pais text) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT s.ciudad, s.pais FROM (
    SELECT DISTINCT ON (lower(c.ciudad)) c.ciudad, c.pais
      FROM (
        SELECT left(trim(t.destino), 60) AS ciudad, left(nullif(trim(t.pais_destino), ''), 60) AS pais, 1 AS src
          FROM public.trips t
         WHERE t.id IN (SELECT trip_id FROM public._social_trip_ids(p_user))
           AND t.fecha_regreso IS NOT NULL AND t.fecha_regreso < current_date
        UNION ALL
        SELECT left(trim(d), 60), NULL, 2
          FROM public.travel_profiles tp, unnest(coalesce(tp.destinos_visitados, '{}'::text[])) d
         WHERE tp.user_id = p_user
      ) c
     WHERE c.ciudad IS NOT NULL AND c.ciudad <> ''
     ORDER BY lower(c.ciudad), c.src, c.pais NULLS LAST
  ) s
  ORDER BY s.pais NULLS LAST, s.ciudad
  LIMIT 40;
$$;

-- Lista de etiquetas sin vacíos ni la de restricciones (dato de salud), máximo 8.
CREATE OR REPLACE FUNCTION public._social_clean(p text[])
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT left(trim(x), 40)) FILTER (WHERE x IS NOT NULL AND trim(x) <> '' AND x <> 'restricciones'), '{}'::text[])
    FROM (SELECT unnest(coalesce(p, '{}'::text[])) AS x LIMIT 8) s;
$$;

CREATE OR REPLACE FUNCTION public._social_inter(a text[], b text[])
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(x ORDER BY x), '{}'::text[])
    FROM (SELECT unnest(public._social_clean(a)) INTERSECT SELECT unnest(public._social_clean(b))) s(x);
$$;

CREATE OR REPLACE FUNCTION public._social_jaccard(a text[], b text[])
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN u.n = 0 THEN 0 ELSE i.n::numeric / u.n END
    FROM (SELECT count(*) AS n FROM (SELECT unnest(public._social_clean(a)) UNION SELECT unnest(public._social_clean(b))) s) u,
         (SELECT cardinality(public._social_inter(a, b)) AS n) i;
$$;

-- Lo que tienen en común dos personas (solo intersecciones: nada propio del otro) y su afinidad.
-- afinidad es NULL si a alguno le falta Travel DNA (ritmo + comida o tardes): así nunca se
-- muestra un "0 %" que en realidad es "faltan datos".
CREATE OR REPLACE FUNCTION public._social_en_comun(a uuid, b uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  pa record; pb record; ta record; tb record;
  v_comida text[]; v_tardes text[]; v_hosp text[];
  v_ritmo boolean := false; v_presu boolean := false;
  v_a_ok boolean; v_b_ok boolean; v_afinidad int;
  v_destinos jsonb; v_suenos jsonb;
BEGIN
  SELECT ritmo_viaje, nivel_presupuesto, estilo_comida, actividades_tarde, hospedaje_preferencias INTO pa
    FROM public.ai_user_preferences WHERE user_id = a;
  SELECT ritmo_viaje, nivel_presupuesto, estilo_comida, actividades_tarde, hospedaje_preferencias INTO pb
    FROM public.ai_user_preferences WHERE user_id = b;
  SELECT destinos_pendientes INTO ta FROM public.travel_profiles WHERE user_id = a;
  SELECT destinos_pendientes INTO tb FROM public.travel_profiles WHERE user_id = b;

  v_comida := public._social_inter(pa.estilo_comida, pb.estilo_comida);
  v_tardes := public._social_inter(pa.actividades_tarde, pb.actividades_tarde);
  v_hosp := public._social_inter(pa.hospedaje_preferencias, pb.hospedaje_preferencias);
  v_ritmo := pa.ritmo_viaje IS NOT NULL AND pa.ritmo_viaje = pb.ritmo_viaje;
  v_presu := pa.nivel_presupuesto IS NOT NULL AND pa.nivel_presupuesto = pb.nivel_presupuesto;

  v_a_ok := pa.ritmo_viaje IS NOT NULL AND (cardinality(public._social_clean(pa.estilo_comida)) > 0 OR cardinality(public._social_clean(pa.actividades_tarde)) > 0);
  v_b_ok := pb.ritmo_viaje IS NOT NULL AND (cardinality(public._social_clean(pb.estilo_comida)) > 0 OR cardinality(public._social_clean(pb.actividades_tarde)) > 0);
  IF coalesce(v_a_ok, false) AND coalesce(v_b_ok, false) THEN
    v_afinidad := round(
        30 * public._social_jaccard(pa.estilo_comida, pb.estilo_comida)
      + 30 * public._social_jaccard(pa.actividades_tarde, pb.actividades_tarde)
      + 15 * public._social_jaccard(pa.hospedaje_preferencias, pb.hospedaje_preferencias)
      + CASE WHEN v_ritmo THEN 15 ELSE 0 END
      + CASE WHEN v_presu THEN 10 ELSE 0 END)::int;
  END IF;

  SELECT coalesce(jsonb_agg(x.ciudad ORDER BY x.ciudad), '[]'::jsonb) INTO v_destinos FROM (
    SELECT min(la.ciudad) AS ciudad FROM public._social_lugares(a) la
      JOIN public._social_lugares(b) lb ON lower(la.ciudad) = lower(lb.ciudad)
     GROUP BY lower(la.ciudad) LIMIT 12) x;
  SELECT coalesce(jsonb_agg(x.d ORDER BY x.d), '[]'::jsonb) INTO v_suenos FROM (
    SELECT min(left(trim(da), 60)) AS d
      FROM unnest(coalesce(ta.destinos_pendientes, '{}'::text[])) da
      JOIN unnest(coalesce(tb.destinos_pendientes, '{}'::text[])) db ON lower(trim(da)) = lower(trim(db))
     WHERE trim(da) <> '' GROUP BY lower(trim(da)) LIMIT 12) x;

  RETURN jsonb_build_object(
    'comida', to_jsonb(v_comida), 'tardes', to_jsonb(v_tardes), 'hospedaje', to_jsonb(v_hosp),
    'mismo_ritmo', v_ritmo, 'mismo_presupuesto', v_presu,
    'destinos', v_destinos, 'suenos', v_suenos,
    'yo_tengo_dna', coalesce(v_a_ok, false), 'amigo_tiene_dna', coalesce(v_b_ok, false),
    'afinidad', v_afinidad);
END $$;

CREATE OR REPLACE FUNCTION public._social_saludos(p_me uuid, p_amigo uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'puedo', s.enviado IS NULL OR s.enviado <= now() - interval '24 hours',
    'proximo', CASE WHEN s.enviado > now() - interval '24 hours' THEN s.enviado + interval '24 hours' END,
    'ultimo_enviado', s.enviado,
    'ultimo_recibido', s.recibido,
    'gesto_recibido', s.gesto_recibido,
    'por_devolver', s.recibido IS NOT NULL AND s.recibido > coalesce(s.enviado, '-infinity'::timestamptz),
    'total', s.total)
  FROM (SELECT
      (SELECT max(created_at) FROM public.social_pokes WHERE user_id = p_me AND friend_id = p_amigo) AS enviado,
      (SELECT max(created_at) FROM public.social_pokes WHERE user_id = p_amigo AND friend_id = p_me) AS recibido,
      (SELECT gesto FROM public.social_pokes WHERE user_id = p_amigo AND friend_id = p_me ORDER BY created_at DESC LIMIT 1) AS gesto_recibido,
      (SELECT count(*) FROM public.social_pokes WHERE (user_id = p_me AND friend_id = p_amigo) OR (user_id = p_amigo AND friend_id = p_me)) AS total
  ) s;
$$;

-- ¿Miembro IATOS Privé vigente? Solo el booleano (prive_entitled: PRO + elegible + membresía activa).
CREATE OR REPLACE FUNCTION public._social_is_prive(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(public.prive_entitled(p_user), false);
$$;

REVOKE ALL ON FUNCTION public._social_is_prive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._social_son_amigos(uuid, uuid), public._social_trip_ids(uuid),
  public._social_shared_trip_ids(uuid, uuid), public._social_lugares(uuid), public._social_clean(text[]),
  public._social_inter(text[], text[]), public._social_jaccard(text[], text[]), public._social_en_comun(uuid, uuid),
  public._social_saludos(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ───────────── Perfil de un amigo ─────────────
-- {ok:false, error:'privado'} para quien no es amigo aceptado (o no existe: la respuesta es la misma,
-- así no se puede sondear si un id existe). {ok:false, error:'eres_tu'} para el propio id.
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
      'avatar_url', v_prof.avatar_url, 'ciudad_origen', v_prof.ciudad_origen, 'pais_origen', v_prof.pais_origen,
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

-- ───────────── Resumen para la lista de amigos (una sola llamada) ─────────────
CREATE OR REPLACE FUNCTION public.amigos_resumen()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  r record;
  v_comun jsonb; v_sal jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::jsonb; END IF;
  FOR r IN
    SELECT DISTINCT CASE WHEN f.requester_id = v_me THEN f.addressee_id ELSE f.requester_id END AS amigo
      FROM public.friendships f
     WHERE f.status = 'accepted' AND (f.requester_id = v_me OR f.addressee_id = v_me)
     LIMIT 200
  LOOP
    v_comun := public._social_en_comun(v_me, r.amigo);
    v_sal := public._social_saludos(v_me, r.amigo);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'amigo_id', r.amigo,
      'is_prive', public._social_is_prive(r.amigo),
      'viajes_juntos', (SELECT count(*) FROM public._social_shared_trip_ids(v_me, r.amigo)),
      'en_comun', v_comun - 'yo_tengo_dna' - 'amigo_tiene_dna',
      'afinidad', v_comun->'afinidad',
      'saludo_por_devolver', v_sal->'por_devolver'));
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.amigos_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigos_resumen() TO authenticated;

-- ───────────── Mandar un saludo ─────────────
-- Uno cada 24 h por pareja y dirección (el otro puede devolverlo cuando quiera). El aviso usa una
-- plantilla fija; el único dato variable es el nombre de pila de quien saluda (el mismo que el
-- amigo ya ve en Social). related_id = quien saluda, para abrir su perfil desde la campana.
CREATE OR REPLACE FUNCTION public.saludar_amigo(p_amigo uuid, p_gesto text DEFAULT 'saludo')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_gesto text := coalesce(nullif(trim(p_gesto), ''), 'saludo');
  v_last timestamptz;
  v_sal jsonb;
  v_nombre text;
  v_title text; v_body text;
  v_total int;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF v_gesto NOT IN ('saludo', 'brindis', 'maleta', 'devuelta') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'gesto_invalido');
  END IF;
  IF NOT public._social_son_amigos(v_me, p_amigo) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_son_amigos');
  END IF;

  -- Dos toques simultáneos: el segundo espera y ve el primero (no salen dos avisos).
  PERFORM pg_advisory_xact_lock(hashtext('saludar_amigo'), hashtext(v_me::text || '>' || p_amigo::text));
  SELECT max(created_at) INTO v_last FROM public.social_pokes WHERE user_id = v_me AND friend_id = p_amigo;
  IF v_last IS NOT NULL AND v_last > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'muy_pronto', 'proximo', v_last + interval '24 hours');
  END IF;
  IF v_gesto = 'devuelta' THEN
    v_sal := public._social_saludos(v_me, p_amigo);
    IF NOT coalesce((v_sal->>'por_devolver')::boolean, false) THEN v_gesto := 'saludo'; END IF;
  END IF;

  INSERT INTO public.social_pokes (user_id, friend_id, gesto) VALUES (v_me, p_amigo, v_gesto);
  SELECT count(*) INTO v_total FROM public.social_pokes
   WHERE (user_id = v_me AND friend_id = p_amigo) OR (user_id = p_amigo AND friend_id = v_me);

  SELECT left(regexp_replace(coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), nullif(trim(username), ''), 'Tu amigo'),
              '[[:cntrl:]<>]', '', 'g'), 40)
    INTO v_nombre FROM public.profiles WHERE id = v_me;
  v_nombre := coalesce(nullif(v_nombre, ''), 'Tu amigo');

  CASE v_gesto
    WHEN 'brindis' THEN v_title := v_nombre || ' brindó por su próximo viaje juntos 🥂'; v_body := 'Abre su perfil y elijan destino.';
    WHEN 'maleta' THEN v_title := v_nombre || ' ya quiere hacer maleta contigo 🧳'; v_body := '¿Planean el próximo viaje juntos?';
    WHEN 'devuelta' THEN v_title := v_nombre || ' te devolvió el saludo 👋'; v_body := 'Ya van ' || v_total || ' saludos entre ustedes.';
    ELSE v_title := '¡' || v_nombre || ' te mandó un saludo! ✈️'; v_body := 'Devuélveselo desde su perfil en Social.';
  END CASE;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (p_amigo, 'social_poke', v_title, v_body, v_me);

  RETURN jsonb_build_object('ok', true, 'gesto', v_gesto, 'proximo', now() + interval '24 hours', 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.saludar_amigo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saludar_amigo(uuid, text) TO authenticated;

-- ───────────── Al terminar una amistad ─────────────
CREATE OR REPLACE FUNCTION public.social_friendship_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'accepted' AND NEW.status IS DISTINCT FROM 'accepted') THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.social_pokes
   WHERE (user_id = OLD.requester_id AND friend_id = OLD.addressee_id)
      OR (user_id = OLD.addressee_id AND friend_id = OLD.requester_id);
  DELETE FROM public.notifications
   WHERE type = 'social_poke'
     AND ((user_id = OLD.requester_id AND related_id = OLD.addressee_id)
       OR (user_id = OLD.addressee_id AND related_id = OLD.requester_id));
  RETURN NULL; -- AFTER: el valor no se usa
END $$;
REVOKE ALL ON FUNCTION public.social_friendship_ended() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS social_friendship_ended ON public.friendships;
CREATE TRIGGER social_friendship_ended AFTER DELETE OR UPDATE OF status ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.social_friendship_ended();
