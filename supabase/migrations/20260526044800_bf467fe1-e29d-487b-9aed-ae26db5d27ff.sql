-- Add status to trip_collaborators
ALTER TABLE public.trip_collaborators
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- Allow the invited user to update their own row (to accept/reject)
DROP POLICY IF EXISTS trip_collab_update_self ON public.trip_collaborators;
CREATE POLICY trip_collab_update_self ON public.trip_collaborators
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Only "accepted" collaborators count as collaborators
CREATE OR REPLACE FUNCTION public.is_trip_collaborator(p_trip uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_collaborators
    WHERE trip_id = p_trip AND user_id = p_user AND status = 'accepted'
  );
$$;

-- Accept invitation
CREATE OR REPLACE FUNCTION public.aceptar_invitacion_viaje(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_trip record;
  v_updated int;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;

  UPDATE public.trip_collaborators
     SET status = 'accepted'
   WHERE trip_id = p_trip_id AND user_id = v_me AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin_invitacion');
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;

  -- Notify owner
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (v_trip.user_id, 'trip_accepted', 'Aceptaron tu invitación',
          'Tu invitación al viaje a ' || v_trip.destino || ' fue aceptada', p_trip_id);

  -- Mark related invite notifications as read
  UPDATE public.notifications
     SET read = true
   WHERE user_id = v_me AND type = 'trip_invite' AND related_id = p_trip_id;

  RETURN jsonb_build_object('ok', true);
END; $$;

-- Reject invitation
CREATE OR REPLACE FUNCTION public.rechazar_invitacion_viaje(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_trip record;
  v_deleted int;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_autenticado');
  END IF;

  DELETE FROM public.trip_collaborators
   WHERE trip_id = p_trip_id AND user_id = v_me AND status = 'pending';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin_invitacion');
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (v_trip.user_id, 'trip_rejected', 'Invitación rechazada',
          'Rechazaron tu invitación al viaje a ' || v_trip.destino, p_trip_id);

  UPDATE public.notifications
     SET read = true
   WHERE user_id = v_me AND type = 'trip_invite' AND related_id = p_trip_id;

  RETURN jsonb_build_object('ok', true);
END; $$;