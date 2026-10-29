// Adaptadores: convierten lo que IATOS YA tiene (resultados de flights-search/hotels-search, opciones
// del viaje en trips.*_json, catálogo Privé, fichas de Google Places) en ofertas del Booking Bridge
// con sus acciones. Sin Deno. Cada oferta conserva su procedencia real (provider, source_url,
// price_checked_at) y nunca promete más de lo que la fuente dio.
import { isPlaceholderHotel } from "./placeholderHotel.ts";
import { checkAllowlisted, unwrapAffiliate } from "./allowlist.ts";
import { countryIso as countryIsoName, whatsappNumberFromUrl } from "./channels.ts";
import {
  aviasalesFromTpLink, aviasalesSearchUrl, bookingSearchUrl, EVIDENCE, getYourGuideSearchUrl, googleFlightsSearchUrl, isIsoDate, kayakFlightsSearchUrl,
  parseAviasalesSearch, parseBookingSearch, resyWithDate, roomsForAdults, viatorSearchUrl,
} from "./links.ts";
import { airlineCode } from "../airlines.ts";
import { cleanPlaceName } from "../placeName.ts";
import { restaurantCountry, restaurantSearchFor } from "../restaurantBooking.ts";
import { airlineFitsRoute, cityAirports, codeServesCity, mainAirport, maxPlausibleHours } from "../airports.ts";
import { stayForCity, tripFlightRoute, type TripFlightRoute } from "./tripRoute.ts";
import { TP_PUBLIC_MARKER } from "../tp-params.ts";
import type { RequestLang } from "./messages.ts";
import { hotelPriceRooms } from "../rooms.ts";
import { langForCountry } from "./messages.ts";
import { type ChannelCandidate, type ExactCandidate, type LinkCandidate, resolveBookingActions, type ResolverInput } from "./resolver.ts";
import type { BookingOffer, ProductType, SourceTrust } from "./types.ts";

/**
 * Id estable de la oferta (16 hex, mismo en el cliente y en el servidor): dos FNV-1a de 32 bits con
 * semillas distintas. Sin BigInt: el build del cliente apunta a Safari 13.
 */
export function stableId(parts: unknown[]): string {
  const s = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x9747b28c);
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};
const addHours = (iso: string | null, h: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t + h * 3600_000).toISOString() : null;
};
const normName = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ESTIMATED = new Set(["estimado", "perplexity", "ia", "ai"]);

export type TripLike = {
  id?: string | null;
  destino?: string | null;
  pais_destino?: string | null;
  ciudad_origen?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  num_viajeros?: number | null;
  quote_needs_update?: boolean | null;
  itinerario_json?: any;
  created_at?: string | null;
};

export type OfferContext = {
  trip?: TripLike | null;
  /** País ISO-2 del lugar (para teléfono e idioma). */
  country?: string | null;
  now?: number;
  /** Datos de la solicitud que el usuario está preparando (fecha, hora, personas…). */
  draft?: ResolverInput["draft"];
  flags?: ResolverInput["flags"];
  /** Si hay datos verificados del lugar (catálogo Privé, Google Places, sitio oficial). */
  venue?: VenueInfo | null;
  allow_assisted?: boolean;
};

function finish(
  base: Omit<BookingOffer, "actions" | "rejected" | "booking_url" | "booking_mode" | "offer_id"> & { id_parts: unknown[] },
  input: ResolverInput,
  extraRejected: Array<{ url: string; reason: string }> = [],
): BookingOffer {
  const r = resolveBookingActions(input);
  const { id_parts, ...rest } = base;
  const expired = r.exact_expired || (rest.offer_expires_at != null && Date.parse(rest.offer_expires_at) <= (input.now ?? Date.now()));
  return {
    ...rest,
    offer_id: stableId([rest.product_type, rest.provider, ...id_parts]),
    booking_mode: r.booking_mode,
    booking_url: r.primary?.url && /^https:/.test(r.primary.url) ? r.primary.url : null,
    actions: r.actions,
    rejected: [...extraRejected, ...r.rejected],
    availability_status: rest.availability_status,
    details: { ...rest.details, price_expired: expired },
  };
}

// ───────────────────────────────────────────── Vuelos ─────────────────────────────────────────────

export type FlightResultLike = {
  price_usd?: number | null;
  price_per_person_usd?: number | null;
  airline?: string | null;
  stops?: number | null;
  duration?: string | null;
  departure?: { id?: string | null; time?: string | null } | null;
  arrival?: { id?: string | null; time?: string | null } | null;
  booking_token?: string | null;
  buy_url?: string | null;
  airline_buy_url?: string | null;
  segments?: Array<{ airline?: string; flight_number?: string; from?: string; to?: string; departs?: string; arrives?: string }> | null;
  layovers?: Array<{ id?: string; name?: string; duration?: number }> | null;
  extensions?: string[] | null;
};

export type FlightSearchMeta = {
  dep_iata?: string | null;
  arr_iata?: string | null;
  depart?: string | null;
  return_date?: string | null;
  travelers?: number | null;
  consulted_at?: string | null;
  source?: string | null; // serpapi | travelpayouts
  google_flights_url?: string | null;
};

