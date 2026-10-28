// De qué lugar habla cada turno de Iato (bug real, 23-oct-2026). Lógica pura, sin Deno: la usan
// concierge-chat (index.ts, planner), la pantalla del Concierge (etiqueta de la respuesta) y las pruebas.
//
// El caso: el usuario estaba físicamente en Interlomas (Edo. Méx.) y tenía un viaje FUTURO a India.
// Pidió "restaurantes cercanos" y Iato buscó alrededor del hotel de India; al corregirlo, recomendó
// lugares locales pero la respuesta seguía diciendo "sobre India".
//
// Aquí se separan cuatro cosas que antes se mezclaban en "el viaje":
//   * physical   — ubicación física actual: SOLO si llegó del navegador (con permiso). Nunca un viaje.
//   * selected   — viaje seleccionado (selector, fijado o automático). Un lugar pedido no lo cambia.
//   * requested  — destino que el mensaje nombra ("restaurantes en Delhi").
//   * futureTrip — el viaje seleccionado si todavía no empieza: nunca es la ubicación física.
// Y de ahí sale el alcance de la respuesta (scope) y la etiqueta que se muestra (label).

import { CITIES, cityAirports } from "../_shared/airports.ts";
import { needsSpecificTrip, normalizeText, resolveActiveTrip, type ActiveTripResult, type TripLike } from "../_shared/activeTrip.ts";

export type LatLng = { lat: number; lng: number };
/** here = donde está el usuario; requested = el lugar que nombró; trip = su viaje; none = sin lugar. */
export type PlaceScope = "here" | "requested" | "trip" | "none";

export interface PhysicalLocation { coords: LatLng | null; place: string | null }

export interface TurnPlace<T extends TripLike = TripLike> {
  physical: PhysicalLocation | null;
  /** Resolución del viaje del turno (la de siempre, salvo que un lugar pedido no cambia el viaje). */
  resolution: ActiveTripResult<T>;
  selectedTrip: T | null;
  requested: string | null;
  futureTrip: T | null;
  /** El mensaje pide algo "cerca de mí / aquí / cercanos". */
  nearMe: boolean;
  scope: PlaceScope;
  /** Lo que se muestra en la respuesta ("Interlomas", "Delhi", "India"); null = no se etiqueta. */
  label: string | null;
  /** Ciudad para los enlaces de reserva (OpenTable/Maps). */
  searchCity: string | null;
}

const validPoint = (p: LatLng | null | undefined): p is LatLng =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/** ¿Pide algo cerca de donde está? ("cerca de mí", "aquí", "cercanos"). "Cerca de mi hotel" no cuenta. */
export function asksNearMe(message: string): boolean {
  const m = normalizeText(message);
  if (/\bhotel\b/.test(m)) return false;
  return /\b(cerca|cercan[oa]s?|aqui|aca|por aqui|alrededor|a mi alrededor|near me|nearby|close by)\b/.test(m);
}

/** ¿Es una búsqueda de lugares? (restaurantes, bares, cafés, museos, qué hacer…). */
export function isPlaceSearch(message: string): boolean {
  return /\b(restaurante\w*|restaurant\w*|cenar|comer|cena|desayun\w*|brunch|comida|bar|bares|cafe\w*|cafeteria\w*|museo\w*|lugar\w*|sitio\w*|atraccion\w*|que hacer|que ver|tour\w*|tienda\w*|farmacia\w*|hospital\w*)\b/.test(normalizeText(message));
}

const COUNTRIES = new Map<string, string>();
for (const c of CITIES) COUNTRIES.set(normalizeText(c.country), c.country);

const NOT_A_PLACE = new Set(["google", "google maps", "maps", "uber", "waze", "opentable", "iato", "prive", "fixer", "concierge"]);

/**
 * Destino que el mensaje nombra: una ciudad o país conocido después de "en / de / para / cerca de"
 * ("restaurantes en Delhi" → "Delhi"), o un nombre propio después de "en / cerca de"
 * ("tacos en Interlomas" → "Interlomas"). null si no nombra ninguno.
 */
