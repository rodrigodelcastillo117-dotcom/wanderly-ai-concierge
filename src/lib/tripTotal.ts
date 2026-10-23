// Un solo total en la página del viaje (caso Roma → Florencia → Venecia, 23-oct-2026): el dueño veía
// "TOTAL DE TU VIAJE $542,407" con la nota "cotización de $561,468" y, en el desglose, "TOTAL ESTIMADO
// $542,407": dos totales casi iguales y no sabía cuál era real. Aquí se decide qué dice ESE único total
// según lo que la persona eligió en "Comprar" y lo que ya compró:
//  - "estimado": falta elegir vuelo u hoteles → "Total estimado · elige … para ver el total real".
//  - "seleccion": todo elegido → "Total de tu selección" (y en qué rubros el precio es estimado).
//  - "comprado": hay marcas de "Ya lo compré" o reservas confirmadas → "Ya compraste $X · Falta $Y".
// No calcula precios: la cifra es la de computeTripDesglose (quote.ts) y lo comprado sale de los
// elementos de buildBuyFlow/buildPurchasePlan con su estado (itemPurchaseState).
import { cityHotelChoices, hasCityHotels } from "@/lib/cityHotels";
import { provenanceOf } from "@/lib/provenance";
import type { PurchaseItem, PurchaseState } from "@/lib/purchasePlan";

export type TotalState = "estimado" | "seleccion" | "comprado";

export type TripTotalSummary = {
  state: TotalState;
  /** El total del viaje (la suma del desglose con la selección actual). */
  total: number;
  /** ¿Ya eligió vuelo y un hotel por ciudad (o dijo que ya los tiene)? */
  complete: boolean;
  /** Lo que falta elegir: "vuelo", "hotel en Florencia"… */
  missing: string[];
  /** Renglones sin precio ("por cotizar"): no están sumados en el total. */
  porCotizar: string[];
  /** Rubros cuyo precio es estimado o de referencia ("comida", "transporte local"…). */
  estimatedIn: string[];
  /** Claves del desglose con precio estimado (para marcarlas en el desglose). */
  estimatedKeys: string[];
  /**
   * Vuelo u hospedaje que el total suma SIN un precio verificable (estimado por la IA o sin tarifa
   * real): "vuelos", "hospedaje". La página, Comprar y el PDF lo dicen junto al total.
   */
  sinPrecioReal: string[];
  /** "Incluye estimados: vuelos." (o "" si todo lo grande tiene precio verificable). */
  estimadosNote: string;
  /** Lo marcado como comprado o confirmado (MXN) y lo que falta pagar. */
  paid: number;
  pending: number;
  boughtCount: number;
  /** Título del total ("Total estimado", "Total de tu selección"). */
  title: string;
  /** Una línea bajo la cifra. */
  hint: string;
  /** Texto de la barra móvil inferior (misma cifra): "Total $X MXN · estimado". */
  barLabel: string;
  /** La barra en dos renglones (en el celular no cabe en uno): "Total $X MXN" y "Estimado · falta elegir". */
  barTotal: string;
  barNote: string;
};

type Sel = { selVuelo: number; selHospedaje: number; selTours: Set<number> | number[]; selHoteles?: Record<string, number> | null };

export type TripTotalInput = {
  trip: any;
  sel: Sel;
  /** computeTripDesglose con la selección actual. */
  desglose: Record<string, number>;
  /** Elementos de "Comprar mi viaje" (buildBuyFlow(...).items). */
  items: PurchaseItem[];
  /** Estado de compra de cada elemento (itemPurchaseState con las marcas del grupo). */
  itemState?: (it: PurchaseItem) => PurchaseState;
  /** Renglones que la cotización dejó "por cotizar" (trip_quotes.sources.por_cotizar). */
  porCotizar?: string[] | null;
  now?: Date;
};

export const fmtTotalMXN = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

const trusted = (src: { fuente?: unknown; estado?: unknown; consultadoAt?: unknown; approximateDates?: unknown }, now: Date) =>
  provenanceOf({
    source: (src.fuente as string) ?? null, estado: (src.estado as string) ?? null,
    consultadoAt: (src.consultadoAt as string) ?? null, approximateDates: !!src.approximateDates,
  }, now).trusted;

