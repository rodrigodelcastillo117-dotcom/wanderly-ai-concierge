// "Ya lo reservé" compartido en el viaje (r2 grupo). Cada marca vive en public.trip_purchase_marks: una
// por (viaje, elemento), con quién la puso y cuándo, visible para el dueño y los colaboradores. La base
// pone el nombre y la fecha (no el cliente). Si la tabla aún no existe (migración pendiente), se usa lo
// de antes: las filas propias de bookings con raw_payload.compra_item (solo las ve quien marcó).
import type { PurchaseMarkRow } from "@/lib/purchasePlan";

export type TripPurchaseMarkRow = {
  id: string;
  trip_id: string;
  item_key: string;
  category: string | null;
  marked_by: string | null;
  marked_by_name: string | null;
  marked_at: string;
};

/** Una marca tal como la muestra la tarjeta, venga de la tabla del grupo o de bookings (modo anterior). */
export type GroupMark = {
  key: string;
  /** id de la fila en trip_purchase_marks (source "grupo") o en bookings (source "propia"). */
  id: string | null;
  markedBy: string | null;
  name: string | null;
  at: string | null;
  source: "grupo" | "propia";
};

export const MARKS_COLUMNS = "id, trip_id, item_key, category, marked_by, marked_by_name, marked_at";

export function marksFromGroup(rows: TripPurchaseMarkRow[] | null | undefined): Map<string, GroupMark> {
  const m = new Map<string, GroupMark>();
  for (const r of rows ?? []) {
    if (!r || typeof r.item_key !== "string") continue;
    m.set(r.item_key, { key: r.item_key, id: r.id ?? null, markedBy: r.marked_by ?? null, name: r.marked_by_name ?? null, at: r.marked_at ?? null, source: "grupo" });
  }
  return m;
}

/** Modo anterior: las marcas propias guardadas en bookings (las únicas que RLS deja leer). */
export function marksFromBookings(rows: PurchaseMarkRow[] | null | undefined, userId: string | null): Map<string, GroupMark> {
  const m = new Map<string, GroupMark>();
  for (const r of rows ?? []) {
    const k = r?.raw_payload?.compra_item;
    if (typeof k !== "string" || !k || r.status === "cancelled" || m.has(k)) continue;
    const at = typeof r.raw_payload?.marcado_at === "string" ? r.raw_payload.marcado_at : (r.created_at ?? null);
    m.set(k, { key: k, id: r.id ?? null, markedBy: (r as any).user_id ?? userId, name: null, at, source: "propia" });
  }
  return m;
}

/** Marcas propias que están en bookings y todavía no en la tabla del grupo (hechas con la app anterior). */
export function pendingGroupCopies(rows: PurchaseMarkRow[] | null | undefined, group: Map<string, GroupMark>, userId: string | null) {
  if (!userId) return [];
  const out: { item_key: string; category: string | null }[] = [];
  for (const mk of marksFromBookings(rows, userId).values()) {
    if (mk.markedBy !== userId || group.has(mk.key)) continue;
    const row = (rows ?? []).find((r) => r?.raw_payload?.compra_item === mk.key);
    const cat = row?.category && ["flight", "hotel", "car", "activity", "restaurant"].includes(row.category) ? row.category : null;
    out.push({ item_key: mk.key, category: cat });
  }
  return out;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha corta en español: "22 oct"; con año si no es el año en curso ("3 dic 2025"). */
export function shortMarkDate(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const base = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Quién lo marcó, en español y sin datos de más. */
export function markerName(mark: GroupMark, userId: string | null): string {
  const n = (mark.name ?? "").trim();
  if (n) return n;
  if (mark.markedBy && mark.markedBy === userId) return "tú";
  return "alguien del viaje";
}

/** "Ya lo compré · Ana · 22 oct" (antes "Ya lo reservé": mismo verbo que el botón). */
export function markLabel(mark: GroupMark, userId: string | null, now = new Date()): string {
  return ["Ya lo compré", markerName(mark, userId), shortMarkDate(mark.at, now)].filter(Boolean).join(" · ");
}

/** Quitar una marca: quien la puso o el dueño del viaje (la base lo vuelve a comprobar). */
export function canUnmark(mark: GroupMark, userId: string | null, ownerId: string | null | undefined): boolean {
  if (!userId) return false;
  if (mark.source === "propia") return true;
  return mark.markedBy === userId || (!!ownerId && ownerId === userId);
}
