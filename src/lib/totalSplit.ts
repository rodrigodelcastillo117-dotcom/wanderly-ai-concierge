// Total del viaje separado en lo que tiene precio REAL y lo que es estimado (caso CDMX → Tepoztlán,
// 27-oct-2026: "$37,350" mezclaba un hotel en vivo con comida, experiencias, transporte local y extras que
// estimó la IA, y el coche "$1,800" inventado). No calcula precios nuevos: reparte los renglones de
// computeTripDesglose (la misma cifra de la página) según la fuente de cada uno:
//  - real: vuelo o tarifa con precio verificable (no estimado), hotel con precio en vivo, casetas de
//    Google (también la parte de casetas del coche) y experiencias con precio en vivo;
//  - estimado: comida, transporte local, extras, gasolina, experiencias sin precio real y todo lo que
//    venga de la IA.
import type { PurchaseItem } from "@/lib/purchasePlan";
import { arrivalByLand, carCostFor } from "@/lib/groundTrip";
import { transportRubroLabel } from "@/lib/multiDestTrip";

export type SplitPart = { key: string; label: string; amount: number };
export type TotalSplit = { total: number; real: number; estimado: number; realParts: SplitPart[]; estParts: SplitPart[] };

const LABEL: Record<string, string> = {
  vuelos: "vuelo", hospedaje: "hotel", comida: "comida", tours: "experiencias", transporte_local: "transporte local", extras: "extras", casetas: "casetas",
};
const isReal = (it: PurchaseItem | undefined | null) => !!it && Number(it.price) > 0 && !it.estimate;
const LIVE = new Set(["CONSULTADO_EN_VIVO", "VERIFICADO", "CONFIRMADO"]);

export function splitTripTotal(a: { trip: any; sel: { selVuelo: number; selTours: Set<number> | number[] }; desglose: Record<string, number>; items: PurchaseItem[] }): TotalSplit {
  const realParts: SplitPart[] = [];
  const estParts: SplitPart[] = [];
  const d = a.desglose ?? {};
  const label = (k: string) => (k === "transporte_local" ? transportRubroLabel(a.trip).toLowerCase() : LABEL[k] ?? k);
  const push = (list: SplitPart[], key: string, amount: number, lab = label(key)) => {
    const n = Math.round(amount);
    if (n > 0) list.push({ key, label: lab, amount: n });
  };
  for (const [k, raw] of Object.entries(d)) {
    const amount = Math.round(Number(raw) || 0);
    if (!(amount > 0)) continue;
    if (k === "vuelos") {
      const flight = a.items.find((i) => i.kind === "vuelo" && i.col === "vuelos_json" && i.index === a.sel.selVuelo)
        ?? a.items.find((i) => i.kind === "vuelo" && i.col === "vuelos_json") ?? a.items.find((i) => i.kind === "vuelo");
      const row = flight && flight.col === "vuelos_json" ? a.trip?.vuelos_json?.[flight.index] : null;
      const car = row ? carCostFor(a.trip, row) : null;
      if (car && Math.round(car.total_mxn ?? -1) === amount) {
        // Coche: las casetas de Google son reales; la gasolina, estimada.
        push(realParts, "casetas_coche", car.real_mxn, "casetas");
        push(estParts, "gasolina", amount - Math.round(car.real_mxn), "gasolina");
      } else if (isReal(flight) && Math.abs(Number(flight!.price) - amount) <= 2) push(realParts, k, amount);
      else push(estParts, k, amount);
      continue;
    }
    if (k === "hospedaje") {
      const hotels = a.items.filter((i) => i.kind === "hospedaje");
      const sum = hotels.reduce((s, h) => s + (Number(h.price) || 0), 0);
      if (hotels.length && hotels.every(isReal) && Math.abs(sum - amount) <= hotels.length * 2) push(realParts, k, amount);
      else push(estParts, k, amount);
      continue;
    }
    if (k === "casetas") { push(realParts, k, amount); continue; }
    if (k === "tours") {
      const tours: any[] = Array.isArray(a.trip?.tours_json) ? a.trip.tours_json : [];
      const chosen = Array.from(a.sel.selTours ?? []);
      const allLive = chosen.length > 0 && chosen.every((i) => LIVE.has(String(tours[i]?.estado_dato ?? "").toUpperCase()));
      push(allLive ? realParts : estParts, k, amount);
      continue;
    }
    push(estParts, k, amount);
  }
  const real = realParts.reduce((s, p) => s + p.amount, 0);
  const estimado = estParts.reduce((s, p) => s + p.amount, 0);
  return { total: real + estimado, real, estimado, realParts, estParts };
}

/** "comida, transporte local y extras" */
export function partsList(parts: SplitPart[]): string {
  const xs = [...new Set(parts.map((p) => p.label))];
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Nombres de los rubros del desglose para este viaje: "Cómo llegar" en lugar de "Vuelos" cuando se
 * llega por tierra (caso E2E 28-oct-2026, Valle de Bravo: "Vuelos · estimado $1,685" era el coche).
 */
export function budgetLabels(trip: any): Record<string, string> {
  return { transporte_local: transportRubroLabel(trip), ...(arrivalByLand(trip) ? { vuelos: "Cómo llegar" } : {}) };
}

/**
 * ¿La barra "consultado en vivo · estimado" de la cotización dice lo mismo que el reparto del total
 * ("Total con precios reales")? Si no (p. ej. las casetas reales del coche cuentan como reales en uno y
 * como estimado en el otro), la barra se oculta para no mostrar dos cifras "reales" distintas.
 */
export function trustMatchesSplit(trust: { verified: number }, split: TotalSplit | null | undefined): boolean {
  if (!split || !(split.estimado > 0)) return true;
  return Math.abs(Math.round(trust.verified) - Math.round(split.real)) <= 2;
}

/**
 * Línea «De eso, $X con precio en vivo y $Y estimado». Un precio consultado hace más de 24 h ya no se llama
 * «en vivo» (R4 viajes P2-7, Valle de Bravo: «$6,592 MXN con precio en vivo» con precios de hace 27 h):
 * con `age` («hace 27 h») dice «con precio consultado hace 27 h». null si no hay nada real que separar.
 */
export function splitRealText(split: Pick<TotalSplit, "real" | "estimado">, money: (n: number) => string, age?: string | null): string | null {
  if (!(split.real > 0) || !(split.estimado > 0)) return null;
  return `De eso, ${money(split.real)} ${age ? `con precio consultado ${age}` : "con precio en vivo"} y ${money(split.estimado)} estimado.`;
}
