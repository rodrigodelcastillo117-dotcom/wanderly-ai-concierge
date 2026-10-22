// Viajes que muestra Inicio (E-11).
//
// Antes Inicio cargaba los 2 viajes CREADOS más recientemente y de ahí sacaba "En vivo" y
// "Próximo viaje": un viaje en curso creado hace meses no aparecía, y un viaje pasado recién
// creado salía como "próximo". Ahora el viaje lo decide resolveActiveTrip (el MISMO selector que
// usan Iato, Cercanos, Gastos y el Fixer) con profiles.active_trip_id; aquí solo se reparte en
// "En vivo" / "Próximo viaje" / lista. Con empate no se elige ninguno: Inicio muestra el selector.
import { isTripEnded, isTripInProgress, resolveActiveTrip, type ActiveTripResult, type TripLike } from "@/lib/activeTrip";
import { diffLocalDays } from "@/lib/localDate";

const bySalida = (a: TripLike, b: TripLike) =>
  String(a.fecha_salida ?? "9999").localeCompare(String(b.fecha_salida ?? "9999"));

export type HomeTrips<T extends TripLike> = {
  /** Viaje activo en curso hoy. */
  active: T | null;
  /** Viaje activo que aún no empieza: si lo fijó el usuario, o si sale en los próximos 7 días. */
  upcoming: T | null;
  /** "Mis próximos viajes": el activo primero y luego los vigentes más cercanos (máx. 2). */
  list: T[];
  /** Resultado de resolveActiveTrip (reason "ambiguous" = hay que preguntar cuál). */
  resolved: ActiveTripResult<T>;
};

export function homeTrips<T extends TripLike>(trips: T[], todayLocal: string, pinnedId: string | null = null): HomeTrips<T> {
  const all = (trips ?? []).filter((t) => t && t.id);
  const resolved = resolveActiveTrip(all, { pinnedId, todayLocal });
  const trip = resolved.trip;
  const inProgress = !!trip && isTripInProgress(trip, todayLocal);
  const soon = !!trip?.fecha_salida && (() => {
    const d = diffLocalDays(todayLocal, String(trip.fecha_salida));
    return d >= 0 && d <= 7;
  })();
  const live = all.filter((t) => !isTripEnded(t, todayLocal)).sort(bySalida);
  const list = [...(trip && !isTripEnded(trip, todayLocal) ? [trip] : []), ...live.filter((t) => t.id !== trip?.id)].slice(0, 2);
  return {
    active: inProgress ? trip : null,
    upcoming: !inProgress && trip && (resolved.reason === "pinned" || soon) ? trip : null,
    list,
    resolved,
  };
}
