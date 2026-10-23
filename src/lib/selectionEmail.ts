// "Enviarme mi selección por correo": arma lo que se manda a enviar-seleccion con las MISMAS funciones
// de la página (buildBuyFlow / buildPurchasePlan para los botones de compra, cityHotelChoices y
// computeTripDesglose para los precios y el total). Así el correo lleva exactamente el vuelo, los hoteles
// y las experiencias elegidas, con el total de la página. El servidor vuelve a comprobar todo contra la
// fila del viaje (_shared/selection-email.ts) y pone los nombres.
import { buildBuyFlow } from "@/lib/buyFlow";
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { itemPurchaseState, realFlightOptions, type PurchaseItem, type PurchaseMarkRow, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { flightDurationLabel, flightStopsLabel } from "@/lib/flightDisplay";
import type { SelectionRequest, SelectionRequestItem } from "../../supabase/functions/_shared/selection-email.ts";

export type SelectionSel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null };

export type SelectionContext = {
  /** Viajeros con que la página calcula el total (quoteTravelers). */
  travelers: number;
  /** Noches del hotel en un viaje de un destino (nochesEfectivas). */
  nights: number;
  /** computeTripDesglose de la página con la selección. */
  desglose: Record<string, number>;
  /** Total que muestra la página (tripTotals(...).total). */
  total: number;
  serverOffers?: TripOfferActionsLike;
  quoteCreatedAt?: string | null;
  /** Filas de bookings y marcas del grupo (useTripPurchaseMarks), para "Ya lo compré". */
  rows?: PurchaseMarkRow[];
  marks?: { has(key: string): boolean } | null;
};

export type SelectionPayload = Omit<SelectionRequest, "trip_id" | "to" | "member_ids">;

export type SelectionReadiness = {
  /** true si ya eligió vuelo y hotel (o dijo que ya los tiene) y hay algo que mandar. */
  ready: boolean;
  /** Lo que falta elegir: "tu vuelo", "hotel en Atenas". */
  missing: string[];
  payload: SelectionPayload | null;
};

export const SEND_LABEL = "Enviarme mi selección por correo";
export const NOT_READY_LABEL = "Elige tu vuelo y hotel para enviarte el resumen";

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

function requestItem(it: PurchaseItem | null | undefined, kind: SelectionRequestItem["kind"], index: number, extra: Partial<SelectionRequestItem>, bought: boolean): SelectionRequestItem {
  return {
    kind, index, key: it?.key ?? `${kind}:${index}`,
    subtitle: it?.subtitle ?? null, url: it?.url ?? null, site: it?.site ?? null, lleva: it?.lleva ?? [], bought,
    ...extra,
  };
}

/**
 * Qué falta elegir y, si ya está, la petición para enviar-seleccion. Sin vuelo y hotel elegidos (o
 * "ya lo tengo") no hay petición: el botón dice "Elige tu vuelo y hotel…" y no se manda nada.
 */
