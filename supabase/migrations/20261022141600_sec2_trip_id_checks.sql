-- F-15 (IATOS-106): referencias trip_id sin validar. Idempotente.
-- Las políticas de INSERT/UPDATE solo exigían auth.uid() = user_id, así que un usuario podía
-- colgar sus filas de un viaje ajeno: en packing_lists (trip_id UNIQUE) eso le "ocupaba" la lista
-- al dueño real, y en las demás tablas mezclaba datos en viajes de otros.
-- Ahora el trip_id, si viene, debe ser un viaje al que el usuario tiene acceso (dueño o
-- colaborador aceptado). Las filas existentes no se tocan.

-- 1) FKs faltantes (NOT VALID: no revisa filas viejas; sí las nuevas y los cambios de trip_id).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concierge_requests_trip_fk') THEN
    ALTER TABLE public.concierge_requests ADD CONSTRAINT concierge_requests_trip_fk
      FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_flights_trip_fk') THEN
    ALTER TABLE public.tracked_flights ADD CONSTRAINT tracked_flights_trip_fk
      FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- 2) WITH CHECK con acceso al viaje. Mismo nombre, comando y roles que la política original.
DROP POLICY IF EXISTS "Users insert own bookings" ON public.bookings;
CREATE POLICY "Users insert own bookings" ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own bookings" ON public.bookings;
CREATE POLICY "Users update own bookings" ON public.bookings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own expenses" ON public.expenses;
CREATE POLICY "Users insert own expenses" ON public.expenses FOR INSERT
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own expenses" ON public.expenses;
CREATE POLICY "Users update own expenses" ON public.expenses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own conversations" ON public.concierge_conversations;
CREATE POLICY "Users insert own conversations" ON public.concierge_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own conversations" ON public.concierge_conversations;
CREATE POLICY "Users update own conversations" ON public.concierge_conversations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own concierge_requests" ON public.concierge_requests;
CREATE POLICY "Users insert own concierge_requests" ON public.concierge_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own concierge_requests" ON public.concierge_requests;
CREATE POLICY "Users update own concierge_requests" ON public.concierge_requests FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own visits" ON public.user_visits;
CREATE POLICY "Users insert own visits" ON public.user_visits FOR INSERT
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own visits" ON public.user_visits;
CREATE POLICY "Users update own visits" ON public.user_visits FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

DROP POLICY IF EXISTS "Users insert own packing lists" ON public.packing_lists;
CREATE POLICY "Users insert own packing lists" ON public.packing_lists FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_trip_access(trip_id, auth.uid()));
DROP POLICY IF EXISTS "Users update own packing lists" ON public.packing_lists;
CREATE POLICY "Users update own packing lists" ON public.packing_lists FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.has_trip_access(trip_id, auth.uid()));

DROP POLICY IF EXISTS "Users insert own escalations" ON public.fixer_escalations;
CREATE POLICY "Users insert own escalations" ON public.fixer_escalations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS "Users update own escalations" ON public.fixer_escalations;
CREATE POLICY "Users update own escalations" ON public.fixer_escalations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));

-- tracked_flights: el cliente ya no tiene INSERT/UPDATE (lo hace track-flight con service role);
-- las políticas se alinean igual por si un GRANT futuro los regresa.
DROP POLICY IF EXISTS tf_insert_own ON public.tracked_flights;
CREATE POLICY tf_insert_own ON public.tracked_flights FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
DROP POLICY IF EXISTS tf_update_own ON public.tracked_flights;
CREATE POLICY tf_update_own ON public.tracked_flights FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND (trip_id IS NULL OR public.has_trip_access(trip_id, auth.uid())));
