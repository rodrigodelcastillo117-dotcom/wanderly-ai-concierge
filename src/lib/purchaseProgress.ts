// Qué falta para tener el viaje listo (ola «9.5 en todo», 29-oct-2026). Una sola cuenta para «Comprar»
// («0 de 7 reservados · Te falta: …») y para el tablero del Resumen (la lista «Qué falta»): antes cada
// pantalla contaba por su lado. No calcula precios ni inventa estados: sale de los pasos de buildBuyFlow
// y del estado de compra de cada elemento (itemPurchaseState: reserva confirmada o marca «Ya lo compré»).
import type { BuyFlow, BuyStep } from "@/lib/buyFlow";
import type { PurchaseItem, PurchaseState } from "@/lib/purchasePlan";

/** Estado de un paso en la lista «Qué falta». */
export type ChecklistStatus =
  | "reservado" // reserva confirmada con el proveedor
  | "comprado" // la persona lo marcó como comprado
  | "ya_lo_tienes" // dijo que ya lo tiene (no suma al total)
  | "elegido" // eligió una opción; falta comprarla
  | "por_elegir" // hay opciones y aún no elige
  | "por_comprar" // traslado entre ciudades: la opción de la cotización, falta comprarla
  | "sin_precio"; // sin opciones con precio real: se busca en el sitio

export type ChecklistRow = {
  /** id del paso en «Comprar» (paso-1, paso-2…): tocar la fila lleva ahí. */
  id: string;
  kind: BuyStep["kind"];
  /** «Vuelo», «Hotel en Roma», «Tren Roma → Florencia». */
  label: string;
  status: ChecklistStatus;
  /** Lo elegido o comprado («Lufthansa», «Hotel Artemide»), si lo hay. */
  detail: string | null;
};

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = {
  reservado: "Reservado",
  comprado: "Comprado",
  ya_lo_tienes: "Ya lo tienes",
  elegido: "Elegido",
  por_elegir: "Por elegir",
  por_comprar: "Falta comprar",
  sin_precio: "Sin precio",
};

/** ¿El paso ya no pide nada (comprado, reservado o «ya lo tengo»)? */
export const CHECKLIST_DONE: ReadonlySet<ChecklistStatus> = new Set<ChecklistStatus>(["reservado", "comprado", "ya_lo_tienes"]);

export type PurchaseProgress = {
  /** Elementos que hay que comprar (los no opcionales y cada traslado entre ciudades). */
  total: number;
  /** De esos, cuántos ya están comprados o reservados. */
  done: number;
  /** Pasos aún sin comprar, en palabras («vuelo», «hotel en Roma», «Roma → Florencia»). */
  falta: string[];
  /** Un renglón por paso (sin el auto opcional). */
  rows: ChecklistRow[];
  stepDone: (s: BuyStep) => boolean;
};

const MODE_WORD: Record<string, string> = { vuelo: "Vuelo", tren: "Tren", coche: "Coche", bus: "Autobús", ferry: "Ferry" };

const stripPrefix = (title: string) => title.replace(/^(Vuelo|Hospedaje) · /, "").trim();

/**
 * Avance de compra del viaje. `state` es itemPurchaseState con las marcas del grupo (o «pendiente» si no
 * hay marcas cargadas).
 */
export function purchaseProgress(flow: Pick<BuyFlow, "steps" | "items">, state: (it: PurchaseItem) => PurchaseState): PurchaseProgress {
  const st = (it: PurchaseItem | null | undefined): PurchaseState => (it ? state(it) : "pendiente");
  const core = [...flow.items.filter((i) => !i.optional), ...flow.steps.flatMap((s) => (s.kind === "traslado" ? [s.item] : []))];
  const done = core.filter((i) => st(i) !== "pendiente").length;
  const stepDone = (s: BuyStep) => ((s.kind === "vuelo" || s.kind === "hospedaje") && s.skipped) || (!!s.item && st(s.item) !== "pendiente");
  const falta = flow.steps
    .filter((s) => s.kind !== "auto" && !stepDone(s))
    .map((s) => (s.kind === "vuelo" || s.kind === "hospedaje" ? s.title.charAt(0).toLowerCase() + s.title.slice(1) : s.title));

  const rows: ChecklistRow[] = [];
  for (const s of flow.steps) {
    if (s.kind === "auto") continue;
    const id = `paso-${s.n}`;
    const bought = s.item ? st(s.item) : "pendiente";
    const boughtStatus: ChecklistStatus | null = bought === "confirmado" ? "reservado" : bought === "marcado" ? "comprado" : null;
    if (s.kind === "traslado") {
      const choice = s.choices.find((c) => c.mode === s.chosen) ?? null;
      const word = choice ? (choice.label || MODE_WORD[choice.mode] || null) : null;
      rows.push({
        id, kind: s.kind, label: `${word ? `${word} ` : ""}${s.from} → ${s.to}`,
        status: boughtStatus ?? "por_comprar",
        detail: choice?.duration ? `${choice.duration} aprox.` : null,
      });
      continue;
    }
    const chosenName = s.item && s.item.index >= 0 ? stripPrefix(s.item.title) : null;
    let status: ChecklistStatus;
    if (s.skipped) status = "ya_lo_tienes";
    else if (boughtStatus) status = boughtStatus;
    else if (s.kind === "vuelo" && s.options.length === 0) status = "sin_precio";
    else if (s.userChosen) status = "elegido";
    else status = "por_elegir";
    const showName = status === "elegido" || status === "comprado" || status === "reservado";
    rows.push({ id, kind: s.kind, label: s.title, status, detail: showName && chosenName && !/^elegir hotel/i.test(chosenName) ? chosenName : null });
  }
  return { total: core.length, done, falta, rows, stepDone };
}
