// "Comprar" como flujo de elegir y comprar (punto 11 del caso Roma → Florencia → Venecia): por cada
// paso (vuelo, un hotel por ciudad, auto) las opciones que se pueden elegir y la que está elegida, con
// su botón de compra precargado (el elemento de buildPurchasePlan). Reúsa las selecciones de la página
// (selVuelo / selHospedaje / selHoteles / selTours): elegir aquí cambia el total como antes.
import { buildPurchasePlan, realFlightOptions, type PurchaseItem, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { hotelPriceRooms } from "@/lib/quote";
import { sameCity, tripDestinations, type CityStay } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { legOptionsFor, type LegOption } from "@/lib/multiDestTrip";
import { checkAllowlisted } from "@/lib/booking";
import { describePrefill } from "@/lib/purchasePlan";
import { trainlineLink } from "@/lib/affiliateLinks";
import { distanceKm, mainAirport } from "../../supabase/functions/_shared/airports.ts";
import { googleFlightsSearchUrl } from "../../supabase/functions/_shared/booking/links.ts";

export type BuySel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null };

export type FlightStep = { kind: "vuelo"; n: number; title: string; item: PurchaseItem | null; options: number[]; chosen: number; skipped: boolean };
export type HotelStep = { kind: "hospedaje"; n: number; title: string; city: string | null; stay: CityStay | null; item: PurchaseItem | null;
  options: number[]; chosen: number; skipped: boolean; nights: number };
export type CarStep = { kind: "auto"; n: number; title: string; item: PurchaseItem | null };
/** Multi-destino: cómo ir de una ciudad a la siguiente (París → Roma), con su fecha y opciones estimadas. */
export type LegStep = { kind: "traslado"; n: number; title: string; from: string; to: string; date: string | null; options: LegOption[]; item: PurchaseItem };
export type BuyStep = FlightStep | HotelStep | CarStep | LegStep;

export type BuyFlow = {
  steps: BuyStep[];
  /** Todos los elementos de "Comprar mi viaje" (incluye actividades elegidas y restaurantes). */
  items: PurchaseItem[];
  /** Recomendaciones para reservar por ciudad (restaurantes y experiencias). */
  extras: Array<{ city: string; restaurants: number[]; tours: number[] }>;
};

/** Palabras normales para el nivel de una opción (sin "tier"). */
export const TIER_WORD: Record<string, string> = { ahorro: "Económico", equilibrio: "Equilibrado", premium: "Premium" };

export function hotelTotal(h: any, nights: number, travelers: number): number | null {
  const n = Number(h?.precio_por_noche) || 0;
  return n > 0 && nights > 0 ? Math.round(n * nights * hotelPriceRooms(h, travelers)) : null;
}

const isoOk = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const normKey = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Paso "París → Roma": opciones estimadas (vuelo interno, tren…) y un botón de compra precargado. Si
 * hay tren (o la distancia es de tren, < 800 km en Europa) el botón principal es el buscador de trenes;
 * si no, Google Flights solo ida con la fecha y los pasajeros.
 */
