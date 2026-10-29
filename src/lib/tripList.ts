// Agrupa "Mis viajes" (pura, para probarla): próximos y en curso primero, ordenados por fecha de
// salida (los que no tienen fecha al final); los terminados aparte, del más reciente al más viejo.
import { isTripEnded } from "@/lib/activeTrip";
import { shortTripName } from "@/lib/tripName";

type T = { id: string; fecha_salida?: string | null; fecha_regreso?: string | null; created_at?: string | null };

export type TripGroup<X> = { key: "proximos" | "pasados"; title: string; trips: X[] };

export function groupTripsForList<X extends T>(trips: X[], today: string): TripGroup<X>[] {
  const upcoming: X[] = [];
  const past: X[] = [];
  for (const t of trips) (isTripEnded(t as any, today) ? past : upcoming).push(t);
  upcoming.sort((a, b) => String(a.fecha_salida ?? "9999").localeCompare(String(b.fecha_salida ?? "9999")));
  past.sort((a, b) => String(b.fecha_regreso ?? b.fecha_salida ?? "").localeCompare(String(a.fecha_regreso ?? a.fecha_salida ?? "")));
  const groups: TripGroup<X>[] = [];
  if (upcoming.length) groups.push({ key: "proximos", title: "Próximos y en curso", trips: upcoming });
  if (past.length) groups.push({ key: "pasados", title: "Viajes pasados", trips: past });
  return groups;
}

/** Filtro simple de «Mis viajes» (R2: 24 viajes sin filtros). */
export type TripListFilter = "todos" | "proximos" | "pasados";
export const TRIP_LIST_FILTERS: { id: TripListFilter; label: string }[] = [
  { id: "proximos", label: "Próximos" },
  { id: "pasados", label: "Pasados" },
  { id: "todos", label: "Todos" },
];

export function filterTripGroups<X>(groups: TripGroup<X>[], filter: TripListFilter): TripGroup<X>[] {
  return filter === "todos" ? groups : groups.filter((g) => g.key === filter);
}

type Dup = T & { destino?: string | null; pais_destino?: string | null; itinerario_json?: unknown };
const dupKey = (t: Dup) => `${shortTripName(t).toLowerCase().trim()}|${t.fecha_salida ?? ""}|${t.fecha_regreso ?? ""}`;

/**
 * Viajes con el mismo nombre y las mismas fechas (R2: tres «Madrid · 10–17 mar» imposibles de distinguir):
 * el más antiguo queda igual y los demás llevan (2), (3)… por orden de creación. `ids` = todos los del grupo
 * (para mostrarles además la fecha de creación).
 */
export function duplicateTripMarks(trips: Dup[]): { n: Map<string, number>; ids: Set<string> } {
  const groups = new Map<string, Dup[]>();
  for (const t of trips) groups.set(dupKey(t), [...(groups.get(dupKey(t)) ?? []), t]);
  const n = new Map<string, number>();
  const ids = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id));
    g.forEach((t, i) => { ids.add(t.id); if (i > 0) n.set(t.id, i + 1); });
  }
  return { n, ids };
}

/** "Madrid" → "Madrid (2)" si es el segundo viaje igual. */
export const markedTripName = (name: string, n?: number) => (n && n > 1 ? `${name} (${n})` : name);

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const parts = (iso: string) => ({ d: Number(iso.slice(8, 10)), m: MES[Number(iso.slice(5, 7)) - 1], y: iso.slice(0, 4) });

/** "10 may 2027" / con regreso: "10–20 may 2027", "28 may – 2 jun 2027", "29 dic 2026 – 5 ene 2027". */
export function tripDateLabel(salida: string | null | undefined, regreso?: string | null): string {
  if (!isIso(salida)) return "sin fecha";
  const a = parts(salida);
  if (!isIso(regreso) || regreso <= salida) return `${a.d} ${a.m} ${a.y}`;
  const b = parts(regreso);
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d}–${b.d} ${b.m} ${b.y}`;
}

/**
 * Texto de cada chip de viaje (Ahorro): «Roma → Florencia → Venecia · 10 may 2027». Si otro viaje tiene el
 * mismo nombre y sale el mismo día, se muestra el rango de fechas (R4 viajes P2-5: dos chips idénticos,
 * 10–20 y 10–19 may); si además las fechas son las mismas, lleva (2), (3)… como en Mis viajes.
 */
export function tripChipLabels(trips: Dup[]): Map<string, string> {
  const dups = duplicateTripMarks(trips);
  const sameStart = new Map<string, number>();
  const k = (t: Dup) => `${shortTripName(t).toLowerCase().trim()}|${t.fecha_salida ?? ""}`;
  for (const t of trips) sameStart.set(k(t), (sameStart.get(k(t)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const t of trips) {
    const range = (sameStart.get(k(t)) ?? 0) > 1;
    out.set(t.id, `${markedTripName(shortTripName(t), dups.n.get(t.id))} · ${range ? tripDateLabel(t.fecha_salida, t.fecha_regreso) : tripDateLabel(t.fecha_salida)}`);
  }
  return out;
}
