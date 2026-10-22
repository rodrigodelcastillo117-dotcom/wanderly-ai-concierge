import { Plane } from "lucide-react";
import { isTripEnded, tripLabel, type ActiveTripResult, type TripLike } from "@/lib/activeTrip";
import { localISODate } from "@/lib/localDate";

const REASON_TEXT: Record<string, string> = {
  pinned: "elegido por ti",
  explicit: "elegido por ti",
  in_progress: "en curso",
  single_upcoming: "tu próximo viaje",
};

/**
 * Selector del viaje activo para las pantallas fuera del chat (Dashboard, Cercanos, Gastos).
 * Guarda la elección en profiles.active_trip_id (vía `onChange`), así Iato y las demás pantallas
 * hablan del mismo viaje. Con empate muestra "Elige tu viaje activo" en lugar de adivinar.
 */
export function ActiveTripPicker<T extends TripLike>({ trips, pinnedId, resolved, onChange, className = "" }: {
  trips: T[];
  pinnedId: string | null;
  resolved: ActiveTripResult<T>;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const today = localISODate();
  const options = trips.filter((t) => !isTripEnded(t, today) || t.id === pinnedId);
  if (!options.length) return null;
  const value = pinnedId && options.some((t) => t.id === pinnedId) ? pinnedId : "";
  const hint = resolved.trip
    ? REASON_TEXT[resolved.reason] ?? ""
    : resolved.reason === "ambiguous" ? "tienes varios viajes: elige uno" : "";
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      <Plane className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
      <span className="text-muted-foreground">Viaje activo:</span>
      <select
        aria-label="Viaje activo"
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        className="max-w-[15rem] truncate rounded-full border border-primary/30 bg-background/60 px-2 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">
          {resolved.trip && !pinnedId ? `Automático · ${resolved.trip.destino ?? "viaje"}` : "Elige tu viaje activo"}
        </option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>{tripLabel(t)}</option>
        ))}
      </select>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
