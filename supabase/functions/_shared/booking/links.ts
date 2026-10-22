// Constructores de enlaces del Booking Bridge. Sin Deno.
//
// Regla del dueño: "No inventar parámetros de URL". Cada constructor usa SOLO un formato documentado
// por el proveedor u observado en su sitio público, y lleva el id de su evidencia (EVIDENCE) que se
// documenta en docs/iatos/IATOS_BOOKING_BRIDGE.md §Evidencia y se prueba abriendo el enlace con
// scripts/booking/verify_links.mjs (capturas en docs/iatos/evidencia/bridge/).
//
// Monetización: Aviasales conserva su marker como antes. El redirect tp.media/click que la app usaba
// para Booking/GetYourGuide/Viator responde HTTP 400 ("source_type is empty", verificado el
// 2026-10-22, docs/iatos/evidencia/bridge/H1.jpg): mandaba al usuario a una página de error. El bridge
// abre el destino directo (la atribución queda como esté configurada en Travelpayouts Drive); cómo
// recuperar la atribución por enlace es decisión del dueño (IATOS_BOOKING_BRIDGE_GO_NO_GO.md). A los
// proveedores nuevos (OpenTable, Tock, Maps…) no se les agrega ningún identificador de afiliado.
import { TP_PUBLIC_MARKER } from "../tp-params.ts";

export const EVIDENCE = {
  AVIASALES_SEARCH: "EV-AVIASALES-SEARCH", // Travelpayouts Data API, campo "link" (/search/MAD2807BCN26081)
  AVIASALES_TP_LINK: "EV-AVIASALES-TP-LINK", // mismo artículo: "Add the code to https://www.aviasales.com/"
  GOOGLE_FLIGHTS_SERP_URL: "EV-GFLIGHTS-SERP-URL", // search_metadata.google_flights_url de SerpApi
  // google.com/travel/flights?tfs=<búsqueda codificada>: ruta, fechas, adultos/niños y filtro de aerolínea
  // (capturas docs/iatos/evidencia/enlaces/D-GF-*.jpg, 2026-10-22).
  GOOGLE_FLIGHTS_TFS: "EV-GFLIGHTS-TFS",
  // kayak.com/flights/MEX-FCO/2026-10-23/VCE-MEX/2026-10-30/2adults: tramos, fechas y adultos en la ruta.
  KAYAK_FLIGHTS: "EV-KAYAK-FLIGHTS",
  RESY_VENUE_DATE: "EV-RESY-DATE", // resy.com/cities/<c>/venues/<v>?date=YYYY-MM-DD&seats=N (Resy la usa al abrir; D-RESY)
  // Descartado: google.com/travel/flights?q=… abre el formulario VACÍO (captura F6, 2026-10-22).
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

export type FlightSearchQuery = {
  origin: string; destination: string; depart: string; ret?: string | null; adults: number; children?: number;
  /** Código IATA de la aerolínea (2 caracteres) para filtrar Google Flights. */
  airline?: string | null;
  /**
   * Viaje multi-destino (open-jaw): el regreso sale de esta ciudad y no del destino de ida
   * (MEX→FCO a la salida, VCE→MEX al regreso). Sin él, o igual al destino, es ida y vuelta normal.
   */
  returnFrom?: string | null;
};

const clampPax = (n: unknown, min: number) => Math.min(9, Math.max(min, Math.round(Number(n) || 0)));

/**
 * Búsqueda de Aviasales: /search/{ORIGEN}{DDMM}{DESTINO}{DDMM regreso}{adultos}{niños}. El formato sale
 * del ejemplo documentado por Travelpayouts ("link": "/search/MAD2807BCN26081?..."). El dígito de niños
 * (2–11 años) se comprobó abriendo /search/MEX1212MAD191221: Aviasales muestra "Adults 2 · Children 1"
 * (docs/iatos/evidencia/enlaces/D-AVIA-NINOS.jpg). Adultos + niños ≤ 9.
 */
export function aviasalesSearchUrl(q: FlightSearchQuery, marker = TP_PUBLIC_MARKER): string | null {
  const o = String(q.origin ?? "").toUpperCase();
  const d = String(q.destination ?? "").toUpperCase();
  if (!IATA.test(o) || !IATA.test(d) || o === d || !isIsoDate(q.depart)) return null;
  if (q.ret && (!isIsoDate(q.ret) || q.ret < q.depart)) return null;
  const adults = clampPax(q.adults, 1);
  const children = Math.min(9 - adults, clampPax(q.children, 0));
  return `https://www.aviasales.com/search/${o}${ddmm(q.depart)}${d}${q.ret ? ddmm(q.ret) : ""}${adults}${children > 0 ? children : ""}?marker=${marker}`;
}

/** Lee origen, destino, DDMM y pasajeros de un enlace /search/ de Aviasales. */
export function parseAviasalesSearch(url: string): { origin: string; destination: string; depart: string; ret: string | null; adults: number; children: number } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)aviasales\.com$/i.test(u.hostname)) return null;
    const m = /^\/search\/([A-Z]{3})(\d{4})([A-Z]{3})(\d+)$/.exec(u.pathname);
    if (!m) return null;
    // Cola: [DDMM regreso] + adultos + [niños] (+ [infantes]). Con 5 o más dígitos hay regreso.
    const tail = m[4];
    if (tail.length > 7 || (tail.length === 4)) return null;
    const ret = tail.length >= 5 ? tail.slice(0, 4) : null;
    const pax = ret ? tail.slice(4) : tail;
    return { origin: m[1], depart: m[2], destination: m[3], ret, adults: Number(pax[0]), children: Number(pax[1] ?? 0) };
  } catch {
    return null;
  }
}

