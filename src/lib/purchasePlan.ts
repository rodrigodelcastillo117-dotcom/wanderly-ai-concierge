// "Comprar mi viaje" (cierre 2, grupo enlaces): la lista de lo cotizado con, para cada cosa, a qué sitio
// lleva el botón, qué datos van precargados EN ESA URL (se leen de la propia URL, no se suponen), qué
// falta completar ahí y su estado ("Ya lo reservé", marcado a mano por el usuario).
//
// Los enlaces salen del Booking Bridge (offers.ts + resolver): son los mismos que ya validan la lista
// blanca y booking-go; aquí no se arma ninguna URL nueva salvo la renta de auto opcional (Kayak), que
// también pasa por checkAllowlisted.
import { kayakCarsLink, PREFILL } from "@/lib/affiliateLinks";
import {
  checkAllowlisted, offerFromTripFlight, offerFromTripHotel, offerFromTripRestaurant, offerFromTripTour, venueFromTripPlace,
  type BookingAction, type BookingOffer,
} from "@/lib/booking";
import { isConfirmedBooking, type BookingLike } from "@/lib/bookingState";
import { parseAviasalesSearch, parseBookingSearch, parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links.ts";
import { airlineName } from "@/lib/airlines";

export type PurchaseKind = "vuelo" | "hospedaje" | "auto" | "actividad" | "restaurante";
export type PurchaseCategory = "flight" | "hotel" | "car" | "activity" | "restaurant";

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
  /** Ruta interna cuando no hay enlace externo fiable (p. ej. buscar vuelos reales). */
  fallbackHref: string | null;
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
    return {
      lleva: [`${gf.origin} → ${gf.destination}`, fmtRange(gf.depart, gf.ret) ?? "", pax(gf.adults, gf.children), ...(air.length ? [`solo ${air.join(", ")}`] : [])].filter(Boolean),
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
  if (host.endsWith("kayak.com") && u.pathname.startsWith("/cars/")) {
    const [, , city, a, b] = u.pathname.split("/");
    return { lleva: [decodeURIComponent(city ?? ""), fmtRange(a ?? null, b ?? null) ?? ""].filter(Boolean), completa: PREFILL.kayak_cars.completa };
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

type Sel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[] };

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

  // 1 · Vuelo (o trayecto por carretera)
  const vuelos: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
  if (sel.selVuelo !== -2 && vuelos.length) {
    const i = sel.selVuelo >= 0 && vuelos[sel.selVuelo] ? sel.selVuelo : 0;
    const v = vuelos[i];
    const offer = offerFromTripFlight(v, { trip, city, index: i });
    const pp = num(v?.precio_por_persona);
    const range = num(v?.precio_min) && num(v?.precio_max);
    items.push(base({
      key: `vuelo:${i}:${norm(v?.aerolinea)}`, kind: "vuelo", category: "flight",
      title: isGround(v) ? `${v?.modo === "auto" ? "En auto" : "Autobús"} · ${v?.aerolinea ?? ""}`.trim() : `Vuelo · ${v?.aerolinea ?? "Aerolínea por elegir"}`,
      subtitle: [trip.ciudad_origen && city ? `${trip.ciudad_origen} → ${city}` : null, fmtRange(trip.fecha_salida, trip.fecha_regreso), plural(travelers, "viajero", "viajeros")].filter(Boolean).join(" · "),
      price: range ? null : pp ? pp * travelers : null, currency: "MXN",
      priceNote: range ? `$${Math.round(Number(v.precio_min)).toLocaleString("es-MX")}–$${Math.round(Number(v.precio_max)).toLocaleString("es-MX")} MXN por persona` : pp ? `${plural(travelers, "persona", "personas")} · $${Math.round(pp).toLocaleString("es-MX")} MXN c/u` : null,
      source: { fuente: v?.fuente_precio ?? null, estado: v?.estado_dato ?? null, consultadoAt: checked(v), approximateDates: !!v?.approximate_dates },
      estimate: offer.price_is_estimate || !!range, action: pick(offer, "vuelos_json", i), optional: false,
      fallbackHref: isGround(v) ? null : `/dashboard/vuelos?origin=${encodeURIComponent(trip.ciudad_origen ?? "")}&destination=${encodeURIComponent(city ?? "")}&depart=${trip.fecha_salida ?? ""}&return=${trip.fecha_regreso ?? ""}&travelers=${travelers}&auto=1&trip=${trip.id}`,
      col: "vuelos_json", index: i, offer,
    }));
  }

  // 2 · Hospedaje
  const hoteles: any[] = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
  if (sel.selHospedaje !== -2 && hoteles.length) {
    const i = sel.selHospedaje >= 0 && hoteles[sel.selHospedaje] ? sel.selHospedaje : 0;
    const h = hoteles[i];
    const hCity = h?.ciudad ?? city;
    const offer = offerFromTripHotel(h, { trip, city: hCity, index: i });
    const nights = Number((offer.details as any)?.nights) || null;
    items.push(base({
      key: `hospedaje:${i}:${norm(h?.nombre)}`, kind: "hospedaje", category: "hotel",
      title: `Hospedaje · ${h?.nombre ?? "Hotel"}`,
      subtitle: [hCity, fmtRange(trip.fecha_salida, trip.fecha_regreso), nights ? plural(nights, "noche", "noches") : null].filter(Boolean).join(" · "),
      price: offer.price, currency: offer.currency ?? "MXN",
      priceNote: nights && num(h?.precio_por_noche) ? `${plural(nights, "noche", "noches")} · $${Math.round(Number(h.precio_por_noche)).toLocaleString("es-MX")} MXN por noche` : null,
      source: { fuente: h?.fuente_precio ?? null, estado: h?.estado_dato ?? null, consultadoAt: checked(h) },
      estimate: offer.price_is_estimate, action: pick(offer, "hospedaje_json", i), optional: false, fallbackHref: null,
      col: "hospedaje_json", index: i, offer,
    }));
  }

  // 3 · Renta de auto (opcional, no cotizada): Kayak con ciudad y fechas del viaje.
  if (city && isIso(trip.fecha_salida) && isIso(trip.fecha_regreso)) {
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
    const offer = offerFromTripTour(t, { trip, city: tCity, index: i });
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
      price: null, currency: null, priceNote: r?.rango_precio ? `Rango: ${r.rango_precio}` : "Sin precio: depende de lo que pidas.",
      source: { fuente: r?.fuente ?? null, estado: null, consultadoAt: r?.consultado_at ?? null }, estimate: false,
      action: pick(offer, "restaurantes_json", i), optional: true, fallbackHref: null, col: "restaurantes_json", index: i, offer,
    }));
  });
  return items;
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
export function markRow(item: PurchaseItem, trip: { id: string; destino?: string | null; fecha_salida?: string | null }, userId: string, now = new Date()) {
  return {
    user_id: userId, trip_id: trip.id, category: item.category, provider: item.site ?? "Por su cuenta", status: "pending",
    title: item.title, subtitle: item.subtitle, city: trip.destino ?? null, start_at: trip.fecha_salida ?? null, booking_url: item.url,
    raw_payload: { compra_item: item.key, marcado_por_usuario: true, marcado_at: now.toISOString(), nota: "Marcado a mano por el usuario: sin verificar con el proveedor." },
  };
}
