/** A dónde lleva un aviso al tocarlo, o null si no lleva a ningún lado. */
export function notificationTarget(n: { type: string; related_id: string | null; title?: string | null }): string | null {
  const tripTypes = ["trip_updated", "trip_accepted", "trip_rejected", "price_drop", "flight_update"];
  if (n.related_id && tripTypes.includes(n.type)) return `/dashboard/viajes/${n.related_id}`;
  // Un vuelo seguido sin viaje se consultó desde el concierge (igual que el enlace del push).
  if (n.type === "flight_update") return "/dashboard/concierge";
  // IATOS Privé (notifications.type = 'prive'): la invitación abre la ceremonia sin token (el
  // servidor la busca por cuenta). Los avisos de seguridad (contraseña, sesiones, accesos) llevan a
  // la membresía. /prive/invitacion también resuelve bien cualquier estado (p. ej. "ya activa").
  if (n.type === "prive") return /invitaci/i.test(n.title ?? "") || !n.title ? "/prive/invitacion" : "/prive/membresia";
  return null;
}
