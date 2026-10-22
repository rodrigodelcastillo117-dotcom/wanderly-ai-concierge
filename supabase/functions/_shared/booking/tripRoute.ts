// Ruta aérea de un viaje guardado (trips): de qué aeropuerto sale, a cuál llega y, en un viaje
// multi-destino, desde dónde regresa. Sin Deno: la usan el cliente y booking-bridge.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): vuelos_json no traía IATA y la búsqueda de Google
// Flights se armaba con la ruta de la tarifa guardada (MEX→BUH, Bucarest). Ahora la ruta sale del
// viaje: ida MEX→FCO (primera ciudad) y regreso VCE→MEX (última), con las fechas y viajeros del viaje.
import { cityAirports, codeServesCity, mainAirport } from "../airports.ts";
import { googleFlightsSearchUrl, isIsoDate, kayakFlightsSearchUrl } from "./links.ts";

export type TripRouteLike = {
  destino?: string | null;
  ciudad_origen?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  num_viajeros?: number | null;
  itinerario_json?: any;
};

/** Ciudades del viaje en orden: itinerario_json.destinations o el texto "Roma → Florencia → Venecia". */
export function tripDestinations(trip: TripRouteLike | null | undefined): string[] {
  const fromItin = Array.isArray(trip?.itinerario_json?.destinations) ? trip!.itinerario_json.destinations : null;
  const list: unknown[] = fromItin ?? String(trip?.destino ?? "").split(/\s*(?:→|->|\|)\s*/);
  return list.map((c) => String(c ?? "").trim()).filter(Boolean);
}

export type TripFlightRoute = {
  /** Aeropuerto de salida (IATA) o null si no se reconoce la ciudad de origen. */
  origin: string | null;
  /** Aeropuerto de llegada de la ida (primera ciudad). */
  destination: string | null;
  /** Aeropuerto de donde sale el regreso (última ciudad); igual a destination si es un solo destino. */
  returnFrom: string | null;
  depart: string | null;
  ret: string | null;
  adults: number;
  cities: string[];
  originCity: string;
  multi: boolean;
  /** Lo que no se pudo reconocer, para decírselo al usuario. */
  missing: Array<"origen" | "destino" | "regreso">;
};

export function tripFlightRoute(trip: TripRouteLike | null | undefined): TripFlightRoute {
  const cities = tripDestinations(trip);
  const originCity = String(trip?.ciudad_origen ?? "").trim();
  const origin = mainAirport(originCity);
  const destination = cities.length ? mainAirport(cities[0]) : null;
  const last = cities.length > 1 ? cities[cities.length - 1] : cities[0];
  const returnFrom = last ? mainAirport(last) : null;
  const missing: TripFlightRoute["missing"] = [];
  if (!origin) missing.push("origen");
  if (!destination) missing.push("destino");
  if (cities.length > 1 && !returnFrom) missing.push("regreso");
  return {
    origin, destination, returnFrom: returnFrom ?? destination,
    depart: isIsoDate(trip?.fecha_salida) ? trip!.fecha_salida! : null,
    ret: isIsoDate(trip?.fecha_regreso) ? trip!.fecha_regreso! : null,
    adults: Math.max(1, Math.min(9, Math.round(Number(trip?.num_viajeros) || 1))),
    cities, originCity, multi: cities.length > 1, missing,
  };
}

/**
 * ¿Una tarifa (código de destino) sirve para el viaje? false si llega a otra ciudad (BUH no es Roma);
 * null si no se puede saber (ciudad desconocida).
 */
export function fareMatchesTrip(fareDestination: string | null | undefined, trip: TripRouteLike | null | undefined): boolean | null {
  const first = tripDestinations(trip)[0];
  if (!first || !fareDestination) return null;
  return codeServesCity(fareDestination, first);
}

/** Búsquedas de vuelo del viaje (Google Flights y Kayak) con la ruta, fechas y pasajeros. */
export function tripFlightSearches(trip: TripRouteLike | null | undefined, opts: { airline?: string | null } = {}) {
  const r = tripFlightRoute(trip);
  const q = r.origin && r.destination && r.depart
    ? { origin: r.origin, destination: r.destination, returnFrom: r.returnFrom, depart: r.depart, ret: r.ret, adults: r.adults }
    : null;
  return {
    route: r,
    google: q ? googleFlightsSearchUrl({ ...q, airline: opts.airline ?? null }) : null,
    kayak: q ? kayakFlightsSearchUrl(q) : null,
  };
}

/** Nombre de la ciudad que no se reconoció (para "escribe el destino en Google Flights"). */
export function unresolvedCityLabel(r: TripFlightRoute): string | null {
  if (r.missing.includes("destino")) return r.cities[0] ?? null;
  if (r.missing.includes("origen")) return r.originCity || null;
  if (r.missing.includes("regreso")) return r.cities[r.cities.length - 1] ?? null;
  return null;
}

/** País del primer destino (Italia para Roma → Florencia → Venecia); null si no se conoce. */
export function tripCountry(trip: TripRouteLike | null | undefined): string | null {
  const first = tripDestinations(trip)[0];
  return first ? cityAirports(first)?.country ?? null : null;
}
