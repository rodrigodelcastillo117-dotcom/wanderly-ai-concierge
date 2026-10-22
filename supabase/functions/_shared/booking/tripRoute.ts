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

// ───────────────────────── Estancia por ciudad (multi-destino) ─────────────────────────

export type CityStay = { city: string; checkin: string; checkout: string; nights: number };

const addDaysIso = (iso: string, n: number) => {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Mismo reparto que logistics-plan (splitNights): base igual y el sobrante a las primeras ciudades. */
export function splitNights(total: number, cities: number): number[] {
  const base = Math.max(1, Math.floor(total / cities));
  const arr = new Array(cities).fill(base);
  let rest = total - base * cities;
  for (let i = 0; rest > 0; i++, rest--) arr[i % cities] += 1;
  return arr;
}

/**
 * Noches y fechas de cada ciudad de un viaje multi-destino. Usa el plan guardado
 * (itinerario_json.logistics.per_destination) si cuadra con las fechas del viaje; si no (el usuario
 * cambió fechas), los días del itinerario por ciudad; y si tampoco, el mismo reparto que el servidor.
 * [] si el viaje no tiene fechas o es de un solo destino.
 */
export function cityStays(trip: TripRouteLike | null | undefined): CityStay[] {
  const cities = tripDestinations(trip);
  const start = isIsoDate(trip?.fecha_salida) ? trip!.fecha_salida! : null;
  const end = isIsoDate(trip?.fecha_regreso) ? trip!.fecha_regreso! : null;
  if (cities.length < 2 || !start || !end || end <= start) return [];
  const total = nightsBetween(start, end);
  const per: any[] = Array.isArray(trip?.itinerario_json?.logistics?.per_destination) ? trip!.itinerario_json.logistics.per_destination : [];
  const fromPlan = per.length === cities.length && per[0]?.checkin === start && per[per.length - 1]?.checkout === end
    && per.every((p) => isIsoDate(p?.checkin) && isIsoDate(p?.checkout) && p.checkout > p.checkin);
  if (fromPlan) return per.map((p, i) => ({ city: cities[i], checkin: p.checkin, checkout: p.checkout, nights: nightsBetween(p.checkin, p.checkout) }));
  const days: any[] = Array.isArray(trip?.itinerario_json?.days) ? trip!.itinerario_json.days : [];
  const byDays = cities.map((c) => days.filter((d) => sameCity(d?.ciudad, c)).length);
  let nights = byDays.every((n) => n > 0) && byDays.reduce((a, b) => a + b, 0) === total ? byDays : splitNights(total, cities.length);
  if (nights.reduce((a, b) => a + b, 0) !== total) nights = splitNights(total, cities.length);
  let cursor = start;
  return cities.map((city, i) => {
    const checkin = cursor;
    const checkout = addDaysIso(checkin, nights[i]);
    cursor = checkout;
    return { city, checkin, checkout, nights: nights[i] };
  });
}

/** ¿Dos nombres son la misma ciudad? ("Venecia" = "Venice" = "venecia, Italia"). */
export function sameCity(a: unknown, b: unknown): boolean {
  const x = cityAirports(a);
  const y = cityAirports(b);
  if (x && y) return x.metro === y.metro;
  const n = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(",")[0].trim();
  return !!n(a) && n(a) === n(b);
}

/** Estancia de la ciudad de un hotel (por su campo `ciudad`) o null si no aplica. */
export function stayForCity(trip: TripRouteLike | null | undefined, city: unknown): CityStay | null {
  if (!city) return null;
  return cityStays(trip).find((s) => sameCity(s.city, city)) ?? null;
}
