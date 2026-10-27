// "Comprar mi viaje" (cierre 2, grupo enlaces): la lista de lo cotizado con, para cada cosa, a qué sitio
// lleva el botón, qué datos van precargados EN ESA URL (se leen de la propia URL, no se suponen), qué
// falta completar ahí y su estado ("Ya lo reservé", marcado a mano por el usuario).
//
// Los enlaces salen del Booking Bridge (offers.ts + resolver): son los mismos que ya validan la lista
// blanca y booking-go; aquí no se arma ninguna URL nueva salvo la renta de auto opcional (Kayak), que
// también pasa por checkAllowlisted.
import { restaurantPriceLabel, tripUsdMxnRate } from "@/lib/tripPicks";
import { kayakCarsLink, PREFILL } from "@/lib/affiliateLinks";
import {
  checkAllowlisted, isEstimatedTripFlight, isGroundTripOption, isTripInternationalRow, tripFlightProblems, tripFlightRoute, tripFlightSearches,
  unresolvedCityLabel, type TripFlightRoute, offerFromTripFlight, offerFromTripHotel, offerFromTripRestaurant, offerFromTripTour, venueFromTripPlace,
  type BookingAction, type BookingOffer,
} from "@/lib/booking";
import { isConfirmedBooking, type BookingLike } from "@/lib/bookingState";
import { parseAviasalesSearch, parseBookingSearch, parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links.ts";
import { airlineName } from "@/lib/airlines";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { codeServesCity } from "../../supabase/functions/_shared/airports.ts";

export type PurchaseKind = "vuelo" | "hospedaje" | "auto" | "actividad" | "restaurante";
export type PurchaseCategory = "flight" | "hotel" | "car" | "activity" | "restaurant" | "train";

export type PurchaseItem = {
  /** Estable entre recargas mientras la cotización no cambie: tipo, índice y nombre. */
  key: string;
  kind: PurchaseKind;
  category: PurchaseCategory;
  title: string;
  subtitle: string | null;
  /** Precio total del elemento para el grupo (o por persona en actividades, dicho en priceNote). */
  price: number | null;
  currency: string | null;
  priceNote: string | null;
  /** Para PriceSourceBadge: fuente, estado y fecha de consulta. */
  source: { fuente: string | null; estado: string | null; consultadoAt: string | null; approximateDates?: boolean };
  estimate: boolean;
  /** Botón principal: sitio, URL y lo que lleva. null si no hay una forma fiable de abrirlo. */
  site: string | null;
  url: string | null;
  action: BookingAction | null;
  lleva: string[];
  completa: string | null;
  optional: boolean;
  /** Texto del botón cuando no es "Abrir en <sitio>" (p. ej. "Abre Google Flights y escribe el destino"). */
  buttonLabel?: string | null;
  /** Ruta interna cuando no hay enlace externo fiable (p. ej. buscar vuelos reales). */
  fallbackHref: string | null;
  /** Ciudad del elemento (hoteles de un viaje multi-destino). */
  city?: string | null;
  /** Índice en trips.*_json (para el Booking Bridge). */
  col: "vuelos_json" | "hospedaje_json" | "tours_json" | "restaurantes_json" | null;
  index: number;
  offer: BookingOffer | null;
};

export type TripOfferActionsLike = Partial<Record<"vuelos_json" | "hospedaje_json" | "tours_json" | "restaurantes_json", Record<number, BookingAction[]>>>;

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const isIso = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
/** "12 dic 2026" sin depender de la zona horaria. */
export function fmtDay(iso: string, withYear = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MES[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function fmtRange(a: string | null, b: string | null): string | null {
  if (!isIso(a)) return null;
  if (!isIso(b)) return `${fmtDay(a)} (solo ida)`;
  return a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))}–${fmtDay(b)}` : `${fmtDay(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmtDay(b)}`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Qué datos lleva DE VERDAD una URL de salida (se leen de la URL) y qué hay que completar en el sitio.
 * `trip` da el año de las fechas DDMM de Aviasales.
 */
export function describePrefill(url: string | null, processor: string | null, trip?: { fecha_salida?: string | null } | null): { lleva: string[]; completa: string | null } {
  if (!url) return { lleva: [], completa: null };
  let u: URL;
  try { u = new URL(url); } catch { return { lleva: [], completa: null }; }
  const host = u.hostname.replace(/^www\./, "");
  const gf = parseGoogleFlightsSearch(url);
  if (gf) {
    const air = gf.airlines.map((c) => airlineName(c) ?? c);
    // Multi-destino (open-jaw): "MEX → FCO · regreso VCE → MEX".
    const ruta = gf.return_from ? [`${gf.origin} → ${gf.destination}`, `regreso ${gf.return_from} → ${gf.origin}`] : [`${gf.origin} → ${gf.destination}`];
    return {
      lleva: [...ruta, fmtRange(gf.depart, gf.ret) ?? "", pax(gf.adults, gf.children), ...(air.length ? [`solo ${air.join(", ")}`] : [])].filter(Boolean),
      completa: PREFILL.google_flights.completa,
    };
  }
  const av = parseAviasalesSearch(url);
  if (av) {
    const y = isIso(trip?.fecha_salida) ? trip!.fecha_salida!.slice(0, 4) : null;
    const d = (ddmm: string) => (y ? fmtDay(`${y}-${ddmm.slice(2, 4)}-${ddmm.slice(0, 2)}`, false) : `${ddmm.slice(0, 2)}/${ddmm.slice(2, 4)}`);
    return { lleva: [`${av.origin} → ${av.destination}`, av.ret ? `${d(av.depart)} – ${d(av.ret)}` : `${d(av.depart)} (solo ida)`, pax(av.adults, av.children)], completa: PREFILL.aviasales.completa };
  }
  const bk = parseBookingSearch(url);
  if (bk && host.endsWith("booking.com")) {
    const rooms = Number(u.searchParams.get("no_rooms")) || null;
    const kids = Number(u.searchParams.get("group_children")) || 0;
    return {
      lleva: [bk.ss ? `“${bk.ss}”` : "", fmtRange(bk.checkin, bk.checkout) ?? "", bk.adults ? plural(bk.adults, "adulto", "adultos") : "",
        kids ? plural(kids, "niño", "niños") : "", rooms ? plural(rooms, "habitación", "habitaciones") : ""].filter(Boolean),
      completa: PREFILL.booking.completa,
    };
  }
  if (host.endsWith("getyourguide.com")) {
    const qq = u.searchParams.get("q");
    return { lleva: [qq ? `“${qq}”` : "", fmtRange(u.searchParams.get("date_from"), u.searchParams.get("date_to")) ?? ""].filter(Boolean), completa: PREFILL.getyourguide.completa };
  }
  if (host.endsWith("kayak.com") && u.pathname.startsWith("/flights/")) {
    // /flights/MEX-FCO/2026-10-23[/VCE-MEX]/2026-10-30/2adults
    const parts = u.pathname.split("/").filter(Boolean).slice(1);
    const legs = parts.filter((x) => /^[A-Z]{3}-[A-Z]{3}$/.test(x)).map((x) => x.replace("-", " → "));
    const dates = parts.filter((x) => isIso(x));
    const ad = Number(/^(\d)adults$/.exec(parts.find((x) => /adults$/.test(x)) ?? "")?.[1]) || 0;
    return { lleva: [...legs.map((l, i) => (i ? `regreso ${l}` : l)), fmtRange(dates[0] ?? null, dates[1] ?? null) ?? "", ad ? plural(ad, "adulto", "adultos") : ""].filter(Boolean),
      completa: "Elige el horario y compra con la aerolínea o agencia que muestre Kayak." };
  }
  if (host.endsWith("kayak.com") && u.pathname.startsWith("/cars/")) {
    // /cars/Rome/2026-10-22/2026-11-01 o, si se devuelve en otra ciudad, /cars/Rome/Venice/2026-10-26/2026-10-29.
    const parts = u.pathname.split("/").filter(Boolean).slice(1).map((x) => decodeURIComponent(x));
    const dates = parts.filter((x) => isIso(x));
    const places = parts.filter((x) => !isIso(x));
    return { lleva: [places.join(" → "), fmtRange(dates[0] ?? null, dates[1] ?? null) ?? ""].filter(Boolean), completa: PREFILL.kayak_cars.completa };
  }
  if (host.endsWith("resy.com")) {
    const d = u.searchParams.get("date"); const s = Number(u.searchParams.get("seats")) || 0;
    return { lleva: ["el restaurante", isIso(d) ? fmtDay(d) : "", s ? plural(s, "persona", "personas") : ""].filter(Boolean), completa: PREFILL.resy.completa };
  }
  if (host === "google.com" && u.pathname.startsWith("/maps")) {
    return u.pathname.startsWith("/maps/dir")
      ? { lleva: ["origen y destino de la ruta"], completa: "Google Maps no recibe la fecha: revisa horarios y compra el boleto con la línea." }
      : { lleva: ["el lugar"], completa: PREFILL.google_maps.completa };
  }
  if (/(^|\.)opentable\./.test(host)) return { lleva: [u.pathname.startsWith("/r/") ? "el restaurante" : "búsqueda por nombre"], completa: PREFILL.opentable.completa };
  if (host.endsWith("aeromexico.com")) return { lleva: [], completa: PREFILL.aeromexico.completa };
  return { lleva: [], completa: `${processor ?? "El sitio"} no recibe tus fechas ni personas por enlace: confírmalas ahí.` };
}

function pax(adults: number, children: number) {
  return [plural(adults, "adulto", "adultos"), children ? plural(children, "niño", "niños") : ""].filter(Boolean).join(" y ");
}

/** Acción principal de una oferta: la primera web (oferta exacta, búsqueda, página de reservas o sitio). */
export function primaryAction(actions: BookingAction[]): BookingAction | null {
  return actions.find((a) => a.tier >= 1 && a.tier <= 4 && !!a.url && /^https:\/\//.test(a.url)) ?? null;
}

const isGround = (v: any) => v?.modo === "autobus" || v?.modo === "auto";

type Sel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null };

/**
 * Lo cotizado, en el orden en que conviene comprarlo: vuelo, hospedaje, auto (opcional), actividades
 * elegidas y restaurantes. Respeta la selección de la página ("Ya tengo vuelo" lo quita de la lista).
 */
export function buildPurchasePlan(trip: any, sel: Sel, server: TripOfferActionsLike = {}, opts: { quoteCreatedAt?: string | null; maxRestaurants?: number } = {}): PurchaseItem[] {
  if (!trip) return [];
  const items: PurchaseItem[] = [];
  const travelers = Math.max(1, Math.round(Number(trip.num_viajeros) || 1));
  const city = trip.destino ?? null;
  const checked = (v: any) => v?.consultado_at ?? opts.quoteCreatedAt ?? trip.created_at ?? null;
  const pick = (offer: BookingOffer, col: PurchaseItem["col"], i: number) => {
    const actions = (col && server[col]?.[i]?.length ? server[col]![i] : offer.actions) ?? [];
    return primaryAction(actions);
  };
  const base = (it: Omit<PurchaseItem, "site" | "url" | "lleva" | "completa">): PurchaseItem => {
    const a = it.action;
    const d = describePrefill(a?.url ?? null, a?.processor ?? null, trip);
    return { ...it, site: a?.processor ?? null, url: a?.url ?? null, lleva: d.lleva, completa: d.completa };
  };

  // 1 · Vuelo (o trayecto por carretera). Sin selección, la primera tarifa que sirve para el viaje:
  // una de otro destino, con duración absurda o con una aerolínea que no opera la ruta no se ofrece.
  const vuelos: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
  const route = tripFlightRoute(trip);
  if (sel.selVuelo !== -2 && (vuelos.length || route.multi)) {
    // Sin selección: la primera tarifa REAL (no un estimado de IA) que sirve; si no hay, "por cotizar".
    // Entre las reales, la que suma el total de la página (desglose_presupuesto.vuelos), si alguna cuadra.
    const real = realFlightOptions(trip);
    const quoted = Math.round(Number(trip.desglose_presupuesto?.vuelos) || 0);
    const i = sel.selVuelo >= 0 && vuelos[sel.selVuelo] ? sel.selVuelo
      : (real.find((k) => quoted > 0 && Math.round((Number(vuelos[k]?.precio_por_persona) || 0) * travelers) === quoted) ?? real[0] ?? -1);
    const v = i >= 0 ? vuelos[i] : null;
    const tripRange = [route.multi && route.cities.length ? `${trip.ciudad_origen?.trim() ?? ""} → ${route.cities[0]} · regreso desde ${route.cities[route.cities.length - 1]}`.trim()
      : trip.ciudad_origen && city ? `${String(trip.ciudad_origen).trim()} → ${city}` : null, fmtRange(trip.fecha_salida, trip.fecha_regreso), plural(travelers, "viajero", "viajeros")].filter(Boolean).join(" · ");
    if (v) {
      const offer = offerFromTripFlight(v, { trip, city, index: i });
      const bad = tripFlightProblems(v, trip).length > 0;
      const pp = bad ? null : num(v?.precio_por_persona);
      const range = num(v?.precio_min) && num(v?.precio_max);
      const est = isEstimatedTripFlight(v);
      // Una fila con problemas usa SOLO las acciones locales (las del servidor pueden ser de antes del arreglo).
      // Y nunca un enlace cuyo destino no sea el del viaje (p. ej. MEX→BUH guardado como Roma).
      const actions = (!bad && server.vuelos_json?.[i]?.length ? server.vuelos_json![i] : offer.actions)
        .filter((a) => isGroundTripOption(v) || prefillMatchesTrip(a.url, trip) !== false);
      items.push(base({
        key: `vuelo:${i}:${norm(v?.aerolinea)}`, kind: "vuelo", category: "flight",
        title: isGroundTripOption(v) ? `${v?.modo === "auto" || v?.mode === "coche" ? "En auto" : "Autobús"} · ${v?.aerolinea ?? ""}`.trim()
          : `Vuelo · ${est || bad ? "aerolínea por confirmar" : v?.aerolinea ?? "Aerolínea por elegir"}`,
        subtitle: tripRange,
        price: range ? null : pp ? pp * travelers : null, currency: "MXN",
        priceNote: range ? `$${Math.round(Number(v.precio_min)).toLocaleString("es-MX")}–$${Math.round(Number(v.precio_max)).toLocaleString("es-MX")} MXN por persona` : pp ? `${plural(travelers, "persona", "personas")} · $${Math.round(pp).toLocaleString("es-MX")} MXN c/u` : null,
        source: { fuente: v?.fuente_precio ?? null, estado: v?.estado_dato ?? null, consultadoAt: checked(v), approximateDates: !!v?.approximate_dates },
        estimate: offer.price_is_estimate || !!range, action: primaryAction(actions), optional: false,
        fallbackHref: isGroundTripOption(v) ? null : `/dashboard/vuelos?origin=${encodeURIComponent(String(trip.ciudad_origen ?? "").trim())}&destination=${encodeURIComponent(route.cities[0] ?? city ?? "")}&depart=${trip.fecha_salida ?? ""}&return=${trip.fecha_regreso ?? ""}&travelers=${travelers}&auto=1&trip=${trip.id}`,
        col: "vuelos_json", index: i, offer,
      }));
    } else {
      // Ninguna tarifa sirve: el vuelo queda por cotizar, con la búsqueda del viaje precargada.
      items.push(flightToQuote(trip, route, tripRange));
    }
  }

  // 2 · Hospedaje. Multi-destino: un hotel por ciudad con las noches y fechas de esa ciudad (Roma
  // 22–26 oct · 4 noches), no todas las noches en la primera ciudad.
  const hoteles: any[] = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
  // La misma ciudad dos veces (Delhi al llegar y al final, caso India): el mismo hotel son dos estancias.
  const hotelSeen = new Set<number>();
  const pushHotel = (i: number, h: any, hCity: string | null, stay: { checkin: string; checkout: string; nights: number } | null) => {
    const repeat = hotelSeen.has(i);
    hotelSeen.add(i);
    const offer = offerFromTripHotel(h, { trip, city: hCity, index: i });
    const nights = stay?.nights ?? (Number((offer.details as any)?.nights) || null);
    items.push(base({
      key: `hospedaje:${i}:${norm(h?.nombre)}${repeat && stay ? `:${stay.checkin}` : ""}`, kind: "hospedaje", category: "hotel",
      title: `Hospedaje · ${h?.nombre ?? "Hotel"}`,
      subtitle: [hCity, fmtRange(stay?.checkin ?? trip.fecha_salida, stay?.checkout ?? trip.fecha_regreso), nights ? plural(nights, "noche", "noches") : null].filter(Boolean).join(" · "),
      price: offer.price, currency: offer.currency ?? "MXN",
      priceNote: nights && num(h?.precio_por_noche) ? `${plural(nights, "noche", "noches")} · $${Math.round(Number(h.precio_por_noche)).toLocaleString("es-MX")} MXN por noche` : null,
      source: { fuente: h?.fuente_precio ?? null, estado: h?.estado_dato ?? null, consultadoAt: checked(h) },
      estimate: offer.price_is_estimate, action: pick(offer, "hospedaje_json", i), optional: false, fallbackHref: null,
      col: "hospedaje_json", index: i, offer, city: hCity,
    }));
  };
  if (hasCityHotels(trip)) {
    for (const c of cityHotelChoices(trip, sel)) {
      if (c.index === -2 || !c.hotel) continue;
      pushHotel(c.index, c.hotel, c.stay.city, c.stay);
    }
  } else if (sel.selHospedaje !== -2 && hoteles.length) {
    const i = sel.selHospedaje >= 0 && hoteles[sel.selHospedaje] ? sel.selHospedaje : quotedHotelIndex(trip);
    const h = hoteles[i];
    pushHotel(i, h, h?.ciudad ?? city, null);
  }

  // 3 · Renta de auto (opcional, no cotizada): Kayak con ciudad y fechas del viaje.
  // Multi-destino: se recoge en la primera ciudad ("Roma → Florencia → Venecia" no es una ciudad).
  const carCity = route.multi ? route.cities[0] ?? null : city;
  if (carCity && isIso(trip.fecha_salida) && isIso(trip.fecha_regreso)) {
    const city = carCity;
    const url = kayakCarsLink(city, trip.fecha_salida, trip.fecha_regreso);
    const ok = checkAllowlisted(url);
    const d = describePrefill(ok.ok ? ok.url : null, "Kayak", trip);
    items.push({
      key: `auto:${norm(city)}`, kind: "auto", category: "car", title: `Renta de auto · ${city}`,
      subtitle: [fmtRange(trip.fecha_salida, trip.fecha_regreso), "opcional"].filter(Boolean).join(" · "),
      price: null, currency: null, priceNote: "IATOS no cotizó auto: el precio lo ves en Kayak.",
      source: { fuente: null, estado: null, consultadoAt: null }, estimate: false,
      site: ok.ok ? "Kayak" : null, url: ok.ok ? ok.url : null, action: null, lleva: d.lleva, completa: d.completa,
      optional: true, fallbackHref: `/dashboard/autos?trip=${trip.id}`, col: null, index: -1, offer: null,
    });
  }

  // 4 · Actividades elegidas
  const tours: any[] = Array.isArray(trip.tours_json) ? trip.tours_json : [];
  const chosen = Array.from(sel.selTours ?? []).filter((i) => tours[i]).sort((a, b) => a - b);
  for (const i of chosen) {
    const t = tours[i];
    const tCity = t?.ciudad ?? city;
    // Con place_id de Google: la ficha exacta en Maps (no una búsqueda por nombre).
    const offer = offerFromTripTour(t, { trip, city: tCity, index: i, venue: venueFromTripPlace(t, tCity, trip.pais_destino) });
    const pp = num(t?.precio_por_persona);
    items.push(base({
      key: `actividad:${i}:${norm(t?.nombre)}`, kind: "actividad", category: "activity", title: t?.nombre ?? "Experiencia",
      subtitle: [tCity, t?.duracion].filter(Boolean).join(" · ") || null,
      price: pp ? pp * travelers : null, currency: "MXN", priceNote: pp ? `${plural(travelers, "persona", "personas")} · $${Math.round(pp).toLocaleString("es-MX")} MXN c/u` : null,
      source: { fuente: t?.fuente ?? null, estado: t?.estado_dato ?? null, consultadoAt: t?.consultado_at ?? null },
      estimate: offer.price_is_estimate, action: pick(offer, "tours_json", i), optional: false, fallbackHref: null,
      col: "tours_json", index: i, offer,
    }));
  }

  // 5 · Restaurantes (no se cotiza mesa: rango de precio y cómo reservar)
  const rest: any[] = Array.isArray(trip.restaurantes_json) ? trip.restaurantes_json : [];
  rest.slice(0, opts.maxRestaurants ?? 3).forEach((r, i) => {
    const rCity = r?.ciudad ?? city;
    const name = String(r?.nombre ?? "").replace(` · ${rCity}`, "").trim() || "Restaurante";
    const offer = offerFromTripRestaurant(r, { trip, city: rCity, index: i, venue: venueFromTripPlace(r, rCity, trip.pais_destino) });
    items.push(base({
      key: `restaurante:${i}:${norm(name)}`, kind: "restaurante", category: "restaurant", title: name,
      subtitle: [r?.cocina, rCity].filter(Boolean).join(" · ") || null,
      price: null, currency: null, priceNote: r?.rango_precio ? `Rango: ${restaurantPriceLabel(r.rango_precio, tripUsdMxnRate(trip))?.text ?? r.rango_precio}` : "Sin precio: depende de lo que pidas.",
      source: { fuente: r?.fuente ?? null, estado: null, consultadoAt: r?.consultado_at ?? null }, estimate: false,
      action: pick(offer, "restaurantes_json", i), optional: true, fallbackHref: null, col: "restaurantes_json", index: i, offer,
    }));
  });
  return items;
}

/**
 * Sin hotel elegido (un destino), el que suma el total de la página: el total usa
 * desglose_presupuesto.hospedaje (analizar-viaje: hotel de precio medio), así que "Comprar" muestra el
 * hotel cuyo precio es ese monto; si ninguno cuadra, el de precio medio (el mismo criterio).
 */
export function quotedHotelIndex(trip: any): number {
  const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  if (!hoteles.length) return -1;
  const quoted = Math.round(Number(trip?.desglose_presupuesto?.hospedaje) || 0);
  const match = quoted > 0 ? hoteles.findIndex((h, i) => offerFromTripHotel(h, { trip, city: h?.ciudad ?? trip?.destino ?? null, index: i }).price === quoted) : -1;
  if (match >= 0) return match;
  const sorted = hoteles.map((h, i) => [Number(h?.precio_por_noche) || 0, i] as const).sort((a, b) => a[0] - b[0]);
  return sorted[Math.floor(sorted.length / 2)][1];
}

const TIER_ORDER: Record<string, number> = { ahorro: 0, equilibrio: 1, premium: 2 };

/**
 * Opciones de vuelo que se pueden ofrecer (índices en vuelos_json, máximo 3, ahorro → premium): solo
 * tarifas reales del vuelo del viaje, sin las de otro destino, con duración absurda o aerolínea que no
 * opera la ruta, ni estimados de IA. En un viaje de un destino también los trayectos por carretera.
 */
export function realFlightOptions(trip: any, max = 3): number[] {
  const vuelos: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const route = tripFlightRoute(trip);
  const seen = new Set<string>();
  return vuelos.map((v, i) => [v, i] as const)
    .filter(([v]) => (isGroundTripOption(v) ? !route.multi && (v?.modo === "autobus" || v?.modo === "auto")
      : !isEstimatedTripFlight(v) && isTripInternationalRow(v, route) && tripFlightProblems(v, trip).length === 0))
    .filter(([v]) => {
      const k = `${norm(v?.aerolinea)}|${Number(v?.precio_por_persona) || ""}|${v?.modo ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (TIER_ORDER[a[0]?.tier] ?? 9) - (TIER_ORDER[b[0]?.tier] ?? 9) || (Number(a[0]?.precio_por_persona) || 0) - (Number(b[0]?.precio_por_persona) || 0))
    .slice(0, max)
    .map(([, i]) => i);
}

/**
 * ¿El destino precargado en un enlace de vuelo (Google Flights o Aviasales) es el del viaje? false si
 * es otra ciudad; null si el enlace no lleva destino o la ciudad no se conoce.
 */
export function prefillMatchesTrip(url: string | null | undefined, trip: any): boolean | null {
  if (!url) return null;
  const dest = parseGoogleFlightsSearch(url)?.destination ?? parseAviasalesSearch(url)?.destination ?? null;
  const first = tripFlightRoute(trip).cities[0];
  return dest && first ? codeServesCity(dest, first) : null;
}

/**
 * Vuelo sin tarifa válida: "por cotizar" con la búsqueda de Google Flights del viaje (open-jaw en
 * multi-destino). Si no se reconoce un aeropuerto, el botón lo dice en vez de fingir que lleva la ruta.
 */
export function flightToQuote(trip: any, route: TripFlightRoute, subtitle: string): PurchaseItem {
  const s = tripFlightSearches(trip);
  const ok = s.google ? checkAllowlisted(s.google) : null;
  const url = ok && ok.ok ? ok.url : null;
  const d = describePrefill(url, "Google Flights", trip);
  const missing = unresolvedCityLabel(route);
  const plain = "https://www.google.com/travel/flights?hl=es-419";
  return {
    key: `vuelo:por-cotizar:${norm(route.cities.join(" "))}`, kind: "vuelo", category: "flight", title: "Vuelo · por cotizar",
    subtitle, price: null, currency: null,
    priceNote: "Aún no tenemos precio real para esta ruta: búscalo en Google Flights.",
    source: { fuente: null, estado: null, consultadoAt: null }, estimate: false,
    site: "Google Flights", url: url ?? plain, action: null,
    lleva: url ? d.lleva : [],
    completa: url ? d.completa : `No reconocimos el aeropuerto de ${missing ?? "tu destino"}: escribe la ruta en Google Flights.`,
    buttonLabel: url ? null : "Abre Google Flights y escribe el destino",
    optional: false, fallbackHref: null, col: null, index: -1, offer: null,
  };
}

// ───────────────────────────── Estado "Ya lo reservé" ─────────────────────────────
// Se guarda en public.bookings (tabla que ya existe, con RLS por usuario y acceso al viaje): una fila
// con status "pending" (NO es una reserva confirmada) y raw_payload.compra_item = clave del elemento.
// Así no se marca la cotización como "por actualizar" (trips.selections sí lo haría) y no se usa
// "confirmed", que en IATOS exige evidencia del proveedor (bookingState.isConfirmedBooking).

export type PurchaseMarkRow = BookingLike & { id?: string; user_id?: string | null; raw_payload?: any; created_at?: string | null };

export function markedKeys(rows: PurchaseMarkRow[]): Map<string, PurchaseMarkRow> {
  const m = new Map<string, PurchaseMarkRow>();
  for (const r of rows ?? []) {
    const k = r?.raw_payload?.compra_item;
    if (typeof k === "string" && r.status !== "cancelled") m.set(k, r);
  }
  return m;
}

export type PurchaseState = "confirmado" | "marcado" | "pendiente";

/** Confirmado (con evidencia del proveedor) > marcado por alguien del viaje > pendiente. Con `marks`
 *  (las marcas del grupo, r2 grupo) cuenta lo que marcó cualquier miembro; sin él, las filas propias. */
export function itemPurchaseState(item: PurchaseItem, rows: PurchaseMarkRow[], marks?: { has(key: string): boolean } | null): PurchaseState {
  const confirmed = (rows ?? []).filter((r) => isConfirmedBooking(r) && r.category === item.category);
  const name = norm(item.kind === "vuelo" ? item.title.replace(/^Vuelo · /, "") : item.title.replace(/^Hospedaje · /, ""));
  if (name.length >= 3 && confirmed.some((r) => ` ${norm(`${r.title ?? ""} ${r.subtitle ?? ""}`)} `.includes(` ${name} `))) return "confirmado";
  return (marks ?? markedKeys(rows)).has(item.key) ? "marcado" : "pendiente";
}

/** Fila para bookings al tocar "Ya lo reservé". */
export function markRow(item: PurchaseItem, trip: { id: string; destino?: string | null; fecha_salida?: string | null }, userId: string, now = new Date(),
  extra: { confirmacion?: string | null; ciudad?: string | null } = {}) {
  // Número de confirmación que escribió la persona (Experiencias): va en raw_payload, NO en
  // confirmation_code (ese campo es la evidencia de una reserva real y la app lo mostraría "Reservado").
  const conf = String(extra.confirmacion ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return {
    user_id: userId, trip_id: trip.id, category: item.category, provider: item.site ?? "Por su cuenta", status: "pending",
    title: item.title, subtitle: item.subtitle, city: extra.ciudad ?? trip.destino ?? null, start_at: trip.fecha_salida ?? null, booking_url: item.url,
    raw_payload: {
      compra_item: item.key, marcado_por_usuario: true, marcado_at: now.toISOString(), nota: "Marcado a mano por el usuario: sin verificar con el proveedor.",
      ...(conf ? { confirmacion_usuario: conf } : {}),
    },
  };
}