const hotelTrusted = (h: any, now: Date) =>
  trusted({ fuente: h?.fuente_precio ?? h?.fuente, estado: h?.estado_dato, consultadoAt: h?.consultado_at }, now);

/** "a", "a y b", "a, b y c". */
export function listaHumana(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

export function tripTotalSummary({ trip, sel, desglose, items, itemState, porCotizar: pendingKeys, now = new Date() }: TripTotalInput): TripTotalSummary {
  const total = Object.values(desglose ?? {}).reduce((s: number, v) => s + (Number(v) || 0), 0);
  const state = (it: PurchaseItem): PurchaseState => (itemState ? itemState(it) : "pendiente");
  const bought = items.filter((it) => state(it) !== "pendiente" && !(it.optional && !(Number(it.price) > 0)));
  const boughtKeys = new Set(bought.map((b) => b.key));
  const isBought = (kind: PurchaseItem["kind"], index?: number) =>
    items.some((it) => it.kind === kind && (index == null || it.index === index) && boughtKeys.has(it.key));

  // ── Qué falta elegir ──────────────────────────────────────────────────────────────────────
  const missing: string[] = [];
  const flightItem = items.find((i) => i.kind === "vuelo") ?? null;
  if (sel.selVuelo === -1 && flightItem && !isBought("vuelo")) missing.push("vuelo");
  const hotels: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const multi = hasCityHotels(trip);
  const choices = multi ? cityHotelChoices(trip, sel) : [];
  const hotelMissing: string[] = [];
  if (multi) {
    for (const c of choices) {
      if (!c.chosen && c.options.length > 0 && !isBought("hospedaje", c.index)) hotelMissing.push(`hotel en ${c.stay.city}`);
    }
  } else if (hotels.length && sel.selHospedaje === -1 && !isBought("hospedaje")) {
    hotelMissing.push("hotel");
  }
  // "vuelo y hoteles" cuando no ha elegido ningún hotel de varias ciudades.
  if (multi && hotelMissing.length > 1 && hotelMissing.length === choices.filter((c) => c.options.length > 0).length) missing.push("hoteles");
  else missing.push(...hotelMissing);
  // Por cotizar: sin precio (y no "ya lo tengo"); si la persona ya eligió una opción con precio, ya no falta.
  const porCotizar: string[] = [];
  const skippedHotels = sel.selHospedaje === -2 || (multi && choices.length > 0 && choices.every((c) => c.index === -2));
  for (const k of pendingKeys ?? []) {
    if (Number(desglose?.[k]) > 0) continue;
    if (k === "vuelos" && sel.selVuelo !== -2) porCotizar.push("el vuelo");
    if (k === "hospedaje" && !skippedHotels) porCotizar.push("el hospedaje");
  }
  const complete = missing.length === 0 && porCotizar.length === 0;

  // ── Qué parte del total es estimada ───────────────────────────────────────────────────────
  const estimatedIn: string[] = [];
  const estimatedKeys: string[] = [];
  const est = (key: string, label: string) => {
    if (!(Number(desglose?.[key]) > 0)) return;
    if (!estimatedKeys.includes(key)) estimatedKeys.push(key);
    if (!estimatedIn.includes(label)) estimatedIn.push(label);
  };
  if (Number(desglose?.vuelos) > 0) {
    const v = sel.selVuelo >= 0 ? trip?.vuelos_json?.[sel.selVuelo] : null;
    const chosenFlight = v ? items.find((i) => i.kind === "vuelo" && i.index === sel.selVuelo) : null;
    const ok = !!chosenFlight && !chosenFlight.estimate && trusted({
      fuente: chosenFlight.source.fuente, estado: chosenFlight.source.estado, consultadoAt: chosenFlight.source.consultadoAt, approximateDates: chosenFlight.source.approximateDates,
    }, now);
    if (!ok) est("vuelos", "vuelo");
  }
  if (Number(desglose?.hospedaje) > 0) {
    if (multi) {
      const anySel = sel.selHospedaje !== -1 || Object.keys(sel.selHoteles ?? {}).length > 0;
      if (!anySel) est("hospedaje", "hoteles");
      else for (const c of choices) if (c.index >= 0 && c.hotel && !hotelTrusted(c.hotel, now)) est("hospedaje", `hotel en ${c.stay.city}`);
    } else {
      const h = sel.selHospedaje >= 0 ? hotels[sel.selHospedaje] : null;
      if (!h || !hotelTrusted(h, now)) est("hospedaje", "hotel");
    }
  }
  est("comida", "comida");
  est("transporte_local", "transporte local");
  const tours: any[] = Array.isArray(trip?.tours_json) ? trip.tours_json : [];
  const selTours = Array.from(sel.selTours ?? []);
  if (!selTours.length || selTours.some((i) => !trusted({ fuente: tours[i]?.fuente, estado: tours[i]?.estado_dato, consultadoAt: tours[i]?.consultado_at }, now))) {
    est("tours", "experiencias");
  }
  est("extras", "extras");

  // ── Ya comprado ───────────────────────────────────────────────────────────────────────────
  const paidRaw = bought.reduce((s, it) => s + (Number(it.price) > 0 ? Number(it.price) : 0), 0);
  const paid = Math.min(Math.round(paidRaw), Math.round(total));
  const pending = Math.max(0, Math.round(total) - paid);
  const state_: TotalState = bought.length > 0 ? "comprado" : complete ? "seleccion" : "estimado";

  const sinPrecioReal = unverifiedInTotal(desglose, items, sel);
  const estimadosNote = sinPrecioReal.length ? `Incluye estimados: ${listaHumana(sinPrecioReal)}.` : "";
  const title = complete ? "Total de tu selección" : "Total estimado";
  const faltaCotizar = porCotizar.length ? `Falta cotizar ${listaHumana(porCotizar)}: no está sumado al total.` : "";
  const hint = complete
    ? estimatedIn.length ? `Incluye precios estimados en: ${listaHumana(estimatedIn)}.` : "Con los precios consultados de lo que elegiste."
    : [missing.length ? `Elige ${listaHumana(missing)} para ver el total real.` : "", faltaCotizar, estimadosNote].filter(Boolean).join(" ");
  const barLabel = state_ === "comprado"
    ? `Total ${fmtTotalMXN(total)} · falta ${fmtTotalMXN(pending)}`
    : `Total ${fmtTotalMXN(total)} · ${complete ? "tu selección" : "estimado"}`;

  const barTotal = `Total ${fmtTotalMXN(total)}`;
  const barNote = state_ === "comprado" ? `Falta ${fmtTotalMXN(pending)} · ya compraste ${fmtTotalMXN(paid)}`
    : complete ? (sinPrecioReal.length ? "Tu selección · incluye estimados" : "Tu selección") : porCotizar.length && !missing.length ? `Estimado · falta cotizar ${listaHumana(porCotizar)}` : "Estimado · falta elegir";
  return { state: state_, total, complete, missing, porCotizar, estimatedIn, estimatedKeys, sinPrecioReal, estimadosNote, paid, pending, boughtCount: bought.length, title, hint, barLabel, barTotal, barNote };
}

/**
 * Vuelo y hospedaje que el total suma sin precio verificable (caso Roma → Florencia → Venecia: el
 * total incluía "Vuelos · estimado $49,530" de la IA mientras Comprar decía "Aún no tenemos precio
 * real"). Verificable = el elemento de Comprar que corresponde tiene precio y no es un estimado.
 */
export function unverifiedInTotal(desglose: Record<string, number>, items: PurchaseItem[], sel: Pick<Sel, "selVuelo">): string[] {
  const real = (it: PurchaseItem | undefined) => !!it && Number(it.price) > 0 && !it.estimate;
  const out: string[] = [];
  const flight = items.find((i) => i.kind === "vuelo" && i.col === "vuelos_json") ?? items.find((i) => i.kind === "vuelo");
  if (Number(desglose?.vuelos) > 0 && sel.selVuelo !== -2 && !real(flight)) out.push("vuelos");
  const hotels = items.filter((i) => i.kind === "hospedaje");
  if (Number(desglose?.hospedaje) > 0 && (!hotels.length || !hotels.every(real))) out.push("hospedaje");
  return out;
}
