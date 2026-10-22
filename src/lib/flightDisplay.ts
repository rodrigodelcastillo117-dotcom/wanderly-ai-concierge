// Cómo se muestra una opción de vuelo guardada (trips.vuelos_json) sin afirmar lo que no se sabe.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): filas "estimado" generadas por IA decían
// "Iberia · Directo · 15h 20m" (Iberia no vuela directo MEX→Roma) como si fuera un dato. Una fila
// estimada no nombra aerolínea ni dice "Directo": "Aerolínea por confirmar" y "Escalas por confirmar".
import { isEstimatedTripFlight, isGroundTripOption } from "@/lib/booking";
import { airportCityName } from "../../supabase/functions/_shared/airports.ts";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard.ts";

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
  if (/^directo$/i.test(s) && ["serpapi", "google_flights"].includes(String(v?.fuente_precio ?? "").toLowerCase())) return "Directo";
  return "Escalas por confirmar";
}

/** Duración: en un estimado, marcada como aproximada. */
export function flightDurationLabel(v: any): string | null {
  const d = String(v?.duracion ?? "").trim();
  if (!d) return null;
  return flightIsEstimate(v) ? `≈ ${d} (estimado)` : d;
}