// ── Google Flights: búsqueda codificada (tfs) ──
// google.com/travel/flights?tfs=<protobuf en base64>. Es el formato que usa el propio Google Flights en
// sus URLs de resultados (no está documentado como API). Se comprobó abriéndolo el 2026-10-22: muestra
// ruta, fechas, "Ida y vuelta"/"Solo ida", número de pasajeros (adultos y niños) y el filtro de aerolínea
// (capturas D-GF-*.jpg). La forma de texto (?q=…) se descartó: con pasajeros + aerolínea Google la
// interpreta mal y abre otra página (captura A-GF-Q.jpg).
const pbVarint = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; while (v > 127) { o.push((v & 127) | 128); v >>>= 7; } o.push(v); return o; };
const pbKey = (field: number, wire: number) => pbVarint((field << 3) | wire);
const pbBytes = (field: number, bytes: number[]) => [...pbKey(field, 2), ...pbVarint(bytes.length), ...bytes];
const pbStr = (field: number, s: string) => pbBytes(field, Array.from(new TextEncoder().encode(s)));
const pbInt = (field: number, n: number) => [...pbKey(field, 0), ...pbVarint(n)];
const b64 = (bytes: number[]) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

export function googleFlightsSearchUrl(q: FlightSearchQuery, lang = "es-419"): string | null {
  const o = String(q.origin ?? "").toUpperCase();
  const d = String(q.destination ?? "").toUpperCase();
  if (!IATA.test(o) || !IATA.test(d) || o === d || !isIsoDate(q.depart)) return null;
  if (q.ret && (!isIsoDate(q.ret) || q.ret < q.depart)) return null;
  const rf = q.returnFrom ? String(q.returnFrom).toUpperCase() : d;
  if (!IATA.test(rf) || rf === o) return null;
  // Open-jaw (regreso desde otra ciudad): Google Flights lo abre como "Varios destinos" (tipo 3).
  const openJaw = !!q.ret && rf !== d;
  const adults = clampPax(q.adults, 1);
  const children = Math.min(9 - adults, clampPax(q.children, 0));
  const airline = q.airline && /^[A-Z0-9]{2}$/.test(q.airline.toUpperCase()) ? q.airline.toUpperCase() : null;
  // FlightData: 2 fecha · 6 aerolíneas · 13 aeropuerto de salida {2 código} · 14 de llegada {2 código}.
  const leg = (date: string, from: string, to: string) =>
    pbBytes(3, [...pbStr(2, date), ...(airline ? pbStr(6, airline) : []), ...pbBytes(13, pbStr(2, from)), ...pbBytes(14, pbStr(2, to))]);
  const bytes = [
    ...leg(q.depart, o, d),
    ...(q.ret ? leg(q.ret, rf, o) : []),
    // 8 pasajeros (1 adulto, 2 niño) · 9 clase (1 turista) · 19 viaje (1 ida y vuelta, 2 solo ida, 3 varios destinos).
    ...Array.from({ length: adults }, () => pbInt(8, 1)).flat(),
    ...Array.from({ length: children }, () => pbInt(8, 2)).flat(),
    ...pbInt(9, 1),
    ...pbInt(19, openJaw ? 3 : q.ret ? 1 : 2),
  ];
  const p = new URLSearchParams({ tfs: b64(bytes), hl: lang });
  return `https://www.google.com/travel/flights?${p.toString()}`;
}

