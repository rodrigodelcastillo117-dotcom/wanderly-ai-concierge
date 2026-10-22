-- Configuración comercial pública que el frontend necesita para mostrar el texto correcto:
-- con trial_no_card_enabled apagado la prueba de 30 días se activa en Stripe con tarjeta; encendido,
-- es la prueba sin tarjeta al confirmar el correo (DEC-02). Solo expone booleanos, nunca app_flags
-- completo. Idempotente.
CREATE OR REPLACE FUNCTION public.public_plan_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('trial_no_card_enabled', public.app_flag('trial_no_card_enabled'));
$$;
REVOKE ALL ON FUNCTION public.public_plan_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_plan_config() TO anon, authenticated, service_role;
