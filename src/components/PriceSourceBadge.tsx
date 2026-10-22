import { AlertTriangle, BadgeCheck, CircleSlash, Clock, HelpCircle, Sparkles, Star } from "lucide-react";
import { provenanceOf, type ProvenanceInput } from "@/lib/provenance";

/** Compatibilidad: true solo si el precio es de un proveedor en vivo y está vigente ahora. */
export const isLivePrice = (source?: string | null, consultadoAt?: string | Date | null) =>
  provenanceOf({ source, consultadoAt }).state === "CONSULTADO_EN_VIVO";

type Props = ProvenanceInput & { className?: string; now?: Date };

/**
 * Insignia del origen del precio. Siempre se muestra (sin fuente dice "Sin fuente") y nunca dice
 * "en vivo" para estimaciones, precios viejos (>24 h) o pendientes de verificar.
 */
export function PriceSourceBadge({ className = "", now, ...input }: Props) {
  const p = provenanceOf(input, now);
  const curated = p.state === "ESTIMADO" && /Reseñas reales/.test(p.label);

  const tone =
    p.state === "CONSULTADO_EN_VIVO" || p.state === "CONFIRMADO"
      ? "border-primary/30 bg-primary/10 text-primary"
      : p.state === "OBSOLETO" || p.state === "PENDIENTE_DE_VERIFICACION"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
        : curated
          ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
          : "border-border bg-surface/60 text-muted-foreground";

  const Icon =
    p.state === "CONSULTADO_EN_VIVO" || p.state === "CONFIRMADO"
      ? BadgeCheck
      : p.state === "OBSOLETO"
        ? Clock
        : p.state === "PENDIENTE_DE_VERIFICACION"
          ? AlertTriangle
          : p.state === "NO_DISPONIBLE"
            ? CircleSlash
            : curated
              ? Star
              : p.label === "Sin fuente"
                ? HelpCircle
                : Sparkles;

  return (
    <span
      title={p.detail}
      data-estado={p.state}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${tone} ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {p.label}
    </span>
  );
}
