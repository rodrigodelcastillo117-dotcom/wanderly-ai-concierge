import { ExternalLink, Sparkles } from "lucide-react";
import { provenanceOf } from "@/lib/provenance";
import { SRE_GUIA_URL } from "../../supabase/functions/_shared/sre.ts";

// Datos generados por IA (E-27): visa, seguridad y costos del comparador venían directo del
// modelo y se mostraban como hechos. Todo lo que sale de la IA lleva la misma etiqueta de
// procedencia que los precios ("Estimado por IA") y, para trámites, el enlace a la fuente oficial.

/** Guía del Viajero de la SRE: requisitos de visa y alertas por país para mexicanos. */
export const SRE_GUIA_VIAJERO_URL = SRE_GUIA_URL;

const AI = provenanceOf({ source: "ia" });

/** Insignia corta "Estimado por IA" con la explicación en el tooltip. */
export function AiEstimateBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title={AI.detail}
      data-estado={AI.state}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 text-[11px] tracking-wide text-muted-foreground ${className}`}
    >
      <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
      {AI.label}
    </span>
  );
}

/** Aviso general para un bloque de datos generados por IA. */
export function AiDataNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="glass-card rounded-2xl p-4 text-sm text-muted-foreground border border-amber-500/30 bg-amber-500/5">
      <p className="flex items-center gap-2 text-foreground font-medium mb-1">
        <Sparkles className="w-4 h-4 text-amber-500" aria-hidden="true" />
        Información generada por IA, no verificada
      </p>
      {children ?? (
        <p>Es una orientación y puede estar desactualizada o ser incorrecta. Confírmala en fuentes oficiales antes de decidir.</p>
      )}
    </div>
  );
}

/** Enlace a la fuente oficial para verificar visa o seguridad. */
export function OfficialSourceLink({ label = "Verifica en la Guía del Viajero (SRE)" }: { label?: string }) {
  return (
    <a
      href={SRE_GUIA_VIAJERO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:opacity-80"
    >
      {label}
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
      <span className="sr-only">(abre en otra pestaña)</span>
    </a>
  );
}
