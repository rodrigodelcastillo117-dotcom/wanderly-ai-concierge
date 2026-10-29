import { BadgeCheck, ChevronDown, FileText, Receipt } from "lucide-react";
import { REQUOTE_LABEL } from "@/lib/budgetSanity";
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
export function BookingStateBadge({ summary, compact = false, estimated = [], byLand = false, requote = false }: { summary: TripBookingSummary; compact?: boolean; estimated?: ItemKind[]; byLand?: boolean; requote?: boolean }) {
  const Icon = summary.estado === "reservado" ? BadgeCheck : Receipt;
  // Cotización con error (invalidQuoteReason, Budapest «$7»): nada se llama «Cotizado» (R2: el total decía
  // «Por recotizar» y arriba «Vuelo: Cotizado · Hospedaje: Cotizado»; Mis viajes, «Cotizado · sin reservar»).
  const label = requote && summary.estado === "cotizado" ? `${REQUOTE_LABEL} · sin reservar`
    : summary.estado === "cotizado" && estimated.length ? "Cotizado · incluye estimados · sin reservar" : summary.label;
  const itemLabel = (kind: ItemKind, st: ItemState) =>
    st === "cotizado" && requote ? REQUOTE_LABEL
      : st === "cotizado" && estimated.includes(kind) ? "Estimado · no reservado" : ITEM_STATE_LABEL[st];
  const badge = (
    <span data-testid="trip-booking-state" data-state={summary.estado}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${requote && summary.estado === "cotizado" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : tone(summary.estado)}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {label}
    </span>
  );
  if (compact) return badge;
  const tipos = Object.entries(summary.por_tipo) as Array<[ItemKind, ItemState]>;
  if (!tipos.length) return <div className="flex flex-wrap items-center gap-1.5" aria-label="Estado de reservas del viaje">{badge}</div>;
  // Una sola insignia a la vista y el estado de cada rubro plegado (R3 viajes P1-3: 4 insignias seguidas
  // en Resumen eran «demasiado texto» para alguien nuevo).
  return (
    <details className="group" aria-label="Estado de reservas del viaje" data-testid="trip-booking-state-detalle">
      <summary className="flex min-h-[32px] cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
        {badge}
        <span className="inline-flex items-center gap-0.5 text-[11px] text-primary">
          <span className="group-open:hidden">Ver por rubro</span><span className="hidden group-open:inline">Ocultar</span>
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {tipos.map(([kind, st]) => (
          <span key={kind} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${tone(st)}`}>
            {st === "segun_tu_archivo" && <FileText className="w-3 h-3" aria-hidden="true" />}
            {kind === "vuelo" && byLand ? "Cómo llegar" : KIND_LABEL[kind]}: {itemLabel(kind, st)}
          </span>
        ))}
      </div>
    </details>
  );
}
