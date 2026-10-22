-- Colaboradores: solo pueden editar el CONTENIDO del viaje. Idempotente.
--
-- trips_update_collab deja que un colaborador aceptado haga UPDATE de la fila completa. El dueño ya
-- estaba protegido (trips_guard_owner), pero el colaborador podía apuntar current_quote_id a otra
-- cotización, reescribir quote_basis / quote_needs_update o cambiar el estado del viaje.
--
-- Qué edita un colaborador hoy (EditTrip, TripDetail, EditableBudget, re-análisis en sitio de
-- analizar-viaje con su sesión, LiveTrip solo lee): destino, fechas, viajeros, presupuesto,
-- itinerario, vuelos, hospedaje, restaurantes, tours, cruceros, tips, desglose, total, portada.
-- Todo eso sigue permitido.
--
-- Bloqueado para quien no es el dueño (solo cuando la sentencia la ejecuta un cliente):
--   id, user_id, created_at, current_quote_id, quote_basis, quote_needs_update → error 42501.
--   status → se conserva el valor anterior sin error: analizar-viaje siempre manda status='listo'
--   al re-analizar, y un error ahí rompería el re-análisis del colaborador sin proteger nada.
-- El service role (cotizaciones, webhooks) no pasa por esta regla.
CREATE OR REPLACE FUNCTION public.trips_collab_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- current_user es quien ejecuta la sentencia: 'authenticated'/'anon' para PostgREST con la
  -- sesión del usuario; el dueño de la función dentro de un SECURITY DEFINER; service_role, etc.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND OLD.user_id = auth.uid() THEN
    RETURN NEW; -- dueño: aplican trips_guard_owner y trips_quote_basis_guard
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id
     OR NEW.quote_basis IS DISTINCT FROM OLD.quote_basis
     OR NEW.quote_needs_update IS DISTINCT FROM OLD.quote_needs_update THEN
    RAISE EXCEPTION 'Solo el dueño del viaje puede cambiar ese dato' USING ERRCODE = '42501';
  END IF;
  NEW.status := OLD.status;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trips_collab_columns_guard() FROM PUBLIC, anon, authenticated;

-- El nombre ordena este trigger ANTES de trips_guard_owner y trips_quote_basis_guard (Postgres los
-- dispara en orden alfabético), así ve los valores que mandó el cliente.
DROP TRIGGER IF EXISTS trips_collab_columns_guard ON public.trips;
CREATE TRIGGER trips_collab_columns_guard BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_collab_columns_guard();
