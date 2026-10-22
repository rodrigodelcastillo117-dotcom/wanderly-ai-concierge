// Adaptadores: convierten lo que IATOS YA tiene (resultados de flights-search/hotels-search, opciones
// del viaje en trips.*_json, catálogo Privé, fichas de Google Places) en ofertas del Booking Bridge
// con sus acciones. Sin Deno. Cada oferta conserva su procedencia real (provider, source_url,
// price_checked_at) y nunca promete más de lo que la fuente dio.
import { checkAllowlisted, unwrapAffiliate } from "./allowlist.ts";
import { whatsappNumberFromUrl } from "./channels.ts";
import {
  aviasalesFromTpLink, aviasalesSearchUrl, bookingSearchUrl, EVIDENCE, getYourGuideSearchUrl, googleFlightsQueryUrl, isIsoDate,
  openTableSearchUrl, parseAviasalesSearch, parseBookingSearch, roomsForAdults, viatorSearchUrl,
} from "./links.ts";
import type { RequestLang } from "./messages.ts";
import { hotelPriceRooms } from "../rooms.ts";
import { langForCountry } from "./messages.ts";
import { type ChannelCandidate, type ExactCandidate, type LinkCandidate, resolveBookingActions, type ResolverInput } from "./resolver.ts";
import type { BookingOffer, ProductType, SourceTrust } from "./types.ts";

/** FNV-1a de 64 bits en hex: id estable de la oferta (mismo en el cliente y en el servidor). */
export function stableId(parts: unknown[]): string {
  let h = 0xcbf29ce484222325n;
  const s = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
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

/** Opción de vuelo guardada en el viaje (trips.vuelos_json, escrita por analizar-viaje). */
export function offerFromTripFlight(v: any, ctx: OfferContext & { city?: string | null; index?: number }): BookingOffer {
  const trip = ctx.trip ?? {};
  const travelers = Math.max(1, Math.round(Number(trip.num_viajeros) || 1));
  const depart = isIsoDate(trip.fecha_salida) ? trip.fecha_salida! : null;
  const ret = isIsoDate(trip.fecha_regreso) ? trip.fecha_regreso! : null;
  const city = ctx.city ?? trip.destino ?? null;
  const ground = v?.modo === "autobus" || v?.modo === "auto";
  const product: ProductType = ground ? "transport" : "flight";
  const raw = str(v?.booking_link, 2000) ?? str(v?.cta_action, 2000);
  const rejected: Array<{ url: string; reason: string }> = [];
  const searches: LinkCandidate[] = [];
  let website: LinkCandidate | null = null;

  if (raw) {
    const ok = checkAllowlisted(raw);
    const parsed = ok.ok ? parseAviasalesSearch(unwrapAffiliate(ok.url)) : null;
    if (!ok.ok) {
      rejected.push({ url: raw, reason: ok.reason });
    } else if (parsed && depart) {
      // El enlace lo copió la IA de una búsqueda: si sus fechas o pasajeros no son los del viaje
      // (p. ej. el usuario cambió fechas), se arma la búsqueda correcta con los mismos aeropuertos.
      const want = { d: `${depart.slice(8, 10)}${depart.slice(5, 7)}`, r: ret ? `${ret.slice(8, 10)}${ret.slice(5, 7)}` : null };
      if (parsed.depart !== want.d || (parsed.ret ?? null) !== want.r || parsed.adults !== Math.min(9, travelers)) {
        rejected.push({ url: raw, reason: "fechas_o_viajeros_distintos_al_viaje" });
        const rebuilt = aviasalesSearchUrl({ origin: parsed.origin, destination: parsed.destination, depart, ret, adults: travelers });
        if (rebuilt) searches.push({ url: rebuilt, trust: "builder", evidence: EVIDENCE.AVIASALES_SEARCH, preserves: { product: false, dates: true, travelers: travelers <= 9, room_or_fare: false } });
      } else {
        searches.push({ url: ok.url, trust: "ai", evidence: EVIDENCE.AVIASALES_TP_LINK, preserves: { product: false, dates: true, travelers: true, room_or_fare: false } });
      }
    } else if (ok.provider?.kind === "airline") {
      website = { url: ok.url, trust: "ai", evidence: EVIDENCE.AIRLINE_HOME, provider_label: ok.provider.label };
    } else if (ok.provider?.kind === "bus" || ok.provider?.provider === "travelpayouts" || ok.provider?.kind === "metasearch") {
      searches.push({ url: ok.url, trust: "ai", evidence: ground ? EVIDENCE.BUS_SEARCH : EVIDENCE.AVIASALES_TP_LINK,
        preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
    } else {
      rejected.push({ url: raw, reason: "no_es_un_enlace_de_vuelo" });
    }
  }
  if (!ground && depart && trip.ciudad_origen && city) {
    const gf = googleFlightsQueryUrl({ origin: trip.ciudad_origen, destination: city, depart, ret, adults: travelers });
    if (gf) searches.push({ url: gf, trust: "builder", evidence: EVIDENCE.GOOGLE_FLIGHTS_Q, preserves: { product: false, dates: true, travelers: true, room_or_fare: false } });
  }
  const est = ESTIMATED.has(String(v?.fuente_precio ?? "").toLowerCase()) || String(v?.estado_dato ?? "").toUpperCase() === "ESTIMADO" || num(v?.precio_min) != null;
  const pp = num(v?.precio_por_persona);
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
    details: { tier: v?.tier ?? null, stale_quote: !!trip.quote_needs_update, ground },
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
  const ci = isIsoDate(trip.fecha_salida) ? trip.fecha_salida! : null;
  const co = isIsoDate(trip.fecha_regreso) ? trip.fecha_regreso! : null;
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
  const b = ci && co ? bookingSearchUrl({ query: [name, city].filter(Boolean).join(" "), checkin: ci, checkout: co, adults, rooms: roomsForAdults(adults) }) : null;
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
  google_places: "Ficha de Google Maps del lugar",
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
  out.maps = { query: [v.name, v.city].filter(Boolean).join(", "), place_id: v.place_id ?? null };
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
  const name = str(v.name, 160) ?? "Lugar";
  const city = str(v.city) ?? ctx.trip?.destino ?? null;
  const country = (v.country ?? ctx.country ?? null) || null;
  const rejected: Array<{ url: string; reason: string }> = [];
  const vin = venueInputs(venue);
  const official = [...(vin.official_booking ?? [])];
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
    const ot = openTableSearchUrl(city ?? "", name);
    if (ot) searches.push({ url: ot, trust: "builder", evidence: EVIDENCE.OPENTABLE_SEARCH, preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
  } else if (product !== "restaurant" && official.length === 0) {
    const gyg = getYourGuideSearchUrl(city ?? "", name);
    const via = viatorSearchUrl(city ?? "", name);
    if (gyg) searches.push({ url: gyg, trust: "builder", evidence: EVIDENCE.TOURS_SEARCH, provider_label: "GetYourGuide", preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
    if (via) searches.push({ url: via, trust: "builder", evidence: EVIDENCE.TOURS_SEARCH, provider_label: "Viator", preserves: { product: false, dates: false, travelers: false, room_or_fare: false } });
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
  return offerFromVenue(ctx.venue ?? { name, city, country: ctx.country ?? null }, "restaurant",
    { ...ctx, ai_url: str(r?.cta_action, 2000), price_label: str(r?.rango_precio), id_extra: [ctx.trip?.id, ctx.index ?? ""] });
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
