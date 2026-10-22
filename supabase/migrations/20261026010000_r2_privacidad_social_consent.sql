-- T-P2-1 (segunda auditoría, grupo transversal): amistad CON consentimiento. Idempotente.
--
-- Antes: agregar_amigo_por_codigo creaba la amistad 'accepted' con solo conocer el código (el mismo
-- que circula en el enlace /?ref= de referidos); quitar al amigo no servía (volvía a entrar al
-- instante con el mismo código), el código no se podía cambiar e invitar_amigo_viaje avisaba en cada
-- llamada con el destino del viaje (texto libre del remitente: "abre bit.ly/…").
--
-- Ahora:
--   * friendships.status: 'pending' (solicitud) → 'accepted' (la otra persona la aceptó) o
--     'rejected' (la rechazó; el remitente no puede volver a pedir en 30 días). 'blocked': quien
--     bloquea es requester_id; el bloqueado no ve la fila, no la puede borrar ni volver a pedir.
--   * agregar_amigo_por_codigo crea una SOLICITUD y un aviso 'friend_request' (plantilla fija, a lo
--     más uno por pareja cada 7 días). Si la otra persona ya me había pedido, la acepta (las dos
--     quisieron). Ya no devuelve el id de la otra persona hasta que son amigos.
--   * responder_solicitud_amistad (aceptar/rechazar), cancelar_solicitud_amistad, quitar_amigo
--     (opcionalmente bloquear), bloquear_usuario, desbloquear_usuario, solicitudes_amistad y
--     regenerar_codigo_invitacion (el enlace anterior deja de funcionar).
--   * invitar_amigo_viaje solo avisa cuando la invitación es NUEVA, a lo más una vez por viaje y
--     persona cada 7 días, con tope de 20 invitaciones por día por remitente, y el aviso ya no copia
--     el destino ni otro texto libre (solo el nombre de pila sin signos, que no puede formar enlaces).
--   * Las amistades 'accepted' que ya existen se conservan (no se puede saber cuáles se crearon sin
--     consentimiento); quien quiera puede quitarlas o bloquear desde la app.

-- ───── Nombre de pila "seguro" para avisos: solo letras, apóstrofo y guion (sin puntos ni "/") ─────
CREATE OR REPLACE FUNCTION public._social_nombre_seguro(p_user uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT nullif(left(regexp_replace(
             split_part(trim(coalesce(nullif(trim(p.full_name), ''), p.username, '')), ' ', 1),
             '[^A-Za-zÀ-ÖØ-öø-ÿ''-]', '', 'g'), 30), '')
      FROM public.profiles p WHERE p.id = p_user), 'Alguien');
$$;
REVOKE ALL ON FUNCTION public._social_nombre_seguro(uuid) FROM PUBLIC, anon, authenticated;

