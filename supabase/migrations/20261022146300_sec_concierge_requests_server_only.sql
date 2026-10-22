-- IATOS-114 (P1): cualquier usuario podía insertar o editar sus propias solicitudes al concierge
-- con cualquier estado, y por lo tanto marcar una como "confirmada" él mismo. Ninguna pantalla
-- escribe directo en esta tabla: las solicitudes se crean en concierge-action (llave de servicio),
-- que fija el estado inicial. El usuario conserva la lectura de las suyas.
-- Idempotente.
DROP POLICY IF EXISTS "Users insert own concierge_requests" ON public.concierge_requests;
DROP POLICY IF EXISTS "Users update own concierge_requests" ON public.concierge_requests;
REVOKE INSERT, UPDATE, DELETE ON public.concierge_requests FROM anon, authenticated;