/**
 * Kayak vuelos: /flights/MEX-MAD/2026-12-12/2026-12-19/2adults (ida y vuelta) y, para multi-destino
 * (open-jaw), /flights/MEX-FCO/2026-10-23/VCE-MEX/2026-10-30/2adults: cada tramo con su fecha, que es
 * como Kayak escribe sus búsquedas de "Varios destinos". Los pasajeros van en la ruta (D-KAYAK.jpg).
 */
export function kayakFlightsSearchUrl(q: FlightSearchQuery & { childAges?: number[] }): string | null {
  const o = String(q.origin ?? "").toUpperCase();
  const d = String(q.destination ?? "").toUpperCase();
  if (!IATA.test(o) || !IATA.test(d) || o === d || !isIsoDate(q.depart)) return null;
  if (q.ret && (!isIsoDate(q.ret) || q.ret < q.depart)) return null;
  const rf = q.returnFrom ? String(q.returnFrom).toUpperCase() : d;
  if (!IATA.test(rf) || rf === o) return null;
  const a = clampPax(q.adults, 1);
  const kids = (q.childAges ?? []).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 17).slice(0, 8);
  const path = !q.ret ? `${o}-${d}/${q.depart}` : rf !== d ? `${o}-${d}/${q.depart}/${rf}-${o}/${q.ret}` : `${o}-${d}/${q.depart}/${q.ret}`;
  return `https://www.kayak.com/flights/${path}/${a}adults${kids.length ? `/children-${kids.join("-")}` : ""}`;
}

/** "link" que devuelve la API de Travelpayouts ("/search/…?t=…"): abre resultados de búsqueda. */
export function aviasalesFromTpLink(link: string, marker = TP_PUBLIC_MARKER): string | null {
  if (typeof link !== "string" || !/^\/search\/[A-Z]{3}\d{4}[A-Z]{3}(\d{4})?\d(\?|$)/.test(link)) return null;
  const base = `https://www.aviasales.com${link}`;
  return /[?&]marker=/.test(base) ? base : `${base}${base.includes("?") ? "&" : "?"}marker=${marker}`;
}

/**
 * Lee una búsqueda tfs de Google Flights (la inversa de googleFlightsSearchUrl): ruta, fechas, adultos,
 * niños y aerolíneas. Sirve para comprobar que la salida lleva los datos de la cotización.
 */
export function parseGoogleFlightsSearch(url: string): { origin: string; destination: string; depart: string; ret: string | null; adults: number; children: number; airlines: string[]; one_way: boolean; return_from?: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== "www.google.com" || !u.pathname.startsWith("/travel/flights")) return null;
  const t = u.searchParams.get("tfs");
  if (!t) return null;
  let bytes: number[];
  try { bytes = Array.from(atob(t), (c) => c.charCodeAt(0)); } catch { return null; }
  type F = { f: number; v: number | number[] };
  const read = (buf: number[]): F[] | null => {
    const out: F[] = [];
    let i = 0;
    const vint = () => { let r = 0, sh = 0, b: number; do { if (i >= buf.length) throw 0; b = buf[i++]; r |= (b & 127) << sh; sh += 7; } while (b & 128); return r >>> 0; };
    try {
      while (i < buf.length) {
        const k = vint(); const f = k >>> 3; const w = k & 7;
        if (w === 0) out.push({ f, v: vint() });
        else if (w === 2) { const n = vint(); if (i + n > buf.length) return null; out.push({ f, v: buf.slice(i, i + n) }); i += n; }
        else return null;
      }
    } catch { return null; }
    return out;
  };
  const txt = (b: number | number[]) => (Array.isArray(b) ? new TextDecoder().decode(new Uint8Array(b)) : "");
  const top = read(bytes);
  if (!top) return null;
  const legs = top.filter((x) => x.f === 3 && Array.isArray(x.v)).map((x) => read(x.v as number[]) ?? []);
  if (!legs.length) return null;
  const leg = (l: F[]) => {
    const ap = (f: number) => { const a = l.find((x) => x.f === f); const inner = a && Array.isArray(a.v) ? read(a.v) : null; return inner ? txt(inner.find((x) => x.f === 2)?.v ?? []) : ""; };
    return { date: txt(l.find((x) => x.f === 2)?.v ?? []), from: ap(13), to: ap(14), airlines: l.filter((x) => x.f === 6).map((x) => txt(x.v)) };
  };
  const a = leg(legs[0]);
  const b = legs[1] ? leg(legs[1]) : null;
  const pax = top.filter((x) => x.f === 8).map((x) => x.v);
  return { origin: a.from, destination: a.to, depart: a.date, ret: b?.date ?? null, adults: pax.filter((v) => v === 1).length,
    children: pax.filter((v) => v === 2).length, airlines: a.airlines, one_way: top.find((x) => x.f === 19)?.v === 2,
    // Open-jaw: el regreso sale de otra ciudad (solo se agrega cuando es así).
    ...(b && b.from && b.from !== a.to ? { return_from: b.from } : {}) };
}