-- Candado por pareja (dos solicitudes cruzadas al mismo tiempo no dejan dos filas).
CREATE OR REPLACE FUNCTION public._social_lock_pair(a uuid, b uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT pg_advisory_xact_lock(hashtext('friendship_pair'),
    hashtext(least(a::text, b::text) || '|' || greatest(a::text, b::text)));
$$;
REVOKE ALL ON FUNCTION public._social_lock_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ───── Políticas de friendships ─────
-- Lectura: quien pide ve sus solicitudes, amistades y bloqueos; quien recibe ve solicitudes,
-- amistades y lo que rechazó. El bloqueado no ve el bloqueo y el rechazado no ve el rechazo.
DROP POLICY IF EXISTS friend_select_involved ON public.friendships;
CREATE POLICY friend_select_involved ON public.friendships FOR SELECT TO authenticated
  USING (
    (auth.uid() = requester_id AND status IN ('pending', 'accepted', 'blocked'))
    OR (auth.uid() = addressee_id AND status IN ('pending', 'accepted', 'rejected'))
  );
-- Borrar directo (pantallas viejas): quitar una amistad o una solicitud pendiente. El rechazado no
-- puede borrar el rechazo (se saltaría la espera) ni el bloqueado su bloqueo.
DROP POLICY IF EXISTS friend_delete_involved ON public.friendships;
CREATE POLICY friend_delete_involved ON public.friendships FOR DELETE TO authenticated
  USING (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND (status IN ('accepted', 'pending')
         OR (status = 'rejected' AND auth.uid() = addressee_id)
         OR (status = 'blocked' AND auth.uid() = requester_id))
  );
-- INSERT/UPDATE siguen revocados para clientes (F-02): todo pasa por las funciones de abajo.
REVOKE INSERT, UPDATE ON public.friendships FROM anon, authenticated;

-- ───── Mandar una solicitud con el código de la otra persona ─────
CREATE OR REPLACE FUNCTION public.agregar_amigo_por_codigo(p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_otro uuid;
  v_rl jsonb;
  v_mine record;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;
  -- Tope de intentos (también frena adivinar códigos): 30 por hora.
  v_rl := public.check_rate_limit(v_me::text, 'agregar_amigo_por_codigo', 30, 3600);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  END IF;

  SELECT id INTO v_otro FROM public.profiles
   WHERE upper(invite_code) = upper(trim(coalesce(p_codigo, ''))) LIMIT 1;
  IF v_otro IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  END IF;
  IF v_otro = v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'es_tu_propio_codigo');
  END IF;

  PERFORM public._social_lock_pair(v_me, v_otro);

  -- Yo lo bloqueé: primero hay que desbloquear.
  IF EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = v_me AND addressee_id = v_otro AND status = 'blocked') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lo_bloqueaste');
  END IF;
  -- Me bloqueó: se responde igual que una solicitud enviada (no se revela el bloqueo) y no pasa nada.
  IF EXISTS (SELECT 1 FROM public.friendships WHERE requester_id = v_otro AND addressee_id = v_me AND status = 'blocked') THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
  END IF;
  -- Ya son amigos.
  IF EXISTS (SELECT 1 FROM public.friendships WHERE status = 'accepted'
              AND ((requester_id = v_me AND addressee_id = v_otro) OR (requester_id = v_otro AND addressee_id = v_me))) THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'amigos', 'amigo_id', v_otro);
  END IF;
  -- La otra persona ya me había pedido amistad: usar su código es aceptarla (las dos quisieron).
  UPDATE public.friendships SET status = 'accepted', updated_at = now()
   WHERE requester_id = v_otro AND addressee_id = v_me AND status = 'pending';
  IF FOUND THEN
    UPDATE public.notifications SET read = true
     WHERE user_id = v_me AND type = 'friend_request' AND related_id = v_otro;
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (v_otro, 'friend_accepted', public._social_nombre_seguro(v_me) || ' aceptó tu solicitud de amistad',
            'Ya pueden ver su Travel DNA y planear viajes juntos en Social.', v_me);
    RETURN jsonb_build_object('ok', true, 'estado', 'amigos', 'amigo_id', v_otro);
  END IF;

  SELECT status, updated_at INTO v_mine FROM public.friendships
   WHERE requester_id = v_me AND addressee_id = v_otro;
  IF v_mine.status = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
  END IF;
  IF v_mine.status = 'rejected' THEN
    -- Rechazada hace menos de 30 días: no se vuelve a pedir ni a avisar (sin revelar el rechazo).
    IF v_mine.updated_at > now() - interval '30 days' THEN
      RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
    END IF;
    UPDATE public.friendships SET status = 'pending', updated_at = now()
     WHERE requester_id = v_me AND addressee_id = v_otro;
  ELSE
    -- Si yo había rechazado antes una solicitud suya, ahora la pido yo: esa fila vieja sobra.
    DELETE FROM public.friendships WHERE requester_id = v_otro AND addressee_id = v_me AND status = 'rejected';
    INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (v_me, v_otro, 'pending')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;
  END IF;

  -- Aviso con plantilla fija; a lo más uno por pareja cada 7 días.
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE user_id = v_otro AND type = 'friend_request' AND related_id = v_me
                    AND created_at > now() - interval '7 days') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (v_otro, 'friend_request', public._social_nombre_seguro(v_me) || ' quiere conectar contigo',
            'Acepta o rechaza su solicitud de amistad en Social.', v_me);
  END IF;
  RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
END;
$$;
REVOKE ALL ON FUNCTION public.agregar_amigo_por_codigo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_amigo_por_codigo(text) TO authenticated;

