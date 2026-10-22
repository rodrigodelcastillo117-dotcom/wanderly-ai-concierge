-- Cierre de auditoría · AUD-04 (docs/iatos/cierre/BRIDGE.md). Idempotente. REQUIERE AUTORIZACIÓN para
-- aplicarse en producción.
--
-- Trazabilidad del destino de salida: booking-bridge puede alinear el destino de una intención viva
-- (antes de salir al proveedor) con la acción que el usuario eligió después, vía
-- booking_intent_transition(_patch.target_url). Hasta ahora el historial solo registraba cambios de
-- estado, verificación y contador de salidas: un cambio de destino no dejaba rastro. Desde aquí,
-- cada cambio de target_url (o de la acción) escribe un evento con el host anterior y el nuevo.
-- booking-go, además, firma la huella SHA-256 del destino: si cambia, el enlace ya emitido deja de
-- servir (supabase/functions/booking-go/go.ts).
CREATE OR REPLACE FUNCTION public.booking_intents_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_note text := left(nullif(current_setting('booking.note', true), ''), 1000);
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.target_url IS DISTINCT FROM OLD.target_url OR NEW.action_kind IS DISTINCT FROM OLD.action_kind)
     AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    v_note := left(concat_ws(' · ', v_note, format('Destino: %s (%s) → %s (%s)',
      coalesce(OLD.target_host, 'sin destino'), OLD.action_kind, coalesce(NEW.target_host, 'sin destino'), NEW.action_kind)), 1000);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.verification IS DISTINCT FROM OLD.verification OR NEW.redirect_count IS DISTINCT FROM OLD.redirect_count
     OR NEW.target_url IS DISTINCT FROM OLD.target_url OR NEW.action_kind IS DISTINCT FROM OLD.action_kind THEN
    INSERT INTO public.booking_intent_events (intent_id, from_state, to_state, actor, actor_id, note)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.state END, NEW.state,
            coalesce(nullif(current_setting('booking.actor', true), ''), 'sistema'),
            nullif(current_setting('booking.actor_id', true), '')::uuid,
            v_note);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.booking_intents_log() FROM PUBLIC, anon, authenticated;
