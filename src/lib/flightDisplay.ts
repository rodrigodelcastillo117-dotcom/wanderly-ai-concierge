// Cómo se muestra una opción de vuelo guardada (trips.vuelos_json) sin afirmar lo que no se sabe.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): filas "estimado" generadas por IA decían
// "Iberia · Directo · 15h 20m" (Iberia no vuela directo MEX→Roma) como si fuera un dato. Una fila
// estimada no nombra aerolínea ni dice "Directo": "Aerolínea por confirmar" y "Escalas por confirmar".
import { isEstimatedTripFlight, isGroundTripOption, tripFlightProblems } from "@/lib/booking";
import { airportCityName } from "../../supabase/functions/_shared/airports.ts";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard.ts";
import { frescuraPrecio } from "../../supabase/functions/_shared/priceFreshness.ts";

/** ¿Es un estimado de IA (sin tarifa de un proveedor)? */
export const flightIsEstimate = (v: any) => !isGroundTripOption(v) && isEstimatedTripFlight(v);

/**
 * Nombre de aerolínea como se escribe en español ("Aeromexico" de Google Flights → "Aeroméxico"), para que
 * la misma aerolínea no salga escrita de dos formas en la misma pantalla. Solo cambia lo que se muestra.
 */
const AIRLINE_DISPLAY: Array<[RegExp, string]> = [
  [/\baerom[eé]xico\b/gi, "Aeroméxico"],
  [/\bviva ?aerob[uú]s\b/gi, "Viva Aerobus"],
  [/\bvolaris\b/gi, "Volaris"],
];
export function displayAirlineName(name: string | null | undefined): string {
  let out = String(name ?? "").trim();
  for (const [re, fixed] of AIRLINE_DISPLAY) out = out.replace(re, fixed);
  return out;
}

/**
 * Aviso de tarifas descartadas (caso E2E 28-oct-2026, Nueva York): decía "El vuelo queda por cotizar"
 * junto a "Vuelos · en vivo $18,930 MXN" incluido en el total. Solo se dice "por cotizar" si de verdad no
 * queda ningún vuelo de la ruta con precio; si queda, solo que se descartó la tarifa. null = sin aviso.
 */
export function discardedFaresNotice(trip: any): string | null {
  const rows: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const discarded = rows.filter((v) => tripFlightProblems(v, trip).length > 0).length;
  if (!discarded) return null;
  const priced = (v: any) => Number(v?.precio_por_persona) > 0 || Number(v?.precio_total) > 0 || Number(v?.price_total_mxn) > 0;
  const remaining = rows.some((v) => tripFlightProblems(v, trip).length === 0 && priced(v));
  const what = discarded === 1 ? "1 tarifa de vuelo" : `${discarded} tarifas de vuelo`;
  const why = discarded === 1 ? "no era de tu ruta" : "no eran de tu ruta";
  return remaining
    ? `Descartamos ${what} de esta cotización porque ${why}. Los vuelos que ves sí son de tu ruta.`
    : `Descartamos ${what} de esta cotización porque ${why}. El vuelo queda por cotizar: búscalo en “Comprar mi viaje” o actualiza la cotización.`;
}

/** Aerolínea que se puede mostrar: la de una tarifa real; en un estimado, "Aerolínea por confirmar". */
export function flightAirlineLabel(v: any): string {
  if (isGroundTripOption(v)) return String(v?.aerolinea ?? v?.provider ?? "Transporte");
  if (flightIsEstimate(v)) return "Aerolínea por confirmar";
  return displayAirlineName(v?.aerolinea) || "Aerolínea por confirmar";
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
  // Sin número no es una duración ("Directo" en duración salía "Directo · Directo").
  if (!d || !/\d/.test(d)) return null;
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

const TIME = "([01]?\\d|2[0-3])[:h.]([0-5]\\d)";
const DATE_BIT = "(?:el\\s+)?(?:\\d{1,2}[-/\\s]?(?:de\\s+)?[a-záéíóú]{3,10}\\.?|\\d{1,2}[-/]\\d{1,2})?";
const hh = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;

/**
 * Horario escrito en las notas de una tarifa de viajes viejos ("salida 10-mar 11:00, llegada 11-mar 05:30").
 * Solo si está explícito; si no, null (nunca se inventa una hora).
 */
export function scheduleFromNotes(notas: unknown): { sale: string; llega: string | null; plus: number } | null {
  const t = String(notas ?? "").toLowerCase();
  if (!t) return null;
  const dep = new RegExp(`\\b(?:sale|salida|despega)\\s*(?:a las\\s*)?${DATE_BIT}\\s*(?:a las\\s*)?${TIME}`).exec(t);
  if (!dep) return null;
  const arr = new RegExp(`\\b(?:llega|llegada|aterriza)\\s*(?:a las\\s*)?${DATE_BIT}\\s*(?:a las\\s*)?${TIME}(\\s*\\(?\\+\\s*(\\d)\\)?)?`).exec(t);
  return { sale: hh(dep[1], dep[2]), llega: arr ? hh(arr[1], arr[2]) : null, plus: arr?.[4] ? Number(arr[4]) : 0 };
}

/**
 * Horario de la ida ("Sale 18:05 · llega 12:45 +1"): de las horas de la tarifa en vivo o, en viajes viejos,
 * de las notas si ahí está escrito. null si no hay horarios (no se inventa).
 */
export function flightScheduleLabel(v: any): string | null {
  const t = (s: unknown) => (typeof s === "string" && /\d{2}:\d{2}$/.test(s) ? s.slice(-5) : null);
  const a = t(v?.salida), b = t(v?.llegada);
  if (!a || !b) {
    if (isGroundTripOption(v)) return null;
    const n = scheduleFromNotes(v?.notas);
    if (!n) return null;
    return n.llega ? `Sale ${n.sale} · llega ${n.llega}${n.plus > 0 ? ` +${n.plus}` : ""}` : `Sale ${n.sale}`;
  }
  const da = String(v.salida).slice(0, 10), db = String(v.llegada).slice(0, 10);
  const plus = da && db && db > da ? Math.round((Date.parse(`${db}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86400000) : 0;
  return `Sale ${a} · llega ${b}${plus > 0 ? ` +${plus}` : ""}`;
}
