/** A dónde lleva un aviso al tocarlo, o null si no lleva a ningún lado. */
export function notificationTarget(n: { type: string; related_id: string | null }): string | null {
  const tripTypes = ["trip_updated", "trip_accepted", "trip_rejected", "price_drop", "flight_update"];
  if (n.related_id && tripTypes.includes(n.type)) return `/dashboard/viajes/${n.related_id}`;
  // Un vuelo seguido sin viaje se consultó desde el concierge (igual que el enlace del push).
  if (n.type === "flight_update") return "/dashboard/concierge";
  return null;
}
