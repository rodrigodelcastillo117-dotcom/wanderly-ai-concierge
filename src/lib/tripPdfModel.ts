// Contenido del PDF del viaje ("Compartir PDF"), sin dibujar nada: qué dice cada página y de dónde sale.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): el PDF anterior decía "MESA RESERVADA" sobre
// restaurantes sin reserva, presentaba la tarifa de Aviasales a Bucarest ("Y4 102 · 65h · 2 escalas")
// como vuelo a Roma, ponía rentas de coche como "VUELO / LLEGADA", tomaba el primer hotel de la lista
// en vez del elegido, sumaba un total distinto al de la página y repetía el resumen como "tips".
//
// Aquí no se calcula nada propio: todo sale de las mismas funciones que la página del viaje.
//  - Total y desglose: tripTotals + computeTripDesglose (lo mismo que RealTripTotal).
//  - Qué comprar, con su enlace precargado y su estado: buildBuyFlow + itemPurchaseState ("Comprar").
//  - Vuelos: realFlightOptions / flightToQuote (fareGuard) y flightDisplay (nunca un estimado como dato).
//  - Hotel por ciudad: cityHotelChoices (el elegido, con sus noches y su total).
//  - Ruta en coche y avisos: logistics.road_trip (el mismo plan que el panel "Ruta").
//  - Estado de cada precio: provenanceOf (la misma insignia que en la app).
import { tripTotals } from "@/components/RealTripTotal";
import { computeTripDesglose } from "@/lib/quote";
import { buildBuyFlow, TIER_WORD } from "@/lib/buyFlow";
import { listaHumana, unverifiedInTotal } from "@/lib/tripTotal";
import { describePrefill, fmtDay, fmtRange, itemPurchaseState, type PurchaseItem, type PurchaseMarkRow, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { markLabel, type GroupMark } from "@/lib/purchaseMarks";
import { provenanceOf } from "@/lib/provenance";
import { flightAirlineLabel, flightDurationLabel, flightStopsLabel } from "@/lib/flightDisplay";
import { offerFromCarRental, COUNTRIES, type RoadTripPlan, type Notice } from "@/lib/roadtrip";
import { primaryAction } from "@/lib/purchasePlan";
import { getEmergency, EMERGENCY_SOURCE_NOTE } from "@/lib/emergencyNumbers";
import { currencyName, destinationCurrency } from "@/lib/currencies";
import { groundOptionsForCity } from "@/lib/multiDestTrip";
import type { QuoteTrust } from "@/lib/quoteTrust";
import { cityStays, sameCity, tripCountryLabel, tripDestinations, tripFlightSearches } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { tripFlightProblems } from "@/lib/booking";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist.ts";
import { DEFAULT_SITE_URL } from "../../supabase/functions/_shared/email-kit.ts";

/** Dominio del sitio para el pie del PDF (la misma constante que los correos). */
export const SITE_URL = DEFAULT_SITE_URL;
export const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export type TripPdfSelection = {
  selVuelo: number;
  selHospedaje: number;
  selTours: Set<number> | number[];
  selHoteles?: Record<string, number> | null;
  /** Noches del hotel en un viaje de un destino (nochesEfectivas de la página). */
  nochesHospedaje?: number | null;
};

/** El total tal como lo muestra la página (RealTripTotal), para que el PDF diga exactamente lo mismo. */
export type PageTotals = {
  total: number;
  porPersona: number;
  travelers: number;
  nights: number;
  desglose: Record<string, number>;
  fromSelection: boolean;
  quotedTotal: number;
  /** "Incluye estimados: vuelos." de la página (tripTotalSummary); si falta se calcula igual. */
  estimadosNote?: string;
};

export type TripPdfOptions = {
  sel: TripPdfSelection;
  /** Lo que muestra la página; si falta se calcula con las mismas funciones. */
  totals?: PageTotals | null;
  bookings?: PurchaseMarkRow[];
  marks?: Map<string, GroupMark> | null;
  userId?: string | null;
  serverOffers?: TripOfferActionsLike;
  quoteCreatedAt?: string | null;
  trust?: QuoteTrust | null;
  now?: Date;
};

export type PdfLink = { label: string; url: string };
export type BuyRow = {
  key: string;
  group: string;
  title: string;
  subtitle: string | null;
  price: string | null;
  priceNote: string | null;
  /** "Precio de referencia", "Estimado", "Consultado en vivo"… (la insignia de la app). */
  provenance: string | null;
  /** "Ya lo compré · tú · 22 oct", "Confirmado" o "Pendiente". */
  status: string;
  done: boolean;
  optional: boolean;
  links: PdfLink[];
  /** Qué va precargado en el enlace (leído de la propia URL). */
  lleva: string[];
  completa: string | null;
  /** Aviso destacado (p. ej. tarifas descartadas por no ser de la ruta, como dice la página). */
  warning?: string | null;
};
export type DaySlot = { label: string; text: string };
export type PdfDay = { n: number; title: string; slots: DaySlot[] };
export type PdfLeg = { from: string; to: string; mode: string; km: number | null; minutes: number | null; state: string | null; date: string | null; mapsUrl: string | null; note: string | null };
export type PdfCity = {
  city: string;
  index: number;
  nights: number | null;
  range: string | null;
  hotel: { name: string; detail: string; total: string | null; provenance: string | null; status: string; done: boolean; links: PdfLink[]; skipped: boolean } | null;
  arrival: PdfLeg | null;
  days: PdfDay[];
  restaurants: Array<{ name: string; cuisine: string | null; price: string | null; links: PdfLink[] }>;
  tours: Array<{ name: string; detail: string; links: PdfLink[]; status: string }>;
  photoQuery: string;
};

export type TripPdfModel = {
  title: string;
  country: string | null;
  origin: string | null;
  datesLabel: string | null;
  nights: number;
  travelers: number;
  totals: PageTotals;
  totalNote: string;
  desglose: Array<{ label: string; amount: number }>;
  trustSummary: string | null;
  summary: string | null;
  flightLine: string | null;
  route: { cities: Array<{ city: string; nights: number | null; range: string | null }>; legs: PdfLeg[]; totalKm: number | null; totalMinutes: number | null; drivingState: string | null };
  buy: BuyRow[];
  /** Tarifas guardadas que no eran de la ruta (mismo aviso que la página). */
  discardedFares: number;
  buyDone: number;
  buyTotal: number;
  cities: PdfCity[];
  notices: Array<{ title: string; body: string; sources: PdfLink[]; consulted: string | null }>;
  useful: Array<{ label: string; value: string; note?: string | null }>;
  tips: string[];
  coverImageUrl: string | null;
  coverQuery: string;
  generatedAt: string;
  domain: string;
  siteUrl: string;
  filename: string;
};

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isIso = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: unknown) => clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const LABELS: Record<string, string> = {
  vuelos: "Vuelos", hospedaje: "Hospedaje", comida: "Comida", tours: "Tours y experiencias", transporte_local: "Transporte local", extras: "Extras",
};