export function buildSelectionRequest(trip: any, sel: SelectionSel, ctx: SelectionContext): SelectionReadiness {
  if (!trip) return { ready: false, missing: ["tu vuelo", "tu hotel"], payload: null };
  const travelers = Math.max(1, Math.round(Number(ctx.travelers) || 1));
  const tours = new Set(Array.from(sel.selTours ?? []));
  const flow = buildBuyFlow(trip, { ...sel, selTours: tours }, ctx.serverOffers ?? {}, { quoteCreatedAt: ctx.quoteCreatedAt });
  const rows = ctx.rows ?? [];
  const state = (it: PurchaseItem | null | undefined) => (it ? itemPurchaseState(it, rows, ctx.marks ?? null) : "pendiente");
  const vuelos: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
  const hoteles: any[] = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
  const desglose = ctx.desglose ?? {};

  const missing: string[] = [];
  const items: SelectionRequestItem[] = [];
  const skipped: NonNullable<SelectionPayload["skipped"]> = [];

  // 1 · Vuelo: hace falta elegirlo si hay tarifas reales que elegir.
  if (sel.selVuelo === -2) skipped.push({ kind: "vuelo" });
  else if (sel.selVuelo >= 0 && vuelos[sel.selVuelo]) {
    const v = vuelos[sel.selVuelo];
    const it = flow.items.find((x) => x.kind === "vuelo" && x.index === sel.selVuelo);
    const price = num(desglose.vuelos);
    items.push(requestItem(it, "vuelo", sel.selVuelo, {
      price, facts: [flightStopsLabel(v), flightDurationLabel(v)].filter((x): x is string => !!x),
    }, state(it) !== "pendiente"));
  } else if (realFlightOptions(trip).length) missing.push("tu vuelo");

  // 2 · Hotel: uno por ciudad en multi-destino, con las noches de esa ciudad.
  if (hasCityHotels(trip)) {
    // Un hotel por estancia y en orden (como buildBuyFlow): la misma ciudad dos veces (Delhi al llegar y
    // al final) son dos estancias, cada una con su elemento de "Comprar" (su clave y su "Ya lo compré").
    const hotelItems = flow.items.filter((x) => x.kind === "hospedaje");
    for (const c of cityHotelChoices({ ...trip, num_viajeros: travelers }, sel)) {
      const own = c.index >= 0 && c.hotel ? hotelItems.shift() : undefined;
      if (c.index === -2) { skipped.push({ kind: "hospedaje", city: c.stay.city }); continue; }
      if (!c.chosen) { if (c.options.length) missing.push(`hotel en ${c.stay.city}`); continue; }
      if (c.index < 0 || !c.hotel) continue;
      const it = own && own.index === c.index ? own : flow.items.find((x) => x.kind === "hospedaje" && x.index === c.index);
      items.push(requestItem(it, "hospedaje", c.index, { price: c.total, nights: c.stay.nights }, state(it) !== "pendiente"));
    }
  } else if (hoteles.length) {
    if (sel.selHospedaje === -2) skipped.push({ kind: "hospedaje" });
    else if (sel.selHospedaje >= 0 && hoteles[sel.selHospedaje]) {
      const it = flow.items.find((x) => x.kind === "hospedaje" && x.index === sel.selHospedaje);
      items.push(requestItem(it, "hospedaje", sel.selHospedaje, { price: num(desglose.hospedaje), nights: Math.max(0, Math.round(Number(ctx.nights) || 0)) }, state(it) !== "pendiente"));
    } else missing.push("tu hotel");
  }

  // 3 · Experiencias marcadas ("Sumar al total").
  const toursList: any[] = Array.isArray(trip.tours_json) ? trip.tours_json : [];
  for (const i of [...tours].filter((i) => i >= 0 && toursList[i]).sort((a, b) => a - b)) {
    const pp = num(toursList[i]?.precio_por_persona);
    const it = flow.items.find((x) => x.kind === "actividad" && x.index === i);
    items.push(requestItem(it, "actividad", i, { price: pp ? pp * travelers : null }, state(it) !== "pendiente"));
  }

  // 4 · Restaurantes y auto: solo los que marcó como reservados ("Ya lo compré").
  for (const it of flow.items.filter((x) => x.kind === "restaurante" && state(x) !== "pendiente")) items.push(requestItem(it, "restaurante", it.index, { price: null }, true));
  const car = flow.items.find((x) => x.kind === "auto");
  if (car && state(car) !== "pendiente") items.push(requestItem(car, "auto", -1, { price: null }, true));

  // 5 · Lo que suma al total de la página sin ser algo elegido (comida estimada de la cotización…).
  const covered: Record<string, boolean> = {
    vuelos: items.some((x) => x.kind === "vuelo"), hospedaje: items.some((x) => x.kind === "hospedaje"), tours: items.some((x) => x.kind === "actividad"),
  };
  const estimates = Object.entries(desglose)
    .filter(([cat, v]) => !covered[cat] && Math.round(Number(v) || 0) > 0)
    .map(([category, v]) => ({ category, amount: Math.round(Number(v)) }));

  const chosen = items.some((x) => x.kind === "vuelo" || x.kind === "hospedaje");
  if (!chosen && !missing.length) missing.push("tu vuelo o tu hotel");
  const ready = missing.length === 0 && chosen;
  return {
    ready, missing,
    payload: ready ? { travelers, total: Math.round(Number(ctx.total) || 0), items, estimates, skipped } : null,
  };
}