export function legStep(trip: any, from: string, to: string, date: string | null, n: number): LegStep {
  const options = legOptionsFor(trip, from, to);
  const travelers = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  const km = distanceKm(from, to);
  const trainFirst = options[0]?.mode === "tren" || (!options.some((o) => o.mode === "vuelo") && km != null && km < 800);
  const o = mainAirport(from);
  const d = mainAirport(to);
  const gf = !trainFirst && o && d && isoOk(date) ? googleFlightsSearchUrl({ origin: o, destination: d, depart: date, adults: travelers }) : null;
  const gfOk = gf ? checkAllowlisted(gf) : null;
  const url = gfOk && gfOk.ok ? gfOk.url : trainFirst ? trainlineLink(from, to, date ?? "") : null;
  const site = gfOk && gfOk.ok ? "Google Flights" : trainFirst ? "Trainline" : null;
  const pre = describePrefill(url, site, trip);
  const best = options[0] ?? null;
  const item: PurchaseItem = {
    key: `traslado:${normKey(from)}>${normKey(to)}`, kind: "vuelo", category: trainFirst ? "train" : "flight",
    title: `${from} → ${to}`, subtitle: [isoOk(date) ? fmtDayShort(date) : null, `${travelers} ${travelers === 1 ? "viajero" : "viajeros"}`].filter(Boolean).join(" · "),
    price: best?.pricePp ? best.pricePp * travelers : null, currency: "MXN",
    priceNote: best?.pricePp ? `Estimado: $${best.pricePp.toLocaleString("es-MX")} MXN por persona. Confirma el precio en el sitio.` : null,
    source: { fuente: best ? "estimado" : null, estado: best ? "ESTIMADO" : null, consultadoAt: null }, estimate: true,
    site, url, action: null,
    lleva: trainFirst ? [] : pre.lleva,
    completa: trainFirst ? `Trainline no recibe la ruta por enlace: escribe ${from} → ${to}${isoOk(date) ? ` y el ${fmtDayShort(date)}` : ""}.` : pre.completa,
    buttonLabel: url ? (trainFirst ? "Buscar tren en Trainline" : "Buscar vuelo en Google Flights") : null,
    optional: false, fallbackHref: url ? null : `/dashboard/trenes?origin=${encodeURIComponent(from)}&dest=${encodeURIComponent(to)}${isoOk(date) ? `&date=${date}` : ""}`,
    col: null, index: -1, offer: null, city: to,
  };
  return { kind: "traslado", n, title: `${from} → ${to}`, from, to, date, options, item };
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDayShort = (iso: string) => `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]}`;

export function buildBuyFlow(trip: any, sel: BuySel, server: TripOfferActionsLike = {}, opts: { quoteCreatedAt?: string | null } = {}): BuyFlow {
  // Restaurantes: todos (se agrupan por ciudad en "Reservas opcionales").
  const items = buildPurchasePlan(trip, sel, server, { quoteCreatedAt: opts.quoteCreatedAt, maxRestaurants: 99 });
  const steps: BuyStep[] = [];
  let n = 1;
  const flightItem = items.find((i) => i.kind === "vuelo") ?? null;
  // Multi-destino: un solo boleto de ida a la primera ciudad y regreso desde la última (open-jaw).
  steps.push({ kind: "vuelo", n: n++, title: tripDestinations(trip).length > 1 ? "Vuelo de ida y regreso" : "Vuelo", item: flightItem, options: realFlightOptions(trip), chosen: flightItem?.index ?? -1, skipped: sel.selVuelo === -2 });

  if (hasCityHotels(trip)) {
    const choices = cityHotelChoices(trip, sel);
    choices.forEach((c, k) => {
      const item = items.find((i) => i.kind === "hospedaje" && i.index === c.index) ?? null;
      steps.push({ kind: "hospedaje", n: n++, title: `Hotel en ${c.stay.city}`, city: c.stay.city, stay: c.stay, item,
        options: c.options.slice(0, 3).concat(c.index >= 0 && !c.options.slice(0, 3).includes(c.index) ? [c.index] : []),
        chosen: c.index, skipped: c.index === -2, nights: c.stay.nights });
      // Entre ciudades (París → Roma), el día que se sale de esta ciudad.
      const next = choices[k + 1];
      if (next) steps.push(legStep(trip, c.stay.city, next.stay.city, next.stay.checkin, n++));
    });
  } else {
    const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
    if (hoteles.length) {
      const item = items.find((i) => i.kind === "hospedaje") ?? null;
      const sorted = hoteles.map((h, i) => [h, i] as const).sort((a, b) => (Number(a[0]?.precio_por_noche) || 0) - (Number(b[0]?.precio_por_noche) || 0)).map(([, i]) => i);
      const chosen = item?.index ?? -1;
      const options = sorted.slice(0, 3).concat(chosen >= 0 && !sorted.slice(0, 3).includes(chosen) ? [chosen] : []);
      const nights = Number((item?.offer?.details as any)?.nights) || 0;
      steps.push({ kind: "hospedaje", n: n++, title: "Hotel", city: trip?.destino ?? null, stay: null, item, options, chosen, skipped: sel.selHospedaje === -2, nights });
    }
  }
  const car = items.find((i) => i.kind === "auto") ?? null;
  if (car) steps.push({ kind: "auto", n: n++, title: "Auto (opcional)", item: car });

  const cities = tripDestinations(trip);
  const list = (arr: any[]) => (Array.isArray(arr) ? arr : []);
  const byCity = (arr: any[], city: string, multi: boolean) => list(arr).map((x, i) => [x, i] as const)
    .filter(([x]) => !multi || sameCity(x?.ciudad, city)).map(([, i]) => i);
  const multi = cities.length > 1;
  const extras = (multi ? cities : [cities[0] ?? trip?.destino ?? ""]).map((city) => ({
    city, restaurants: byCity(trip?.restaurantes_json, city, multi), tours: byCity(trip?.tours_json, city, multi),
  })).filter((e) => e.restaurants.length || e.tours.length);
  return { steps, items, extras };
}
