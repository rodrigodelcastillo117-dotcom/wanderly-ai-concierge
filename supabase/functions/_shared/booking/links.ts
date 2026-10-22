// Constructores de enlaces del Booking Bridge. Sin Deno.
//
// Regla del dueño: "No inventar parámetros de URL". Cada constructor usa SOLO un formato documentado
// por el proveedor u observado en su sitio público, y lleva el id de su evidencia (EVIDENCE) que se
// documenta en docs/iatos/IATOS_BOOKING_BRIDGE.md §Evidencia y se prueba abriendo el enlace con
// scripts/booking/verify_links.mjs (capturas en docs/iatos/evidencia/bridge/).
//
// Monetización: los enlaces que IATOS ya etiquetaba (Aviasales con marker, Booking/GetYourGuide/Viator
// vía tp.media) se arman EXACTAMENTE igual que antes; a los proveedores nuevos (Google Flights,
// OpenTable, Tock, Maps…) no se les agrega ningún identificador de afiliado.
import { TP_PUBLIC_MARKER } from "../tp-params.ts";

export const EVIDENCE = {
  AVIASALES_SEARCH: "EV-AVIASALES-SEARCH", // Travelpayouts Data API, campo "link" (/search/MAD2807BCN26081)
  AVIASALES_TP_LINK: "EV-AVIASALES-TP-LINK", // mismo artículo: "Add the code to https://www.aviasales.com/"
  GOOGLE_FLIGHTS_SERP_URL: "EV-GFLIGHTS-SERP-URL", // search_metadata.google_flights_url de SerpApi
  GOOGLE_FLIGHTS_Q: "EV-GFLIGHTS-Q", // https://www.google.com/travel/flights?q=… (observado)
  GOOGLE_FLIGHTS_BOOKING_REQUEST: "EV-GFLIGHTS-BOOKING-REQUEST", // SerpApi Booking Options: booking_request {url, post_data}
  GOOGLE_HOTELS_PRICE_LINK: "EV-GHOTELS-PRICE-LINK", // SerpApi Property Details: featured_prices[].link / rooms[].link
  BOOKING_SEARCH: "EV-BOOKING-SEARCH", // booking.com/searchresults.html?ss&checkin&checkout&group_adults&no_rooms (observado)
  MAPS_SEARCH: "EV-MAPS-URLS", // Google Maps URLs: /maps/search/?api=1&query&query_place_id
  WHATSAPP_CLICK_TO_CHAT: "EV-WA-CLICK", // faq.whatsapp.com/5913398998672934
  MAILTO: "EV-RFC6068",
  TEL: "EV-RFC3966",
  SMS: "EV-RFC5724",
  CATALOG_BOOKING_URL: "EV-PRIVE-CATALOG", // booking_url curado del catálogo Privé (fuente y fecha en la fila)
  SITE_SCAN: "EV-SITE-SCAN", // enlace público encontrado en el sitio oficial (siteScan.ts)
  GOOGLE_PLACES: "EV-PLACES", // Google Places (New): websiteUri / internationalPhoneNumber / googleMapsUri
  TOURS_SEARCH: "EV-TOURS-SEARCH", // getyourguide.com/s/?q= y viator.com/searchResults/all?text= (ya en uso)
  OPENTABLE_SEARCH: "EV-OPENTABLE-SEARCH", // opentable.com/s?term= (ya en uso)
  BUS_SEARCH: "EV-BUS-SEARCH", // ligas de groundTransport.ts (IATOS_PROVEEDORES_AUTOBUSES.md)
  AIRLINE_HOME: "EV-AIRLINE-HOME", // sitio oficial de la aerolínea (página general, sin búsqueda)
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IATA = /^[A-Z]{3}$/;

export function isIsoDate(d: unknown): d is string {
  if (typeof d !== "string" || !ISO_DATE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

const ddmm = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}`;

/** Travelpayouts envuelve con tp.media/click (igual que src/lib/affiliateLinks.ts tpDeepLink). */
export function tpWrap(targetUrl: string, subId: string, marker = TP_PUBLIC_MARKER): string {
  const p = new URLSearchParams({ marker: `${marker}.${subId}`, u: targetUrl });
  return `https://tp.media/click?${p.toString()}`;
}

export type FlightSearchQuery = { origin: string; destination: string; depart: string; ret?: string | null; adults: number; children?: number };

/**
 * Búsqueda de Aviasales: /search/{ORIGEN}{DDMM}{DESTINO}{DDMM regreso}{adultos}. El formato sale del
 * ejemplo documentado por Travelpayouts ("link": "/search/MAD2807BCN26081?..."). Solo adultos 1–9:
 * niños e infantes no tienen formato documentado (el resultado lo dice en preserves.travelers).
 */
export function aviasalesSearchUrl(q: FlightSearchQuery, marker = TP_PUBLIC_MARKER): string | null {
  const o = String(q.origin ?? "").toUpperCase();
  const d = String(q.destination ?? "").toUpperCase();
  if (!IATA.test(o) || !IATA.test(d) || o === d || !isIsoDate(q.depart)) return null;
  if (q.ret && (!isIsoDate(q.ret) || q.ret < q.depart)) return null;
  const adults = Math.min(9, Math.max(1, Math.round(Number(q.adults) || 1)));
  return `https://www.aviasales.com/search/${o}${ddmm(q.depart)}${d}${q.ret ? ddmm(q.ret) : ""}${adults}?marker=${marker}`;
}

/** Lee origen, destino, DDMM y pasajeros de un enlace /search/ de Aviasales. */
export function parseAviasalesSearch(url: string): { origin: string; destination: string; depart: string; ret: string | null; adults: number } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)aviasales\.com$/i.test(u.hostname)) return null;
    const m = /^\/search\/([A-Z]{3})(\d{4})([A-Z]{3})(\d{4})?(\d)$/.exec(u.pathname);
    if (!m) return null;
    return { origin: m[1], depart: m[2], destination: m[3], ret: m[4] ?? null, adults: Number(m[5]) };
  } catch {
    return null;
  }
}