/** Resultado de flights-search (o de googlemax) → oferta. */
export function offerFromFlightResult(r: FlightResultLike, meta: FlightSearchMeta, ctx: OfferContext = {}): BookingOffer {
  const travelers = Math.max(1, Math.round(Number(meta.travelers) || 1));
  const origin = String(meta.dep_iata ?? r.departure?.id ?? "").toUpperCase();
  const dest = String(meta.arr_iata ?? r.arrival?.id ?? "").toUpperCase();
  const depart = isIsoDate(meta.depart) ? meta.depart : null;
  const ret = isIsoDate(meta.return_date) ? meta.return_date : null;
  const fromSerp = meta.source === "serpapi";
  const checkedAt = meta.consulted_at ?? null;
  const searches: LinkCandidate[] = [];
  // Google Flights con la búsqueda exacta de SerpApi (ruta, fechas, pasajeros).
  if (fromSerp && meta.google_flights_url && !/aviasales/.test(meta.google_flights_url)) {
    searches.push({ url: meta.google_flights_url, trust: "provider_api", evidence: EVIDENCE.GOOGLE_FLIGHTS_SERP_URL,
      preserves: { product: false, dates: true, travelers: true, room_or_fare: false }, verified_at: checkedAt, provider_label: "Google Flights" });
  }
  // Sin la búsqueda de SerpApi: Google Flights armado por IATOS con ruta, fechas, pasajeros y la
  // aerolínea de este resultado como filtro (EV-GFLIGHTS-TFS).
  const gf = !searches.length && depart
    ? googleFlightsSearchUrl({ origin, destination: dest, depart, ret, adults: travelers, airline: airlineCode(r.airline) })
    : null;
  if (gf) {
    searches.push({ url: gf, trust: "builder", evidence: EVIDENCE.GOOGLE_FLIGHTS_TFS,
      preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false }, provider_label: "Google Flights" });
  }
  const av = depart ? aviasalesSearchUrl({ origin, destination: dest, depart, ret, adults: travelers }) : null;
  if (av) {
    searches.push({ url: av, trust: "builder", evidence: EVIDENCE.AVIASALES_SEARCH,
      preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
  }
  const av2 = r.airline_buy_url ? checkAllowlisted(r.airline_buy_url) : null;
  const airlineSite = av2 && av2.ok && av2.provider?.kind === "airline" ? av2.url : null;
  const price = num(r.price_usd);
  const input: ResolverInput = {
    product_type: "flight", title: `${r.airline ?? "Vuelo"} · ${origin} → ${dest}`, now: ctx.now, flags: ctx.flags,
    searches,
    website: airlineSite ? { url: airlineSite, trust: "builder", evidence: EVIDENCE.AIRLINE_HOME, provider_label: r.airline ?? null } : null,
    recheckable: fromSerp && !!r.booking_token,
    allow_assisted: false,
  };
  return finish({
    id_parts: [origin, dest, depart, ret, travelers, r.airline, r.departure?.time, r.booking_token ?? ""],
    provider: fromSerp ? "google_flights" : meta.source === "travelpayouts" ? "travelpayouts" : "desconocido",
    provider_offer_id: r.booking_token ?? null,
    product_type: "flight",
    title: `${r.airline ?? "Vuelo"} · ${origin} → ${dest}`,
    subtitle: [r.duration, r.stops != null ? (r.stops === 0 ? "Directo" : `${r.stops} escala${r.stops > 1 ? "s" : ""}`) : null].filter(Boolean).join(" · ") || null,
    city: dest || null,
    source_url: fromSerp ? (meta.google_flights_url ?? null) : av,
    price, currency: price ? "USD" : null,
    taxes: { included: fromSerp ? true : null, note: fromSerp ? "Precio total de Google Flights para los pasajeros buscados." : "Precio de la caché de Aviasales (hasta 48 h)." },
    price_checked_at: checkedAt,
    // Google Flights se consulta en el momento (caché 6 h); Travelpayouts es caché de hasta 48 h.
    offer_expires_at: addHours(checkedAt, fromSerp ? 6 : 1),
    availability_status: "not_checked",
    traveler_count: travelers,
    travel_dates: { start: depart, end: ret },
    booking_conditions: (r.extensions ?? []).slice(0, 8).map(String),
    trip_id: ctx.trip?.id ?? null,
    verification_status: fromSerp ? "source_verified" : "unverified",
    price_is_estimate: false,
    recheckable: fromSerp && !!r.booking_token,
    details: {
      airline: r.airline ?? null, stops: r.stops ?? null, duration: r.duration ?? null,
      departure: r.departure ?? null, arrival: r.arrival ?? null, segments: r.segments ?? null, layovers: r.layovers ?? null,
      booking_token: r.booking_token ?? null,
      search: { origin, destination: dest, depart, return_date: ret, adults: travelers },
    },
  }, input);
}

/** Item crudo de SerpApi Google Flights (best_flights/other_flights) → forma de flights-search. */
export function flightResultFromSerp(item: any, travelers: number): FlightResultLike {
  const segs: any[] = Array.isArray(item?.flights) ? item.flights : [];
  const dur = Number(item?.total_duration ?? 0);
  return {
    price_usd: num(item?.price),
    price_per_person_usd: num(item?.price) ? Math.round(Number(item.price) / Math.max(1, travelers)) : null,
    airline: segs[0]?.airline ?? null,
    stops: Math.max(0, segs.length - 1),
    duration: dur ? `${Math.floor(dur / 60)}h ${dur % 60}m` : null,
    departure: { id: segs[0]?.departure_airport?.id ?? null, time: segs[0]?.departure_airport?.time ?? null },
    arrival: { id: segs[segs.length - 1]?.arrival_airport?.id ?? null, time: segs[segs.length - 1]?.arrival_airport?.time ?? null },
    booking_token: typeof item?.booking_token === "string" ? item.booking_token : null,
    segments: segs.map((s) => ({
      airline: s?.airline, flight_number: s?.flight_number, from: s?.departure_airport?.id, to: s?.arrival_airport?.id,
      departs: s?.departure_airport?.time, arrives: s?.arrival_airport?.time,
    })),
    layovers: Array.isArray(item?.layovers) ? item.layovers.map((l: any) => ({ id: l?.id, name: l?.name, duration: l?.duration })) : null,
    extensions: Array.isArray(item?.extensions) ? item.extensions : null,
  };
}

/** Ruta (IATA) del enlace de Aviasales que guardó la cotización, con las fechas y viajeros del viaje. */
function parsedRoute(raw: string | null, depart: string | null, ret: string | null, adults: number) {
  if (!raw) return null;
  const ok = checkAllowlisted(raw);
  const p = ok.ok ? parseAviasalesSearch(unwrapAffiliate(ok.url)) : null;
  return p ? { origin: p.origin, destination: p.destination, depart, return_date: ret, adults } : null;
}

export type TransportMode = "vuelo" | "tren" | "bus" | "coche" | "taxi" | "traslado" | "ferry" | "otro";

// Palabras que delatan el modo de un tramo. logistics-plan escribe el modo en texto libre
// ("Tren de alta velocidad", "Taxi oficial / Traslado privado", "Autobús ALSA", "Auto de alquiler");
// antes solo se reconocían "tren", "coche"… y todo lo demás se pintaba como vuelo con enlace de
// Google Flights (caso España multidestino, 23-oct-2026). El orden importa: "Taxi / Traslado" es taxi.
const MODE_WORDS: Array<[TransportMode, RegExp]> = [
  ["vuelo", /^(vuelos?|avion(es)?|aereo|flights?|plane|airline)$/],
  ["tren", /^(tren(es)?|trains?|ave|avant|alvia|iryo|ouigo|renfe|cercanias|rail|railway|tgv|frecciarossa|italo|shinkansen|eurostar|ferrocarril)$/],
  ["bus", /^(autobus(es)?|bus(es)?|autocar|coach|camion|alsa|flixbus)$/],
  ["ferry", /^(ferry|ferri|ferries|barco|ship|boat|crucero|cruise|lancha|catamaran)$/],
  ["taxi", /^(taxi|taxis|uber|cabify|vtc)$/],
  ["traslado", /^(traslados?|transfer|shuttle)$/],
  ["coche", /^(coche|auto|autos|carro|car|roadtrip|campervan|camper|renta|alquiler|conduccion|driving|vehiculo|manejando)$/],
];

/**
 * Modo canónico de un tramo a partir de su texto (`mode` o `modo`). null si viene vacío (las filas
 * viejas de vuelos_json sin modo son vuelos); "otro" si dice algo que no se reconoce (no se afirma
 * que sea un vuelo).
 */
export function transportModeOf(raw: unknown): TransportMode | null {
  const s = String(raw ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!s) return null;
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [mode, re] of MODE_WORDS) if (words.some((w) => re.test(w))) return mode;
  return "otro";
}

