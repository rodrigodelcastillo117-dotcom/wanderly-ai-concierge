// Viaje nacional corto por tierra (caso CDMX → Tepoztlán, 27-oct-2026): el paso de llegar se llamaba
// "Vuelo" aunque no hay vuelo lógico, el coche costaba "$1,800" inventados por la IA y el botón decía
// "Comprar en Google Maps". Aquí se decide, sin red:
//  - si llegar es por tierra (distancia corta o destino sin aeropuerto cuyo aeropuerto más cercano es
//    el de tu propia ciudad: _shared/airports.ts);
//  - el costo del coche (casetas reales de Google que guardó el análisis + gasolina estimada con su
//    fórmula; en viajes viejos, la gasolina con km aproximados y las casetas "sin consultar");
//  - el enlace del autobús (ADO precargado si existe la ruta) sin precio inventado.
import { isGroundTripOption, tripDestinations } from "@/lib/booking";
import { cityAirports, nearestAirport, placeDistanceKm } from "../../supabase/functions/_shared/airports.ts";
import { detectShortTrip, findCity } from "../../supabase/functions/analizar-viaje/groundTransport.ts";
import { approxRoadKmOf, carCost, carCostLines, groundGroupPrice, isHiredCar, readCarCost, type CarCost } from "../../supabase/functions/_shared/carCost.ts";
import { busSearches, groundButtonLabel } from "../../supabase/functions/_shared/booking/groundLinks.ts";

export { carCostLines, groundGroupPrice, readCarCost, type CarCost };

/** Por debajo de esta distancia en línea recta no hay vuelo lógico. */
export const NO_FLIGHT_KM = 300;

/** ¿Llegar al destino es por tierra (sin vuelo lógico)? Solo viajes de un destino. */
export function arrivalByLand(trip: any): boolean {
  if (!trip || tripDestinations(trip).length > 1) return false;
  const vs: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
  const origin = trip.ciudad_origen;
  const dest = trip.destino;
  if (vs.length > 0 && vs.every((v) => isGroundTripOption(v))) return true;
  const km = placeDistanceKm(origin, dest);
  if (km != null) return km < NO_FLIGHT_KM;
  // Sin aeropuerto propio y el más cercano es el de tu ciudad: volar no tiene sentido.
  const near = nearestAirport(dest);
  const o = cityAirports(origin);
  if (near && !near.exact && o && (o.airports.includes(near.airport) || o.metro === near.airport)) return true;
  return !!detectShortTrip(origin, dest, NO_FLIGHT_KM);
}

/** Nombre del paso: "Cómo llegar" por tierra; "Vuelo" (o "Vuelo de ida y regreso") si se vuela. */
export function arrivalStepTitle(trip: any): string {
  if (arrivalByLand(trip)) return "Cómo llegar";
  return tripDestinations(trip).length > 1 ? "Vuelo de ida y regreso" : "Vuelo";
}

/** Para "Te falta: …" y "Falta elegir: …". */
export function arrivalMissingLabel(trip: any): string {
  return arrivalByLand(trip) ? "cómo llegar" : "vuelo";
}

/** "En tu coche" (no un chofer ni un taxi contratado). */
const isCar = (v: any) => (v?.modo === "auto" || v?.mode === "coche" || v?.modo === "coche") && !isHiredCar(v);
/** Chofer, taxi o traslado privado: sin precio inventado. */
export const isHiredCarOption = (v: any) => (v?.modo === "auto" || v?.mode === "coche" || v?.modo === "coche") && isHiredCar(v);
const isBus = (v: any) => v?.modo === "autobus" || v?.mode === "bus" || v?.modo === "bus";

/**
 * Costo del coche: el que armó el servidor (casetas reales + gasolina estimada) o, en un viaje guardado
 * antes, la gasolina con km aproximados y las casetas sin consultar (se consultan al pulsar). null si la
 * fila no es coche.
 */
export function carCostFor(trip: any, v: any): CarCost | null {
  if (!isCar(v)) return null;
  const saved = readCarCost(v);
  if (saved) return saved;
  const km = Number(v?.km) > 0 ? Number(v.km) : approxRoadKm(trip);
  return carCost({ kmIda: km, kmFuente: "aproximado", tolls: null });
}

/** Km por carretera aproximados (línea recta × 1.3) entre origen y destino; null si no se conocen. */
export function approxRoadKm(trip: any): number | null {
  return approxRoadKmOf(trip?.ciudad_origen, trip?.destino);
}

/** Enlace del autobús: ADO (o la línea que haya) precargado con la ruta; null si no hay uno fiable. */
export function busLinkFor(trip: any): { url: string; site: string; label: string; lleva: string } | null {
  const from = findCity(trip?.ciudad_origen)?.name ?? String(trip?.ciudad_origen ?? "").trim();
  const to = findCity(trip?.destino)?.name ?? String(trip?.destino ?? "").trim();
  if (!from || !to) return null;
  const l = busSearches({ from, to, date: trip?.fecha_salida ?? null, adults: Number(trip?.num_viajeros) || 1 })[0];
  return l ? { url: l.url, site: l.site, label: groundButtonLabel(l.site), lleva: l.lleva } : null;
}

/**
 * Precio de una opción terrestre para la pantalla (grupo): el coche suma su costo (casetas reales +
 * gasolina estimada); el autobús no tiene precio (se ve en el sitio de la línea). Nunca el número que
 * escribió la IA para el autobús o el coche.
 */
export function groundOptionPrice(trip: any, v: any): { total: number | null; real: number; estimado: number; cost: CarCost | null } {
  const cost = carCostFor(trip, v);
  if (cost) return { total: cost.total_mxn, real: cost.real_mxn, estimado: cost.estimado_mxn, cost };
  if (isBus(v)) return { total: null, real: 0, estimado: 0, cost: null };
  return { total: null, real: 0, estimado: 0, cost: null };
}

export { isBus as isBusOption, isCar as isCarOption };
