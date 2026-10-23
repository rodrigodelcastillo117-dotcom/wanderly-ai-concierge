-- Gastos del viaje estilo Splitwise (oct 2026). Idempotente.
--
-- Antes: "Gastos compartidos" (trip_split_people / trip_split_expenses) tenía personas escritas a mano y
-- cada gasto se dividía en partes iguales entre TODAS las personas del viaje en el momento de leerlo:
-- agregar a alguien cambiaba los saldos de gastos viejos. No había forma de decir entre quiénes ni cómo.
--
-- Ahora:
--   * Personas = miembros reales del viaje (dueño y colaboradores aceptados), ligados por member_id.
--     Las personas escritas a mano se conservan como "sin app" (member_id NULL). Si su nombre coincide
--     sin ambigüedad con un miembro (nombre completo, usuario o nombre de pila único), se ligan a él
--     (linked_by_name = true; el miembro o el dueño pueden deshacerlo). Un miembro puede decir "soy yo"
--     de una persona escrita a mano y sus gastos pasan a su nombre.
--   * Cada gasto guarda entre quiénes se divide (trip_split_shares) y cómo (split_mode: equal, exact,
--     percent). La suma de las partes es exactamente el monto: lo revisa la base al confirmar.
--     Los gastos que ya existían reciben sus partes iguales entre las personas que había (lo mismo que
--     mostraba la app), ANTES de agregar a los miembros: sus saldos no cambian.
--   * "Liquidar" registra un pago entre dos personas (trip_split_payments).
--   * Foto del ticket: bucket privado trip-receipts (<viaje>/<quien subió>/<archivo>); la ve quien la
--     subió y, si es de un gasto compartido, los miembros del viaje. Se purga con el viaje.
--   * Lo personal sigue en public.expenses (solo su dueño). Se agrega la ciudad del viaje.
--
-- Reglas (RLS y triggers):
--   * Solo miembros del viaje leen y escriben lo compartido; anon no tiene ningún permiso.
--   * Quien pagó un gasto es uno mismo o una persona sin app: nadie registra que OTRO miembro pagó.
--   * Montos > 0; las partes suman el total; la persona de cada parte es del mismo viaje.
--   * Editar o borrar un gasto: quien lo registró o el dueño del viaje (los viejos sin autor, cualquier
--     miembro, como antes).
--   * Un pago solo lo registra una de las dos partes (o cualquiera si las dos son personas sin app).

-- ═════════════ Utilidades ═════════════
CREATE OR REPLACE FUNCTION public._split_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(lower(regexp_replace(translate(btrim(coalesce(p, '')),
    'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖáéíóúüñàèìòùâêîôûäëïö', 'AEIOUUNAEIOUAEIOUAEIOaeiouunaeiouaeiouaeio'), '\s+', ' ', 'g')), '');
$$;
REVOKE ALL ON FUNCTION public._split_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._split_norm(text) TO authenticated, service_role;

-- Miembros del viaje: dueño y colaboradores aceptados.
CREATE OR REPLACE FUNCTION public._split_trip_members(p_trip uuid)
RETURNS TABLE (uid uuid, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id, true FROM public.trips t WHERE t.id = p_trip
  UNION
  SELECT c.user_id, false FROM public.trip_collaborators c
   WHERE c.trip_id = p_trip AND c.status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM public.trips t2 WHERE t2.id = p_trip AND t2.user_id = c.user_id);
$$;
REVOKE ALL ON FUNCTION public._split_trip_members(uuid) FROM PUBLIC, anon, authenticated;