export function hoursLabel(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min)) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
export const kmLabel = (km: number | null | undefined) => (km == null ? null : `${Math.round(km).toLocaleString("es-MX")} km`);

const DATA_STATE: Record<string, string> = { CONSULTADO: "consultado", ESTIMADO: "estimado", POR_CONFIRMAR: "por confirmar", POR_COTIZAR: "por cotizar", SIN_DATOS: "sin datos" };

export function pdfSlug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "viaje";
}

/** Totales con las MISMAS funciones que la página (computeTripDesglose → tripTotals). */
export function pageTotalsFor(trip: any, sel: TripPdfSelection, travelers?: number, nights?: number): PageTotals {
  const n = Math.max(1, Math.round(Number(travelers ?? trip?.num_viajeros) || 1));
  const tours = sel.selTours instanceof Set ? sel.selTours : new Set(sel.selTours ?? []);
  const desglose = computeTripDesglose(trip, { selVuelo: sel.selVuelo, selHospedaje: sel.selHospedaje, nochesHospedaje: sel.nochesHospedaje ?? 0, selTours: tours, selHoteles: sel.selHoteles ?? {} } as any, n);
  const t = tripTotals(trip, n, desglose);
  const byDates = isIso(trip?.fecha_salida) && isIso(trip?.fecha_regreso)
    ? Math.max(0, Math.round((Date.parse(`${trip.fecha_regreso}T00:00:00Z`) - Date.parse(`${trip.fecha_salida}T00:00:00Z`)) / 86400000)) : 0;
  return { total: t.total, porPersona: t.porPersona, travelers: n, nights: nights ?? (cityStays(trip).reduce((s, c) => s + c.nights, 0) || byDates), desglose, fromSelection: t.fromSelection, quotedTotal: t.quotedTotal };
}

