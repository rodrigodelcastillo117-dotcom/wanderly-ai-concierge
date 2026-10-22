-- F-19 (IATOS-109): un miembro de un viaje podía insertar notificaciones con título y texto libres
-- para los demás miembros (política notifications_insert_trip_members). Idempotente.
-- Las notificaciones entre usuarios ya las crea el servidor con plantillas fijas:
--   invitar_amigo_viaje y notify_trip_updated (SECURITY DEFINER), share-trip-notify (service role,
--   plantilla fija en share-trip-notify/template.ts). Ninguna pantalla inserta notificaciones.
-- Se conserva "Users insert own notifications" (solo a uno mismo, inofensivo).
DROP POLICY IF EXISTS notifications_insert_trip_members ON public.notifications;
