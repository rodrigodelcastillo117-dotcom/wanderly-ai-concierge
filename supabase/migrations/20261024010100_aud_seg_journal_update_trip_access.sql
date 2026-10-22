-- AUD-SEG-01 (auditoría de cierre, grupo seguridad). Idempotente.
-- journal_update solo pedía author_id = auth.uid(). Un UPDATE sin filtro no requiere permiso de SELECT,
-- así que la política SELECT (has_trip_access) no lo frenaba: el autor expulsado de un viaje seguía
-- reescribiendo sus notas en ese diario y podía mover todas sus notas (trip_id) al viaje de otra persona.
-- Ahora la nota debe estar, antes y después, en un viaje al que el autor tiene acceso.
-- Prueba: supabase/tests/security/aud_seguridad.sql (SG7, SJ5, SJ6).
DROP POLICY IF EXISTS journal_update ON public.trip_journal_entries;
CREATE POLICY journal_update ON public.trip_journal_entries
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.has_trip_access(trip_id, auth.uid()))
  WITH CHECK (author_id = auth.uid() AND public.has_trip_access(trip_id, auth.uid()));