/** "link" que devuelve la API de Travelpayouts ("/search/…?t=…"): abre resultados de búsqueda. */
export function aviasalesFromTpLink(link: string, marker = TP_PUBLIC_MARKER): string | null {
  if (typeof link !== "string" || !/^\/search\/[A-Z]{3}\d{4}[A-Z]{3}(\d{4})?\d(\?|$)/.test(link)) return null;
  const base = `https://www.aviasales.com${link}`;
  return /[?&]marker=/.test(base) ? base : `${base}${base.includes("?") ? "&" : "?"}marker=${marker}`;
}

/**
 * Búsqueda de Google Flights por texto (?q=), el formato que IATOS ya usaba (affiliateLinks.ts
 * googleFlightsLink). Observado: Google interpreta origen, destino, fechas y adultos de la frase.
 */
export function googleFlightsQueryUrl(q: FlightSearchQuery): string | null {
  if (!q.origin || !q.destination || !isIsoDate(q.depart)) return null;
  const adults = Math.max(1, Math.round(Number(q.adults) || 1));
  const text = q.ret && isIsoDate(q.ret)
    ? `flights from ${q.origin} to ${q.destination} on ${q.depart} returning ${q.ret} for ${adults} adults`
    : `flights from ${q.origin} to ${q.destination} on ${q.depart} for ${adults} adults`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}`;
}

export type HotelSearchQuery = { query: string; checkin: string; checkout: string; adults: number; rooms?: number };

/** Habitaciones por defecto: misma regla que hotels-search (2 adultos por habitación). */
export const roomsForAdults = (adults: number) => Math.max(1, Math.ceil((Math.max(1, adults) || 1) / 2));

/**
 * Búsqueda de Booking.com (searchresults.html con ss, checkin, checkout, group_adults, no_rooms),
 * envuelta con tp.media como ya lo hacía hotels-search. Formato observado en booking.com.
 */
export function bookingSearchUrl(q: HotelSearchQuery, marker = TP_PUBLIC_MARKER): string | null {
  if (!q.query || !isIsoDate(q.checkin) || !isIsoDate(q.checkout) || q.checkout <= q.checkin) return null;
  const adults = Math.max(1, Math.round(Number(q.adults) || 1));
  const p = new URLSearchParams({
    ss: q.query,
    checkin: q.checkin,
    checkout: q.checkout,
    group_adults: String(adults),
    no_rooms: String(q.rooms ?? roomsForAdults(adults)),
  });
  return tpWrap(`https://www.booking.com/searchresults.html?${p.toString()}`, "hotels", marker);
}

/** Fechas y ocupantes de un enlace de Booking.com (directo o dentro de tp.media). */
export function parseBookingSearch(url: string): { ss: string | null; checkin: string | null; checkout: string | null; adults: number | null } | null {
  try {
    let u = new URL(url);
    if (/(^|\.)tp\.media$/i.test(u.hostname)) u = new URL(u.searchParams.get("u") ?? "");
    if (!/(^|\.)booking\.com$/i.test(u.hostname)) return null;
    const a = Number(u.searchParams.get("group_adults"));
    return {
      ss: u.searchParams.get("ss"),
      checkin: u.searchParams.get("checkin"),
      checkout: u.searchParams.get("checkout"),
      adults: Number.isFinite(a) && a > 0 ? a : null,
    };
  } catch {
    return null;
  }
}

/**
 * Ficha de Google Maps (documentado: developers.google.com/maps/documentation/urls). Con place_id
 * abre el lugar exacto (evita homónimos); sin él, es una búsqueda por nombre + ciudad.
 */
export function mapsListingUrl(query: string, placeId?: string | null): string | null {
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!q) return null;
  const p = new URLSearchParams({ api: "1", query: q });
  if (placeId && /^[A-Za-z0-9_-]{10,300}$/.test(placeId)) p.set("query_place_id", placeId);
  return `https://www.google.com/maps/search/?${p.toString()}`;
}

/** Búsquedas de tours que IATOS ya usaba (affiliateLinks.ts getYourGuideLink / viatorLink). */
export function getYourGuideSearchUrl(city: string, query?: string, marker = TP_PUBLIC_MARKER): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  if (!q) return null;
  const url = `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}&marker=${marker}`;
  return tpWrap(url, "tours", marker);
}

export function viatorSearchUrl(city: string, query?: string, marker = TP_PUBLIC_MARKER): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  if (!q) return null;
  const url = `https://www.viator.com/searchResults/all?text=${encodeURIComponent(q)}&marker=${marker}`;
  return tpWrap(url, "tours", marker);
}

/** Búsqueda pública de OpenTable (affiliateLinks.ts openTableLink), sin afiliado. */
export function openTableSearchUrl(city: string, query?: string): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  return q ? `https://www.opentable.com/s?term=${encodeURIComponent(q)}` : null;
}
