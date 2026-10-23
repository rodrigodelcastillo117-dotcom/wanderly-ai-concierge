// "Comprar" como flujo de elegir y comprar (punto 11 del caso Roma → Florencia → Venecia): por cada
// paso (vuelo, un hotel por ciudad, auto) las opciones que se pueden elegir y la que está elegida, con
// su botón de compra precargado (el elemento de buildPurchasePlan). Reúsa las selecciones de la página
// (selVuelo / selHospedaje / selHoteles / selTours): elegir aquí cambia el total como antes.
import { buildPurchasePlan, realFlightOptions, type PurchaseItem, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { hotelPriceRooms } from "@/lib/quote";
import { sameCity, tripDestinations, type CityStay } from "../../supabase/functions/_shared/booking/tripRoute.ts";

export type BuySel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null };

export type FlightStep = { kind: "vuelo"; n: number; title: string; item: PurchaseItem | null; options: number[]; chosen: number; skipped: boolean };
export type HotelStep = { kind: "hospedaje"; n: number; title: string; city: string | null; stay: CityStay | null; item: PurchaseItem | null;
  options: number[]; chosen: number; skipped: boolean; nights: number };
export type CarStep = { kind: "auto"; n: number; title: string; item: PurchaseItem | null };
export type BuyStep = FlightStep | HotelStep | CarStep;

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

export function buildBuyFlow(trip: any, sel: BuySel, server: TripOfferActionsLike = {}, opts: { quoteCreatedAt?: string | null } = {}): BuyFlow {
  // Restaurantes: todos (se agrupan por ciudad en "Reservas opcionales").
  const items = buildPurchasePlan(trip, sel, server, { quoteCreatedAt: opts.quoteCreatedAt, maxRestaurants: 99 });
  const steps: BuyStep[] = [];
  let n = 1;
  const flightItem = items.find((i) => i.kind === "vuelo") ?? null;
  steps.push({ kind: "vuelo", n: n++, title: "Vuelo", item: flightItem, options: realFlightOptions(trip), chosen: flightItem?.index ?? -1, skipped: sel.selVuelo === -2 });

  if (hasCityHotels(trip)) {
    for (const c of cityHotelChoices(trip, sel)) {
      const item = items.find((i) => i.kind === "hospedaje" && i.index === c.index) ?? null;
      steps.push({ kind: "hospedaje", n: n++, title: `Hotel en ${c.stay.city}`, city: c.stay.city, stay: c.stay, item,
        options: c.options.slice(0, 3).concat(c.index >= 0 && !c.options.slice(0, 3).includes(c.index) ? [c.index] : []),
        chosen: c.index, skipped: c.index === -2, nights: c.stay.nights });
    }
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
