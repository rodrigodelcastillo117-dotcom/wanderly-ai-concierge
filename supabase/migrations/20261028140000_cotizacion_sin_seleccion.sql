-- Elegir otra opción de la MISMA cotización ya no la marca como vieja (E2E 28-oct-2026, pedido del dueño).
-- Idempotente: CREATE OR REPLACE de la misma función; se puede aplicar más de una vez.
-- Requiere 20261022133000_trip_quotes.sql y 20261022143000_trip_selections_and_links.sql.
--
-- Antes (20261022143000): cambiar trips.selections (otro hotel o vuelo de la cotización) ponía
-- quote_needs_update = true y la app decía "Cambiaste fechas, viajeros…" aunque no cambió nada de eso.
-- Regla nueva:
--  * La selección NO invalida la cotización: el total se recalcula al momento con lo elegido.
--  * Solo la invalidan viajeros, fechas, ciudad de origen o destino.
--  * quote_basis guarda ahora también ciudad_origen y destino (al crear el viaje y en cada cotización
--    nueva). Una base anterior sin esas llaves no compara origen ni destino (no se sabe con cuál se
--    cotizó; nunca se inventa un cambio).
--  * quote_basis.selections se sigue guardando (la selección con que se cotizó), solo que ya no cuenta
--    para quote_needs_update.
-- Sin backfill: una fila con quote_needs_update=true solo por la selección se corrige sola en su
-- siguiente UPDATE, y la app ya calcula el aviso con quote_basis (src/lib/quoteChanges.ts).
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
      'ciudad_origen', NEW.ciudad_origen, 'destino', NEW.destino, 'selections', NEW.selections)
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
      'ciudad_origen', NEW.ciudad_origen, 'destino', NEW.destino, 'selections', NEW.selections);
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
      'ciudad_origen', OLD.ciudad_origen, 'destino', OLD.destino, 'selections', OLD.selections);
  END IF;

  IF NEW.quote_basis IS NOT NULL THEN
    NEW.quote_needs_update :=
         ((NEW.quote_basis->>'num_viajeros')::int IS DISTINCT FROM NEW.num_viajeros)
      OR ((NEW.quote_basis->>'fecha_salida')::date IS DISTINCT FROM NEW.fecha_salida)
      OR ((NEW.quote_basis->>'fecha_regreso')::date IS DISTINCT FROM NEW.fecha_regreso)
      -- Origen y destino solo si la base los guardó (bases anteriores no los tienen).
      OR (NEW.quote_basis ? 'ciudad_origen'
          AND lower(btrim(coalesce(NEW.quote_basis->>'ciudad_origen', ''))) IS DISTINCT FROM lower(btrim(coalesce(NEW.ciudad_origen, ''))))
      OR (NEW.quote_basis ? 'destino'
          AND lower(btrim(coalesce(NEW.quote_basis->>'destino', ''))) IS DISTINCT FROM lower(btrim(coalesce(NEW.destino, ''))));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trips_quote_basis_guard() FROM PUBLIC, anon, authenticated;
-- El trigger trips_quote_basis_guard ya existe (BEFORE INSERT OR UPDATE): toma esta versión.
