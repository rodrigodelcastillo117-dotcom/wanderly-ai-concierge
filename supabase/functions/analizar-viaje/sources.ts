// Reglas de fuentes del análisis de viaje (sin dependencias de Deno, para poder probarlas).
import { airlineCode } from "../_shared/airlines.ts";
import { visiblePlaceName } from "../_shared/placeName.ts";

// Extrae de las notas del cliente lo que describe el hospedaje, para buscarlo en Google Hotels.
const HOTEL_WORDS = /(hotel|hospedaje|alojamiento|boutique|resort|villa|caba[ñn]a|hostal|airbnb|todo incluido|all inclusive|vista al mar|frente al mar|frente a la playa|alberca|piscina|spa|lujo|5 estrellas|adults only|solo adultos)/i;
export function hotelPreference(notas: unknown): string {
  const text = String(notas ?? "").replace(/\s+/g, " ").trim();
  // Solo la frase que habla del hospedaje: "aniversario, hotel boutique en Le Marais, cenas"
  // → "hotel boutique en Le Marais". El resto confunde la búsqueda de Google Hotels.
  const clause = text.split(/[,.;]| y luego | pero /i).find((c) => HOTEL_WORDS.test(c));
  return clause ? clause.trim().slice(0, 60) : "";
}

const normName = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Igualdad, o que el nombre corto (de al menos 2 palabras) esté dentro del largo. Antes bastaba
// "contiene" en cualquier sentido: "Hotel" coincidía con cualquier hotel de la lista.
export const sameName = (a: unknown, b: unknown) => {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && ` ${long} `.includes(` ${short} `);
};

/** ¿Dos precios coinciden dentro de la tolerancia relativa? */
export const samePrice = (a: unknown, b: unknown, tolerance = 0.03) => {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return false;
  return Math.abs(x - y) / y <= tolerance;
};

export type LiveFlightLists = {
  /** travelpayouts-flights: `price` USD por persona; `departure_at`/`return_at` con desfase y `duration_to_minutes`. */
  tpFlights?: Array<{ price?: number; booking_link?: string; airline?: string; departure_at?: string | null; return_at?: string | null; duration_to_minutes?: number | null }>;
  tpApproximateDates?: boolean;
  /** flights-search (Google Flights): `price_per_person_usd` y horas locales de cada aeropuerto ("2027-03-10 11:00"). */
  googleFlights?: Array<{ price_per_person_usd?: number; buy_url?: string; airline?: string; departure?: { time?: string | null } | null; arrival?: { time?: string | null } | null }>;
  /** Zona horaria IANA del destino (de Google Places): para convertir la llegada de una tarifa de Aviasales. */
  destTimeZone?: string | null;
  /** Ciudad del viaje (contexto de nombres de una sola palabra). */
  city?: string | null;
  /** Tipo de cambio con el que se le dieron los precios al modelo. */
  fxUsd: number;
  /** Cuándo se consultaron las listas en vivo (ISO). Respaldo si una lista no trae su fecha. */
  consultedAt?: string;
  /** Fecha real de cada lista (de la caché compartida si salió de ahí). */
  googleFlightsAt?: string;
  hotelsAt?: string;
  tpAt?: string;
  /** La lista es un precio guardado (vencido) servido por uso justo o pausa: no es "en vivo". */
  googleFlightsSaved?: boolean;
  hotelsSaved?: boolean;
};

/** Fecha real de consulta de la respuesta de una búsqueda (consulted_at), o el respaldo. */
export function liveConsultedAt(resp: unknown, fallback: string): string {
  const at = (resp as { consulted_at?: unknown } | null)?.consulted_at;
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : fallback;
}

/** Etiqueta de Travelpayouts: un respaldo de referencia, nunca "en vivo". */
export const TP_REFERENCE_NOTE = "Precio de referencia (Aviasales, búsquedas de las últimas 48 h); puede variar.";

// ─── Horarios del vuelo elegido (caso Madrid, 28-oct-2026) ───
// En un destino, vuelos_json no traía salida ni llegada y la app no podía decir "Sale 11:00 · llega 05:00
// +1" ni armar el día de llegada. Las horas se copian SOLO de la fila real de la lista con la que empató
// el precio (y la aerolínea); si empatan varias filas con horas distintas, no se pone ninguna.

const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/** "2027-03-10 11:00" tal como lo publica Google Flights (hora local del aeropuerto), o null. */
export const gfStamp = (v: unknown): string | null => (typeof v === "string" && STAMP.test(v.trim()) ? v.trim() : null);