/** Texto de la insignia de procedencia (igual que PriceSourceBadge). */
function provLabel(src: PurchaseItem["source"] | null | undefined, now: Date): string | null {
  if (!src || (!src.fuente && !src.estado)) return null;
  return provenanceOf({ source: src.fuente, estado: src.estado, consultadoAt: src.consultadoAt, approximateDates: src.approximateDates }, now).label;
}

function buyLinkLabel(it: PurchaseItem): string {
  if (it.buttonLabel) return it.buttonLabel;
  if (!it.site) return "Abrir";
  if (it.kind === "auto") return `Buscar en ${it.site}`;
  if (it.kind === "restaurante") return `Reservar en ${it.site}`;
  return `Comprar en ${it.site}`;
}

/** Los tips solo si dicen algo distinto del resumen (en el caso real, el único "tip" era el resumen). */
export function distinctTips(trip: any): string[] {
  const summary = norm(trip?.analisis_ai);
  const seen = new Set<string>();
  return (Array.isArray(trip?.tips_personalizados) ? trip.tips_personalizados : [])
    .map(clean).filter(Boolean)
    .filter((t: string) => {
      const k = norm(t);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      // Igual al resumen, o contenido entero en él (o al revés): repetido.
      return !(summary && (k === summary || (k.length > 60 && (summary.includes(k) || k.includes(summary)))));
    });
}