export function requestedDestination(message: string): string | null {
  const raw = String(message ?? "");
  const words = normalizeText(raw).split(" ");
  const PREP = new Set(["en", "de", "del", "para", "a", "por", "hacia"]);
  for (let i = 0; i < words.length - 1; i++) {
    if (!PREP.has(words[i])) continue;
    for (let n = 3; n >= 1; n--) {
      const cand = words.slice(i + 1, i + 1 + n).join(" ");
      if (cand.split(" ").length !== n || cand.length < 4 || NOT_A_PLACE.has(cand)) continue;
      const city = cityAirports(cand);
      if (city) return city.name;
      const country = COUNTRIES.get(cand);
      if (country) return country;
    }
  }
  const m = raw.match(/(?:^|[\s¿¡,(])(?:[Ee]n|[Cc]erca del?)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}'-]+)(?:\s+(?:de\s+(?:la\s+|los\s+)?)?[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,2})/u);
  if (m) {
    const name = m[1].trim();
    if (!NOT_A_PLACE.has(normalizeText(name))) return name.slice(0, 60);
  }
  return null;
}

const startOf = (t: TripLike | null | undefined) => (t?.fecha_salida ? String(t.fecha_salida).slice(0, 10) : null);

/** Primer destino del viaje para mostrar ("India", "Roma"). */
export function tripDisplayName(t: TripLike | null | undefined): string | null {
  const d = String(t?.destino ?? "").split(/→|->|,|;/)[0]?.trim();
  return d || null;
}

/** Pedir transporte ahora ("Pedir transporte", "un Uber"): es de donde está, no del viaje futuro. */
const TRANSPORT_NOW = /\b(transporte|taxi|uber|didi|cabify|traslado|llevame|pedir (un )?(auto|carro|coche))\b/;

/** El mensaje nombra un vuelo (AM 2, IB6402) que no está en el viaje seleccionado. */
export function flightNotInTrip(message: string, trip: TripLike | null | undefined): boolean {
  const m = String(message ?? "").toUpperCase().match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/);
  if (!m || !/\bVUELO\b/.test(normalizeText(message).toUpperCase())) return false;
  const code = `${m[1]}${Number(m[2])}`;
  const list = Array.isArray((trip as any)?.vuelos_json) ? (trip as any).vuelos_json : [];
  return !list.some((v: any) => {
    const raw = String(v?.numero_vuelo ?? v?.numero ?? "").toUpperCase().replace(/\s+/g, "");
    const x = raw.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})$/);
    return !!x && `${x[1]}${Number(x[2])}` === code;
  });
}

