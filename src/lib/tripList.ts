// Agrupa "Mis viajes" (pura, para probarla): próximos y en curso primero, ordenados por fecha de
// salida (los que no tienen fecha al final); los terminados aparte, del más reciente al más viejo.
import { isTripEnded } from "@/lib/activeTrip";

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
