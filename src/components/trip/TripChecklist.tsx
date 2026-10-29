import type { ReactNode } from "react";
import { Check, ChevronRight, Circle, CircleDot, Search } from "lucide-react";
import { CHECKLIST_DONE, CHECKLIST_STATUS_LABEL, type ChecklistRow } from "@/lib/purchaseProgress";

const MAX_ROWS = 6;

const tone = (s: ChecklistRow["status"]) =>
  CHECKLIST_DONE.has(s) ? "text-emerald-400" : s === "elegido" ? "text-primary" : s === "por_elegir" ? "text-amber-400" : "text-muted-foreground";

/**
 * «Qué falta» del tablero del Resumen: un renglón por paso de «Comprar» (vuelo, hotel por ciudad, tren
 * entre ciudades) con su estado, y la misma cuenta «N de M reservados» que «Comprar». Tocar un renglón
 * lleva a ese paso. Los datos los arma purchaseProgress.
 */
export function TripChecklist({ rows, done, total, onGo, footer }: {
  rows: ChecklistRow[];
  done: number;
  total: number;
  onGo: (id: string) => void;
  footer?: ReactNode;
}) {
  if (!rows.length) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section aria-labelledby="trip-falta-title" data-testid="trip-falta">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="trip-falta-title" className="text-[11px] uppercase tracking-[0.2em] text-primary">Qué falta</h2>
        {total > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="trip-falta-progreso">
            {done} de {total} reservado{total === 1 ? "" : "s"}
          </p>
        )}
      </div>
      {total > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Avance de compra">
          <span className="block h-full rounded-full bg-emerald-500/80 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="mt-2 divide-y divide-border/40">
        {shown.map((r) => {
          const isDone = CHECKLIST_DONE.has(r.status);
          const Icon = isDone ? Check : r.status === "elegido" ? CircleDot : r.status === "sin_precio" ? Search : Circle;
          return (
            <li key={r.id}>
              <button type="button" onClick={() => onGo(r.id)} data-testid="trip-falta-item" data-status={r.status}
                className="flex min-h-[44px] w-full items-center gap-2.5 py-2 text-left transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md">
                <Icon className={`h-4 w-4 shrink-0 ${tone(r.status)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug break-words">{r.label}</span>
                  {r.detail && <span className="block text-xs text-muted-foreground truncate">{r.detail}</span>}
                </span>
                <span className={`shrink-0 text-[11px] ${tone(r.status)}`}>{CHECKLIST_STATUS_LABEL[r.status]}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <button type="button" onClick={() => onGo(rows[MAX_ROWS].id)} className="mt-1 text-xs text-primary underline-offset-2 hover:underline" data-testid="trip-falta-mas">
          Ver {more} paso{more === 1 ? "" : "s"} más en Comprar
        </button>
      )}
      {footer && <div className="mt-2">{footer}</div>}
    </section>
  );
}
