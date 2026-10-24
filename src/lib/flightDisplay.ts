// Cómo se muestra una opción de vuelo guardada (trips.vuelos_json) sin afirmar lo que no se sabe.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): filas "estimado" generadas por IA decían
// "Iberia · Directo · 15h 20m" (Iberia no vuela directo MEX→Roma) como si fuera un dato. Una fila
// estimada no nombra aerolínea ni dice "Directo": "Aerolínea por confirmar" y "Escalas por confirmar".
import { isEstimatedTripFlight, isGroundTripOption } from "@/lib/booking";
import { airportCityName } from "../../supabase/functions/_shared/airports.ts";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard.ts";
import { frescuraPrecio } from "../../supabase/functions/_shared/priceFreshness.ts";

/** ¿Es un estimado de IA (sin tarifa de un proveedor)? */
export const flightIsEstimate = (v: any) => !isGroundTripOption(v) && isEstimatedTripFlight(v);

/** Aerolínea que se puede mostrar: la de una tarifa real; en un estimado, "Aerolínea por confirmar". */
export function flightAirlineLabel(v: any): string {
  if (isGroundTripOption(v)) return String(v?.aerolinea ?? v?.provider ?? "Transporte");
  if (flightIsEstimate(v)) return "Aerolínea por confirmar";
  return String(v?.aerolinea ?? "").trim() || "Aerolínea por confirmar";
}

/** Ciudades de escala conocidas de una opción: las guardadas o las del enlace de Aviasales. */
export function flightLayoverCities(v: any): string[] | null {
  if (Array.isArray(v?.escalas_ciudades) && v.escalas_ciudades.length) return v.escalas_ciudades.map(String);
  const codes = layoverCodesFromAviasalesLink(v?.booking_link);
  return codes ? codes.map(airportCityName) : null;
}

/**
 * Escalas que se pueden afirmar: "Escalas: Cancún · Madrid" si se saben las ciudades, "Directo" solo
 * de una tarifa real, y si no, "Escalas por confirmar" (nunca un número sin decir dónde).
 */
export function flightStopsLabel(v: any): string | null {
  if (isGroundTripOption(v)) return null;
  if (flightIsEstimate(v)) return "Escalas por confirmar";
  const cities = flightLayoverCities(v);
  if (cities && cities.length) return `Escalas: ${cities.join(" · ")}`;
  const s = String(v?.escalas ?? "").trim();
  if (cities && cities.length === 0) return "Directo";
  const live = ["serpapi", "google_flights", "en_vivo"].includes(String(v?.fuente_precio ?? "").toLowerCase());
  if (/^directo$/i.test(s) && live) return "Directo";
  // Tarifa en vivo de Google Flights con el número de escalas ("1 escala"): se muestra tal cual.
  if (live && /^\d\s+escalas?$/i.test(s)) return s;
  return "Escalas por confirmar";
}

/** Duración: en un estimado, marcada como aproximada. */
export function flightDurationLabel(v: any): string | null {
  const d = String(v?.duracion ?? "").trim();
  if (!d) return null;
  return flightIsEstimate(v) ? `≈ ${d} (estimado)` : d;
}

const hhmm = (iso: string) => {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
};

/**
 * Vuelo consultado en Google Flights por el plan (fuente "en_vivo"): "Google Flights · en vivo ·
 * consultado 14:32" mientras la consulta es de hace ≤ 15 min; después, "Google Flights · consultado
 * 14:32 (hace 3 h)" (nunca "en vivo" para una consulta vieja); y "precio guardado" si salió de la
 * caché vencida. null si el vuelo no es en vivo.
 */
export function flightLiveLine(v: any, now: Date | number = Date.now()): string | null {
  if (String(v?.fuente_precio ?? "").toLowerCase() !== "en_vivo" || !v?.consultado_at) return null;
  const time = hhmm(String(v.consultado_at));
  if (!time) return null;
  const f = frescuraPrecio({ estado: v?.precio_guardado ? "OBSOLETO" : v?.estado_dato, consultadoAt: v.consultado_at }, now);
  if (f.frescura === "en_vivo") return `Google Flights · en vivo · consultado ${time}`;
  if (f.frescura === "cache") return `Google Flights · consultado ${time} (${f.edad})`;
  return `Google Flights · precio de ${f.edad ?? "otra fecha"} · actualízalo antes de comprar`;
}

/** Horario de la ida de un vuelo en vivo ("Sale 18:05 · llega 12:45 +1"). null si no hay horarios. */
export function flightScheduleLabel(v: any): string | null {
  const t = (s: unknown) => (typeof s === "string" && /\d{2}:\d{2}$/.test(s) ? s.slice(-5) : null);
  const a = t(v?.salida), b = t(v?.llegada);
  if (!a || !b) return null;
  const da = String(v.salida).slice(0, 10), db = String(v.llegada).slice(0, 10);
  const plus = da && db && db > da ? Math.round((Date.parse(`${db}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86400000) : 0;
  return `Sale ${a} · llega ${b}${plus > 0 ? ` +${plus}` : ""}`;
}