export function resolveTurnPlace<T extends TripLike>(i: {
  message: string;
  trips: T[];
  explicitId?: string | null;
  pinnedId?: string | null;
  todayISO: string;
  /** Lo que mandó el navegador. Solo con permiso trae coordenadas; el nombre sale de ellas. */
  user?: { coords?: LatLng | null; place?: string | null } | null;
  /** Posición frente al viaje (location.ts) si ya se calculó: "away" = fuera de sus destinos. */
  position?: "at_destination" | "away" | "unknown";
}): TurnPlace<T> {
  const coords = validPoint(i.user?.coords ?? null) ? i.user!.coords! : null;
  const placeName = typeof i.user?.place === "string" && i.user.place.trim() && i.user.place.trim() !== "Tu ubicación" ? i.user.place.trim().slice(0, 80) : null;
  const physical: PhysicalLocation | null = coords || placeName ? { coords, place: placeName } : null;

  const message = String(i.message ?? "");
  const named = requestedDestination(message);
  // "Estoy en Interlomas" con el navegador en Interlomas: es "aquí", no otro destino.
  const isHere = !!named && !!physical?.place && normalizeText(named) === normalizeText(physical.place);
  const requested = isHere ? null : named;
  const nearMe = asksNearMe(message) || isHere;
  const placeSearch = isPlaceSearch(message);

  // Un lugar pedido para buscar ("restaurantes en Delhi") no cambia el viaje seleccionado; la mención
  // sigue eligiendo viaje cuando la pregunta es SOBRE el viaje ("mi vuelo a Roma", "qué llevo a Japón").
  const placeOnly = !!requested && placeSearch && !needsSpecificTrip(message);
  const resolution = resolveActiveTrip(i.trips, {
    explicitId: i.explicitId ?? null, pinnedId: i.pinnedId ?? null, todayLocal: i.todayISO,
    mentionedText: placeOnly ? null : message,
  });
  const selectedTrip = resolution.trip;
  const start = startOf(selectedTrip);
  const futureTrip = selectedTrip && start && start > i.todayISO ? selectedTrip : null;

  let scope: PlaceScope;
  let label: string | null;
  let searchCity: string | null;
  const hereLabel = physical?.place ?? (physical?.coords ? "Tu ubicación" : null);
  const mentionsHotel = /\bhotel\b/.test(normalizeText(message));
  const foreignFlight = flightNotInTrip(message, selectedTrip);
  const transportNow = TRANSPORT_NOW.test(normalizeText(message)) && !mentionsHotel && !/\baeropuerto\b/.test(normalizeText(message));
  if (requested && !needsSpecificTrip(message)) {
    scope = "requested"; label = requested; searchCity = requested;
  } else if (foreignFlight) {
    // "¿Cómo va el vuelo AM 2?" con un vuelo que no es del viaje: no es "sobre Valle de Bravo" (auditoría 10 #17).
    scope = "none"; label = null; searchCity = null;
  } else if (nearMe || ((placeSearch || transportNow) && !mentionsHotel && (futureTrip || i.position === "away"))) {
    // "Cerca" = donde está ahora. Un viaje que no ha empezado (o del que está fuera) no es "aquí".
    scope = "here"; label = hereLabel; searchCity = physical?.place ?? null;
  } else if (selectedTrip) {
    scope = "trip"; label = tripDisplayName(selectedTrip); searchCity = label;
  } else {
    scope = "none"; label = null; searchCity = null;
  }
  return { physical, resolution, selectedTrip, requested, futureTrip, nearMe, scope, label, searchCity };
}

/** Nota para el modelo con las cuatro piezas separadas (va en <notas>, junto al plan del turno). */
export function turnPlaceNote(tp: TurnPlace): string {
  const parts: string[] = [];
  parts.push(`UBICACIÓN FÍSICA: ${tp.physical ? (tp.physical.place ?? "coordenadas del navegador") : "desconocida (sin permiso de ubicación)"}.`);
  if (tp.selectedTrip) {
    const name = tripDisplayName(tp.selectedTrip) ?? "su viaje";
    parts.push(tp.futureTrip
      ? `VIAJE SELECCIONADO: ${name}, empieza el ${startOf(tp.futureTrip)}; es futuro: el usuario NO está ahí.`
      : `VIAJE SELECCIONADO: ${name}.`);
  }
  if (tp.requested) parts.push(`DESTINO PEDIDO: ${tp.requested} (no cambia su viaje seleccionado).`);
  if (tp.scope === "here") {
    parts.push(tp.physical
      ? `Responde sobre donde está ahora${tp.physical.place ? ` (${tp.physical.place})` : ""}; no recomiendes ni nombres lugares de su viaje.`
      : "Pidió algo cerca y no hay ubicación: pregúntale en una línea su zona o que active la ubicación; no uses el destino de su viaje.");
  } else if (tp.scope === "requested") {
    parts.push(`Responde sobre ${tp.requested}.`);
  }
  return parts.join(" ");
}

/** Etiqueta corta de la respuesta en el chat ("cerca de ti, Interlomas", "en Delhi", "sobre India"). */
export function answerPlaceLabel(
  m: { placeScope?: PlaceScope | null; placeLabel?: string | null; tripId?: string | null; local?: boolean },
  trips: Array<{ id: string; destino?: string | null }>,
): string | null {
  if (m.placeScope === "here") return m.placeLabel && m.placeLabel !== "Tu ubicación" ? `cerca de ti, ${m.placeLabel}` : m.placeLabel ? "cerca de ti" : null;
  if (m.placeScope === "requested") return m.placeLabel ? `en ${m.placeLabel}` : null;
  if (m.placeScope === "none") return null;
  // "trip" o respuestas viejas sin alcance (antes de este cambio): como antes.
  if (!m.tripId || (!m.placeScope && m.local)) return null;
  const t = trips.find((x) => x.id === m.tripId);
  return t?.destino ? `sobre ${t.destino}` : null;
}