export type HotelSearchQuery = { query: string; checkin: string; checkout: string; adults: number; rooms?: number;
  /** Edad de cada niño (0–17). Booking.com la pide para mostrar la ocupación correcta. */
  childAges?: number[] };

/** Habitaciones por defecto: misma regla que hotels-search (2 adultos por habitación). */
export const roomsForAdults = (adults: number) => Math.max(1, Math.ceil((Math.max(1, adults) || 1) / 2));

/**
 * Búsqueda de Booking.com (searchresults.html con ss, checkin, checkout, group_adults, no_rooms).
 * Formato observado: la página aplica destino, fechas y ocupación (capturas H2–H10, 2026-10-22).
 */
export function bookingSearchUrl(q: HotelSearchQuery): string | null {
  if (!q.query || !isIsoDate(q.checkin) || !isIsoDate(q.checkout) || q.checkout <= q.checkin) return null;
  const adults = Math.max(1, Math.round(Number(q.adults) || 1));
  const p = new URLSearchParams({
    ss: q.query,
    checkin: q.checkin,
    checkout: q.checkout,
    group_adults: String(adults),
    no_rooms: String(q.rooms ?? roomsForAdults(adults)),
  });
  // group_children + un age=<edad> por niño: Booking muestra "2 adultos · 1 niño · 1 habitación"
  // (captura D-BK-NINOS.jpg, 2026-10-22).
  const ages = (q.childAges ?? []).map((a) => Math.round(Number(a))).filter((a) => Number.isFinite(a) && a >= 0 && a <= 17).slice(0, 10);
  if (ages.length) {
    p.set("group_children", String(ages.length));
    for (const a of ages) p.append("age", String(a));
  }
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
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
export function getYourGuideSearchUrl(city: string, query?: string, marker = TP_PUBLIC_MARKER, dates?: { from?: string | null; to?: string | null }): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  if (!q) return null;
  // date_from/date_to: GetYourGuide los aplica como filtro de fechas ("12–19 Dic", captura D-GYG.jpg).
  const range = dates && isIsoDate(dates.from) && isIsoDate(dates.to) && dates.to! >= dates.from! ? `&date_from=${dates.from}&date_to=${dates.to}` : "";
  return `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}${range}&marker=${marker}`;
}

export function viatorSearchUrl(city: string, query?: string, marker = TP_PUBLIC_MARKER): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  if (!q) return null;
  return `https://www.viator.com/searchResults/all?text=${encodeURIComponent(q)}&marker=${marker}`;
}

/**
 * Página pública de un restaurante en Resy con fecha y personas: resy.com/cities/<ciudad>/venues/<lugar>
 * ?date=YYYY-MM-DD&seats=N. Son los mismos parámetros que Resy pone en su URL al abrir la página
 * (verify_links R7) y al abrirla con ellos muestra "2 Clientes · dom., 13 dic." (captura D-RESY.jpg).
 * La hora NO se puede fijar por enlace. Cualquier otra URL se devuelve igual.
 */
export function resyWithDate(url: string, date?: string | null, seats?: number | null): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!/(^|\.)resy\.com$/i.test(u.hostname) || !/^\/cities\/[^/]+\/venues\/[^/]+\/?$/.test(u.pathname)) return url;
  if (isIsoDate(date)) u.searchParams.set("date", date);
  const n = Math.round(Number(seats));
  if (Number.isFinite(n) && n >= 1 && n <= 20) u.searchParams.set("seats", String(n));
  return u.toString();
}

/** Búsqueda pública de OpenTable (affiliateLinks.ts openTableLink), sin afiliado. */
export function openTableSearchUrl(city: string, query?: string): string | null {
  const q = [query, city].filter(Boolean).join(" ").trim();
  return q ? `https://www.opentable.com/s?term=${encodeURIComponent(q)}` : null;
}
