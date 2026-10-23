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
 *
 * `phaseHint` (de location.ts) reemplaza "en curso" cuando la ubicación dice otra cosa: el día de
 * salida, todavía en tu ciudad, el viaje "sale hoy" (caso Huixquilucan → Roma, 22-oct-2026).
 * Compacto: una sola línea que se recorta en vez de desbordar el encabezado.
 */
export function TripContextSelector({ trips, todayLocal, pinnedId, resolved, onChange, phaseHint, className = "" }: {
  trips: ContextTrip[];
  todayLocal: string;
  pinnedId: string | null;
  resolved: ActiveTripResult<ContextTrip>;
  onChange: (id: string | null) => void;
  phaseHint?: string | null;
  className?: string;
}) {
  const options = trips.filter((t) => !isTripEnded(t, todayLocal) || t.id === pinnedId);
  if (!options.length) return null;
  const reasonHint = resolved.trip
    ? REASON_TEXT[resolved.reason] ?? ""
    : resolved.reason === "ambiguous" ? "Iato te preguntará cuál" : "";
  const hint = resolved.trip && phaseHint ? phaseHint : reasonHint;
  return (
    <label className={`flex min-w-0 items-center gap-1 ${className}`} data-testid="trip-context">
      <Plane className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
      <span className="sr-only">Viaje en contexto:</span>
      <select
        aria-label="Viaje en contexto"
        value={pinnedId && options.some((t) => t.id === pinnedId) ? pinnedId : ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 w-full max-w-[13rem] sm:max-w-[18rem] truncate rounded-full border border-primary/30 bg-background/60 px-2 py-0.5 text-[11px] text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">
          {resolved.trip && !pinnedId ? `Automático · ${resolved.trip.destino ?? "viaje"}` : "Automático (Iato decide)"}
        </option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>{tripLabel(t)}</option>
        ))}
      </select>
      {hint && <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground" data-testid="trip-phase">{hint}</span>}
    </label>
  );
}
