// Reglas de fuentes del análisis de viaje (sin dependencias de Deno, para poder probarlas).

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
  /** travelpayouts-flights: `price` USD por persona. */
  tpFlights?: Array<{ price?: number; booking_link?: string }>;
  tpApproximateDates?: boolean;
  /** flights-search (Google Flights): `price_per_person_usd`. */
  googleFlights?: Array<{ price_per_person_usd?: number; buy_url?: string }>;
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
    if (LIVE_HOTEL_LABELS.has(label) && label !== "travelpayouts") {
      // Nombre de la lista Y precio por noche igual (±5 %) al de la lista convertido a MXN.
      ok = hotels.some((x) => sameName(x?.name, h.nombre) &&
        (!(live.fxUsd > 0) || !(Number(h.precio_por_noche) > 0) || samePrice(h.precio_por_noche, Number(x?.nightly_usd) * live.fxUsd, 0.05)));
    }
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