-- ═════════════ Personas ═════════════
ALTER TABLE public.trip_split_people ADD COLUMN IF NOT EXISTS member_id uuid;
ALTER TABLE public.trip_split_people ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.trip_split_people ADD COLUMN IF NOT EXISTS linked_by_name boolean NOT NULL DEFAULT false;
ALTER TABLE public.trip_split_people ADD COLUMN IF NOT EXISTS autolink_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE public.trip_split_people ALTER COLUMN created_by SET DEFAULT auth.uid();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_people_member_id_fkey') THEN
    ALTER TABLE public.trip_split_people ADD CONSTRAINT trip_split_people_member_id_fkey
      FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_people_created_by_fkey') THEN
    ALTER TABLE public.trip_split_people ADD CONSTRAINT trip_split_people_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_people_name_len') THEN
    ALTER TABLE public.trip_split_people ADD CONSTRAINT trip_split_people_name_len
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 80) NOT VALID;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_split_people_member ON public.trip_split_people (trip_id, member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_split_people_member ON public.trip_split_people (member_id) WHERE member_id IS NOT NULL;
REVOKE ALL ON public.trip_split_people FROM PUBLIC, anon;

-- El cliente solo crea y renombra personas sin app; quién es miembro lo decide la base (RPC).
CREATE OR REPLACE FUNCTION public.trip_split_people_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
      NEW.member_id := NULL;
      NEW.linked_by_name := false;
      NEW.autolink_blocked := false;
    ELSE
      NEW.id := OLD.id;
      NEW.trip_id := OLD.trip_id;
      NEW.member_id := OLD.member_id;
      NEW.created_by := OLD.created_by;
      NEW.created_at := OLD.created_at;
      NEW.linked_by_name := OLD.linked_by_name;
      NEW.autolink_blocked := OLD.autolink_blocked;
    END IF;
  END IF;
  NEW.name := left(btrim(coalesce(NEW.name, '')), 80);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_people_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_people_guard ON public.trip_split_people;
CREATE TRIGGER trg_trip_split_people_guard BEFORE INSERT OR UPDATE ON public.trip_split_people
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_people_guard();

DROP POLICY IF EXISTS "split_people_all" ON public.trip_split_people;
DROP POLICY IF EXISTS split_people_select ON public.trip_split_people;
CREATE POLICY split_people_select ON public.trip_split_people FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS split_people_insert ON public.trip_split_people;
CREATE POLICY split_people_insert ON public.trip_split_people FOR INSERT TO authenticated
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()) AND member_id IS NULL);
DROP POLICY IF EXISTS split_people_update ON public.trip_split_people;
CREATE POLICY split_people_update ON public.trip_split_people FOR UPDATE TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()) AND member_id IS NULL)
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()) AND member_id IS NULL);
DROP POLICY IF EXISTS split_people_delete ON public.trip_split_people;
CREATE POLICY split_people_delete ON public.trip_split_people FOR DELETE TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()) AND member_id IS NULL);

-- ═════════════ Gastos compartidos ═════════════
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.trip_split_expenses ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'equal';
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS expense_date date;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS merchant text;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS tip numeric(12,2);
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS tax numeric(12,2);
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS receipt_path text;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS scan jsonb;
ALTER TABLE public.trip_split_expenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_expenses_created_by_fkey') THEN
    ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_expenses_split_mode_chk') THEN
    ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_split_mode_chk
      CHECK (split_mode IN ('equal', 'exact', 'percent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_split_expenses_extras_chk') THEN
    ALTER TABLE public.trip_split_expenses ADD CONSTRAINT trip_split_expenses_extras_chk CHECK (
      (tip IS NULL OR tip >= 0) AND (tax IS NULL OR tax >= 0)
      AND (category IS NULL OR char_length(category) <= 60)
      AND (city IS NULL OR char_length(city) <= 80)
      AND (merchant IS NULL OR char_length(merchant) <= 120)
      AND char_length(description) <= 200
      AND (scan IS NULL OR pg_column_size(scan) <= 16000)
      AND (receipt_path IS NULL OR (receipt_path LIKE trip_id::text || '/%' AND position('..' IN receipt_path) = 0))
    ) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_split_exp_payer ON public.trip_split_expenses (payer_id);
REVOKE ALL ON public.trip_split_expenses FROM PUBLIC, anon;

-- ¿Puede la sesión editar/borrar este gasto (y sus partes)?
CREATE OR REPLACE FUNCTION public.trip_split_can_edit(p_expense uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_split_expenses e
     WHERE e.id = p_expense
       AND public.has_trip_access(e.trip_id, auth.uid())
       AND (e.created_by = auth.uid() OR e.created_by IS NULL OR public.is_trip_owner(e.trip_id, auth.uid()))
  );
$$;
REVOKE ALL ON FUNCTION public.trip_split_can_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_can_edit(uuid) TO authenticated, service_role;

-- Autor, viaje inmutable y quién pagó: uno mismo o una persona sin app del MISMO viaje.
CREATE OR REPLACE FUNCTION public.trip_split_expenses_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_found boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.trip_id := OLD.trip_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  SELECT p.member_id, true INTO v_member, v_found
    FROM public.trip_split_people p WHERE p.id = NEW.payer_id AND p.trip_id = NEW.trip_id;
  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'split_payer_other_trip: quien pagó no es de este viaje' USING ERRCODE = '23514';
  END IF;
  -- Desde la app (rol del usuario, sin pasar por el servidor): no se firma como otro miembro.
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
    IF (TG_OP = 'INSERT' OR NEW.payer_id IS DISTINCT FROM OLD.payer_id)
       AND v_member IS NOT NULL AND v_member IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'split_payer_not_you: no puedes registrar que otro miembro pagó; que lo registre esa persona' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_expenses_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_expenses_guard ON public.trip_split_expenses;
CREATE TRIGGER trg_trip_split_expenses_guard BEFORE INSERT OR UPDATE ON public.trip_split_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_expenses_guard();

DROP POLICY IF EXISTS "split_exp_all" ON public.trip_split_expenses;
DROP POLICY IF EXISTS split_exp_select ON public.trip_split_expenses;
CREATE POLICY split_exp_select ON public.trip_split_expenses FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS split_exp_insert ON public.trip_split_expenses;
CREATE POLICY split_exp_insert ON public.trip_split_expenses FOR INSERT TO authenticated
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS split_exp_update ON public.trip_split_expenses;
CREATE POLICY split_exp_update ON public.trip_split_expenses FOR UPDATE TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid())
         AND (created_by = auth.uid() OR created_by IS NULL OR public.is_trip_owner(trip_id, auth.uid())))
  WITH CHECK (public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS split_exp_delete ON public.trip_split_expenses;
CREATE POLICY split_exp_delete ON public.trip_split_expenses FOR DELETE TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid())
         AND (created_by = auth.uid() OR created_by IS NULL OR public.is_trip_owner(trip_id, auth.uid())));

