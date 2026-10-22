/**
 * Selecciones del usuario en TripDetail (vuelo, hospedaje, noches, experiencias) guardadas en
 * trips.selections (E-12). Antes vivían solo en el estado de React y se perdían al recargar.
 *
 * Se guarda el índice Y una llave del elemento elegido: si después se re-analiza el viaje y las
 * opciones cambian, una selección cuyo elemento ya no está se descarta en lugar de apuntar a otra
 * opción distinta. Sin selección (todo por defecto) se guarda null, que es también lo que la base
 * de la cotización considera "sin cambios" (trips_quote_basis_guard).
 */
import type { Selection } from "@/lib/quote";

export type PickedItem = { i: number; key: string | null };

export type PersistedSelections = {
  v: 1;
  vuelo: PickedItem;
  hospedaje: PickedItem;
  noches_hospedaje: number | null;
  tours: Array<{ i: number; key: string }>;
};

export type UiSelection = Omit<Selection, "nochesHospedaje"> & { nochesHospedaje: number | null };

export const DEFAULT_SELECTION: UiSelection = { selVuelo: -1, selHospedaje: -1, nochesHospedaje: null, selTours: new Set() };

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Llave estable de una opción: nombre/aerolínea + ciudad + precio. */
export function itemKey(item: any): string {
  if (!item || typeof item !== "object") return "";
  const name = item.nombre ?? item.aerolinea ?? item.titulo ?? item.naviera ?? "";
  const price = item.precio_por_persona ?? item.precio_por_noche ?? item.precio_total ?? "";
  return [norm(name), norm(item.numero_vuelo ?? ""), norm(item.ciudad ?? item.to ?? ""), String(price)].join("|");
}

const pick = (list: any[] | undefined, i: number): PickedItem =>
  i >= 0 ? { i, key: itemKey(list?.[i]) || null } : { i: i === -2 ? -2 : -1, key: null };

/** Lo que se guarda en trips.selections. null si todo está por defecto. */
export function serializeSelections(trip: any, sel: UiSelection): PersistedSelections | null {
  const tours = [...sel.selTours].filter((i) => i >= 0).sort((a, b) => a - b);
  const isDefault = sel.selVuelo === -1 && sel.selHospedaje === -1 && sel.nochesHospedaje == null && tours.length === 0;
  if (isDefault) return null;
  return {
    v: 1,
    vuelo: pick(trip?.vuelos_json, sel.selVuelo),
    hospedaje: pick(trip?.hospedaje_json, sel.selHospedaje),
    noches_hospedaje: sel.nochesHospedaje == null ? null : Math.max(0, Math.round(Number(sel.nochesHospedaje) || 0)),
    tours: tours.map((i) => ({ i, key: itemKey(trip?.tours_json?.[i]) })),
  };
}

/** Índice vigente de una selección guardada: mismo índice si la llave coincide; si no, se busca. */
function resolvePick(list: any[] | undefined, p: PickedItem | undefined): number {
  if (!p || typeof p.i !== "number") return -1;
  if (p.i === -2) return -2;
  if (p.i < 0) return -1;
  const arr = Array.isArray(list) ? list : [];
  if (!p.key) return p.i < arr.length ? p.i : -1;
  if (arr[p.i] && itemKey(arr[p.i]) === p.key) return p.i;
  const found = arr.findIndex((x) => itemKey(x) === p.key);
  return found;
}

/** Selección de la UI a partir de lo guardado (o por defecto si no hay nada o ya no aplica). */
export function restoreSelections(trip: any, raw: unknown): UiSelection {
  const s = raw as Partial<PersistedSelections> | null | undefined;
  if (!s || typeof s !== "object" || s.v !== 1) return { ...DEFAULT_SELECTION, selTours: new Set() };
  const tours = new Set<number>();
  const list: any[] = Array.isArray(trip?.tours_json) ? trip.tours_json : [];
  for (const t of Array.isArray(s.tours) ? s.tours : []) {
    const i = resolvePick(list, { i: t?.i, key: t?.key ?? null });
    if (i >= 0) tours.add(i);
  }
  const noches = s.noches_hospedaje;
  return {
    selVuelo: resolvePick(trip?.vuelos_json, s.vuelo),
    selHospedaje: resolvePick(trip?.hospedaje_json, s.hospedaje),
    nochesHospedaje: typeof noches === "number" && Number.isFinite(noches) ? noches : null,
    selTours: tours,
  };
}

/** Igualdad de dos selecciones guardadas (null/undefined = sin selección). */
export function sameSelections(a: unknown, b: unknown): boolean {
  const canon = (x: unknown) => {
    if (!x || typeof x !== "object") return "null";
    const s = x as PersistedSelections;
    return JSON.stringify([s.vuelo?.i ?? -1, s.vuelo?.key ?? null, s.hospedaje?.i ?? -1, s.hospedaje?.key ?? null,
      s.noches_hospedaje ?? null, (s.tours ?? []).map((t) => [t.i, t.key])]);
  };
  return canon(a) === canon(b);
}

const LOCAL_PREFIX = "iatos_trip_selections_";

/** Respaldo local mientras la columna trips.selections no exista en producción. */
export function readLocalSelections(tripId: string): unknown {
  try { const raw = localStorage.getItem(LOCAL_PREFIX + tripId); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function writeLocalSelections(tripId: string, value: PersistedSelections | null) {
  try {
    if (value) localStorage.setItem(LOCAL_PREFIX + tripId, JSON.stringify(value));
    else localStorage.removeItem(LOCAL_PREFIX + tripId);
  } catch { /* modo privado */ }
}
