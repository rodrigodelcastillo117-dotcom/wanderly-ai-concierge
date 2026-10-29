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