-- ═════════════ Partes de cada gasto ═════════════
CREATE TABLE IF NOT EXISTS public.trip_split_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.trip_split_expenses(id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES public.trip_split_people(id) ON DELETE NO ACTION,
  trip_id    uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  amount     numeric(12,2) NOT NULL CONSTRAINT trip_split_shares_amount_positive CHECK (amount > 0),
  percent    numeric(7,4) CONSTRAINT trip_split_shares_percent_range CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_split_shares_expense_person UNIQUE (expense_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_split_shares_person ON public.trip_split_shares (person_id);
CREATE INDEX IF NOT EXISTS idx_split_shares_trip ON public.trip_split_shares (trip_id);
ALTER TABLE public.trip_split_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_split_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_split_shares TO authenticated;
GRANT ALL ON public.trip_split_shares TO service_role;

CREATE OR REPLACE FUNCTION public.trip_split_shares_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.expense_id := OLD.expense_id;
    NEW.person_id := OLD.person_id;
  END IF;
  SELECT e.trip_id INTO v_trip FROM public.trip_split_expenses e WHERE e.id = NEW.expense_id;
  NEW.trip_id := v_trip;
  IF NOT EXISTS (SELECT 1 FROM public.trip_split_people p WHERE p.id = NEW.person_id AND p.trip_id = v_trip) THEN
    RAISE EXCEPTION 'split_share_other_trip: la persona no es de este viaje' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_shares_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_shares_guard ON public.trip_split_shares;
CREATE TRIGGER trg_trip_split_shares_guard BEFORE INSERT OR UPDATE ON public.trip_split_shares
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_shares_guard();

DROP POLICY IF EXISTS split_shares_select ON public.trip_split_shares;
CREATE POLICY split_shares_select ON public.trip_split_shares FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS split_shares_insert ON public.trip_split_shares;
CREATE POLICY split_shares_insert ON public.trip_split_shares FOR INSERT TO authenticated
  WITH CHECK (public.trip_split_can_edit(expense_id));
DROP POLICY IF EXISTS split_shares_update ON public.trip_split_shares;
CREATE POLICY split_shares_update ON public.trip_split_shares FOR UPDATE TO authenticated
  USING (public.trip_split_can_edit(expense_id)) WITH CHECK (public.trip_split_can_edit(expense_id));
DROP POLICY IF EXISTS split_shares_delete ON public.trip_split_shares;
CREATE POLICY split_shares_delete ON public.trip_split_shares FOR DELETE TO authenticated
  USING (public.trip_split_can_edit(expense_id));

-- Partes iguales entre p_people (centavos que sobran: a los primeros). Reemplaza las partes del gasto.
CREATE OR REPLACE FUNCTION public._split_equal_assign(p_expense uuid, p_people uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_trip uuid;
  v_n integer := coalesce(array_length(p_people, 1), 0);
BEGIN
  SELECT round(e.amount * 100)::bigint, e.trip_id INTO v_total, v_trip FROM public.trip_split_expenses e WHERE e.id = p_expense;
  IF v_total IS NULL OR v_total <= 0 OR v_n = 0 THEN RETURN; END IF;
  DELETE FROM public.trip_split_shares WHERE expense_id = p_expense;
  INSERT INTO public.trip_split_shares (expense_id, person_id, trip_id, amount)
  SELECT p_expense, u.pid, v_trip, (v_total / v_n + CASE WHEN u.ord <= v_total % v_n THEN 1 ELSE 0 END)::numeric / 100
    FROM unnest(p_people) WITH ORDINALITY AS u(pid, ord)
   WHERE v_total / v_n + CASE WHEN u.ord <= v_total % v_n THEN 1 ELSE 0 END > 0;
END;
$$;
REVOKE ALL ON FUNCTION public._split_equal_assign(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Un gasto insertado sin partes (versión anterior de la app o API directa) se divide en partes iguales
-- entre las personas del viaje EN ESE MOMENTO, como hacía la app. trip_split_save_expense manda sus
-- partes explícitas y se salta esto.
CREATE OR REPLACE FUNCTION public.trip_split_expenses_default_shares()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('iatos.split_explicit', true), '') = 'on' THEN RETURN NULL; END IF;
  IF NEW.amount > 0 AND NOT EXISTS (SELECT 1 FROM public.trip_split_shares s WHERE s.expense_id = NEW.id) THEN
    PERFORM public._split_equal_assign(NEW.id,
      ARRAY(SELECT p.id FROM public.trip_split_people p WHERE p.trip_id = NEW.trip_id ORDER BY p.created_at, p.id));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_expenses_default_shares() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_expenses_default_shares ON public.trip_split_expenses;
CREATE TRIGGER trg_trip_split_expenses_default_shares AFTER INSERT ON public.trip_split_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_expenses_default_shares();

-- Al confirmar: las partes de cada gasto tocado suman exactamente su monto (y hay al menos una).
CREATE OR REPLACE FUNCTION public.trip_split_check_sum()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_amount numeric;
  v_sum numeric;
  v_n integer;
BEGIN
  IF TG_TABLE_NAME = 'trip_split_expenses' THEN
    v_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_id := OLD.expense_id;
  ELSE
    v_id := NEW.expense_id;
  END IF;
  SELECT e.amount INTO v_amount FROM public.trip_split_expenses e WHERE e.id = v_id;
  IF NOT FOUND OR v_amount IS NULL OR v_amount <= 0 THEN RETURN NULL; END IF;
  SELECT count(*), coalesce(sum(s.amount), 0) INTO v_n, v_sum FROM public.trip_split_shares s WHERE s.expense_id = v_id;
  IF v_n = 0 OR v_sum <> v_amount THEN
    RAISE EXCEPTION 'split_sum_mismatch: las partes suman % y el gasto es de %', v_sum, v_amount USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_check_sum() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_shares_sum ON public.trip_split_shares;
CREATE CONSTRAINT TRIGGER trg_trip_split_shares_sum AFTER INSERT OR UPDATE OR DELETE ON public.trip_split_shares
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trip_split_check_sum();
DROP TRIGGER IF EXISTS trg_trip_split_expenses_sum ON public.trip_split_expenses;
CREATE CONSTRAINT TRIGGER trg_trip_split_expenses_sum AFTER INSERT OR UPDATE OF amount ON public.trip_split_expenses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trip_split_check_sum();

-- Foto del ticket de un gasto borrado (o reemplazada): a la cola de purga de storage.
CREATE OR REPLACE FUNCTION public.trip_split_expenses_queue_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.receipt_path IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.receipt_path IS DISTINCT FROM OLD.receipt_path) THEN
    INSERT INTO public.storage_purge_queue (bucket_id, name, user_id, reason)
    VALUES ('trip-receipts', OLD.receipt_path, (SELECT t.user_id FROM public.trips t WHERE t.id = OLD.trip_id), 'huerfano')
    ON CONFLICT (bucket_id, name) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_expenses_queue_receipt() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_expenses_queue_receipt ON public.trip_split_expenses;
CREATE TRIGGER trg_trip_split_expenses_queue_receipt AFTER UPDATE OR DELETE ON public.trip_split_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_expenses_queue_receipt();

-- ═════════════ Pagos para liquidar ═════════════
CREATE TABLE IF NOT EXISTS public.trip_split_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  from_person uuid NOT NULL REFERENCES public.trip_split_people(id) ON DELETE NO ACTION,
  to_person   uuid NOT NULL REFERENCES public.trip_split_people(id) ON DELETE NO ACTION,
  amount      numeric(12,2) NOT NULL CONSTRAINT trip_split_payments_amount_positive CHECK (amount > 0),
  currency    text NOT NULL DEFAULT 'MXN' CONSTRAINT trip_split_payments_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  note        text CONSTRAINT trip_split_payments_note_len CHECK (note IS NULL OR char_length(note) <= 200),
  paid_on     date NOT NULL DEFAULT CURRENT_DATE,
  created_by  uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_split_payments_two_people CHECK (from_person <> to_person)
);
CREATE INDEX IF NOT EXISTS idx_split_payments_trip ON public.trip_split_payments (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_split_payments_from ON public.trip_split_payments (from_person);
CREATE INDEX IF NOT EXISTS idx_split_payments_to ON public.trip_split_payments (to_person);
ALTER TABLE public.trip_split_payments ENABLE ROW LEVEL SECURITY;
-- Un pago no se edita: se borra y se registra otro.
REVOKE ALL ON public.trip_split_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.trip_split_payments TO authenticated;
GRANT ALL ON public.trip_split_payments TO service_role;

-- ¿La sesión es parte del pago? (es quien paga o quien recibe; o las dos personas son sin app).
CREATE OR REPLACE FUNCTION public.trip_split_payment_party_ok(p_trip uuid, p_from uuid, p_to uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_trip_access(p_trip, auth.uid())
     AND (
       EXISTS (SELECT 1 FROM public.trip_split_people p
                WHERE p.trip_id = p_trip AND p.id IN (p_from, p_to) AND p.member_id = auth.uid())
       OR NOT EXISTS (SELECT 1 FROM public.trip_split_people p
                       WHERE p.trip_id = p_trip AND p.id IN (p_from, p_to) AND p.member_id IS NOT NULL)
     );
$$;
REVOKE ALL ON FUNCTION public.trip_split_payment_party_ok(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_payment_party_ok(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trip_split_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.trip_split_people p WHERE p.id IN (NEW.from_person, NEW.to_person) AND p.trip_id = NEW.trip_id) <> 2 THEN
    RAISE EXCEPTION 'split_payment_other_trip: las dos personas deben ser de este viaje' USING ERRCODE = '23514';
  END IF;
  IF coalesce(auth.role(), '') = 'authenticated' THEN NEW.created_by := auth.uid(); END IF;
  NEW.currency := upper(NEW.currency);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_payments_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_payments_guard ON public.trip_split_payments;
CREATE TRIGGER trg_trip_split_payments_guard BEFORE INSERT ON public.trip_split_payments
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_payments_guard();

DROP POLICY IF EXISTS split_payments_select ON public.trip_split_payments;
CREATE POLICY split_payments_select ON public.trip_split_payments FOR SELECT TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS split_payments_insert ON public.trip_split_payments;
CREATE POLICY split_payments_insert ON public.trip_split_payments FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.trip_split_payment_party_ok(trip_id, from_person, to_person));
DROP POLICY IF EXISTS split_payments_delete ON public.trip_split_payments;
CREATE POLICY split_payments_delete ON public.trip_split_payments FOR DELETE TO authenticated
  USING (public.has_trip_access(trip_id, auth.uid())
         AND (created_by = auth.uid() OR public.is_trip_owner(trip_id, auth.uid())));

-- ═════════════ Quitar a una persona sin app ═════════════
-- Con pagos (pagó un gasto o tiene pagos de liquidación) no se puede. Si solo participaba en gastos
-- divididos en partes iguales, esas partes se reparten entre los demás participantes (lo que hacía la
-- app). En divisiones exactas o por porcentaje no se adivina: hay que editar el gasto primero.
-- Al borrar el viaje (cascada) no se revisa nada.
CREATE OR REPLACE FUNCTION public.trip_split_people_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
BEGIN
  IF pg_trigger_depth() > 1 OR NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = OLD.trip_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_split_expenses e WHERE e.payer_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.trip_split_payments p WHERE p.from_person = OLD.id OR p.to_person = OLD.id) THEN
    RAISE EXCEPTION 'split_person_has_payments: esta persona tiene pagos registrados' USING ERRCODE = '23503';
  END IF;
  FOR s IN SELECT sh.expense_id, e.split_mode FROM public.trip_split_shares sh
             JOIN public.trip_split_expenses e ON e.id = sh.expense_id WHERE sh.person_id = OLD.id LOOP
    IF s.split_mode <> 'equal' OR NOT EXISTS (
         SELECT 1 FROM public.trip_split_shares o WHERE o.expense_id = s.expense_id AND o.person_id <> OLD.id) THEN
      RAISE EXCEPTION 'split_person_in_expense: esta persona está en un gasto; edítalo primero' USING ERRCODE = '23503';
    END IF;
    PERFORM public._split_equal_assign(s.expense_id, ARRAY(
      SELECT o.person_id FROM public.trip_split_shares o JOIN public.trip_split_people pp ON pp.id = o.person_id
       WHERE o.expense_id = s.expense_id AND o.person_id <> OLD.id ORDER BY pp.created_at, pp.id));
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_people_before_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_trip_split_people_before_delete ON public.trip_split_people;
CREATE TRIGGER trg_trip_split_people_before_delete BEFORE DELETE ON public.trip_split_people
  FOR EACH ROW EXECUTE FUNCTION public.trip_split_people_before_delete();

-- ═════════════ Miembros: lista, sincronía y "soy yo" ═════════════
-- Nombre y avatar de los miembros del viaje, solo para otro miembro del mismo viaje.
CREATE OR REPLACE FUNCTION public.trip_split_members(p_trip uuid)
RETURNS TABLE (user_id uuid, name text, avatar_url text, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.uid,
         left(coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''), 'Miembro del viaje'), 80),
         p.avatar_url,
         m.is_owner
    FROM public._split_trip_members(p_trip) m
    LEFT JOIN public.profiles p ON p.id = m.uid
   WHERE auth.uid() IS NOT NULL AND public.has_trip_access(p_trip, auth.uid())
   ORDER BY m.is_owner DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.trip_split_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_members(uuid) TO authenticated, service_role;

-- Cada miembro tiene su persona. Una persona escrita a mano se liga a un miembro solo si su nombre
-- coincide sin ambigüedad (nombre completo, usuario o nombre de pila) en los dos sentidos.
CREATE OR REPLACE FUNCTION public._split_sync_trip(p_trip uuid, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked integer := 0;
  v_added integer := 0;
BEGIN
  WITH m AS (
    SELECT mb.uid, public._split_norm(p.full_name) AS fn, public._split_norm(p.username) AS un
      FROM public._split_trip_members(p_trip) mb
      JOIN auth.users u ON u.id = mb.uid
      LEFT JOIN public.profiles p ON p.id = mb.uid
     WHERE NOT EXISTS (SELECT 1 FROM public.trip_split_people x WHERE x.trip_id = p_trip AND x.member_id = mb.uid)
  ), g AS (
    SELECT x.id, public._split_norm(x.name) AS nn FROM public.trip_split_people x
     WHERE x.trip_id = p_trip AND x.member_id IS NULL AND NOT x.autolink_blocked
  ), pairs AS (
    SELECT DISTINCT m.uid, g.id AS gid FROM m JOIN g
      ON g.nn IS NOT NULL AND (g.nn = m.fn OR g.nn = m.un OR g.nn = split_part(m.fn, ' ', 1))
  ), uniq AS (
    SELECT p1.uid, p1.gid FROM pairs p1
     WHERE (SELECT count(*) FROM pairs p2 WHERE p2.uid = p1.uid) = 1
       AND (SELECT count(*) FROM pairs p3 WHERE p3.gid = p1.gid) = 1
  )
  UPDATE public.trip_split_people x SET member_id = uniq.uid, linked_by_name = true
    FROM uniq WHERE x.id = uniq.gid;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  INSERT INTO public.trip_split_people (trip_id, name, member_id, created_by)
  SELECT p_trip,
         left(coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''), 'Miembro del viaje'), 80),
         mb.uid, p_actor
    FROM public._split_trip_members(p_trip) mb
    JOIN auth.users u ON u.id = mb.uid
    LEFT JOIN public.profiles p ON p.id = mb.uid
   WHERE NOT EXISTS (SELECT 1 FROM public.trip_split_people x WHERE x.trip_id = p_trip AND x.member_id = mb.uid)
  ON CONFLICT (trip_id, member_id) WHERE member_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_linked + v_added;
