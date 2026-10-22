-- r2 grupo (oct 2026): "Ya lo reservé" compartido en el viaje. Idempotente.
--
-- Antes: tocar "Ya lo reservé" en "Comprar mi viaje" solo creaba una fila en public.bookings (status
-- 'pending', raw_payload.compra_item = clave del elemento). bookings es personal (RLS por user_id: lleva
-- precio, código de confirmación y enlaces), así que el dueño y los colaboradores no veían lo que otro ya
-- había reservado y podían comprar dos veces el mismo vuelo u hotel.
--
-- Ahora: trip_purchase_marks guarda UNA marca por (viaje, elemento) con quién la puso y cuándo, visible
-- para todos los miembros del viaje (dueño y colaboradores aceptados) y para nadie más. La fila de
-- bookings se sigue creando (es la constancia personal en "Mis reservas"); aquí solo va lo que el grupo
-- necesita: elemento, categoría, quién y cuándo. Nada de precios ni códigos.
--
-- Reglas (RLS):
--   * leer: solo miembros del viaje (has_trip_access). anon y no miembros no ven nada.
--   * marcar / actualizar: solo miembros y solo a su nombre (marked_by = auth.uid()).
--   * quitar: quien la puso (si sigue en el viaje) o el dueño del viaje.
--   * el nombre y la fecha los pone la base (trigger), no el cliente: no se puede firmar como otro ni
--     inventar la fecha.
-- Las marcas que ya existían en bookings se copian aquí una vez (abajo, ON CONFLICT DO NOTHING); el
-- cliente además copia las suyas al abrir el viaje por si alguna se creó con la versión anterior de la app.

CREATE TABLE IF NOT EXISTS public.trip_purchase_marks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  item_key       text NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 300),
  category       text CHECK (category IS NULL OR category IN ('flight','hotel','car','activity','restaurant')),
  marked_by      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_by_name text,
  marked_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_purchase_marks_trip_item_key UNIQUE (trip_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_trip_purchase_marks_marked_by ON public.trip_purchase_marks(marked_by);

ALTER TABLE public.trip_purchase_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_purchase_marks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_purchase_marks TO authenticated;
GRANT ALL ON public.trip_purchase_marks TO service_role;

-- Nombre y fecha los fija la base. El nombre sale del perfil de quien marca (full_name, si no username);
-- la fecha, de su propia fila de bookings para ese elemento (la marca original, al migrar) o now().
-- En un UPDATE no cambian ni el viaje ni el elemento ni la fecha. Si la cuenta se borra (FK SET NULL),
-- se borra también el nombre.
CREATE OR REPLACE FUNCTION public.trip_purchase_marks_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.trip_id := OLD.trip_id;
    NEW.item_key := OLD.item_key;
    NEW.marked_at := OLD.marked_at;
  ELSE
    SELECT least(min(b.created_at), now()) INTO v_at
      FROM public.bookings b
     WHERE NEW.marked_by IS NOT NULL
       AND b.user_id = NEW.marked_by AND b.trip_id = NEW.trip_id
       AND b.status <> 'cancelled' AND b.raw_payload->>'compra_item' = NEW.item_key;
    NEW.marked_at := coalesce(v_at, now());
  END IF;
  IF NEW.marked_by IS NULL THEN
    NEW.marked_by_name := NULL;
  ELSE
    SELECT left(coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), '')), 80)
      INTO NEW.marked_by_name
      FROM public.profiles p WHERE p.id = NEW.marked_by;
    IF NOT FOUND THEN NEW.marked_by_name := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_purchase_marks_fill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trip_purchase_marks_fill ON public.trip_purchase_marks;
CREATE TRIGGER trg_trip_purchase_marks_fill
  BEFORE INSERT OR UPDATE ON public.trip_purchase_marks
  FOR EACH ROW EXECUTE FUNCTION public.trip_purchase_marks_fill();

-- Al quitar una marca (quien la puso o el dueño) se quita también la constancia "marcado a mano" de
-- quien la puso en bookings: si no, su app la volvería a copiar aquí al abrir el viaje. Solo toca filas
-- pending marcadas a mano para ese viaje y ese elemento; nunca reservas confirmadas.
CREATE OR REPLACE FUNCTION public.trip_purchase_marks_unmark_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.marked_by IS NOT NULL THEN
    DELETE FROM public.bookings b
     WHERE b.user_id = OLD.marked_by AND b.trip_id = OLD.trip_id AND b.status = 'pending'
       AND b.raw_payload->>'compra_item' = OLD.item_key
       AND b.raw_payload->>'marcado_por_usuario' = 'true';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_purchase_marks_unmark_booking() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trip_purchase_marks_unmark_booking ON public.trip_purchase_marks;
CREATE TRIGGER trg_trip_purchase_marks_unmark_booking
  AFTER DELETE ON public.trip_purchase_marks
  FOR EACH ROW EXECUTE FUNCTION public.trip_purchase_marks_unmark_booking();

DROP POLICY IF EXISTS trip_purchase_marks_select_members ON public.trip_purchase_marks;
CREATE POLICY trip_purchase_marks_select_members ON public.trip_purchase_marks
  FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS trip_purchase_marks_insert_self ON public.trip_purchase_marks;
CREATE POLICY trip_purchase_marks_insert_self ON public.trip_purchase_marks
  FOR INSERT TO authenticated
  WITH CHECK (marked_by = auth.uid() AND public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS trip_purchase_marks_update_self ON public.trip_purchase_marks;
CREATE POLICY trip_purchase_marks_update_self ON public.trip_purchase_marks
  FOR UPDATE TO authenticated
  USING (marked_by = auth.uid() AND public.has_trip_access(trip_id, auth.uid()))
  WITH CHECK (marked_by = auth.uid() AND public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS trip_purchase_marks_delete_self_or_owner ON public.trip_purchase_marks;
CREATE POLICY trip_purchase_marks_delete_self_or_owner ON public.trip_purchase_marks
  FOR DELETE TO authenticated
  USING ((marked_by = auth.uid() AND public.has_trip_access(trip_id, auth.uid()))
         OR public.is_trip_owner(trip_id, auth.uid()));

-- Copia única de las marcas que ya estaban en bookings (de miembros que siguen en el viaje). La más
-- antigua gana si dos personas marcaron lo mismo. Repetirla no duplica nada.
INSERT INTO public.trip_purchase_marks (trip_id, item_key, category, marked_by)
SELECT DISTINCT ON (b.trip_id, b.raw_payload->>'compra_item')
       b.trip_id, b.raw_payload->>'compra_item',
       CASE WHEN b.category IN ('flight','hotel','car','activity','restaurant') THEN b.category END,
       b.user_id
  FROM public.bookings b
  JOIN public.trips t ON t.id = b.trip_id
 WHERE b.status <> 'cancelled'
   AND jsonb_typeof(b.raw_payload->'compra_item') = 'string'
   AND char_length(b.raw_payload->>'compra_item') BETWEEN 1 AND 300
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = b.user_id)
   AND (t.user_id = b.user_id
        OR EXISTS (SELECT 1 FROM public.trip_collaborators c
                    WHERE c.trip_id = b.trip_id AND c.user_id = b.user_id AND c.status = 'accepted'))
 ORDER BY b.trip_id, b.raw_payload->>'compra_item', b.created_at, b.id
ON CONFLICT (trip_id, item_key) DO NOTHING;
