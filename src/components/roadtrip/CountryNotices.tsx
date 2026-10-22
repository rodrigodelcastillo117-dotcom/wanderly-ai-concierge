import { AlertTriangle, ArrowLeftRight, Car, ExternalLink, IdCard, MapPinned, Route, Ticket } from "lucide-react";
import type { Notice } from "@/lib/roadtrip";
import { COUNTRIES } from "@/lib/roadtrip";
import { formatDateOnly } from "@/lib/dateUtils";

const ICON = { ztl: MapPinned, vineta: Ticket, licencia: IdCard, lado: ArrowLeftRight, frontera: Route, carreteras: AlertTriangle } as const;

/** Avisos prácticos por país, cada uno con su fuente oficial y la fecha en que IATOS la consultó. */
export function CountryNotices({ notices, className = "" }: { notices: Notice[]; className?: string }) {
  if (!notices.length) return null;
  return (
    <section className={`space-y-2 ${className}`} aria-label="Avisos para manejar" data-testid="roadtrip-notices">
      <h4 className="text-xs uppercase tracking-[0.2em] text-primary flex items-center gap-2"><Car className="w-3.5 h-3.5" aria-hidden="true" /> Antes de manejar</h4>
      <ul className="space-y-2">
        {notices.map((n) => {
          const Icon = ICON[n.kind] ?? AlertTriangle;
          return (
            <li key={n.id} className="rounded-xl border border-border bg-surface/40 p-3 text-sm" data-notice={n.id}>
              <p className="flex items-start gap-2 font-medium">
                <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{n.iso !== "*" ? `${COUNTRIES[n.iso]?.name ?? n.iso} · ` : ""}{n.title}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {n.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                    Fuente: {s.label} <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </a>
                ))}
                <span>Consultada el {formatDateOnly(n.sources[0]?.consulted_at, { day: "numeric", month: "short", year: "numeric" })}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
