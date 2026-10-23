import { Receipt, Trash2, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, fxLabel, type FxTable } from "@/lib/fx";
import { formatDateOnly } from "@/lib/dateUtils";
import { canonicalCategory } from "@/lib/expenseCategories";
import type { TripSpendItem, TripSpendSummary } from "@/lib/tripSpend";

const mxn = (n: number) => formatMoney(Math.round(n), "MXN", 0);
const dayLabel = (d: string) => (d === "sin-fecha" ? "Sin fecha" : formatDateOnly(d, { weekday: "short", day: "numeric", month: "short" }));

type Props = {
  items: TripSpendItem[];
  summary: TripSpendSummary | null;
  fx: FxTable | null;
  removing: Set<string>;
  onRemovePersonal: (id: string) => void;
  onAdd: () => void;
  onOpenShared: () => void;
  /** Días del viaje (para el presupuesto por día); null sin fechas. */
  tripDays?: number | null;
};

/**
 * Pestaña "Gastos": cuánto llevo gastado YO en este viaje, en pesos. Mis gastos personales más mi
 * parte de lo compartido (se dice cuánto es cada cosa). Solo la veo yo.
 */
export function TripPersonalTab({ items, summary, fx, removing, onRemovePersonal, onAdd, onOpenShared, tripDays }: Props) {
  if (items.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6 md:p-10 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/30 grid place-items-center mb-4">
          <Receipt className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <p className="font-display text-2xl mb-2">Aún no registras gastos en este viaje</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          Anota la cena, el taxi o el museo en la moneda en que pagaste, o escanea el ticket. Te decimos cuánto llevas en pesos.
        </p>
        <Button onClick={onAdd} className="bg-primary text-primary-foreground hover:bg-primary/90">Registrar un gasto</Button>
      </div>
    );
  }
  if (!summary || !fx) return <div className="glass-card rounded-2xl p-8 text-center text-sm text-muted-foreground">Convirtiendo a pesos…</div>;

  const unconv = Object.entries(summary.unconverted);
  const multi = Object.keys(summary.byCurrency).length > 1 || !summary.byCurrency.MXN;
  const b = summary.budget;
  const maxDay = Math.max(1, ...summary.byDay.map((d) => d.mxn));

  return (
    <div className="space-y-4">
      <section aria-label="Lo que llevas gastado" className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 md:p-6">
        <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-1 flex items-center gap-1.5"><Wallet className="w-3 h-3" aria-hidden="true" /> Llevas gastado</p>
        <p className="font-display text-3xl md:text-4xl" data-testid="trip-spent-total">{mxn(summary.totalMxn)}</p>
        <p className="text-xs text-muted-foreground mt-1" data-testid="trip-spent-split">
          {summary.sharedMxn > 0
            ? <>Tus gastos {mxn(summary.personalMxn)} + tu parte de lo compartido {mxn(summary.sharedMxn)}. Lo que pagaste por otros no cuenta aquí: está en <button type="button" onClick={onOpenShared} className="text-primary underline-offset-2 hover:underline">Gastos compartidos</button> como lo que te deben.</>
            : <>Solo tus gastos de este viaje. Si compartes alguno, aquí sumamos tu parte.</>}
        </p>
        {multi && (
          <p className="text-[11px] text-muted-foreground mt-2">
            En cada moneda: {Object.entries(summary.byCurrency).map(([c, v]) => formatMoney(v, c)).join(" · ")}
          </p>
        )}
        {unconv.length > 0 && (
          <p className="text-[11px] text-amber-500 mt-1">Sin contar {unconv.map(([c, v]) => formatMoney(v, c)).join(", ")}: no hay tipo de cambio disponible.</p>
        )}
        <p className="text-[10px] text-muted-foreground/80 mt-1">{fxLabel(fx)}</p>

        {b && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span>{b.source === "presupuesto" ? "Tu presupuesto" : "Cotización del viaje"}{b.travelers > 1 ? ` por persona (${mxn(b.total)} entre ${b.travelers})` : ""}</span>
              <span className="font-medium">{mxn(b.perPerson)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface overflow-hidden" role="progressbar" aria-label="Presupuesto usado"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, b.used) * 100)}>
              <div className={`h-full rounded-full ${b.used > 1 ? "bg-destructive" : b.used > 0.85 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, b.used * 100)}%` }} />
            </div>
            <p className={`text-xs mt-1.5 ${b.remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {b.remaining >= 0 ? `Llevas ${Math.round(b.used * 100)} % · te quedan ${mxn(b.remaining)}` : `Te pasaste por ${mxn(-b.remaining)}`}
            </p>
          </div>
        )}
      </section>

      {summary.byCategory.length > 0 && (
        <section aria-label="Por categoría" className="glass-card rounded-2xl p-4 md:p-5">
          <h2 className="text-sm font-medium mb-3">Por categoría</h2>
          <ul className="space-y-2.5">
            {summary.byCategory.map((c) => (
              <li key={c.name}>
                <div className="flex justify-between text-sm"><span className="truncate">{c.name}</span><span className="shrink-0 ml-3">{mxn(c.value)} <span className="text-muted-foreground text-xs">{Math.round(c.pct)} %</span></span></div>
                <div className="h-1.5 rounded-full bg-surface mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, c.pct)}%`, background: c.color }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.byDay.length > 0 && (
        <section aria-label="Por día" className="glass-card rounded-2xl p-4 md:p-5">
          <h2 className="text-sm font-medium mb-3">Por día</h2>
          <ul className="space-y-2">
            {summary.byDay.map((d) => (
              <li key={d.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground capitalize">{dayLabel(d.date)}</span>
                <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, (d.mxn / maxDay) * 100)}%` }} /></div>
                <span className="w-24 text-right shrink-0">{mxn(d.mxn)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-3">
            Promedio: {mxn(summary.totalMxn / summary.byDay.length)} por día con gastos
            {b && tripDays ? ` · tu presupuesto da ${mxn(b.perPerson / tripDays)} por día` : ""}.
          </p>
        </section>
      )}

      <section aria-label="Tus movimientos" className="glass-card rounded-2xl p-4 md:p-5">
        <h2 className="text-sm font-medium mb-2">Tus movimientos</h2>
        <ul>
          {items.map((x) => (
            <li key={`${x.kind}-${x.id}`} className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                  <span className="px-2 py-0.5 rounded-full border border-primary/30 text-primary">{canonicalCategory(x.category)}</span>
                  {x.date && <span>{formatDateOnly(x.date)}</span>}
                  {x.city && <span>· {x.city}</span>}
                  {x.kind === "compartido" && <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" aria-hidden="true" /> Compartido</span>}
                </div>
                <p className="text-sm truncate mt-0.5">{x.description || "—"}</p>
                {x.kind === "compartido" && x.total != null && (
                  <p className="text-[11px] text-muted-foreground">Tu parte de {formatMoney(x.total, x.currency)} · pagó {x.paidByMe ? "tú" : x.payerName}</p>
                )}
              </div>
              <span className="text-sm font-medium shrink-0">{formatMoney(x.amount, x.currency)}</span>
              {x.kind === "personal" ? (
                <button onClick={() => onRemovePersonal(x.id)} disabled={removing.has(x.id)} aria-label={`Eliminar gasto ${x.description ?? ""}`.trim()}
                  className="p-2 -m-1 text-muted-foreground hover:text-destructive disabled:opacity-40"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
              ) : <span className="w-6" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
