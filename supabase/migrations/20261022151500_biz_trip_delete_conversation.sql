-- Hallazgo R10 (producción): no se podía borrar un viaje si el usuario ya había platicado con Iato
-- sobre ese viaje y además tenía su conversación general.
--
-- concierge_conversations.trip_id → trips(id) es ON DELETE SET NULL, y hay un índice único parcial
-- uq_conv_user_general (una conversación general por usuario, trip_id IS NULL). Al borrar el viaje,
-- la conversación del viaje pasaba a trip_id = NULL, chocaba con la general (23505) y el DELETE del
-- viaje fallaba: la app mostraba "No pudimos completar la acción" y el viaje no se borraba.
--
-- Ahora, antes de borrar un viaje se borran las conversaciones de ESE viaje cuyo dueño ya tiene
-- conversación general (borrar el viaje incluye su chat). Si el usuario no tiene conversación
-- general, se conserva el comportamiento anterior: el chat pasa a ser su conversación general.
-- SECURITY DEFINER: el dueño del viaje no puede ver ni borrar por RLS la conversación de un
-- colaborador sobre ese viaje, y sin borrarla el DELETE del viaje seguiría fallando.

CREATE OR REPLACE FUNCTION public.trips_before_delete_conversations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.concierge_conversations c
   WHERE c.trip_id = OLD.id
     AND EXISTS (
       SELECT 1 FROM public.concierge_conversations g
        WHERE g.user_id = c.user_id AND g.trip_id IS NULL
     );
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.trips_before_delete_conversations() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trips_before_delete_conversations ON public.trips;
CREATE TRIGGER trips_before_delete_conversations
  BEFORE DELETE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_before_delete_conversations();
