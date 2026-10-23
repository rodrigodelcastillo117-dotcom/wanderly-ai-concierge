import { Check, Clock } from "lucide-react";
import {
  reservationStateLabel, requestStatusToCanonical, type ReservationStateRow,
} from "../../../supabase/functions/_shared/reservationState.ts";

/**
 * God Mode F1: estado REAL de una solicitud o reserva con etiqueta honesta ("Solicitud enviada · aún no
 * es una reserva", "Confirmada por el proveedor"…). Mismo vocabulario que reservation_state_v. Negro y
 * dorado (tokens primary); sin agrandar letra.
 */
export function ReservationStateBadge({ row, status, type }: { row?: ReservationStateRow | null; status?: string | null; type?: string | null }) {
  const r: ReservationStateRow = row ?? { canonical_state: requestStatusToCanonical(status, type), raw_status: status ?? null };
  const { label, tone } = reservationStateLabel(r);
  const cls = tone === "confirmed"
    ? "border-primary bg-primary/15 text-primary"
    : tone === "open" ? "border-primary/40 text-primary" : "border-border text-muted-foreground";
  const Icon = tone === "confirmed" ? Check : Clock;
  return (
    <span data-reservation-state={r.canonical_state ?? ""}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight ${cls}`}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" /> {label}
    </span>
  );
}
