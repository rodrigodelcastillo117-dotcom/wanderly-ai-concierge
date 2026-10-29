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

// "elegido por ti" se leía como "lo elegiste tú" cuando lo había elegido Iato (auditoría 10, ronda 3, §4).
// Ahora dice quién lo eligió: tú lo fijaste, o Iato lo eligió (y por qué).
export const REASON_TEXT: Record<string, string> = {
  pinned: "lo fijaste tú",
  explicit: "lo fijaste tú",
  mentioned: "Iato eligió este viaje",
  in_progress: "en curso",
  single_upcoming: "tu próximo viaje",
};
/** Texto junto al selector cuando la última respuesta de Iato fue sobre otro viaje (N-P2-8). */
export const FOLLOW_TEXT = "Iato habla de este viaje";

/**
 * Muestra sobre qué viaje está hablando Iato y deja cambiarlo (guarda profiles.active_trip_id).
 * "Automático" = Iato decide: el viaje que menciones, el que está en curso o el único próximo; si
 * hay empate, te pregunta.
 *
 * `phaseHint` (de location.ts) reemplaza "en curso" cuando la ubicación dice otra cosa: el día de
 * salida, todavía en tu ciudad, el viaje "sale hoy" (caso Huixquilucan → Roma, 22-oct-2026).
 * Compacto: una sola línea que se recorta en vez de desbordar el encabezado.
 */
export function TripContextSelector({ trips, todayLocal, pinnedId, resolved, onChange, phaseHint, followId = null, className = "" }: {
  trips: ContextTrip[];
  todayLocal: string;
  pinnedId: string | null;
  resolved: ActiveTripResult<ContextTrip>;
  onChange: (id: string | null) => void;
  phaseHint?: string | null;
  /** Viaje del que trató la última respuesta de Iato (lo nombró el usuario): el selector lo sigue (N-P2-8). */
  followId?: string | null;
  className?: string;
}) {
  const options = trips.filter((t) => !isTripEnded(t, todayLocal) || t.id === pinnedId || t.id === followId);
  if (!options.length) return null;
  const following = !!followId && options.some((t) => t.id === followId);
  const reasonHint = resolved.trip
    ? REASON_TEXT[resolved.reason] ?? ""
    : resolved.reason === "ambiguous" ? "Iato te preguntará cuál" : "";
  const hint = following ? FOLLOW_TEXT : resolved.trip && phaseHint ? phaseHint : reasonHint;
  const value = following ? followId! : pinnedId && options.some((t) => t.id === pinnedId) ? pinnedId : "";
  return (
    <label className={`flex min-w-0 items-center gap-1 ${className}`} data-testid="trip-context">
      <Plane className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
      <span className="sr-only">Viaje en contexto:</span>
      <select
        aria-label="Viaje en contexto"
        value={value}
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