/** ¿El tramo NO es un vuelo (tren, bus, coche, taxi, traslado, ferry…)? Lee `modo` (analizar-viaje) o `mode`. */
export function isGroundTripOption(v: any): boolean {
  const m = transportModeOf(v?.modo) ?? transportModeOf(v?.mode);
  return m != null && m !== "vuelo";
}

/** ¿La fila la escribió la IA como estimación (sin tarifa verificada)? */
export function isEstimatedTripFlight(v: any): boolean {
  const fuente = String(v?.fuente_precio ?? "").toLowerCase();
  return ESTIMATED.has(fuente) || !fuente;
}

/**
 * Problemas de una tarifa guardada que la vuelven inservible para el viaje: llega a otra ciudad
 * (MEX→BUH presentada como Roma), dura más de lo creíble para la distancia o trae una aerolínea
 * regional que no opera esa ruta (Volaris a Europa). Lista vacía = se puede usar.
 */
export function tripFlightProblems(v: any, trip: TripLike | null | undefined): Array<"destino_distinto_al_viaje" | "origen_distinto_al_viaje" | "duracion_absurda" | "aerolinea_no_opera_la_ruta"> {
  const out: ReturnType<typeof tripFlightProblems> = [];
  if (!v || isGroundTripOption(v)) return out;
  const route = tripFlightRoute(trip);
  const raw = str(v?.booking_link, 2000);
  const ok = raw ? checkAllowlisted(raw) : null;
  const parsed = ok && ok.ok ? parseAviasalesSearch(unwrapAffiliate(ok.url)) : null;
  // Solo el vuelo internacional (origen → primera ciudad) se compara con el viaje; un tramo interno
  // (Florencia → Venecia) tiene su propia ruta.
  if (parsed && isTripInternationalRow(v, route)) {
    if (route.cities[0] && codeServesCity(parsed.destination, route.cities[0]) === false) out.push("destino_distinto_al_viaje");
    if (route.originCity && codeServesCity(parsed.origin, route.originCity) === false) out.push("origen_distinto_al_viaje");
  }
  const from = parsed?.origin ?? v?.from ?? route.originCity;
  const to = parsed?.destination ?? v?.to ?? route.cities[0];
  const hours = durationHours(v?.duracion ?? v?.duration);
  // La duración guardada puede ser de ida y vuelta (Travelpayouts "duration"): se compara con el doble.
  if (hours != null && hours > maxPlausibleHours(from, to) * (String(v?.fuente_precio) === "travelpayouts" ? 2 : 1)) out.push("duracion_absurda");
  const code = airlineCode(v?.aerolinea);
  if (code && !airlineFitsRoute(code, from, to)) out.push("aerolinea_no_opera_la_ruta");
  return out;
}

/** ¿La fila es el vuelo internacional del viaje (sale del origen o no dice de dónde)? */
export function isTripInternationalRow(v: any, route: TripFlightRoute): boolean {
  if (isGroundTripOption(v)) return false;
  const from = cityAirports(v?.from);
  const origin = cityAirports(route.originCity);
  if (!v?.from || !from) return true;
  return !!origin && from.metro === origin.metro;
}

/** "65h", "12h 45m", "15 h 20 min" → horas. null si no se entiende. */
export function durationHours(s: unknown): number | null {
  const t = String(s ?? "").toLowerCase();
  const h = /(\d+(?:[.,]\d+)?)\s*h/.exec(t);
  const m = /(\d+)\s*m/.exec(t.replace(/\d+(?:[.,]\d+)?\s*h/, ""));
  if (!h && !m) return null;
  return (h ? Number(h[1].replace(",", ".")) : 0) + (m ? Number(m[1]) / 60 : 0);
}

