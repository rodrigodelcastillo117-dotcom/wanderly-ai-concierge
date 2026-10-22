-- Ronda r2 (segunda auditoría, grupo reservas) · A2-RES-10 (P3): el historial y la evidencia no se borran.
-- Idempotente. REQUIERE AUTORIZACIÓN DEL DUEÑO PARA APLICARSE EN PRODUCCIÓN (función apagada).
--
-- Antes, el "solo agregar" de 20261024170000 cubría solo UPDATE: con la llave de servicio se podían
-- hacer DELETE y TRUNCATE de ai_reservation_events, ai_reservation_decisions y del correo sellado en
-- ai_reservation_inbound (quedaba una reserva confirmed sin decisión), y reescribir status/outcome/
-- duplicate_of de un correo ya sellado. Ahora:
--   * triggers BEFORE DELETE (por fila) y BEFORE TRUNCATE (por sentencia) en las cuatro tablas
--     (también ai_reservations, cuyo DELETE borraría la evidencia en cascada): solo pasa quien escribe
--     como DUEÑO de la tabla, es decir, una función SECURITY DEFINER del esquema o una acción de clave
--     foránea (ON DELETE CASCADE corre como el dueño). Es el caso del borrado de cuenta:
--     purge_account_data (SECURITY DEFINER) borra ai_reservations y la cascada borra lo demás.
--     service_role, authenticated y anon directo → 42501, aunque fijen cualquier variable de sesión;
--   * REVOKE de INSERT/UPDATE/DELETE/TRUNCATE para service_role en historial y decisiones, y de
--     DELETE/TRUNCATE en el correo recibido (defensa en profundidad; todo pasa por las funciones);
--   * el correo sellado y terminado (done, duplicate, late, unmatched) no cambia de status, outcome,
--     duplicate_of ni processed_at, tampoco por ai_reservation_inbound_finish.

-- ¿Quien escribe es el dueño de la tabla (función SECURITY DEFINER o cascada) o un superusuario?
-- NO es SECURITY DEFINER a propósito: current_user es el de quien ejecuta la sentencia.
CREATE OR REPLACE FUNCTION public.ai_res_trusted_writer(_rel oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = _rel)
      OR coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false);
$$;

CREATE OR REPLACE FUNCTION public.ai_res_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.ai_res_trusted_writer(TG_RELID) THEN
    RAISE EXCEPTION '%: el historial y la evidencia de las reservas IA no se borran (solo el borrado de cuenta)', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_LEVEL = 'ROW' THEN OLD ELSE NULL END;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_reservations', 'ai_reservation_events', 'ai_reservation_decisions', 'ai_reservation_inbound'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ai_res_no_delete()', t || '_no_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.ai_res_no_delete()', t || '_no_truncate', t);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_reservation_events, public.ai_reservation_decisions FROM service_role;
REVOKE DELETE, TRUNCATE ON public.ai_reservation_inbound FROM service_role;

-- La evidencia sellada no cambia; y un correo ya terminado no cambia de estado (A2-RES-10, A3c).
CREATE OR REPLACE FUNCTION public.ai_reservation_inbound_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.attached_at IS NOT NULL AND (
       NEW.attached_at IS DISTINCT FROM OLD.attached_at OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id OR NEW.email_id IS DISTINCT FROM OLD.email_id
    OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.message_id_hash IS DISTINCT FROM OLD.message_id_hash
    OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256 OR NEW.raw_sha256 IS DISTINCT FROM OLD.raw_sha256
    OR NEW.raw_pointer IS DISTINCT FROM OLD.raw_pointer OR NEW.provider_received_at IS DISTINCT FROM OLD.provider_received_at
    OR NEW.from_address IS DISTINCT FROM OLD.from_address OR NEW.reply_to IS DISTINCT FROM OLD.reply_to
    OR NEW.auth IS DISTINCT FROM OLD.auth OR NEW.reply_text IS DISTINCT FROM OLD.reply_text
    OR NEW.linkage IS DISTINCT FROM OLD.linkage OR NEW.sender IS DISTINCT FROM OLD.sender
    OR NEW.duplicate_of IS DISTINCT FROM OLD.duplicate_of) THEN
    RAISE EXCEPTION 'ai_reservation_inbound: la evidencia del correo recibido no se modifica' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('done', 'duplicate', 'late', 'unmatched') AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.outcome IS DISTINCT FROM OLD.outcome
    OR NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
    RAISE EXCEPTION 'ai_reservation_inbound: un correo ya procesado (%) no cambia de estado', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_reservation_inbound_guard ON public.ai_reservation_inbound;
CREATE TRIGGER ai_reservation_inbound_guard BEFORE UPDATE ON public.ai_reservation_inbound
  FOR EACH ROW EXECUTE FUNCTION public.ai_reservation_inbound_guard();

REVOKE ALL ON FUNCTION public.ai_res_no_delete(), public.ai_reservation_inbound_guard() FROM PUBLIC, anon, authenticated;
-- ai_res_trusted_writer la llaman los triggers con el rol de quien escribe: debe poder ejecutarla.
GRANT EXECUTE ON FUNCTION public.ai_res_trusted_writer(oid) TO PUBLIC;
