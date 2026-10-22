-- Expediente vivo del viaje (grupo trip). Idempotente: se puede aplicar más de una vez.
-- Requiere 20261022133000_trip_quotes.sql (trips_quote_basis_guard) y 20261022131000.
--
-- 1) E-12: trips.selections guarda lo que el usuario eligió en la página del viaje (vuelo, hotel,
--    noches, experiencias). Antes vivía solo en el navegador y se perdía al recargar.
--    {"v":1,"vuelo":{"i":0,"key":"..."},"hospedaje":{...},"noches_hospedaje":null,"tours":[{"i":1,"key":"..."}]}
--    NULL = sin selección (la cotización tal cual).
-- 2) La base de la cotización (quote_basis) recuerda también la selección con que se cotizó
--    (quote_basis.selections). Cambiar la selección después marca quote_needs_update, igual que
--    cambiar viajeros o fechas.
-- 3) E-22: bookings y expenses solo pueden ligarse a un viaje al que su usuario tiene acceso.

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS selections jsonb;
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_selections_is_object;
ALTER TABLE public.trips ADD CONSTRAINT trips_selections_is_object
  CHECK (selections IS NULL OR (jsonb_typeof(selections) = 'object' AND pg_column_size(selections) <= 8192));

-- Misma función que 20261022133000 con la selección como parte de la base. Reglas nuevas:
--  * Cotización nueva (cambia current_quote_id): la selección vieja apuntaba a opciones de la
--    cotización anterior, así que se limpia, salvo que el mismo UPDATE la fije a propósito. La base
--    guarda la selección vigente (normalmente NULL).
--  * Sin cotización nueva: quote_needs_update también es true si la selección difiere de la base.
CREATE OR REPLACE FUNCTION public.trips_quote_basis_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.current_quote_id := NULL;
    NEW.quote_needs_update := false;
    NEW.quote_basis := CASE WHEN NEW.total_estimado IS NOT NULL THEN jsonb_build_object(
      'num_viajeros', NEW.num_viajeros, 'fecha_salida', NEW.fecha_salida, 'fecha_regreso', NEW.fecha_regreso,
      'selections', NEW.selections)
      ELSE NULL END;
    RETURN NEW;
  END IF;

  IF NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id AND NEW.current_quote_id IS NOT NULL THEN
    SELECT trip_id, travelers, date_from, date_to INTO q FROM public.trip_quotes WHERE id = NEW.current_quote_id;
    IF q.trip_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'current_quote_id debe ser una cotización de este viaje';
    END IF;
    IF NEW.selections IS NOT DISTINCT FROM OLD.selections THEN
      NEW.selections := NULL;
    END IF;
    NEW.quote_basis := jsonb_build_object('num_viajeros', q.travelers, 'fecha_salida', q.date_from, 'fecha_regreso', q.date_to,
      'selections', NEW.selections);
    NEW.quote_needs_update := (q.travelers IS DISTINCT FROM NEW.num_viajeros)
      OR (q.date_from IS DISTINCT FROM NEW.fecha_salida)
      OR (q.date_to IS DISTINCT FROM NEW.fecha_regreso);
    RETURN NEW;
  END IF;

  -- Sin cotización nueva: el cliente no toca estas columnas.
  NEW.current_quote_id := OLD.current_quote_id;
  NEW.quote_basis := OLD.quote_basis;
  NEW.quote_needs_update := OLD.quote_needs_update;

  IF OLD.quote_basis IS NULL AND OLD.total_estimado IS NOT NULL THEN
    -- Viaje anterior a 20261022133000: su base son los valores que tenía antes de este cambio.
    NEW.quote_basis := jsonb_build_object(
      'num_viajeros', OLD.num_viajeros, 'fecha_salida', OLD.fecha_salida, 'fecha_regreso', OLD.fecha_regreso,
      'selections', OLD.selections);
  END IF;

  IF NEW.quote_basis IS NOT NULL THEN
    NEW.quote_needs_update :=
         ((NEW.quote_basis->>'num_viajeros')::int IS DISTINCT FROM NEW.num_viajeros)
      OR ((NEW.quote_basis->>'fecha_salida')::date IS DISTINCT FROM NEW.fecha_salida)
      OR ((NEW.quote_basis->>'fecha_regreso')::date IS DISTINCT FROM NEW.fecha_regreso)
      -- Una base sin la llave "selections" (anterior a esta migración) equivale a "sin selección".
      OR (COALESCE(NEW.quote_basis->'selections', 'null'::jsonb) IS DISTINCT FROM COALESCE(NEW.selections, 'null'::jsonb));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trips_quote_basis_guard() FROM PUBLIC, anon, authenticated;
-- El trigger trips_quote_basis_guard ya existe (BEFORE INSERT OR UPDATE): toma la nueva versión.

-- 3) trip_id de bookings/expenses: solo un viaje propio o compartido contigo (aceptado). Antes la
--    FK aceptaba cualquier viaje, también uno ajeno.
CREATE OR REPLACE FUNCTION public.guard_row_trip_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.trip_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND NOT public.has_trip_access(NEW.trip_id, NEW.user_id) THEN
    RAISE EXCEPTION 'No tienes acceso a ese viaje' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_row_trip_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_guard_trip_access ON public.bookings;
CREATE TRIGGER bookings_guard_trip_access BEFORE INSERT OR UPDATE OF trip_id, user_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_row_trip_access();

DROP TRIGGER IF EXISTS expenses_guard_trip_access ON public.expenses;
CREATE TRIGGER expenses_guard_trip_access BEFORE INSERT OR UPDATE OF trip_id, user_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_row_trip_access();

CREATE INDEX IF NOT EXISTS idx_expenses_trip ON public.expenses(trip_id) WHERE trip_id IS NOT NULL;