/** Opción de vuelo guardada en el viaje (trips.vuelos_json, escrita por analizar-viaje o la ruta multi-destino). */
export function offerFromTripFlight(v: any, ctx: OfferContext & { city?: string | null; index?: number }): BookingOffer {
  const trip = ctx.trip ?? {};
  const travelers = Math.max(1, Math.round(Number(trip.num_viajeros) || 1));
  const depart = isIsoDate(trip.fecha_salida) ? trip.fecha_salida! : null;
  const ret = isIsoDate(trip.fecha_regreso) ? trip.fecha_regreso! : null;
  const city = ctx.city ?? trip.destino ?? null;
  const ground = isGroundTripOption(v);
  const product: ProductType = ground ? "transport" : "flight";
  const raw = str(v?.booking_link, 2000) ?? str(v?.cta_action, 2000);
  const rejected: Array<{ url: string; reason: string }> = [];
  const searches: LinkCandidate[] = [];
  let website: LinkCandidate | null = null;
  const problems = tripFlightProblems(v, trip);
  const route = tripFlightRoute(trip);
  const estimated = isEstimatedTripFlight(v);
  // Aerolínea para filtrar Google Flights: solo si la tarifa es real y la aerolínea opera la ruta.
  const airline = !estimated && problems.length === 0 ? airlineCode(v?.aerolinea) : null;
  // Ruta del viaje (ida a la primera ciudad, regreso desde la última). Es la que manda: la de la
  // tarifa guardada puede ser de otro destino.
  const tripSearch = !ground && route.origin && route.destination && depart
    ? { origin: route.origin, destination: route.destination, returnFrom: route.returnFrom, depart, ret, adults: travelers }
    : null;
  const pushTripSearches = () => {
    if (!tripSearch) return;
    const gf = googleFlightsSearchUrl({ ...tripSearch, airline });
    if (gf) searches.push({ url: gf, trust: "builder", evidence: EVIDENCE.GOOGLE_FLIGHTS_TFS, provider_label: "Google Flights",
      preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
    const kk = kayakFlightsSearchUrl(tripSearch);
    if (kk) searches.push({ url: kk, trust: "builder", evidence: EVIDENCE.KAYAK_FLIGHTS, provider_label: "Kayak",
      preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
  };

  if (raw) {
    const ok = checkAllowlisted(raw);
    const parsed = ok.ok ? parseAviasalesSearch(unwrapAffiliate(ok.url)) : null;
    if (!ok.ok) {
      rejected.push({ url: raw, reason: ok.reason });
    } else if (!ground && ok.provider?.provider === "google_flights" && !ok.provider.redirector) {
      // Vuelo de Google Flights en vivo (logistics-plan, open-jaw): la misma búsqueda que dio el
      // precio (tramos, fechas, pasajeros y clase), primero; sin duplicar la tfs del viaje.
      searches.push({ url: ok.url, trust: estimated ? "builder" : "provider_api",
        evidence: /[?&]tfs=/.test(ok.url) && !/[?&]curr=/.test(ok.url) ? EVIDENCE.GOOGLE_FLIGHTS_TFS : EVIDENCE.GOOGLE_FLIGHTS_SERP_URL,
        preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false }, verified_at: str(v?.consultado_at) ?? null, provider_label: "Google Flights" });
    } else if (parsed && problems.includes("destino_distinto_al_viaje")) {
      // La tarifa era de otra ruta: nunca se abre ni se precarga ese destino.
      rejected.push({ url: raw, reason: "destino_distinto_al_viaje" });
    } else if (parsed && depart) {
      // El enlace lo copió la IA de una búsqueda: si sus fechas o pasajeros no son los del viaje
      // (p. ej. el usuario cambió fechas), se arma la búsqueda correcta con los mismos aeropuertos.
      const want = { d: `${depart.slice(8, 10)}${depart.slice(5, 7)}`, r: ret ? `${ret.slice(8, 10)}${ret.slice(5, 7)}` : null };
      // Primero Google Flights con la ruta del viaje (o la de la tarifa), las fechas y pasajeros del
      // viaje y SOLO la aerolínea cotizada si es creíble (EV-GFLIGHTS-TFS).
      const orig = mainAirport(parsed.origin) ?? parsed.origin;
      const dest = mainAirport(parsed.destination) ?? parsed.destination;
      if (tripSearch) pushTripSearches();
      else if (!ground) {
        const gf = googleFlightsSearchUrl({ origin: orig, destination: dest, depart, ret, adults: travelers, airline });
        if (gf) searches.push({ url: gf, trust: "builder", evidence: EVIDENCE.GOOGLE_FLIGHTS_TFS, provider_label: "Google Flights",
          preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
      }
      // Aviasales solo para ida y vuelta al mismo destino (no recibe regreso desde otra ciudad).
      const openJaw = !!tripSearch && tripSearch.returnFrom !== tripSearch.destination;
      if (!openJaw) {
        if (parsed.depart !== want.d || (parsed.ret ?? null) !== want.r || parsed.adults !== Math.min(9, travelers) || parsed.children !== 0) {
          rejected.push({ url: raw, reason: "fechas_o_viajeros_distintos_al_viaje" });
          const rebuilt = aviasalesSearchUrl({ origin: parsed.origin, destination: parsed.destination, depart, ret, adults: travelers });
          if (rebuilt) searches.push({ url: rebuilt, trust: "builder", evidence: EVIDENCE.AVIASALES_SEARCH, preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
        } else {
          searches.push({ url: ok.url, trust: "ai", evidence: EVIDENCE.AVIASALES_TP_LINK, preserves: { product: false, dates: true, travelers: true, room_or_fare: false } });
        }
      } else {
        rejected.push({ url: raw, reason: "regreso_desde_otra_ciudad" });
      }
    } else if (ok.provider?.kind === "airline") {
      website = { url: ok.url, trust: "ai", evidence: EVIDENCE.AIRLINE_HOME, provider_label: ok.provider.label };
    } else if (ground && ok.provider?.kind === "maps") {
      // Trayecto por carretera: ruta de Google Maps (en auto o en transporte público) con origen y destino.
      searches.push({ url: ok.url, trust: "builder", evidence: EVIDENCE.MAPS_SEARCH, provider_label: "Google Maps",
        preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
    } else if (ok.provider?.kind === "bus" || ok.provider?.provider === "travelpayouts" || ok.provider?.kind === "metasearch") {
      searches.push({ url: ok.url, trust: "ai", evidence: ground ? EVIDENCE.BUS_SEARCH : EVIDENCE.AVIASALES_TP_LINK,
        preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
    } else {
      rejected.push({ url: raw, reason: "no_es_un_enlace_de_vuelo" });
    }
  }
  // Sin enlace aprovechable (o descartado): la búsqueda del viaje, si el vuelo es el internacional.
  if (!ground && !searches.some((x) => x.provider_label === "Google Flights") && tripSearch && isTripInternationalRow(v, route)) pushTripSearches();
  // Kayak al final: Google Flights (con la aerolínea) y Aviasales (la tarifa) van primero.
  searches.sort((a, b) => Number(a.provider_label === "Kayak") - Number(b.provider_label === "Kayak"));
  // No se arma Google Flights por texto (?q=): abre el formulario vacío (evidencia F6).
  const est = ESTIMATED.has(String(v?.fuente_precio ?? "").toLowerCase()) || String(v?.estado_dato ?? "").toUpperCase() === "ESTIMADO" || num(v?.precio_min) != null;
  // Una tarifa de otra ruta (o imposible) no aporta precio: el vuelo queda "por cotizar".
  const unusable = problems.length > 0;
  const pp = unusable ? null : num(v?.precio_por_persona);
  const checked = str(v?.consultado_at) ?? trip.created_at ?? null;
  const input: ResolverInput = {
    product_type: product, title: str(v?.aerolinea) ?? (ground ? "Transporte" : "Vuelo"), now: ctx.now, flags: ctx.flags,
    price_is_estimate: est, searches, website, allow_assisted: false,
  };
  return finish({
    id_parts: [trip.id, ctx.index ?? "", v?.aerolinea, v?.tier, depart, ret, travelers],
    provider: String(v?.fuente_precio ?? "iatos_ai"),
    provider_offer_id: null,
    product_type: product,
    title: `${str(v?.aerolinea) ?? (ground ? "Transporte" : "Vuelo")}${city ? ` · ${trip.ciudad_origen ?? ""} → ${city}`.replace(" ·  →", " ·") : ""}`,
    subtitle: [str(v?.duracion), str(v?.escalas)].filter(Boolean).join(" · ") || null,
    city,
    source_url: raw,
    price: pp ? pp * travelers : null,
    currency: pp ? "MXN" : null,
    taxes: null,
    price_checked_at: checked,
    offer_expires_at: est ? null : addHours(checked, 24),
    availability_status: "not_checked",
    traveler_count: travelers,
    travel_dates: { start: depart, end: ret },
    booking_conditions: [],
    trip_id: trip.id ?? null,
    verification_status: est ? "estimated" : trip.quote_needs_update ? "unverified" : "source_verified",
    price_is_estimate: est,
    recheckable: false,
    details: { tier: v?.tier ?? null, stale_quote: !!trip.quote_needs_update, ground, airline_code: airline,
      problems,
      search: problems.includes("destino_distinto_al_viaje") ? null : parsedRoute(raw, depart, ret, travelers) },
  }, input, rejected);
}

// ───────────────────────────────────────────── Hoteles ────────────────────────────────────────────

export type HotelResultLike = {
  name?: string | null;
  nightly_usd?: number | null;
  total_usd?: number | null;
  rating?: number | null;
  link?: string | null; // sitio del hotel (Google Hotels)
  booking_url?: string | null;
  property_token?: string | null;
  gps?: { lat: number; lng: number } | null;
};

export type HotelSearchMeta = { city?: string | null; checkin?: string | null; checkout?: string | null; adults?: number | null; consulted_at?: string | null; source?: string | null };

export function offerFromHotelResult(h: HotelResultLike, meta: HotelSearchMeta, ctx: OfferContext = {}): BookingOffer {
  const adults = Math.max(1, Math.round(Number(meta.adults) || 1));
  const name = str(h.name) ?? "Hotel";
  const city = str(meta.city);
  const ci = isIsoDate(meta.checkin) ? meta.checkin! : null;
  const co = isIsoDate(meta.checkout) ? meta.checkout! : null;
  const searches: LinkCandidate[] = [];
  const b = ci && co ? bookingSearchUrl({ query: [name, city].filter(Boolean).join(" "), checkin: ci, checkout: co, adults }) : null;
  if (b) searches.push({ url: b, trust: "builder", evidence: EVIDENCE.BOOKING_SEARCH, preserves: { product: false, dates: true, travelers: true, room_or_fare: false } });
  const fromSerp = meta.source === "serpapi";
  const price = num(h.total_usd) ?? null;
  const input: ResolverInput = {
    product_type: "hotel", title: name, now: ctx.now, searches,
    website: h.link ? { url: h.link, trust: fromSerp ? "provider_api" : "client", evidence: EVIDENCE.GOOGLE_HOTELS_PRICE_LINK } : null,
    maps: { query: [name, city].filter(Boolean).join(", ") },
    recheckable: fromSerp && !!h.property_token,
  };
  return finish({
    id_parts: [name, city, ci, co, adults, h.property_token ?? ""],
    provider: fromSerp ? "google_hotels" : "desconocido",
    provider_offer_id: h.property_token ?? null,
    product_type: "hotel", title: name, subtitle: h.rating ? `★ ${h.rating}` : null, city,
    source_url: h.link ?? null,
    price, currency: price ? "USD" : null,
    taxes: { included: null, note: "Google Hotels muestra el precio más bajo encontrado; impuestos y cargos según el proveedor." },
    price_checked_at: meta.consulted_at ?? null,
    offer_expires_at: addHours(meta.consulted_at ?? null, 12),
    availability_status: "not_checked",
    traveler_count: adults, travel_dates: { start: ci, end: co },
    booking_conditions: [],
    trip_id: ctx.trip?.id ?? null,
    verification_status: fromSerp ? "source_verified" : "unverified",
    price_is_estimate: false,
    recheckable: fromSerp && !!h.property_token,
    details: { nightly_usd: h.nightly_usd ?? null, property_token: h.property_token ?? null, search: { q: [name, city].filter(Boolean).join(" "), checkin: ci, checkout: co, adults } },
  }, input);
}

/** Opción de hospedaje del viaje (trips.hospedaje_json). */
export function offerFromTripHotel(h: any, ctx: OfferContext & { city?: string | null; index?: number }): BookingOffer {
  const trip = ctx.trip ?? {};
  const adults = Math.max(1, Math.round(Number(trip.num_viajeros) || 1));
  const city = ctx.city ?? trip.destino ?? null;
  const name = str(h?.nombre) ?? "Hospedaje";
  // Multi-destino: las noches de ESA ciudad (Roma 22–26 oct), no todo el viaje.
  const stay = stayForCity(trip as never, h?.ciudad ?? null);
  const ci = stay?.checkin ?? (isIsoDate(trip.fecha_salida) ? trip.fecha_salida! : null);
  const co = stay?.checkout ?? (isIsoDate(trip.fecha_regreso) ? trip.fecha_regreso! : null);
  const rejected: Array<{ url: string; reason: string }> = [];
  const searches: LinkCandidate[] = [];
  const raw = str(h?.booking_link, 2000) ?? str(h?.booking_url, 2000) ?? str(h?.cta_action, 2000);
  if (raw) {
    const ok = checkAllowlisted(raw);
    const parsed = ok.ok ? parseBookingSearch(ok.url) : null;
    if (!ok.ok) rejected.push({ url: raw, reason: ok.reason });
    else if (parsed && (parsed.checkin !== ci || parsed.checkout !== co || (parsed.adults ?? adults) !== adults)) {
      // Otra fecha u otros ocupantes que los del viaje: no se usa (se arma la búsqueda correcta abajo).
      rejected.push({ url: raw, reason: "fechas_o_viajeros_distintos_al_viaje" });
    } else if (!parsed) {
      rejected.push({ url: raw, reason: "enlace_de_hotel_no_verificable" });
    }
  }
  // Hotel "de referencia" de la IA ("Boutique hotel en el Centro Histórico (por confirmar)"): no es un
  // hotel real; la búsqueda es la del destino con las fechas (antes Booking buscaba la frase literal).
  const placeholder = isPlaceholderHotel(h);
  const b = ci && co ? bookingSearchUrl({ query: placeholder ? String(city ?? "") : [name, city].filter(Boolean).join(" "), checkin: ci, checkout: co, adults, rooms: roomsForAdults(adults) }) : null;
  if (b) searches.push({ url: b, trust: "builder", evidence: EVIDENCE.BOOKING_SEARCH, preserves: { product: false, dates: true, travelers: true, room_or_fare: false } });
  const est = ESTIMATED.has(String(h?.fuente_precio ?? "").toLowerCase()) || String(h?.estado_dato ?? "").toUpperCase() === "ESTIMADO";
  const nightly = num(h?.precio_por_noche);
  const nights = ci && co ? Math.max(1, Math.round((Date.parse(co) - Date.parse(ci)) / 86400000)) : null;
  const venueIn = venueInputs(ctx.venue ?? null);
  const input: ResolverInput = {
    product_type: "hotel", title: name, country: ctx.country ?? ctx.venue?.country ?? null, now: ctx.now, price_is_estimate: est,
    searches, maps: venueIn.maps ?? { query: [name, h?.barrio, city].filter(Boolean).join(", ") },
    official_booking: venueIn.official_booking, website: venueIn.website, phone: venueIn.phone, whatsapp: venueIn.whatsapp, email: venueIn.email,
    draft: ctx.draft, allow_assisted: false,
  };
  return finish({
    id_parts: [trip.id, ctx.index ?? "", name, city, ci, co, adults],
    provider: String(h?.fuente_precio ?? "iatos_ai"),
    provider_offer_id: null,
    product_type: "hotel", title: name, subtitle: [str(h?.barrio), h?.rating ? `★ ${h.rating}` : null].filter(Boolean).join(" · ") || null, city,
    source_url: raw,
    // Mismo criterio que la cotización: precio en vivo = grupo completo; estimado = por habitación doble.
    price: nightly && nights ? nightly * nights * hotelPriceRooms(h, adults) : null,
    currency: nightly ? "MXN" : null,
    taxes: { included: null, note: "Impuestos y cargos según el proveedor." },
    price_checked_at: str(h?.consultado_at) ?? trip.created_at ?? null,
    offer_expires_at: est ? null : addHours(str(h?.consultado_at) ?? trip.created_at ?? null, 24),
    availability_status: "not_checked",
    traveler_count: adults, travel_dates: { start: ci, end: co },
    booking_conditions: [],
    trip_id: trip.id ?? null,
    verification_status: est ? "estimated" : trip.quote_needs_update ? "unverified" : "source_verified",
    price_is_estimate: est,
    recheckable: false,
    details: { nightly_mxn: nightly, nights, rooms: roomsForAdults(adults), tier: h?.tier ?? null, stale_quote: !!trip.quote_needs_update },
  }, input, rejected);
}

// ─────────────────────────────────── Lugares: restaurantes y experiencias ─────────────────────────

/** Datos verificados de un lugar: catálogo Privé, Google Places o el escaneo de su sitio oficial. */
export type VenueInfo = {
  name: string;
  city?: string | null;
  country?: string | null; // ISO-2
  place_id?: string | null;
  website?: string | null;
  booking_url?: string | null;
  booking_method?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp_url?: string | null;
  source: "prive_catalog" | "google_places" | "official_site_scan";
  verified_at?: string | null;
  /** De dónde salieron teléfono/correo/WhatsApp si no es la misma fuente (p. ej. escaneo del sitio). */
  channel_source?: VenueInfo["source"] | null;
  prive_experience_id?: string | null;
  prive_slug?: string | null;
};

const VENUE_TRUST: Record<VenueInfo["source"], SourceTrust> = {
  prive_catalog: "curated_catalog", google_places: "google_places", official_site_scan: "official_site_scan",
};
const VERIFIED_BY: Record<VenueInfo["source"], string> = {
  prive_catalog: "Catálogo IATOS Privé (curado del sitio oficial)",
  // Solo llega de trips.*_json (venueFromTripPlace), que el dueño y los colaboradores pueden editar (AUD-04).
  google_places: "Google Maps al cotizar (dato guardado en el viaje; confírmalo en la ficha)",
  official_site_scan: "Sitio oficial del lugar",
};

function venueInputs(v: VenueInfo | null): Pick<ResolverInput, "official_booking" | "website" | "phone" | "whatsapp" | "email" | "maps" | "prive_experience_id"> {
  if (!v) return {};
  const trust = VENUE_TRUST[v.source];
  const out: ReturnType<typeof venueInputs> = {};
  const waFromBooking = v.booking_url ? whatsappNumberFromUrl(v.booking_url) : null;
  const wa = waFromBooking ?? (v.whatsapp_url ? whatsappNumberFromUrl(v.whatsapp_url) : null);
  if (v.booking_url && !waFromBooking) {
    out.official_booking = [{ url: v.booking_url, trust, evidence: v.source === "prive_catalog" ? EVIDENCE.CATALOG_BOOKING_URL : EVIDENCE.SITE_SCAN,
      verified_at: v.verified_at ?? null, preserves: { product: true, dates: false, travelers: false, room_or_fare: false } }];
  }
  // WhatsApp solo si el enlace está en el sitio oficial o en el catálogo curado: un teléfono de Google
  // no garantiza que ese número tenga WhatsApp.
  const cs = v.channel_source ?? v.source;
  const waSource = waFromBooking ? v.source : cs;
  if (wa && waSource !== "google_places") out.whatsapp = { value: wa, verified_by: VERIFIED_BY[waSource], trust: VENUE_TRUST[waSource] };
  if (v.website) out.website = { url: v.website, trust, evidence: v.source === "google_places" ? EVIDENCE.GOOGLE_PLACES : EVIDENCE.CATALOG_BOOKING_URL, verified_at: v.verified_at ?? null };
  if (v.phone) out.phone = { value: v.phone, verified_by: VERIFIED_BY[cs], trust: VENUE_TRUST[cs] };
  if (v.email) out.email = { value: v.email, verified_by: VERIFIED_BY[cs], trust: VENUE_TRUST[cs] };
  out.maps = { query: [cleanPlaceName(v.name), v.city].filter(Boolean).join(", "), place_id: v.place_id ?? null };
  if (v.prive_experience_id) out.prive_experience_id = v.prive_experience_id;
  return out;
}

/** ¿El slug de una página de reservas (opentable.com/r/<slug>) corresponde a este nombre? */
export function bookingPageMatchesName(url: string, name: string): boolean {
  const tokens = normName(name).split(" ").filter((t) => t.length >= 3 && !["restaurante", "restaurant", "the", "bar", "los", "las"].includes(t));
  if (!tokens.length) return false;
  let path = "";
  try { path = normName(decodeURIComponent(new URL(url).pathname)); } catch { return false; }
  return tokens.every((t) => path.includes(t));
}

export function offerFromVenue(
  v: VenueInfo | { name: string; city?: string | null; country?: string | null },
  product: Extract<ProductType, "restaurant" | "experience" | "tour" | "event">,
  ctx: OfferContext & { ai_url?: string | null; price_label?: string | null; id_extra?: unknown[] } = {},
): BookingOffer {
  const venue = "source" in v ? v : null;
  // Nombre limpio para el título y para los enlaces de búsqueda (viajes guardados con el nombre del listado).
  const name = cleanPlaceName(str(v.name, 160)) || "Lugar";
  const city = str(v.city) ?? ctx.trip?.destino ?? null;
  const country = (v.country ?? ctx.country ?? null) || null;
  const rejected: Array<{ url: string; reason: string }> = [];
  const vin = venueInputs(venue);
  // Resy acepta fecha y personas en la URL de la página del lugar (EV-RESY-DATE); la hora no.
  const reqDate = ctx.draft?.date ?? null;
  const reqSeats = ctx.draft?.party_size ?? null;
  const official = (vin.official_booking ?? []).map((c) => {
    if (!c.url) return c;
    const withDate = resyWithDate(c.url, reqDate, reqSeats);
    return withDate === c.url ? c : { ...c, url: withDate, evidence: EVIDENCE.RESY_VENUE_DATE,
      preserves: { ...c.preserves, dates: isIsoDate(reqDate), travelers: !!reqSeats } };
  });
  const searches: LinkCandidate[] = [];
  // Enlace escrito por la IA (cta_action): solo si es un sistema de reservas permitido Y su ruta
  // nombra a este lugar (evita mandar al restaurante equivocado).
  if (ctx.ai_url) {
    const ok = checkAllowlisted(ctx.ai_url);
    if (!ok.ok) rejected.push({ url: ctx.ai_url, reason: ok.reason });
    else if (ok.provider?.kind === "restaurant_booking" && bookingPageMatchesName(ok.url, name)) {
      official.push({ url: ok.url, trust: "ai", evidence: EVIDENCE.OPENTABLE_SEARCH, preserves: { product: true, dates: false, travelers: false, room_or_fare: false } });
    } else if (ok.provider?.kind !== "maps") rejected.push({ url: ctx.ai_url, reason: "no_coincide_con_el_lugar" });
  }
  // La búsqueda por nombre solo si el lugar no tiene su propia página de reservas: si la tiene, esa es
  // la correcta (una búsqueda en otra plataforma podría llevar a un homónimo).
  if (product === "restaurant" && official.length === 0) {
    // La plataforma que cubre el país (TheFork en España e Italia, OpenTable en EE. UU.…); en México y
    // donde no hay una, ninguna búsqueda: el sitio, el teléfono y la ficha de Maps del lugar.
    const iso = (country && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : null) ?? countryIsoName(country) ?? countryIsoName(ctx.trip?.pais_destino)
      ?? restaurantCountry({ city });
    const s = restaurantSearchFor(name, city, iso);
    if (s) searches.push({ url: s.url, trust: "builder", evidence: s.kind === "thefork" ? "EV-THEFORK-SEARCH" : EVIDENCE.OPENTABLE_SEARCH, provider_label: s.kind === "thefork" ? "TheFork" : "OpenTable", preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
  } else if (product !== "restaurant" && official.length === 0) {
    // Con las fechas del viaje: GetYourGuide filtra por ese rango (date_from/date_to).
    const tripFrom = isIsoDate(ctx.trip?.fecha_salida) ? ctx.trip!.fecha_salida! : null;
    const tripTo = isIsoDate(ctx.trip?.fecha_regreso) ? ctx.trip!.fecha_regreso! : null;
    const gyg = getYourGuideSearchUrl(city ?? "", name, TP_PUBLIC_MARKER, { from: tripFrom, to: tripTo });
    const via = viatorSearchUrl(city ?? "", name);
    // Con fechas del viaje va primero GetYourGuide (filtra por ese rango); sin fechas, Viator con el
    // código de afiliado directo de IATOS. Los dos quedan siempre como opción.
    const gygFirst = !!(tripFrom && tripTo);
    const viaEntry = via ? { url: via, trust: "builder" as const, evidence: EVIDENCE.TOURS_SEARCH, provider_label: "Viator", preserves: { product: false, dates: false, travelers: false, room_or_fare: false } } : null;
    const gygEntry = gyg ? { url: gyg, trust: "builder" as const, evidence: EVIDENCE.TOURS_SEARCH, provider_label: "GetYourGuide", preserves: { product: false, dates: gygFirst, travelers: false, room_or_fare: false } } : null;
    for (const e of gygFirst ? [gygEntry, viaEntry] : [viaEntry, gygEntry]) if (e) searches.push(e);
  }
  const lang: RequestLang = langForCountry(country);
  const draft = ctx.draft ?? { venue: name, product_type: product === "tour" ? "tour" : product === "event" ? "event" : product, lang };
  const input: ResolverInput = {
    product_type: product, title: name, city, country, now: ctx.now,
    official_booking: official, searches, website: vin.website ?? null, phone: vin.phone ?? null, whatsapp: vin.whatsapp ?? null, email: vin.email ?? null,
    maps: vin.maps ?? { query: [name, city].filter(Boolean).join(", ") },
    prive_experience_id: vin.prive_experience_id ?? null,
    allow_assisted: ctx.allow_assisted ?? true,
    draft,
  };
  return finish({
    id_parts: [name, city, venue?.prive_slug ?? venue?.place_id ?? "", ...(ctx.id_extra ?? [])],
    provider: venue?.source ?? "iatos_ai",
    provider_offer_id: venue?.prive_slug ?? venue?.place_id ?? null,
    product_type: product, title: name, subtitle: ctx.price_label ?? null, city,
    source_url: venue?.website ?? null,
    price: null, currency: null, taxes: null,
    price_checked_at: venue?.verified_at ?? null,
    offer_expires_at: null,
    // Nunca se consulta disponibilidad en tiempo real de un restaurante o experiencia.
    availability_status: "not_checked",
    traveler_count: ctx.draft?.party_size ?? ctx.trip?.num_viajeros ?? null,
    travel_dates: { start: ctx.draft?.date ?? null, end: null, time: ctx.draft?.time ?? null },
    booking_conditions: [],
    trip_id: ctx.trip?.id ?? null,
    verification_status: venue ? "link_verified" : "unverified",
    price_is_estimate: false,
    recheckable: false,
    details: { booking_method: venue?.booking_method ?? null, prive_experience_id: venue?.prive_experience_id ?? null, lang },
  }, input, rejected);
}

/** Restaurante del viaje (trips.restaurantes_json). */
export function offerFromTripRestaurant(r: any, ctx: OfferContext & { city?: string | null; index?: number }): BookingOffer {
  const city = ctx.city ?? ctx.trip?.destino ?? null;
  const name = String(r?.nombre ?? "").replace(` · ${city}`, "").trim() || "Restaurante";
  // Sin ai_url: el cta_action de un viaje lo escribió la IA (o es el sitio/ficha de Google, que ya llega
  // por ctx.venue). Auditoría de lugares reales: 33 % de esos enlaces estaban rotos o eran de otro lugar.
  return offerFromVenue(ctx.venue ?? { name, city, country: ctx.country ?? null }, "restaurant",
    { ...ctx, price_label: str(r?.rango_precio), id_extra: [ctx.trip?.id, ctx.index ?? ""] });
}

/** Experiencia del viaje (trips.tours_json). */
export function offerFromTripTour(t: any, ctx: OfferContext & { city?: string | null; index?: number }): BookingOffer {
  const city = ctx.city ?? ctx.trip?.destino ?? null;
  const o = offerFromVenue(ctx.venue ?? { name: String(t?.nombre ?? "Experiencia"), city, country: ctx.country ?? null }, "tour",
    { ...ctx, id_extra: [ctx.trip?.id, ctx.index ?? ""], allow_assisted: ctx.allow_assisted ?? false });
  const pp = num(t?.precio_por_persona);
  const est = ESTIMATED.has(String(t?.fuente ?? "").toLowerCase()) || String(t?.estado_dato ?? "").toUpperCase() === "ESTIMADO";
  return { ...o, price: pp, currency: pp ? "MXN" : null, price_is_estimate: est, verification_status: est ? "estimated" : o.verification_status,
    price_checked_at: str(t?.consultado_at) ?? o.price_checked_at };
}

/**
 * Restaurante del viaje que vino de Google Places (grupo googlemax: restaurantFromPlace guarda
 * place_id, maps_url, website y telefono). Como trips.*_json lo puede editar su dueño, el servidor
 * no firma salidas a dominios fuera de la lista blanca con estos datos (ver booking-bridge).
 */
export function venueFromTripPlace(r: any, city?: string | null, countryName?: string | null): VenueInfo | null {
  if (!r || r.fuente !== "google_places" || typeof r.place_id !== "string") return null;
  const country = /^[A-Z]{2}$/.test(String(countryName ?? "")) ? String(countryName) : countryIsoName(countryName);
  return {
    name: String(r.nombre ?? "").replace(` · ${city}`, ""), city: city ?? r.ciudad ?? null, country,
    place_id: r.place_id, website: typeof r.website === "string" ? r.website : null,
    phone: typeof r.telefono === "string" ? r.telefono : null, source: "google_places", verified_at: r.consultado_at ?? null,
  };
}

/** Fila del catálogo Privé → datos del lugar (la usan el servidor y el planeador Privé). */
export function venueFromPriveRow(row: any, cityName?: string | null, iso?: string | null): VenueInfo {
  // Enlace de reservas roto o que redirige a otro dominio (última revisión de booking-links-cron): no se ofrece.
  const brokenBooking = ["broken", "redirected_offsite"].includes(String(row?.booking_url_status ?? ""));
  const f = row?.site_scan?.findings ?? {};
  const scanWa = Array.isArray(f.whatsapp) && f.whatsapp[0] ? `https://wa.me/${String(f.whatsapp[0]).replace(/\D/g, "")}` : null;
  const scanEmail = Array.isArray(f.emails) && f.emails[0] ? String(f.emails[0]) : null;
  const scanPhone = Array.isArray(f.phones) && f.phones[0] ? String(f.phones[0]) : null;
  const scanBooking = !row?.booking_url && Array.isArray(f.booking) && f.booking[0]?.url ? String(f.booking[0].url) : null;
  return {
    name: String(row?.name ?? ""), city: cityName ?? null, country: iso ?? null, place_id: row?.google_place_id ?? null,
    website: row?.website ?? null, booking_url: brokenBooking ? null : (row?.booking_url ?? scanBooking), booking_method: row?.booking_method ?? null,
    whatsapp_url: scanWa, email: scanEmail, phone: scanPhone, channel_source: scanWa || scanEmail || scanPhone ? "official_site_scan" : null,
    source: "prive_catalog", verified_at: row?.verified_at ?? null, prive_experience_id: row?.id ?? null, prive_slug: row?.slug ?? null,
  };
}

export type { ChannelCandidate, ExactCandidate };
