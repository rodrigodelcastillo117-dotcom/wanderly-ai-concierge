// Cómo se muestra una opción de vuelo guardada (trips.vuelos_json) sin afirmar lo que no se sabe.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): filas "estimado" generadas por IA decían
// "Iberia · Directo · 15h 20m" (Iberia no vuela directo MEX→Roma) como si fuera un dato. Una fila
// estimada no nombra aerolínea ni dice "Directo": "Aerolínea por confirmar" y "Escalas por confirmar".
import { isEstimatedTripFlight, isGroundTripOption } from "@/lib/booking";

/** ¿Es un estimado de IA (sin tarifa de un proveedor)? */
export const flightIsEstimate = (v: any) => !isGroundTripOption(v) && isEstimatedTripFlight(v);

/** Aerolínea que se puede mostrar: la de una tarifa real; en un estimado, "Aerolínea por confirmar". */
export function flightAirlineLabel(v: any): string {
  if (isGroundTripOption(v)) return String(v?.aerolinea ?? v?.provider ?? "Transporte");
  if (flightIsEstimate(v)) return "Aerolínea por confirmar";
  return String(v?.aerolinea ?? "").trim() || "Aerolínea por confirmar";
}

/** Escalas que se pueden afirmar; en un estimado, nunca "Directo". */
export function flightStopsLabel(v: any): string | null {
  if (isGroundTripOption(v)) return null;
  if (flightIsEstimate(v)) return "Escalas por confirmar";
  const s = String(v?.escalas ?? "").trim();
  return s || "Escalas por confirmar";
}

/** Duración: en un estimado, marcada como aproximada. */
export function flightDurationLabel(v: any): string | null {
  const d = String(v?.duracion ?? "").trim();
  if (!d) return null;
  return flightIsEstimate(v) ? `≈ ${d} (estimado)` : d;
}
