// Viajes que muestra Inicio (E-11).
//
// Antes Inicio cargaba los 2 viajes CREADOS más recientemente y de ahí sacaba "En vivo" y
// "Próximo viaje": un viaje en curso creado hace meses no aparecía, y un viaje pasado recién
// creado salía como "próximo". Ahora se eligen por fechas (en la zona local), con la misma regla
// de "terminado / en curso" que usa el Concierge (lib/activeTrip).
import { isTripEnded, isTripInProgress, type TripLike } from "@/lib/activeTrip";
import { diffLocalDays } from "@/lib/localDate";

const bySalida = (a: TripLike, b: TripLike) =>
  String(a.fecha_salida ?? "9999").localeCompare(String(b.fecha_salida ?? "9999"));

export type HomeTrips<T extends TripLike> = {
  /** Viaje en curso hoy (si hay varios, el que empezó antes). */
  active: T | null;
  /** Si no hay uno en curso: el siguiente que sale en los próximos 7 días. */
  upcoming: T | null;
  /** "Mis próximos viajes": los 2 vigentes más cercanos por fecha de salida. */
  list: T[];
};

export function homeTrips<T extends TripLike>(trips: T[], todayLocal: string): HomeTrips<T> {
  const live = (trips ?? []).filter((t) => t && t.id && !isTripEnded(t, todayLocal)).sort(bySalida);
  const active = live.find((t) => isTripInProgress(t, todayLocal)) ?? null;
  const upcoming = active
    ? null
    : live.find((t) => {
        if (!t.fecha_salida) return false;
        const d = diffLocalDays(todayLocal, String(t.fecha_salida));
        return d >= 1 && d <= 7;
      }) ?? null;
  return { active, upcoming, list: live.slice(0, 2) };
}
