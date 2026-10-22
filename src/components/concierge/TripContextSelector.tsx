import { Plane } from "lucide-react";
import { isTripEnded, tripLabel, type ActiveTripResult } from "@/lib/activeTrip";

export type ContextTrip = {
  id: string;
  destino?: string | null;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  created_at?: string | null;
};

const REASON_TEXT: Record<string, string> = {
  pinned: "elegido por ti",
  explicit: "elegido por ti",
  in_progress: "en curso",
  single_upcoming: "tu próximo viaje",
};

/**
 * Muestra sobre qué viaje está hablando Iato y deja cambiarlo (guarda profiles.active_trip_id).
 * "Automático" = Iato decide: el viaje que menciones, el que está en curso o el único próximo; si
 * hay empate, te pregunta.
 */
export function TripContextSelector({ trips, todayLocal, pinnedId, resolved, onChange }: {
  trips: ContextTrip[];
  todayLocal: string;
  pinnedId: string | null;
  resolved: ActiveTripResult<ContextTrip>;
  onChange: (id: string | null) => void;
}) {
  const options = trips.filter((t) => !isTripEnded(t, todayLocal) || t.id === pinnedId);
  if (!options.length) return null;
  const hint = resolved.trip
    ? REASON_TEXT[resolved.reason] ?? ""
    : resolved.reason === "ambiguous" ? "Iato te preguntará cuál" : "";
  return (
    <label className="flex items-center gap-1.5">
      <Plane className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="sr-only sm:not-sr-only">Viaje en contexto:</span>
      <select
        aria-label="Viaje en contexto"
        value={pinnedId && options.some((t) => t.id === pinnedId) ? pinnedId : ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="max-w-[16rem] truncate rounded-full border border-primary/30 bg-background/60 px-2 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">
          {resolved.trip && !pinnedId ? `Automático · ${resolved.trip.destino ?? "viaje"}` : "Automático (Iato decide)"}
        </option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>{tripLabel(t)}</option>
        ))}
      </select>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
