// Dónde está el usuario frente a su viaje (caso real 22-oct-2026). Lógica pura, sin Deno: la usan
// concierge-chat (prompt, planeador y acciones), la pantalla del Concierge y las pruebas (Vitest).
//
// El caso: el usuario estaba en Huixquilucan (CDMX) el día que salía su viaje Roma → Florencia →
// Venecia. Por fechas el viaje ya estaba "en curso", así que Iato le buscó cena en Pirules y le
// propuso "Agregar a tu viaje a Roma → Florencia → Venecia: Cena · jue 22 de oct 20:30". Un
// restaurante de CDMX no es parte de un viaje a Italia.
//
// Reglas:
//   * La posición se decide con coordenadas (las del navegador contra las de las ciudades del viaje,
//     de la tabla de _shared/airports.ts, y las de los hoteles) o, sin coordenadas, con el nombre del
//     lugar. Si no se puede saber, es "unknown" y nada cambia respecto a antes.
//   * Viaje en curso por fechas + usuario fuera de sus destinos el día de salida (o el siguiente,
//     en tránsito) = "por salir", no "en curso".
//   * "Agregar a tu viaje" solo para un lugar en una ciudad del viaje, o si el usuario lo pidió.
//     Un lugar local se puede guardar en favoritos (save_place).

import { cityAirports } from "../_shared/airports.ts";
import { haversineKm } from "../_shared/geo-distance.ts";
import { isTripEnded, normalizeText } from "../_shared/activeTrip.ts";

export type LatLng = { lat: number; lng: number };
export interface UserLocation { coords?: LatLng | null; place?: string | null }
/** at_destination = en una ciudad del viaje; away = fuera de todas; unknown = no se puede saber. */
export type TripPosition = "at_destination" | "away" | "unknown";
export type TripPhase = "sin_fechas" | "proximo" | "por_salir" | "en_curso" | "terminado";
export interface GeoPoint { name: string; lat: number; lng: number }

/** Radio alrededor de una ciudad del viaje (la tabla trae el aeropuerto principal, no el centro). */
export const NEAR_DESTINATION_KM = 80;

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const validPoint = (lat?: number, lng?: number) => lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

/** Nombres de los destinos del viaje (sin el origen ni el país, sin expandir a otras ciudades). */
export function destinationNames(trip: any): string[] {
  const names = new Set<string>();
  const push = (v: unknown) => {
    const s = String(v ?? "").replace(/\(.*?\)/g, " ").trim();
    if (s.length > 1) names.add(s);
  };
  String(trip?.destino ?? "").split(/→|->|,|;|\/|\s+y\s+/).forEach(push);
  for (const h of [...asArray(trip?.hospedaje_json), ...asArray(trip?.hospedaje)]) push(h?.ciudad);
  const itin = trip?.itinerario_json;
  for (const d of asArray(itin?.destinations)) push(typeof d === "string" ? d : d?.ciudad ?? d?.city ?? d?.nombre);
  return [...names];
}

