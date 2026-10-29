import { useState } from "react";
import { AlertOctagon, ChevronDown, ExternalLink, Info, TriangleAlert } from "lucide-react";
import type { VaultAlert } from "@/lib/boveda/alerts";

const ICON = { critica: AlertOctagon, aviso: TriangleAlert, info: Info } as const;
const TONE = {
  critica: "border-red-500/40 bg-red-500/[0.08] [&_svg.lead]:text-red-400",
  aviso: "border-amber-400/35 bg-amber-400/[0.07] [&_svg.lead]:text-amber-300",
  info: "border-border/70 bg-surface/60 [&_svg.lead]:text-primary",
} as const;

/** Alertas compactas: se ve la más urgente y el resto se despliega (sin scroll largo). */
export function AlertsPanel({ alerts, onOpenItem }: { alerts: VaultAlert[]; onOpenItem: (id: string) => void }) {
  const [all, setAll] = useState(false);
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, 1);
  return (
    <section aria-label="Alertas de tus documentos y tarjetas" className="space-y-1.5">
      {shown.map((a) => {
        const Icon = ICON[a.level];
        return (
          <div key={a.id} className={`rounded-2xl border px-3 py-2.5 flex gap-2.5 ${TONE[a.level]}`} data-level={a.level}>
            <Icon className="lead w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug">{a.title}</p>
              <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{a.detail}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {a.sourceUrl && (
                  <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary inline-flex items-center gap-1">
                    Fuente oficial: {a.sourceLabel} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
                {a.itemId && (
                  <button type="button" onClick={() => onOpenItem(a.itemId as string)} className="text-[11px] text-foreground/80 underline underline-offset-2">Abrir</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {alerts.length > 1 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}
          className="w-full h-8 text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1">
          {all ? "Ver menos" : `Ver ${alerts.length - 1} alerta${alerts.length - 1 === 1 ? "" : "s"} más`}
          <ChevronDown className={`w-3.5 h-3.5 transition ${all ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
