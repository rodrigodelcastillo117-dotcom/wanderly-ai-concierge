import { Plane, MessageCircle } from "lucide-react";
import { compactTripLabel, type ContextTrip } from "@/components/concierge/TripContextSelector";

/** Texto de la etiqueta de un bloque del historial: el viaje del hilo o "Sin viaje". */
export function threadLabelText(tripId: string | null, trips: ContextTrip[]): string {
  if (!tripId) return "Sin viaje";
  const t = trips.find((x) => x.id === tripId);
  return t ? compactTripLabel(t) : "Otro viaje";
}

/**
 * Etiqueta al empezar cada bloque del historial (auditoría 10, ronda 4, N4-P1-4): cada conversación se
 * guarda en el hilo de su viaje; al recargar se ven todas, en orden, y esta etiqueta dice de cuál es.
 */
export function ThreadLabel({ tripId, trips }: { tripId: string | null; trips: ContextTrip[] }) {
  const Icon = tripId ? Plane : MessageCircle;
  return (
    <div className="flex items-center gap-2 pt-2" role="separator" aria-label={`Conversación: ${threadLabelText(tripId, trips)}`} data-testid="thread-label">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full border border-primary/25 bg-card/70 px-2.5 py-0.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">{threadLabelText(tripId, trips)}</span>
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

export default ThreadLabel;
