-- Snapshots inmutables de cotización (D-22 / D-02 / D-24).
--
-- Antes la cotización era solo trips.total_estimado + desglose_presupuesto, que se sobrescribían
-- en cada edición, sin fecha, sin tipo de cambio, sin fuentes y sin saber para cuántos viajeros o
-- qué fechas se calculó. Ahora:
--   * public.trip_quotes: una fila por cotización, solo se insertan (las edge functions con service
--     role); nadie las modifica. El dueño y los colaboradores aceptados del viaje las pueden leer.
--   * trips.current_quote_id: la cotización vigente (las columnas de trips quedan como caché).
--   * trips.quote_basis / quote_needs_update: viajeros y fechas con que se cotizó, y si el usuario
--     los cambió después (entonces la cotización ya no corresponde y hay que recotizar). Los
--     mantiene un trigger: el cliente no puede escribirlos.

CREATE TABLE IF NOT EXISTS public.trip_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  version        integer NOT NULL DEFAULT 0,
  origin         text NOT NULL CHECK (origin IN ('analizar-viaje', 'editar-viaje-ai', 'logistics-plan')),
  currency       char(3) NOT NULL DEFAULT 'MXN',
  total          numeric(14,2) NOT NULL CHECK (total >= 0),
  breakdown      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{category,label,amount,qty,qty_basis,source,consultado_at,state,booking_url}]
  -- state ∈ COTIZADO | ESTIMADO | PAGADO | PENDIENTE | OPCIONAL | EXCLUIDO
  line_items     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(line_items) = 'array'),
  travelers      integer NOT NULL CHECK (travelers BETWEEN 1 AND 50),
  nights         integer NOT NULL CHECK (nights >= 0),
  rooms          integer NOT NULL DEFAULT 1 CHECK (rooms >= 1),
  date_from      date,
  date_to        date,
  fx_rate        numeric(12,6) NOT NULL CHECK (fx_rate > 0),
  fx_source      text NOT NULL,
  fx_at          timestamptz NOT NULL,
  fx_is_fallback boolean NOT NULL DEFAULT false,
  sources        jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_quotes_dates_ok CHECK (date_to IS NULL OR date_from IS NULL OR date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_trip_quotes_trip ON public.trip_quotes (trip_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS trip_quotes_trip_version_key ON public.trip_quotes (trip_id, version);

-- Cada renglón debe traer un estado válido.
CREATE OR REPLACE FUNCTION public.trip_quotes_line_items_valid(items jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(items) li
    WHERE NOT (li ? 'state')
       OR (li->>'state') NOT IN ('COTIZADO', 'ESTIMADO', 'PAGADO', 'PENDIENTE', 'OPCIONAL', 'EXCLUIDO')
  );
$$;

ALTER TABLE public.trip_quotes DROP CONSTRAINT IF EXISTS trip_quotes_line_items_state;
ALTER TABLE public.trip_quotes ADD CONSTRAINT trip_quotes_line_items_state
  CHECK (public.trip_quotes_line_items_valid(line_items));

-- Versión 1, 2, 3… por viaje (la asigna la base, no quien inserta), user_id = dueño del viaje,
-- created_at = ahora.
CREATE OR REPLACE FUNCTION public.trip_quotes_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.trips WHERE id = NEW.trip_id FOR UPDATE;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'trip_quotes: el viaje % no existe', NEW.trip_id;
  END IF;
  NEW.user_id := v_owner;
  NEW.created_at := now();
  SELECT COALESCE(MAX(version), 0) + 1 INTO NEW.version FROM public.trip_quotes WHERE trip_id = NEW.trip_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_quotes_before_insert ON public.trip_quotes;
CREATE TRIGGER trip_quotes_before_insert BEFORE INSERT ON public.trip_quotes
  FOR EACH ROW EXECUTE FUNCTION public.trip_quotes_before_insert();

-- Solo se insertan: una cotización mostrada al usuario nunca cambia después.
CREATE OR REPLACE FUNCTION public.trip_quotes_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trip_quotes es de solo inserción: crea una cotización nueva en lugar de modificarla';
END;
$$;

DROP TRIGGER IF EXISTS trip_quotes_no_update ON public.trip_quotes;
CREATE TRIGGER trip_quotes_no_update BEFORE UPDATE ON public.trip_quotes
  FOR EACH ROW EXECUTE FUNCTION public.trip_quotes_immutable();

ALTER TABLE public.trip_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_quotes_select ON public.trip_quotes;
CREATE POLICY trip_quotes_select ON public.trip_quotes FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
-- Sin políticas de INSERT/UPDATE/DELETE: solo escribe el service role (edge functions). Se borra
-- en cascada con el viaje.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trip_quotes FROM anon, authenticated;
GRANT SELECT ON public.trip_quotes TO authenticated;

-- ───── trips: cotización vigente y base con que se cotizó ─────
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS current_quote_id uuid;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS quote_basis jsonb;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS quote_needs_update boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_current_quote_id_fkey') THEN
    ALTER TABLE public.trips ADD CONSTRAINT trips_current_quote_id_fkey
      FOREIGN KEY (current_quote_id) REFERENCES public.trip_quotes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Mantiene quote_basis/quote_needs_update. Reglas:
--  * Al crear el viaje con total: la base son sus viajeros y fechas.
--  * Si cambia current_quote_id (cotización nueva): debe ser una cotización de ESTE viaje; la base
--    pasa a ser la de esa cotización y deja de necesitar actualización.
--  * Si cambian viajeros o fechas sin cotización nueva: queda marcada para recotizar (la base no
--    cambia: dice para quién se calculó el total que se sigue mostrando).
--  * El cliente no puede escribir estas columnas directamente (se restauran).
CREATE OR REPLACE FUNCTION public.trips_quote_basis_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.current_quote_id := NULL;
    NEW.quote_needs_update := false;
    NEW.quote_basis := CASE WHEN NEW.total_estimado IS NOT NULL THEN jsonb_build_object(
      'num_viajeros', NEW.num_viajeros, 'fecha_salida', NEW.fecha_salida, 'fecha_regreso', NEW.fecha_regreso)
      ELSE NULL END;
    RETURN NEW;
  END IF;

  IF NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id AND NEW.current_quote_id IS NOT NULL THEN
    SELECT trip_id, travelers, date_from, date_to INTO q FROM public.trip_quotes WHERE id = NEW.current_quote_id;
    IF q.trip_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'current_quote_id debe ser una cotización de este viaje';
    END IF;
    NEW.quote_basis := jsonb_build_object('num_viajeros', q.travelers, 'fecha_salida', q.date_from, 'fecha_regreso', q.date_to);
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
    -- Viaje anterior a esta migración: su base son los valores que tenía antes de este cambio.
    NEW.quote_basis := jsonb_build_object(
      'num_viajeros', OLD.num_viajeros, 'fecha_salida', OLD.fecha_salida, 'fecha_regreso', OLD.fecha_regreso);
  END IF;

  IF NEW.quote_basis IS NOT NULL THEN
    NEW.quote_needs_update :=
         ((NEW.quote_basis->>'num_viajeros')::int IS DISTINCT FROM NEW.num_viajeros)
      OR ((NEW.quote_basis->>'fecha_salida')::date IS DISTINCT FROM NEW.fecha_salida)
      OR ((NEW.quote_basis->>'fecha_regreso')::date IS DISTINCT FROM NEW.fecha_regreso);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_quote_basis_guard ON public.trips;
CREATE TRIGGER trips_quote_basis_guard BEFORE INSERT OR UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_quote_basis_guard();

REVOKE EXECUTE ON FUNCTION public.trips_quote_basis_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trip_quotes_before_insert() FROM PUBLIC, anon, authenticated;
