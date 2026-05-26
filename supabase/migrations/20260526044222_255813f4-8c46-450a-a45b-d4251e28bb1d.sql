
-- 1. Tabla de colaboradores
CREATE TABLE public.trip_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'editor',
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX idx_trip_collab_user ON public.trip_collaborators(user_id);
CREATE INDEX idx_trip_collab_trip ON public.trip_collaborators(trip_id);

ALTER TABLE public.trip_collaborators ENABLE ROW LEVEL SECURITY;

-- 2. Security definer helpers (evitan recursión RLS)
CREATE OR REPLACE FUNCTION public.is_trip_owner(p_trip uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip AND user_id = p_user);
$$;

CREATE OR REPLACE FUNCTION public.is_trip_collaborator(p_trip uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_collaborators
    WHERE trip_id = p_trip AND user_id = p_user
  );
$$;

CREATE OR REPLACE FUNCTION public.has_trip_access(p_trip uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_trip_owner(p_trip, p_user) OR public.is_trip_collaborator(p_trip, p_user);
$$;

-- 3. RLS para trip_collaborators
CREATE POLICY trip_collab_select ON public.trip_collaborators FOR SELECT
USING (auth.uid() = user_id OR public.is_trip_owner(trip_id, auth.uid()));

CREATE POLICY trip_collab_insert_owner ON public.trip_collaborators FOR INSERT
WITH CHECK (public.is_trip_owner(trip_id, auth.uid()) AND auth.uid() = invited_by);

CREATE POLICY trip_collab_delete ON public.trip_collaborators FOR DELETE
USING (public.is_trip_owner(trip_id, auth.uid()) OR auth.uid() = user_id);

-- 4. Ampliar RLS de trips para incluir colaboradores
CREATE POLICY trips_select_collab ON public.trips FOR SELECT
USING (public.is_trip_collaborator(id, auth.uid()));

CREATE POLICY trips_update_collab ON public.trips FOR UPDATE
USING (public.is_trip_collaborator(id, auth.uid()))
WITH CHECK (public.is_trip_collaborator(id, auth.uid()));

-- 5. Permitir notificaciones cruzadas (insertar a otros usuarios desde funciones de la app)
-- Política adicional: cualquiera puede insertar una notificación dirigida a un usuario
-- con quien comparte un viaje (owner o colaborador del mismo trip referenciado en related_id).
CREATE POLICY notifications_insert_trip_members ON public.notifications FOR INSERT
WITH CHECK (
  related_id IS NOT NULL
  AND public.has_trip_access(related_id, auth.uid())
  AND public.has_trip_access(related_id, user_id)
);

-- 6. Función para invitar amigo a viaje (valida amistad + crea notificación)
CREATE OR REPLACE FUNCTION public.invitar_amigo_viaje(p_trip_id uuid, p_friend_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_es_amigo int;
  v_trip record;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;
  IF v_trip IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'viaje_no_existe');
  END IF;
  IF v_trip.user_id <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_eres_dueno');
  END IF;

  SELECT count(*) INTO v_es_amigo FROM public.friendships
  WHERE status = 'accepted'
    AND ((requester_id = v_me AND addressee_id = p_friend_id)
      OR (requester_id = p_friend_id AND addressee_id = v_me));
  IF v_es_amigo = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_son_amigos');
  END IF;

  INSERT INTO public.trip_collaborators (trip_id, user_id, role, invited_by)
  VALUES (p_trip_id, p_friend_id, 'editor', v_me)
  ON CONFLICT (trip_id, user_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (
    p_friend_id,
    'trip_invite',
    'Te invitaron a un viaje',
    'Te agregaron como editor del viaje a ' || v_trip.destino,
    p_trip_id
  );

  RETURN jsonb_build_object('ok', true);
END; $$;

-- 7. Trigger: cuando se actualiza un viaje, notificar al resto de los miembros
CREATE OR REPLACE FUNCTION public.notify_trip_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_dest text := NEW.destino;
BEGIN
  -- Notificar al dueño si quien editó es colaborador
  IF v_actor IS NOT NULL AND v_actor <> NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (NEW.user_id, 'trip_updated', 'Actualizaron tu viaje',
            'Un colaborador editó el viaje a ' || v_dest, NEW.id);
  END IF;

  -- Notificar a todos los colaboradores excepto al que hizo el cambio
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT tc.user_id, 'trip_updated', 'Viaje actualizado',
         'Se editó el viaje a ' || v_dest, NEW.id
  FROM public.trip_collaborators tc
  WHERE tc.trip_id = NEW.id AND tc.user_id <> COALESCE(v_actor, NEW.user_id);

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_notify_trip_updated
AFTER UPDATE ON public.trips
FOR EACH ROW
WHEN (
  OLD.itinerario_json IS DISTINCT FROM NEW.itinerario_json
  OR OLD.vuelos_json IS DISTINCT FROM NEW.vuelos_json
  OR OLD.hospedaje_json IS DISTINCT FROM NEW.hospedaje_json
  OR OLD.restaurantes_json IS DISTINCT FROM NEW.restaurantes_json
  OR OLD.total_estimado IS DISTINCT FROM NEW.total_estimado
  OR OLD.desglose_presupuesto IS DISTINCT FROM NEW.desglose_presupuesto
)
EXECUTE FUNCTION public.notify_trip_updated();