export function buildTripPdfModel(trip: any, opts: TripPdfOptions): TripPdfModel {
  const now = opts.now ?? new Date();
  const sel = opts.sel;
  const tours = sel.selTours instanceof Set ? sel.selTours : new Set(sel.selTours ?? []);
  const cities = tripDestinations(trip);
  const multi = cities.length > 1;
  const stays = cityStays(trip);
  const stayNights = stays.reduce((s, c) => s + c.nights, 0);
  const totals = opts.totals ?? pageTotalsFor(trip, sel);
  const travelers = totals.travelers;
  const nights = totals.nights || stayNights;

  // ── Comprar: los mismos pasos y enlaces que la sección "Comprar" ──
  const flow = buildBuyFlow(trip, { selVuelo: sel.selVuelo, selHospedaje: sel.selHospedaje, selTours: tours, selHoteles: sel.selHoteles ?? null }, opts.serverOffers ?? {}, { quoteCreatedAt: opts.quoteCreatedAt ?? null });
  const rows = opts.bookings ?? [];
  const stateOf = (it: PurchaseItem) => {
    const st = itemPurchaseState(it, rows, opts.marks ?? null);
    if (st === "confirmado") return { status: "Confirmado", done: true };
    if (st === "marcado") {
      const mk = opts.marks?.get(it.key) ?? null;
      return { status: mk ? markLabel(mk, opts.userId ?? null, now) : "Ya lo compré", done: true };
    }
    return { status: "Pendiente", done: false };
  };
  const searches = tripFlightSearches(trip);
  const kayakFlights = searches.kayak ? checkAllowlisted(searches.kayak) : null;

  const plan: RoadTripPlan | null = trip?.itinerario_json?.logistics?.road_trip ?? null;
  const rentalRows = (Array.isArray(plan?.rentals) ? plan!.rentals : []).map((r) => {
    const ready = !!(r.pickup_date && r.dropoff_date);
    const action = ready ? primaryAction(offerFromCarRental({ pickup_city: r.pickup_city, dropoff_city: r.dropoff_city, pickup_date: r.pickup_date!, dropoff_date: r.dropoff_date!, trip_id: trip?.id ?? null }).actions) : null;
    return { r, url: action?.url ?? null, site: action?.processor ?? "Kayak" };
  });

  const buy: BuyRow[] = [];
  const toRow = (it: PurchaseItem, group: string, extraLinks: PdfLink[] = []): BuyRow => {
    const st = stateOf(it);
    const links: PdfLink[] = [];
    if (it.url) links.push({ label: buyLinkLabel(it), url: it.url });
    for (const l of extraLinks) if (!links.some((x) => x.url === l.url)) links.push(l);
    return {
      key: it.key, group, title: it.title.replace(/^Hospedaje · /, "").replace(/^Vuelo · /, "Vuelo · "), subtitle: it.subtitle,
      price: it.price ? money(it.price) : null, priceNote: it.priceNote, provenance: provLabel(it.source, now), status: st.status, done: st.done,
      optional: it.optional, links, lleva: it.lleva, completa: it.completa,
    };
  };
  for (const s of flow.steps) {
    if (s.kind === "vuelo") {
      if (s.skipped) continue;
      if (s.item) {
        const extra = s.item.kind === "vuelo" && kayakFlights?.ok && !s.item.url?.includes("kayak.") ? [{ label: "Comparar en Kayak", url: kayakFlights.url }] : [];
        const row = toRow(s.item, "Vuelo", extra);
        // Tarifa real elegida: aerolínea, escalas y duración como en la página (flightDisplay).
        const v = s.item.index >= 0 ? trip.vuelos_json?.[s.item.index] : null;
        if (v) row.title = `Vuelo · ${flightAirlineLabel(v)}`;
        if (v) row.subtitle = [row.subtitle, flightStopsLabel(v), flightDurationLabel(v)].filter(Boolean).join(" · ");
        buy.push(row);
      }
    } else if (s.kind === "hospedaje") {
      if (s.skipped || !s.item) continue;
      const r = toRow(s.item, s.city ? `Hotel en ${s.city}` : "Hotel");
      buy.push(r);
    } else if (s.item) {
      if (!rentalRows.length) { buy.push(toRow(s.item, "Auto (opcional)")); continue; }
      // Road trip: el auto que se renta es el de los tramos en coche (recoger y devolver donde dice la
      // ruta, como el panel "Ruta"), no uno por todo el viaje. El estado es el del paso "Auto".
      const st = stateOf(s.item);
      for (const { r, url, site } of rentalRows) {
        const d = describePrefill(url, site, trip);
        buy.push({
          key: `${s.item.key}:${r.leg_indexes.join("-")}`, group: "Auto para el road trip",
          title: r.pickup_city === r.dropoff_city ? `Renta de auto · ${r.pickup_city}` : `Renta de auto · ${r.pickup_city} → ${r.dropoff_city}`,
          subtitle: [r.pickup_date ? `Recoges el ${fmtDay(r.pickup_date, false)} en ${r.pickup_city}` : `Recoges en ${r.pickup_city}`,
            r.dropoff_date ? `devuelves el ${fmtDay(r.dropoff_date, false)} en ${r.dropoff_city}` : `devuelves en ${r.dropoff_city}`].join(" y "),
          price: null, priceNote: "IATOS no cotizó el auto: el precio lo ves en Kayak.", provenance: null, status: st.status, done: st.done, optional: true,
          links: url ? [{ label: `Buscar en ${site}`, url }] : [], lleva: d.lleva, completa: [...(r.warnings ?? [])].join(" ") || d.completa,
        });
      }
    }
  }
  for (const it of flow.items.filter((i) => i.kind === "actividad")) buy.push(toRow(it, "Experiencia elegida"));
  const core = buy.filter((b) => !b.optional);
  const discardedFares = (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []).filter((v: any) => tripFlightProblems(v, trip).length > 0).length;
  const flightRow = buy.find((b) => b.group === "Vuelo");
  if (flightRow && discardedFares > 0) {
    flightRow.warning = `Descartamos ${discardedFares === 1 ? "1 tarifa de vuelo" : `${discardedFares} tarifas de vuelo`} de esta cotización porque no eran de tu ruta.`;
  }

  // ── Ruta: noches por ciudad y tramos por tierra (road trip si existe) ──
  const planLegs = Array.isArray(plan?.legs) ? plan!.legs : [];
  const legFor = (from: string, to: string): PdfLeg | null => {
    const l = planLegs.find((x) => sameCity(x.from, from) && sameCity(x.to, to));
    if (l) {
      return { from: l.from, to: l.to, mode: "En coche", km: l.distance_km, minutes: l.duration_min, state: DATA_STATE[l.estado] ?? null, date: isIso(l.date) ? fmtDay(l.date, false) : null,
        mapsUrl: l.maps_url && /^https:\/\//.test(l.maps_url) ? l.maps_url : null, note: l.estado === "CONSULTADO" ? "Google Maps, sin tráfico" : l.estado === "ESTIMADO" ? "aproximado (línea recta)" : null };
    }
    // Sin road trip: la opción por tierra guardada (coche/tren), con su duración marcada como estimada.
    const g = groundOptionsForCity(trip, to)[0];
    if (!g) return null;
    const mode = String(g.mode ?? g.modo ?? "");
    return { from, to, mode: mode === "tren" ? "En tren" : mode === "coche" || mode === "auto" ? "En coche" : mode === "ferry" ? "En ferry" : mode === "bus" || mode === "autobus" ? "En autobús" : "Por tierra",
      km: null, minutes: null, state: "estimado", date: ((d) => (isIso(d) ? fmtDay(d, false) : null))(stays.find((s) => sameCity(s.city, to))?.checkin), mapsUrl: null,
      note: [g.aerolinea, g.duracion ? `≈ ${g.duracion}` : null].filter(Boolean).join(" · ") || null };
  };
  const legs: PdfLeg[] = [];
  for (let i = 0; i < cities.length - 1; i++) {
    const l = legFor(cities[i], cities[i + 1]);
    if (l) legs.push(l);
  }
  const driving = legs.filter((l) => l.mode === "En coche" && l.km != null);
  const routeCities = (multi ? cities : [trip?.destino ?? cities[0]].filter(Boolean)).map((c: string) => {
    const st = stays.find((s) => sameCity(s.city, c));
    return { city: c, nights: st?.nights ?? (multi ? null : nights || null), range: st ? fmtRange(st.checkin, st.checkout) : null };
  });

  // ── Por ciudad ──
  const itin = trip?.itinerario_json;
  const days: any[] = Array.isArray(itin) ? itin : Array.isArray(itin?.days) ? itin.days : [];
  const hotelSteps = flow.steps.filter((s) => s.kind === "hospedaje");
  const restaurantItems = flow.items.filter((i) => i.kind === "restaurante");
  const restList: any[] = Array.isArray(trip?.restaurantes_json) ? trip.restaurantes_json : [];
  const tourList: any[] = Array.isArray(trip?.tours_json) ? trip.tours_json : [];
  const pdfCities: PdfCity[] = routeCities.map((rc, idx) => {
    const city = rc.city;
    const cityDays = (multi ? days.filter((d) => sameCity(d?.ciudad, city)) : days).map((d): PdfDay => {
      const n = Number(d?.dia) || 0;
      // Sin fecha por día: el itinerario guardado no siempre cuadra con las noches por ciudad (en el caso
      // real, el día 4 ya es Florencia y la estancia en Roma termina el 26): no se afirma una fecha.
      const title = clean(d?.titulo).replace(new RegExp(`^${city}\\s+[—–-]\\s+`, "i"), "");
      const slots: DaySlot[] = [
        { label: "Mañana", text: clean(d?.["mañana"] ?? d?.manana) },
        { label: "Tarde", text: clean(d?.tarde) },
        { label: "Noche", text: clean(d?.noche) },
      ].filter((s) => s.text);
      if (Array.isArray(d?.agregados) && d.agregados.length) {
        slots.push({ label: "Agregado por ti", text: d.agregados.map((a: any) => [a?.hora, clean(a?.titulo), a?.lugar ? `— ${clean(a.lugar)}` : null].filter(Boolean).join(" ")).join(" · ") });
      }
      return { n, title: title || `Día ${n}`, slots };
    });
    const hs = hotelSteps.find((s) => (s.kind === "hospedaje" && s.city && sameCity(s.city, city)) || (!multi && s.kind === "hospedaje")) as any;
    let hotel: PdfCity["hotel"] = null;
    if (hs) {
      const h = hs.chosen >= 0 ? trip.hospedaje_json?.[hs.chosen] : null;
      if (hs.skipped) {
        hotel = { name: "Ya tienes dónde quedarte", detail: "No suma al total.", total: null, provenance: null, status: "", done: true, links: [], skipped: true };
      } else if (h && hs.item) {
        const st = stateOf(hs.item);
        const perNight = Number(h.precio_por_noche) || 0;
        const detail = [h.tier && TIER_WORD[h.tier] ? TIER_WORD[h.tier] : null, hs.nights ? plural(hs.nights, "noche", "noches") : null,
          perNight ? `${money(perNight)} por noche` : null, Number(h.rating) > 0 ? `★ ${Number(h.rating).toFixed(1)}` : null].filter(Boolean).join(" · ");
        hotel = { name: clean(h.nombre) || "Hotel", detail, total: hs.item.price ? money(hs.item.price) : null, provenance: provLabel(hs.item.source, now),
          status: st.status, done: st.done, links: hs.item.url ? [{ label: buyLinkLabel(hs.item), url: hs.item.url }] : [], skipped: false };
      }
    }
    const restaurants = restList.map((r, i) => [r, i] as const).filter(([r]) => !multi || sameCity(r?.ciudad, city)).map(([r, i]) => {
      const it = restaurantItems.find((p) => p.index === i);
      return { name: clean(String(r?.nombre ?? "").replace(` · ${city}`, "")) || "Restaurante", cuisine: clean(r?.cocina) || null, price: clean(r?.rango_precio) || null,
        links: it?.url ? [{ label: `Reservar${it.site ? ` en ${it.site}` : ""}`, url: it.url }] : [] };
    });
    const chosenTours = flow.items.filter((it) => it.kind === "actividad" && (!multi || sameCity(tourList[it.index]?.ciudad, city))).map((it) => ({
      name: it.title, detail: [it.priceNote, provLabel(it.source, now)].filter(Boolean).join(" · "), links: it.url ? [{ label: buyLinkLabel(it), url: it.url }] : [], status: stateOf(it).status,
    }));
    return {
      city, index: idx, nights: rc.nights, range: rc.range, hotel, arrival: idx > 0 ? legs.find((l) => sameCity(l.to, city)) ?? null : null,
      days: cityDays, restaurants, tours: chosenTours, photoQuery: `${city} skyline landmark travel`,
    };
  });

  // ── Antes de manejar ──
  const notices = (Array.isArray(plan?.notices) ? plan!.notices : []).map((n: Notice) => ({
    title: `${n.iso !== "*" ? `${COUNTRIES[n.iso]?.name ?? n.iso} · ` : ""}${n.title}`, body: n.body,
    sources: (n.sources ?? []).filter((s) => /^https:\/\//.test(s.url)).map((s) => ({ label: s.label, url: s.url })),
    consulted: n.sources?.[0]?.consulted_at && isIso(n.sources[0].consulted_at) ? fmtDay(n.sources[0].consulted_at) : null,
  }));
  // ── Datos útiles (los que la app ya tiene: SOS y moneda) ──
  const country = tripCountryLabel(trip);
  const useful: TripPdfModel["useful"] = [];
  const em = getEmergency(country);
  if (em.verified && em.numbers) {
    useful.push({ label: `Emergencias en ${em.country}`, value: `Policía ${em.numbers.policia} · Ambulancia ${em.numbers.ambulancia} · Bomberos ${em.numbers.bomberos}`, note: EMERGENCY_SOURCE_NOTE });
  }
  const cur = destinationCurrency({ destino: trip?.destino, pais_destino: country });
  if (cur) useful.push({ label: "Moneda", value: `${cur}${currencyName(cur) ? ` · ${currencyName(cur)}` : ""}` });
  const iso = Object.values(COUNTRIES).find((c) => c.name === country);
  if (iso && planLegs.length) useful.push({ label: "Al volante", value: `En ${iso.name} se maneja por la ${iso.drives === "right" ? "derecha" : "izquierda"}.` });

  // ── Vuelo internacional en una línea (para el resumen) ──
  const fRow = buy.find((b) => b.group === "Vuelo");
  const flightLine = fRow ? [fRow.title, fRow.price ?? (fRow.title.includes("por cotizar") ? "precio por cotizar" : null)].filter(Boolean).join(" · ") : null;

  const datesLabel = fmtRange(trip?.fecha_salida ?? null, trip?.fecha_regreso ?? null);
  const title = clean(trip?.destino) || "Tu viaje";
  // Lo que el total suma sin precio verificable, dicho junto al total (igual que en la página y en Comprar).
  const estimadosNote = totals.estimadosNote ?? ((s) => (s.length ? `Incluye estimados: ${listaHumana(s)}.` : ""))(unverifiedInTotal(totals.desglose ?? {}, flow.items, sel));
  const totalNote = [totals.fromSelection
    ? `Total con tu selección de vuelo, hotel o experiencias (estimado con los precios de la cotización de ${money(totals.quotedTotal)}).`
    : "Total de la cotización guardada; no se agregan extras automáticos.", estimadosNote].filter(Boolean).join(" ");
  const desglose = Object.entries(totals.desglose ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ label: LABELS[k] ?? k, amount: Number(v) }));
  const totalKm = driving.length ? driving.reduce((s, l) => s + (l.km ?? 0), 0) : null;
  const totalMinutes = driving.length ? driving.reduce((s, l) => s + (l.minutes ?? 0), 0) : null;
  const drivingState = driving.length ? (driving.every((l) => l.state === "consultado") ? "consultado" : "estimado") : null;

  return {
    title, country, origin: clean(trip?.ciudad_origen) || null, datesLabel, nights, travelers, totals, totalNote, desglose,
    trustSummary: opts.trust?.summary ?? null, summary: clean(trip?.analisis_ai) || null, flightLine,
    route: { cities: routeCities, legs, totalKm, totalMinutes, drivingState },
    buy, buyDone: core.filter((b) => b.done).length, buyTotal: core.length,
    discardedFares,
    cities: pdfCities, notices, useful, tips: distinctTips(trip),
    coverImageUrl: typeof trip?.cover_image_url === "string" && /^https:\/\//.test(trip.cover_image_url) ? trip.cover_image_url : null,
    coverQuery: `${cities[0] ?? title} landmark travel`,
    generatedAt: fmtDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`),
    domain: SITE_DOMAIN, siteUrl: SITE_URL,
    filename: `IATOS-${pdfSlug(title)}.pdf`,
  };
}