-- ───── Aceptar o rechazar una solicitud recibida ─────
CREATE OR REPLACE FUNCTION public.responder_solicitud_amistad(p_otro uuid, p_aceptar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_otro IS NULL OR p_otro = v_me THEN RETURN jsonb_build_object('ok', false, 'error', 'sin_solicitud'); END IF;
  PERFORM public._social_lock_pair(v_me, p_otro);
  UPDATE public.friendships
     SET status = CASE WHEN coalesce(p_aceptar, false) THEN 'accepted' ELSE 'rejected' END, updated_at = now()
   WHERE requester_id = p_otro AND addressee_id = v_me AND status = 'pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'sin_solicitud'); END IF;
  UPDATE public.notifications SET read = true
   WHERE user_id = v_me AND type = 'friend_request' AND related_id = p_otro;
  IF coalesce(p_aceptar, false) THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (p_otro, 'friend_accepted', public._social_nombre_seguro(v_me) || ' aceptó tu solicitud de amistad',
            'Ya pueden ver su Travel DNA y planear viajes juntos en Social.', v_me);
    RETURN jsonb_build_object('ok', true, 'estado', 'amigos');
  END IF;
  -- Al rechazar no se avisa a quien pidió.
  RETURN jsonb_build_object('ok', true, 'estado', 'rechazada');
END;
$$;
REVOKE ALL ON FUNCTION public.responder_solicitud_amistad(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_solicitud_amistad(uuid, boolean) TO authenticated;

-- ───── Cancelar una solicitud que yo mandé (y su aviso si no se ha leído) ─────
CREATE OR REPLACE FUNCTION public.cancelar_solicitud_amistad(p_otro uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  PERFORM public._social_lock_pair(v_me, p_otro);
  DELETE FROM public.friendships WHERE requester_id = v_me AND addressee_id = p_otro AND status = 'pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'sin_solicitud'); END IF;
  DELETE FROM public.notifications
   WHERE user_id = p_otro AND type = 'friend_request' AND related_id = v_me AND read = false;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_solicitud_amistad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_solicitud_amistad(uuid) TO authenticated;

-- ───── Bloquear / desbloquear ─────
-- Bloquear borra cualquier relación de la pareja (amistad, solicitudes en los dos sentidos) y deja
-- una sola fila (yo → el otro, 'blocked'). El trigger social_friendship_ended limpia saludos.
CREATE OR REPLACE FUNCTION public.bloquear_usuario(p_otro uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF p_otro IS NULL OR p_otro = v_me OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_otro) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'usuario_invalido');
  END IF;
  PERFORM public._social_lock_pair(v_me, p_otro);
  DELETE FROM public.friendships
   WHERE (requester_id = v_me AND addressee_id = p_otro) OR (requester_id = p_otro AND addressee_id = v_me);
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (v_me, p_otro, 'blocked');
  DELETE FROM public.notifications
   WHERE user_id = v_me AND type IN ('friend_request', 'friend_accepted', 'social_poke') AND related_id = p_otro;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bloquear_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bloquear_usuario(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.desbloquear_usuario(p_otro uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  DELETE FROM public.friendships WHERE requester_id = v_me AND addressee_id = p_otro AND status = 'blocked';
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;
REVOKE ALL ON FUNCTION public.desbloquear_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desbloquear_usuario(uuid) TO authenticated;

-- ───── Quitar a un amigo (y, si se pide, bloquearlo) ─────
CREATE OR REPLACE FUNCTION public.quitar_amigo(p_otro uuid, p_bloquear boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  IF coalesce(p_bloquear, false) THEN RETURN public.bloquear_usuario(p_otro); END IF;
  PERFORM public._social_lock_pair(v_me, p_otro);
  DELETE FROM public.friendships
   WHERE status IN ('accepted', 'pending')
     AND ((requester_id = v_me AND addressee_id = p_otro) OR (requester_id = p_otro AND addressee_id = v_me));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_son_amigos'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.quitar_amigo(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_amigo(uuid, boolean) TO authenticated;

-- ───── Solicitudes para la pantalla Social ─────
-- recibidas: quién me pidió (nombre, usuario y avatar, para decidir); enviadas: solo id y fecha
-- (con un código no se aprende el nombre de nadie); bloqueados: a quién bloqueé.
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
                                          'avatar_url', p.avatar_url, 'created_at', f.created_at) ORDER BY f.created_at DESC)
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

-- ───── Rotar el código de invitación (el enlace /?ref= anterior deja de funcionar) ─────
-- SECURITY DEFINER: profiles_guard_sensitive solo frena sentencias de anon/authenticated.
CREATE OR REPLACE FUNCTION public.regenerar_codigo_invitacion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rl jsonb;
  v_code text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado'); END IF;
  v_rl := public.check_rate_limit(v_me::text, 'regenerar_codigo_invitacion', 5, 86400);
  IF NOT coalesce((v_rl->>'allowed')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gen_invite_code'));
  v_code := public.gen_invite_code();
  UPDATE public.profiles SET invite_code = v_code WHERE id = v_me;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'sin_perfil'); END IF;
  RETURN jsonb_build_object('ok', true, 'codigo', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.regenerar_codigo_invitacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerar_codigo_invitacion() TO authenticated;

-- ───── Invitar a un amigo a un viaje: avisos acotados y sin texto libre ─────
CREATE OR REPLACE FUNCTION public.invitar_amigo_viaje(p_trip_id uuid, p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_owner uuid;
  v_new uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;
  SELECT user_id INTO v_owner FROM public.trips WHERE id = p_trip_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'viaje_no_existe');
  END IF;
  IF v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_eres_dueno');
  END IF;
  IF NOT public._social_son_amigos(v_me, p_friend_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_son_amigos');
  END IF;
  -- Tope por remitente: 20 invitaciones nuevas al día.
  IF (SELECT count(*) FROM public.trip_collaborators
       WHERE invited_by = v_me AND created_at > now() - interval '24 hours') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'demasiadas_invitaciones');
  END IF;

  INSERT INTO public.trip_collaborators (trip_id, user_id, role, invited_by)
  VALUES (p_trip_id, p_friend_id, 'editor', v_me)
  ON CONFLICT (trip_id, user_id) DO NOTHING
  RETURNING id INTO v_new;
  IF v_new IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ya_invitado', true);
  END IF;

  -- Aviso solo para una invitación nueva y a lo más uno por viaje y persona cada 7 días (rechazar y
  -- volver a invitar en bucle no inunda la campana). El texto es fijo: sin destino ni enlaces.
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE user_id = p_friend_id AND type = 'trip_invite' AND related_id = p_trip_id
                    AND created_at > now() - interval '7 days') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (p_friend_id, 'trip_invite', 'Te invitaron a un viaje',
            public._social_nombre_seguro(v_me) || ' te invitó a planear un viaje juntos. Acepta o rechaza aquí.',
            p_trip_id);
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.invitar_amigo_viaje(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invitar_amigo_viaje(uuid, uuid) TO authenticated;
