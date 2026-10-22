// Enlace entre las herramientas del viaje (/dashboard/vuelos, hoteles, autos…) y un viaje concreto
// (E-22): la herramienta recibe ?trip=<id>, muestra a qué viaje se está agregando y cada clic a un
// socio o "agregar al viaje" queda en bookings con ese trip_id. Antes esos clics llegaban sin viaje
// y ni Iato ni el expediente podían saber a cuál pertenecían.

export const TRIP_TOOL_PATHS = [
  "/dashboard/vuelos", "/dashboard/hoteles", "/dashboard/autos", "/dashboard/actividades",
  "/dashboard/restaurantes", "/dashboard/trenes", "/dashboard/ferries", "/dashboard/cruceros",
  "/dashboard/esim", "/dashboard/seguros",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTripId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Agrega trip=<id> a la ruta de una herramienta del viaje (las demás rutas no cambian). */
export function withTripParam(path: string, tripId: string | null | undefined): string {
  if (!isTripId(tripId)) return path;
  const [base, query = ""] = path.split("?");
  if (!(TRIP_TOOL_PATHS as readonly string[]).includes(base)) return path;
  const sp = new URLSearchParams(query);
  sp.set("trip", tripId);
  return `${base}?${sp.toString()}`;
}

/** trip=<id> de la URL, solo si tiene forma de UUID. */
export function readTripParam(search: string | URLSearchParams): string | null {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const v = sp.get("trip");
  return isTripId(v) ? v : null;
}