/** Hora local que trae un ISO con desfase ("2027-03-10T11:00:00-06:00" → "2027-03-10 11:00"). */
export function localStamp(iso: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Un instante en la hora local de una zona IANA ("Europe/Madrid") como "YYYY-MM-DD HH:MM"; null si no se puede. */
export function stampInZone(ms: number, timeZone: string | null | undefined): string | null {
  if (!Number.isFinite(ms) || !timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const out = `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
    return STAMP.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** ¿La aerolínea de la fila es la del vuelo elegido? (nombre o código IATA; sin dato, no descarta). */
function sameAirline(row: unknown, chosen: unknown): boolean {
  const r = String(row ?? "").trim(), c = String(chosen ?? "").trim();
  if (!r || !c) return true;
  const rc = /^[A-Z0-9]{2}$/.test(r) ? r : airlineCode(r);
  const cc = airlineCode(c);
  if (rc && cc) return rc === cc;
  const a = normName(r), b = normName(c);
  return a.includes(b) || b.includes(a);
}

const stripMarker = (u: unknown) => String(u ?? "").replace(/[?&]marker=[^&]*/g, "").replace(/\?$/, "");

type Times = { salida: string; llegada: string | null; regreso_salida: string | null };

/** Una sola combinación de horas entre las filas que empatan; si hay varias distintas, ninguna. */
function uniqueTimes(list: Times[]): Times | null {
  const keys = new Set(list.map((t) => `${t.salida}|${t.llegada ?? ""}|${t.regreso_salida ?? ""}`));
  return keys.size === 1 ? list[0] : null;
}

function googleTimes(v: any, rows: LiveFlightLists["googleFlights"], fx: number): Times | null {
  const hits = (rows ?? []).filter((f) => samePrice(v.precio_por_persona, Number(f?.price_per_person_usd) * fx) && sameAirline(f?.airline, v.aerolinea));
  const times = hits.map((f): Times | null => {
    const salida = gfStamp(f?.departure?.time), llegada = gfStamp(f?.arrival?.time);
    return salida && llegada ? { salida, llegada, regreso_salida: null } : null;
  }).filter((t): t is Times => t !== null);
  return times.length === hits.length ? uniqueTimes(times) : null;
}

function aviasalesTimes(v: any, rows: LiveFlightLists["tpFlights"], fx: number, tz: string | null | undefined): Times | null {
  const all = rows ?? [];
  // El enlace de la tarifa (con su token) identifica la fila; si no, precio y aerolínea.
  const byLink = v.booking_link ? all.filter((f) => f?.booking_link && stripMarker(f.booking_link) === stripMarker(v.booking_link)) : [];
  const hits = byLink.length ? byLink : all.filter((f) => samePrice(v.precio_por_persona, Number(f?.price) * fx) && sameAirline(f?.airline, v.aerolinea));
  const times = hits.map((f): Times | null => {
    const salida = localStamp(f?.departure_at);
    if (!salida) return null;
    const dep = Date.parse(String(f?.departure_at ?? ""));
    const dur = Number(f?.duration_to_minutes);
    // Llegada = salida + duración de la ida (Aviasales), en la hora local del destino (zona de Google).
    const llegada = Number.isFinite(dep) && dur > 0 ? stampInZone(dep + dur * 60_000, tz) : null;
    return { salida, llegada, regreso_salida: localStamp(f?.return_at) };
  }).filter((t): t is Times => t !== null);
  return times.length && times.length === hits.length ? uniqueTimes(times) : null;
}

/** Copia las horas reales de la fila que empató (o las borra si no empata ninguna). */
export function applyFlightTimes(v: any, matched: "travelpayouts" | "serpapi" | null, live: LiveFlightLists): void {
  delete v.salida; delete v.llegada; delete v.regreso_salida;
  if (!matched || !(live.fxUsd > 0)) return;
  const t = matched === "serpapi" ? googleTimes(v, live.googleFlights, live.fxUsd) : aviasalesTimes(v, live.tpFlights, live.fxUsd, live.destTimeZone);
  if (!t) return;
  v.salida = t.salida;
  if (t.llegada) v.llegada = t.llegada;
  if (t.regreso_salida) v.regreso_salida = t.regreso_salida;
}

const LIVE_FLIGHT_LABELS = new Set(["travelpayouts", "serpapi", "google_flights", "aviasales"]);
const PLACE_LABELS = new Set(["google_maps", "tripadvisor", "google_places"]);
const LIVE_HOTEL_LABELS = new Set(["serpapi", "travelpayouts", "google_hotels"]);

// La IA debe copiar lugares, hoteles y vuelos de las listas en vivo. Si un nombre o un precio no
// está en la lista, no puede llevar la etiqueta de esa fuente (sería presentar una invención como
// dato real). La etiqueta la decide el servidor, no el modelo.
export function enforceSources(
  a: any,
  places: any[],
  hotels: any[],
  placesSource: string,
  live: LiveFlightLists = { fxUsd: 0 },
) {
  const consultadoAt = live.consultedAt ?? new Date().toISOString();

  for (const t of Array.isArray(a?.tours) ? a.tours : []) {
    const match = t && PLACE_LABELS.has(t.fuente) ? places.find((p) => sameName(p?.name, t?.nombre)) : null;
    if (t && PLACE_LABELS.has(t.fuente) && !match) {
      t.fuente = "estimado";
      t.rating = null;
      t.num_reviews = null;
    } else if (t && match) {
      t.fuente = placesSource;
      // Nombre con los acentos de Google y, si es de una palabra ("David"), con la ciudad.
      t.nombre = visiblePlaceName(t.nombre, match.name, live.city ?? null);
      // Calificación y reseñas las pone el servidor con la lista, no el modelo.
      t.rating = match.rating ?? null;
      t.num_reviews = match.num_reviews ?? null;
      if (match.place_id) t.place_id = match.place_id;
      if (match.web_url) t.maps_url = match.web_url;
    } else if (!t?.fuente) {
      t.fuente = "estimado";
    }
    // El lugar puede ser real, pero el precio del tour siempre es una estimación.
    if (t && typeof t === "object") t.estado_dato = "ESTIMADO";
  }

  for (const h of Array.isArray(a?.hospedaje) ? a.hospedaje : []) {
    if (!h || typeof h !== "object") continue;
    const label = String(h.fuente_precio ?? "").toLowerCase();
    let ok = false;
    let hit: any = null;
    if (LIVE_HOTEL_LABELS.has(label) && label !== "travelpayouts") {
      // Nombre de la lista Y precio por noche igual (±5 %) al de la lista convertido a MXN.
      hit = hotels.find((x) => sameName(x?.name, h.nombre) &&
        (!(live.fxUsd > 0) || !(Number(h.precio_por_noche) > 0) || samePrice(h.precio_por_noche, Number(x?.nightly_usd) * live.fxUsd, 0.05))) ?? null;
      ok = !!hit;
    }
    // Identificador de Google Hotels y sitio del hotel del proveedor (no una búsqueda por nombre).
    if (hit?.property_token) h.property_token = hit.property_token;
    if (typeof hit?.link === "string" && /^https:\/\//.test(hit.link)) h.website = hit.link;
    // Travelpayouts ya no trae hoteles (Hotellook cerró): esa etiqueta nunca es real.
    if (ok) {
      h.fuente_precio = "serpapi";
      h.estado_dato = live.hotelsSaved ? "OBSOLETO" : "CONSULTADO_EN_VIVO";
      h.consultado_at = live.hotelsAt ?? consultadoAt;
    } else {
      if (label !== "perplexity") h.fuente_precio = "estimado";
      h.estado_dato = "ESTIMADO";
      delete h.consultado_at;
      // Liga escrita por el modelo (p. ej. booking.com/hotel/<slug inventado>, dominios que no existen): se quita; la app arma la búsqueda.
      delete h.booking_link;
      delete h.website;
      delete h.property_token;
    }
  }

  for (const v of Array.isArray(a?.vuelos) ? a.vuelos : []) {
    if (!v || typeof v !== "object") continue;
    const label = String(v.fuente_precio ?? "").toLowerCase();
    const ppMxn = Number(v.precio_por_persona) || 0;
    const fx = live.fxUsd;
    let matched: "travelpayouts" | "serpapi" | null = null;
    if (LIVE_FLIGHT_LABELS.has(label) && fx > 0 && ppMxn > 0) {
      const tpHit = (live.tpFlights ?? []).some((f) => samePrice(ppMxn, Number(f?.price) * fx));
      const gfHit = (live.googleFlights ?? []).some((f) => samePrice(ppMxn, Number(f?.price_per_person_usd) * fx));
      // Respeta la fuente declarada si coincide; si el precio está en la otra lista, se corrige.
      if (label === "travelpayouts" || label === "aviasales") matched = tpHit ? "travelpayouts" : gfHit ? "serpapi" : null;
      else matched = gfHit ? "serpapi" : tpHit ? "travelpayouts" : null;
    }
    // Horas de salida y llegada: solo las de la fila real con la que empató (nunca las del modelo).
    if (!v.modo) applyFlightTimes(v, matched, live);
    if (matched) {
      v.fuente_precio = matched;
      if (matched === "travelpayouts") {
        // Caché de búsquedas de otros viajeros (hasta 48 h): precio de referencia, nunca "en vivo".
        v.consultado_at = live.tpAt ?? consultadoAt;
        v.estado_dato = "ESTIMADO";
        v.nota_precio = TP_REFERENCE_NOTE;
        // Tarifa del mismo mes, no de la fecha exacta: además es una aproximación de fecha.
        if (live.tpApproximateDates) v.approximate_dates = true;
      } else {
        v.consultado_at = live.googleFlightsAt ?? consultadoAt;
        v.estado_dato = live.googleFlightsSaved ? "OBSOLETO" : "CONSULTADO_EN_VIVO";
      }
    } else {
      if (label !== "perplexity") v.fuente_precio = "estimado";
      v.estado_dato = "ESTIMADO";
      delete v.consultado_at;
    }
  }
}