/** Puntos del viaje con coordenadas: hoteles con lat/lng y ciudades conocidas (tabla de aeropuertos). */
export function tripDestinationPoints(trip: any): GeoPoint[] {
  const out: GeoPoint[] = [];
  const seen = new Set<string>();
  const add = (name: string, lat?: number, lng?: number) => {
    if (!validPoint(lat, lng)) return;
    const key = `${lat!.toFixed(2)},${lng!.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, lat: lat!, lng: lng! });
  };
  for (const h of [...asArray(trip?.hospedaje_json), ...asArray(trip?.hospedaje)]) {
    add(String(h?.nombre ?? h?.name ?? h?.ciudad ?? "hotel"), finite(h?.lat ?? h?.latitud), finite(h?.lng ?? h?.longitud));
  }
  for (const n of destinationNames(trip)) {
    const c = cityAirports(n);
    if (c) add(c.name, c.lat, c.lng);
  }
  return out;
}

/** Ciudad de origen del viaje (o del perfil) con coordenadas, si se conoce. */
export function originPoint(trip: any, profileOrigin?: string | null): GeoPoint | null {
  for (const raw of [trip?.ciudad_origen, profileOrigin]) {
    const c = cityAirports(raw);
    if (c) return { name: c.name, lat: c.lat, lng: c.lng };
  }
  return null;
}

const containsWord = (hay: string, needle: string) => !!needle && ` ${hay} `.includes(` ${needle} `);

/** ¿El texto (dirección, ciudad o nombre de lugar) nombra una ciudad del viaje? */
export function textMentionsDestination(trip: any, text: unknown): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  for (const n of destinationNames(trip)) {
    const c = cityAirports(n);
    const variants = [n, ...(c ? [c.name, ...(c.aliases ?? [])] : [])].map(normalizeText).filter((v) => v.length > 2);
    if (variants.some((v) => containsWord(t, v))) return true;
  }
  return false;
}

/** Distancia (km) del punto a la ciudad del viaje más cercana; null si el viaje no tiene coordenadas. */
export function kmToNearestDestination(trip: any, p: LatLng): number | null {
  const pts = tripDestinationPoints(trip);
  if (!pts.length || !validPoint(p.lat, p.lng)) return null;
  return Math.min(...pts.map((x) => haversineKm(p, x)));
}

/** ¿Dónde está el usuario respecto a los destinos del viaje? */
export function userTripPosition(trip: any, loc: UserLocation | null | undefined): TripPosition {
  if (!trip || !loc) return "unknown";
  const c = loc.coords;
  if (c && validPoint(c.lat, c.lng)) {
    const km = kmToNearestDestination(trip, c);
    if (km !== null) return km <= NEAR_DESTINATION_KM ? "at_destination" : "away";
  }
  const place = String(loc.place ?? "").trim();
  if (place) {
    if (textMentionsDestination(trip, place)) return "at_destination";
    // Una ciudad conocida que no es del viaje (la de origen, por ejemplo) = fuera.
    const known = cityAirports(place);
    if (known && tripDestinationPoints(trip).length) return "away";
  }
  return "unknown";
}

/**
 * Fase del viaje con la ubicación: por fechas puede estar "en curso", pero si el usuario sigue fuera
 * de sus destinos el día de salida (o el siguiente: vuelos de noche), el viaje está "por salir".
 */
export function tripPhase(trip: any, todayISO: string, position: TripPosition = "unknown"): TripPhase {
  const start = trip?.fecha_salida ? String(trip.fecha_salida).slice(0, 10) : null;
  if (!start) return "sin_fechas";
  if (isTripEnded(trip, todayISO)) return "terminado";
  if (start > todayISO) return "proximo";
  if (position === "away" && todayISO <= addDays(start, 1)) return "por_salir";
  return "en_curso";
}

/** Texto corto para el selector del chat ("sale hoy", "en curso"…). */
export function tripPhaseLabel(phase: TripPhase, trip: any, todayISO: string): string {
  const start = trip?.fecha_salida ? String(trip.fecha_salida).slice(0, 10) : null;
  switch (phase) {
    case "por_salir": return start === todayISO ? "sale hoy" : "por salir";
    case "en_curso": return "en curso";
    case "proximo": return start === addDays(todayISO, 1) ? "sale mañana" : "próximo";
    default: return "";
  }
}

export interface TripSituation {
  phase: TripPhase;
  position: TripPosition;
  /** Nombre del lugar donde está el usuario ("Huixquilucan"), si se conoce. */
  place?: string | null;
  /** Primer destino del viaje ("Roma"). */
  firstDestination?: string | null;
}

export function tripSituation(trip: any, todayISO: string, loc: UserLocation | null | undefined): TripSituation | null {
  if (!trip) return null;
  const position = userTripPosition(trip, loc);
  return {
    phase: tripPhase(trip, todayISO, position), position, place: loc?.place ? String(loc.place).slice(0, 80) : null,
    firstDestination: destinationNames(trip)[0] ?? null,
  };
}

/**
 * Línea para el sistema (parte dinámica): en qué fase está el viaje y qué significa "cerca". Vacía
 * si no hay nada que aclarar (ubicación desconocida y viaje sin cambios).
 */
export function situationLine(s: TripSituation | null | undefined): string {
  if (!s) return "";
  const where = s.place ? ` (${s.place})` : "";
  const dest = s.firstDestination ?? "su destino";
  if (s.phase === "por_salir") {
    return `ESTADO DEL VIAJE: por salir. Por fechas empieza hoy, pero el usuario sigue fuera de los destinos del viaje${where}: todavía no está en ${dest}. No le hables como si ya estuviera allá. Lo que pida "cerca" es cerca de donde está ahora; esas recomendaciones son locales y no se agregan al viaje.`;
  }
  if (s.position === "away") {
    return `UBICACIÓN: el usuario está fuera de los destinos del viaje${where}. Lo que pida "cerca" es local: no lo agregues al viaje.`;
  }
  if (s.position === "at_destination" && s.phase === "en_curso") return "UBICACIÓN: el usuario está en uno de los destinos de su viaje.";
  return "";
}

// ═══ Regla de "Agregar a tu viaje" ═══

export interface EvidencePlaceLike { name: string; address?: string; lat?: number; lng?: number; mapsUrl?: string; website?: string }

const normName = (v: unknown) => normalizeText(v).replace(/^(cena|comida|desayuno|almuerzo|brunch|copa|copas|visita|tour) (en|a|al|de) /, "");

/** Lugar de los resultados al que se refiere la acción (por "lugar" o por el título "Cena en X"). */
export function placeForAction(params: Record<string, unknown>, places: EvidencePlaceLike[]): EvidencePlaceLike | null {
  for (const raw of [params.lugar, params.titulo, params.nombre]) {
    const t = normName(raw);
    if (t.length < 3) continue;
    const hit = places.find((p) => normName(p.name) === t)
      ?? places.find((p) => { const n = normName(p.name); return n.length >= 4 && (t.includes(n) || n.includes(t)); });
    if (hit) return hit;
  }
  return null;
}

/** ¿El usuario pidió agregar algo a su viaje o itinerario? */
export function userAskedToAddToTrip(message: string): boolean {
  const m = normalizeText(message);
  return /\b(agrega|agregalo|agregala|agregar|anade|anadelo|anadir|pon|ponlo|ponla|mete|metelo|apunta|apuntalo|guarda|guardalo)\b.{0,40}\b(itinerario|viaje|agenda|plan del dia|calendario)\b/.test(m);
}

export type ItineraryScope = { keep: true; why: string } | { keep: false; why: string; place?: EvidencePlaceLike | null };

/**
 * ¿Tiene sentido "Agregar a tu viaje" para esta acción? Sí cuando el lugar está en una ciudad del
 * viaje (coordenadas o dirección) o cuando el usuario lo pidió. Sin lugar identificable, solo si el
 * usuario no está fuera de los destinos del viaje (si no se sabe dónde está, como antes).
 */
export function itineraryActionScope(i: {
  trip: any; params: Record<string, unknown>; places: EvidencePlaceLike[]; position: TripPosition; userMessage: string;
}): ItineraryScope {
  if (userAskedToAddToTrip(i.userMessage)) return { keep: true, why: "lo_pidio" };
  const place = placeForAction(i.params, i.places);
  if (place) {
    if (validPoint(place.lat, place.lng)) {
      const km = kmToNearestDestination(i.trip, { lat: place.lat!, lng: place.lng! });
      if (km !== null) return km <= NEAR_DESTINATION_KM ? { keep: true, why: "lugar_en_destino" } : { keep: false, why: "lugar_fuera_del_viaje", place };
    }
    if (textMentionsDestination(i.trip, place.address)) return { keep: true, why: "direccion_en_destino" };
    if (i.position === "away") return { keep: false, why: "usuario_fuera_del_viaje", place };
    return { keep: true, why: "sin_datos_del_lugar" };
  }
  if (textMentionsDestination(i.trip, i.params.lugar)) return { keep: true, why: "lugar_en_destino" };
  if (i.position === "away") return { keep: false, why: "usuario_fuera_del_viaje" };
  return { keep: true, why: "sin_datos" };
}
