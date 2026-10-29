import { BadgeCheck, ExternalLink, PenLine, TriangleAlert } from "lucide-react";
import { curatedBenefits, getProgram, NO_BENEFITS_COPY } from "@/lib/boveda/catalog";
import { fmtDate } from "@/lib/boveda/alerts";
import type { VaultItem } from "@/lib/boveda/types";

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Beneficios: los curados (con fuente y fecha de verificación) + los que escribió la persona. */
export function BenefitsBlock({ item, onAdd }: { item: Pick<VaultItem, "program_id" | "tier_id" | "benefits" | "benefits_unverified">; onAdd?: () => void }) {
  const curated = curatedBenefits(item.program_id, item.tier_id);
  const program = getProgram(item.program_id);
  const own = item.benefits ?? [];
  if (!curated && own.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 p-3 text-sm text-muted-foreground" data-testid="no-benefits">
        <p>{NO_BENEFITS_COPY}.</p>
        {onAdd && (
          <button type="button" onClick={onAdd} className="mt-1 mr-3 inline-flex items-center gap-1 text-foreground text-xs underline underline-offset-2">
            <PenLine className="w-3 h-3" aria-hidden="true" /> Agregar mis beneficios
          </button>
        )}
        {program?.officialUrl && (
          <a href={program.officialUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary text-xs">
            Fuente oficial: {host(program.officialUrl)} <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {curated && (
        <div data-testid="curated-benefits">
          <p className="text-[11px] uppercase tracking-[0.18em] text-primary flex items-center gap-1.5 mb-1.5">
            <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> {curated.scopeLabel}
          </p>
          <ul className="space-y-1.5">
            {curated.benefits.map((b) => (
              <li key={b} className="text-sm leading-snug flex gap-2"><span className="text-primary mt-[3px]" aria-hidden="true">•</span><span>{b}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Fuente: <a href={curated.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{host(curated.sourceUrl)}</a>
            {" "}· verificado el {fmtDate(curated.verifiedAt)}. Pueden cambiar: confírmalos antes de viajar.
          </p>
          {curated.note && <p className="mt-1 text-[11px] text-muted-foreground">{curated.note}</p>}
        </div>
      )}
      {own.length > 0 && (
        <div data-testid="own-benefits">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5 mb-1.5">
            <PenLine className="w-3.5 h-3.5" aria-hidden="true" /> {curated ? "Además, los que agregaste" : "Tus beneficios"}
          </p>
          {item.benefits_unverified && (
            <p className="mb-1.5 text-[11px] text-amber-300 flex items-start gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              Sugeridos por IA en la versión anterior de Documentos y tarjetas, sin verificar: confírmalos con tu banco o programa.
            </p>
          )}
          <ul className="space-y-1.5">
            {own.map((b, i) => (
              <li key={`${i}-${b}`} className="text-sm leading-snug flex gap-2"><span className="text-muted-foreground mt-[3px]" aria-hidden="true">•</span><span>{b}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
