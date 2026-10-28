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
/** Rubros del total que son estimados (tripTotalSummary.estimatedKeys) → tipo de reserva. */
const ESTIMATED_KIND: Record<string, ItemKind> = { vuelos: "vuelo", hospedaje: "hospedaje", tours: "tour" };
export const estimatedKindsOf = (keys: string[] | null | undefined): ItemKind[] =>
  (keys ?? []).map((k) => ESTIMATED_KIND[k]).filter((k): k is ItemKind => !!k);

/**
 * Tipos que la insignia llama "Estimado": vuelo y hospedaje solo si el total los suma SIN precio
 * verificable (tripTotalSummary.sinPrecioReal); experiencias si su rubro es estimado. Caso E2E
 * 28-oct-2026 (Lisboa): "Vuelo: Estimado" junto a "Vuelos · en vivo $41,188" solo porque la persona
 * aún no elegía una de las tres tarifas consultadas en vivo.
 */
export const badgeEstimatedKinds = (s: { sinPrecioReal?: string[] | null; estimatedKeys?: string[] | null }): ItemKind[] =>
  estimatedKindsOf([...(s.sinPrecioReal ?? []), ...(s.estimatedKeys ?? []).filter((k) => k === "tours")]);

/**
 * `estimated`: tipos cuyo precio en el total es estimado (vuelo sin tarifa real…). No se llaman
 * "Cotizado" a secas: "Estimado · no reservado" y, en el resumen, "incluye estimados".
 */
export function BookingStateBadge({ summary, compact = false, estimated = [], byLand = false }: { summary: TripBookingSummary; compact?: boolean; estimated?: ItemKind[]; byLand?: boolean }) {
  const Icon = summary.estado === "reservado" ? BadgeCheck : Receipt;
  const label = summary.estado === "cotizado" && estimated.length ? "Cotizado · incluye estimados · sin reservar" : summary.label;
  const badge = (
    <span data-testid="trip-booking-state" data-state={summary.estado}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${tone(summary.estado)}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {label}
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
          {kind === "vuelo" && byLand ? "Cómo llegar" : KIND_LABEL[kind]}: {st === "cotizado" && estimated.includes(kind) ? "Estimado · no reservado" : ITEM_STATE_LABEL[st]}
        </span>
      ))}
    </div>
  );
}
