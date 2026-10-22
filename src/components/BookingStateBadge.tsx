import { BadgeCheck, FileText, Receipt } from "lucide-react";
import { ITEM_STATE_LABEL, type ItemKind, type ItemState, type TripBookingSummary } from "@/lib/bookingState";

const KIND_LABEL: Record<ItemKind, string> = {
  vuelo: "Vuelo", hospedaje: "Hospedaje", tour: "Experiencias", crucero: "Crucero", auto: "Auto", tren: "Tren",
  ferry: "Ferry", restaurante: "Restaurante", esim: "eSIM", seguro: "Seguro", otro: "Otro",
};

const tone = (estado: TripBookingSummary["estado"] | ItemState) =>
  estado === "reservado"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
    : estado === "parcialmente_reservado" || estado === "segun_tu_archivo"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-border bg-surface/60 text-muted-foreground";

/**
 * Reservado vs. cotizado, derivado de las reservas confirmadas (no de trips.status, que vale "listo"
 * para ambos). `compact` = solo la insignia, para la lista de viajes.
 */
export function BookingStateBadge({ summary, compact = false }: { summary: TripBookingSummary; compact?: boolean }) {
  const Icon = summary.estado === "reservado" ? BadgeCheck : Receipt;
  const badge = (
    <span data-testid="trip-booking-state" data-state={summary.estado}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${tone(summary.estado)}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {summary.label}
    </span>
  );
  if (compact) return badge;
  const tipos = Object.entries(summary.por_tipo) as Array<[ItemKind, ItemState]>;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Estado de reservas del viaje">
      {badge}
      {tipos.map(([kind, st]) => (
        <span key={kind} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${tone(st)}`}>
          {st === "segun_tu_archivo" && <FileText className="w-3 h-3" aria-hidden="true" />}
          {KIND_LABEL[kind]}: {ITEM_STATE_LABEL[st]}
        </span>
      ))}
    </div>
  );
}
