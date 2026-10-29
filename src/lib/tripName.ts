// Nombre corto de un viaje para listas (la lógica vive en supabase/functions/_shared/tripName.ts para
// que analizar-viaje guarde lo mismo que la app muestra).
export { looksLikeRawPrompt, placeFromPrompt, shortTripName, storedTripDestino, type NamedTrip } from "../../supabase/functions/_shared/tripName.ts";

import { formatLocalDate } from "@/lib/localDate";
import { shortTripName as nameOf, type NamedTrip as Named } from "../../supabase/functions/_shared/tripName.ts";

/**
 * Opción de un selector de viajes: "Madrid · 4 may – 19 may 2027". Con fechas, para distinguir viajes
 * con el mismo destino (Gastos y Recuerdos tenían "Madrid" ×3 sin forma de saber cuál era cuál).
 */
export function tripOptionLabel(t: Named & { fecha_salida?: string | null; fecha_regreso?: string | null }): string {
  const name = nameOf(t);
  const a = t.fecha_salida ? formatLocalDate(t.fecha_salida, { day: "numeric", month: "short" }) : null;
  const b = t.fecha_regreso ? formatLocalDate(t.fecha_regreso, { day: "numeric", month: "short", year: "numeric" }) : null;
  if (a && b) return `${name} · ${a} – ${b}`;
  if (a) return `${name} · ${formatLocalDate(t.fecha_salida, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${name} · sin fechas`;
}