END;
$$;
REVOKE ALL ON FUNCTION public._split_sync_trip(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trip_split_sync_members(p_trip uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_trip_access(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'no_access' USING ERRCODE = '42501';
  END IF;
  RETURN public._split_sync_trip(p_trip, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_sync_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_sync_members(uuid) TO authenticated, service_role;

-- "Esta persona soy yo": la persona escrita a mano pasa a ser la del miembro que lo dice (sus gastos,
-- partes y pagos se juntan con los suyos). Solo uno mismo puede decirlo.
CREATE OR REPLACE FUNCTION public.trip_split_claim_guest(p_guest uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.trip_split_people%ROWTYPE;
  v_me uuid;
BEGIN
  SELECT * INTO g FROM public.trip_split_people WHERE id = p_guest FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.has_trip_access(g.trip_id, auth.uid()) THEN
    RAISE EXCEPTION 'no_access' USING ERRCODE = '42501';
  END IF;
  IF g.member_id IS NOT NULL THEN
    RAISE EXCEPTION 'split_not_guest: esta persona ya es un miembro' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_me FROM public.trip_split_people WHERE trip_id = g.trip_id AND member_id = auth.uid() FOR UPDATE;
  IF v_me IS NULL THEN
    UPDATE public.trip_split_people SET member_id = auth.uid(), linked_by_name = false WHERE id = g.id;
    RETURN g.id;
  END IF;
  UPDATE public.trip_split_expenses SET payer_id = v_me WHERE payer_id = g.id;
  -- Gastos donde ya estaban los dos: se suman las partes.
  UPDATE public.trip_split_shares mine SET amount = mine.amount + gs.amount,
         percent = CASE WHEN mine.percent IS NOT NULL AND gs.percent IS NOT NULL THEN least(100, mine.percent + gs.percent) END
    FROM public.trip_split_shares gs
   WHERE gs.person_id = g.id AND mine.person_id = v_me AND mine.expense_id = gs.expense_id;
  DELETE FROM public.trip_split_shares gs
   WHERE gs.person_id = g.id AND EXISTS (SELECT 1 FROM public.trip_split_shares mine WHERE mine.expense_id = gs.expense_id AND mine.person_id = v_me);
  UPDATE public.trip_split_shares SET person_id = v_me WHERE person_id = g.id;
  DELETE FROM public.trip_split_payments WHERE (from_person = g.id AND to_person = v_me) OR (from_person = v_me AND to_person = g.id);
  UPDATE public.trip_split_payments SET from_person = v_me WHERE from_person = g.id;
  UPDATE public.trip_split_payments SET to_person = v_me WHERE to_person = g.id;
  DELETE FROM public.trip_split_people WHERE id = g.id;
  RETURN v_me;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_claim_guest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_claim_guest(uuid) TO authenticated, service_role;

-- Deshacer una liga hecha por nombre (el propio miembro o el dueño): vuelve a ser persona sin app y no
-- se vuelve a ligar sola.
CREATE OR REPLACE FUNCTION public.trip_split_unlink(p_person uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.trip_split_people%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.trip_split_people WHERE id = p_person FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.has_trip_access(r.trip_id, auth.uid())
     OR NOT (r.member_id = auth.uid() OR public.is_trip_owner(r.trip_id, auth.uid())) THEN
    RAISE EXCEPTION 'no_access' USING ERRCODE = '42501';
  END IF;
  IF NOT r.linked_by_name THEN
    RAISE EXCEPTION 'split_not_linked_by_name' USING ERRCODE = '23514';
  END IF;
  UPDATE public.trip_split_people SET member_id = NULL, linked_by_name = false, autolink_blocked = true WHERE id = r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_unlink(uuid) TO authenticated, service_role;

-- Guardar un gasto compartido con sus partes, todo junto (una transacción). Corre con los permisos de
-- quien llama: aplican RLS y triggers; al confirmar se revisa que las partes sumen el total.
-- p_expense: {payer_id, amount, currency, description, category, expense_date, city, merchant, tip, tax,
--             receipt_path, split_mode, scan}; p_shares: [{person_id, amount, percent?}].
CREATE OR REPLACE FUNCTION public.trip_split_save_expense(p_trip uuid, p_expense jsonb, p_shares jsonb, p_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF jsonb_typeof(p_shares) <> 'array' OR jsonb_array_length(p_shares) = 0 OR jsonb_array_length(p_shares) > 50 THEN
    RAISE EXCEPTION 'split_sum_mismatch: el gasto necesita al menos una persona' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('iatos.split_explicit', 'on', true);
  IF p_id IS NULL THEN
    INSERT INTO public.trip_split_expenses (trip_id, payer_id, amount, currency, description, category, expense_date,
                                            city, merchant, tip, tax, receipt_path, split_mode, scan)
    VALUES (p_trip, (p_expense->>'payer_id')::uuid, (p_expense->>'amount')::numeric,
            upper(coalesce(nullif(p_expense->>'currency', ''), 'MXN')),
            left(coalesce(nullif(btrim(p_expense->>'description'), ''), 'Gasto'), 200),
            nullif(p_expense->>'category', ''), nullif(p_expense->>'expense_date', '')::date,
            nullif(p_expense->>'city', ''), nullif(p_expense->>'merchant', ''),
            nullif(p_expense->>'tip', '')::numeric, nullif(p_expense->>'tax', '')::numeric,
            nullif(p_expense->>'receipt_path', ''), coalesce(nullif(p_expense->>'split_mode', ''), 'equal'),
            CASE WHEN jsonb_typeof(p_expense->'scan') = 'object' THEN p_expense->'scan' END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.trip_split_expenses SET
      payer_id = (p_expense->>'payer_id')::uuid,
      amount = (p_expense->>'amount')::numeric,
      currency = upper(coalesce(nullif(p_expense->>'currency', ''), 'MXN')),
      description = left(coalesce(nullif(btrim(p_expense->>'description'), ''), 'Gasto'), 200),
      category = nullif(p_expense->>'category', ''),
      expense_date = nullif(p_expense->>'expense_date', '')::date,
      city = nullif(p_expense->>'city', ''),
      merchant = nullif(p_expense->>'merchant', ''),
      tip = nullif(p_expense->>'tip', '')::numeric,
      tax = nullif(p_expense->>'tax', '')::numeric,
      split_mode = coalesce(nullif(p_expense->>'split_mode', ''), 'equal')
     WHERE id = p_id AND trip_id = p_trip
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'no_access' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.trip_split_shares WHERE expense_id = v_id;
  END IF;
  INSERT INTO public.trip_split_shares (expense_id, person_id, trip_id, amount, percent)
  SELECT v_id, (x->>'person_id')::uuid, p_trip, (x->>'amount')::numeric, nullif(x->>'percent', '')::numeric
    FROM jsonb_array_elements(p_shares) AS x;
  PERFORM set_config('iatos.split_explicit', '', true);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.trip_split_save_expense(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_split_save_expense(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;

-- Mi parte de cada gasto compartido de mis viajes (para "Gastos" del viaje y el resumen del dashboard).
CREATE OR REPLACE FUNCTION public.my_split_shares(p_trip uuid DEFAULT NULL)
RETURNS TABLE (share_id uuid, expense_id uuid, trip_id uuid, amount numeric, currency text, category text,
               description text, expense_date date, city text, total numeric, payer_name text, paid_by_me boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT sh.id, e.id, e.trip_id, sh.amount, e.currency, coalesce(e.category, 'Otros'), e.description,
         coalesce(e.expense_date, (e.created_at AT TIME ZONE 'America/Mexico_City')::date), e.city, e.amount,
         pp.name, coalesce(pp.member_id = auth.uid(), false)
    FROM public.trip_split_shares sh
    JOIN public.trip_split_people me ON me.id = sh.person_id AND me.member_id = auth.uid()
    JOIN public.trip_split_expenses e ON e.id = sh.expense_id
    JOIN public.trip_split_people pp ON pp.id = e.payer_id
   WHERE auth.uid() IS NOT NULL AND (p_trip IS NULL OR e.trip_id = p_trip)
   ORDER BY 8 DESC, e.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_split_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_split_shares(uuid) TO authenticated, service_role;

-- ═════════════ Gastos personales ═════════════
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS city text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_city_len') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_city_len CHECK (city IS NULL OR char_length(city) <= 80) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_amount_positive') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0) NOT VALID;
  END IF;
END $$;

-- ═════════════ Foto del ticket: bucket privado trip-receipts ═════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-receipts', 'trip-receipts', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Ruta <viaje>/<quien subió>/<archivo> → viaje (NULL si la ruta no tiene esa forma).
CREATE OR REPLACE FUNCTION public.trip_receipt_path_trip(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$'
         AND position('..' IN p_name) = 0
    THEN split_part(p_name, '/', 1)::uuid
  END;
$$;
REVOKE ALL ON FUNCTION public.trip_receipt_path_trip(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_receipt_path_trip(text) TO authenticated, service_role;

DROP POLICY IF EXISTS trip_receipts_insert ON storage.objects;
CREATE POLICY trip_receipts_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trip-receipts'
              AND split_part(name, '/', 2) = auth.uid()::text
              AND public.has_trip_access(public.trip_receipt_path_trip(name), auth.uid()));
-- La ve quien la subió y, si ya es de un gasto compartido, los miembros del viaje.
DROP POLICY IF EXISTS trip_receipts_select ON storage.objects;
CREATE POLICY trip_receipts_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'trip-receipts'
         AND public.has_trip_access(public.trip_receipt_path_trip(name), auth.uid())
         AND (split_part(name, '/', 2) = auth.uid()::text
              OR EXISTS (SELECT 1 FROM public.trip_split_expenses e
                          WHERE e.receipt_path = storage.objects.name
                            AND e.trip_id = public.trip_receipt_path_trip(storage.objects.name))));
DROP POLICY IF EXISTS trip_receipts_delete ON storage.objects;
CREATE POLICY trip_receipts_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trip-receipts'
         AND split_part(name, '/', 2) = auth.uid()::text
         AND public.has_trip_access(public.trip_receipt_path_trip(name), auth.uid()));

-- Purga con el viaje: la versión de 20261026130000 + las fotos de tickets del viaje.
CREATE OR REPLACE FUNCTION public.trips_queue_storage_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.storage_purge_queue (bucket_id, name, user_id, reason)
  SELECT o.bucket_id, o.name, OLD.user_id, 'trip_deleted'
    FROM storage.objects o
   WHERE (o.bucket_id = 'trip-documents' AND public.trip_document_path_trip(o.name) = OLD.id)
      OR (o.bucket_id = 'journal-photos' AND split_part(o.name, '/', 2) = OLD.id::text)
      OR (o.bucket_id = 'trip-receipts' AND split_part(o.name, '/', 1) = OLD.id::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.trips_queue_storage_purge() FROM PUBLIC, anon, authenticated;

-- ═════════════ Datos que ya existían ═════════════
-- 1) Los gastos viejos reciben sus partes iguales entre las personas que había (el orden de la app:
--    por fecha de alta; los centavos que sobran, a las primeras). Sus saldos no cambian.
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT x.id, x.trip_id FROM public.trip_split_expenses x
            WHERE x.amount > 0 AND NOT EXISTS (SELECT 1 FROM public.trip_split_shares s WHERE s.expense_id = x.id) LOOP
    PERFORM public._split_equal_assign(e.id,
      ARRAY(SELECT p.id FROM public.trip_split_people p WHERE p.trip_id = e.trip_id ORDER BY p.created_at, p.id));
  END LOOP;
END $$;
-- 2) Después, en los viajes que ya usaban gastos compartidos: cada miembro tiene su persona y los
--    nombres escritos a mano que coinciden sin duda se ligan (ninguno se borra).
SELECT public._split_sync_trip(t.trip_id, NULL)
  FROM (SELECT DISTINCT trip_id FROM public.trip_split_people) t
  JOIN public.trips tr ON tr.id = t.trip_id;
