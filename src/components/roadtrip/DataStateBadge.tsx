import { BadgeCheck, CircleSlash, HelpCircle, Search, Sparkles } from "lucide-react";
import type { DataState } from "@/lib/roadtrip";

const LABEL: Record<DataState, string> = {
  CONSULTADO: "Consultado",
  ESTIMADO: "Estimado",
  POR_CONFIRMAR: "Por confirmar",
  POR_COTIZAR: "Por cotizar",
  SIN_DATOS: "Sin datos",
};

const TONE: Record<DataState, string> = {
  CONSULTADO: "border-primary/30 bg-primary/10 text-primary",
  ESTIMADO: "border-border bg-surface/60 text-muted-foreground",
  POR_CONFIRMAR: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  POR_COTIZAR: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  SIN_DATOS: "border-border bg-surface/60 text-muted-foreground",
};

const ICON = { CONSULTADO: BadgeCheck, ESTIMADO: Sparkles, POR_CONFIRMAR: HelpCircle, POR_COTIZAR: Search, SIN_DATOS: CircleSlash } as const;

/** Etiqueta de procedencia de un dato del road trip. Nunca dice "consultado" para una estimación. */
export function DataStateBadge({ state, title, className = "" }: { state: DataState; title?: string; className?: string }) {
  const Icon = ICON[state];
  return (
    <span data-estado={state} title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide whitespace-nowrap ${TONE[state]} ${className}`}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {LABEL[state]}
    </span>
  );
}
