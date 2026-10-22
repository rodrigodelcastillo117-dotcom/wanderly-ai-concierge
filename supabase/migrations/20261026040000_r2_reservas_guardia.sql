-- Ronda r2 (segunda auditoría, grupo reservas) · A2-RES-11 (P3): la guardia de ai_reservations ya no
-- se salta con set_config('aires.actor', …). Idempotente. REQUIERE AUTORIZACIÓN DEL DUEÑO PARA
-- APLICARSE EN PRODUCCIÓN (función apagada).
--
-- Antes, la guardia (20261023170000) solo miraba la variable de sesión aires.actor, que cualquier
-- sesión puede fijar: con la llave de servicio bastaba set_config('aires.actor','sistema') para
-- reescribir una reserva YA confirmada (código, cita, hora) o set_config('aires.actor','equipo') para
-- confirmarla por el canal "equipo" sin funciones. Ahora:
--   * solo escribe quien actúa como DUEÑO de la tabla: las funciones SECURITY DEFINER del esquema
--     (create_intent, claim_send, mark_sent, apply_reply, transition, claim_reminder,
--     claim_alternative). service_role, authenticated o anon directo → 42501, fijen lo que fijen;
--   * además, REVOKE INSERT/UPDATE/DELETE/TRUNCATE de ai_reservations para service_role;
--   * una reserva confirmed congela lo confirmado: fecha y hora, personas, nombre, correo y sitio del
--     lugar, cita/evidencia, código y fecha de confirmación (solo puede pasar a cancelled);
--   * el correo y el sitio web del lugar no cambian después de enviar la solicitud (la regla del
--     remitente de A2-RES-01 depende de ellos).
-- El canal "equipo" sigue existiendo por diseño SOLO a través de ai_reservation_transition (actor
-- 'equipo', confirmation.channel = 'equipo'), que solo ejecuta service_role: es la confirmación humana
-- del equipo (p. ej. el restaurante respondió desde otra dirección y se verificó por teléfono). No
-- tiene llamadas desde el código hoy; ver docs/iatos/cierre2/RESERVAS_BRIDGE.md.

CREATE OR REPLACE FUNCTION public.ai_reservations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_actor text := nullif(current_setting('aires.actor', true), '');
BEGIN
  -- A2-RES-11: la variable de sesión no basta; tiene que escribir una función del servidor (dueño).
  IF v_actor IS NULL OR NOT public.ai_res_trusted_writer(TG_RELID) THEN
    RAISE EXCEPTION 'ai_reservations: solo las funciones del servidor escriben aquí (ni con la llave de servicio)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','awaiting_user_ok','needs_user') THEN
      RAISE EXCEPTION 'ai_reservations: una reserva nace como draft, awaiting_user_ok o needs_user';
    END IF;
    NEW.status_changed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reply_token IS DISTINCT FROM OLD.reply_token
     OR NEW.ref_code IS DISTINCT FROM OLD.ref_code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ai_reservations: usuario, token, folio y fecha de alta no cambian';
  END IF;
  -- A2-RES-11: lo confirmado por escrito no se reescribe.
  IF OLD.status = 'confirmed' AND (
       NEW.requested_local IS DISTINCT FROM OLD.requested_local OR NEW.requested_for IS DISTINCT FROM OLD.requested_for
    OR NEW.party_size IS DISTINCT FROM OLD.party_size OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.venue_email IS DISTINCT FROM OLD.venue_email OR NEW.venue_website IS DISTINCT FROM OLD.venue_website
    OR NEW.confirmation IS DISTINCT FROM OLD.confirmation OR NEW.confirmation_code IS DISTINCT FROM OLD.confirmation_code
    OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.chosen_alternative IS DISTINCT FROM OLD.chosen_alternative) THEN
    RAISE EXCEPTION 'ai_reservations: una reserva confirmada no cambia lo que se confirmó' USING ERRCODE = '42501';
  END IF;
  IF OLD.sent_at IS NOT NULL AND (NEW.venue_email IS DISTINCT FROM OLD.venue_email OR NEW.venue_website IS DISTINCT FROM OLD.venue_website) THEN
    RAISE EXCEPTION 'ai_reservations: el correo y el sitio del lugar no cambian después de escribirle' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.ai_reservation_transition_ok(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'ai_reservations: transición no permitida (% → %)', OLD.status, NEW.status;
    END IF;
    NEW.status_changed_at := now();
    IF NEW.status IN ('declined','expired','cancelled','failed') THEN
      NEW.closed_at := coalesce(NEW.closed_at, now());
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_reservations_guard ON public.ai_reservations;
CREATE TRIGGER ai_reservations_guard BEFORE INSERT OR UPDATE ON public.ai_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservations_guard();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_reservations FROM service_role;
REVOKE ALL ON FUNCTION public.ai_reservations_guard() FROM PUBLIC, anon, authenticated;

-- Alerta: la guardia exige que las funciones que escriben sean del MISMO dueño que la tabla. Si no lo
-- son, las escrituras fallan cerrado (no hay hueco de seguridad, pero la función no serviría): avisar.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.proname IN ('ai_reservation_create_intent', 'ai_reservation_claim_send', 'ai_reservation_mark_sent', 'ai_reservation_apply_reply',
                       'ai_reservation_transition', 'ai_reservation_claim_reminder', 'ai_reservation_claim_alternative',
                       'ai_reservation_inbound_claim', 'ai_reservation_inbound_attach', 'ai_reservation_inbound_finish', 'ai_reservations_log',
                       'purge_account_data')
     AND p.proowner <> (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.ai_reservations'::regclass);
  IF v_bad IS NOT NULL THEN
    RAISE WARNING 'A2-RES-11: estas funciones no son del dueño de ai_reservations y la guardia rechazará sus escrituras: %', v_bad;
  END IF;
END $$;
