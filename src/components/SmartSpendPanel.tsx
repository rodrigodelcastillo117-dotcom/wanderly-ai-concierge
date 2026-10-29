import { useMemo } from "react";
import { formatMoney, fxLabel, summarizeSpend } from "@/lib/fx";
import { useFxTable } from "@/hooks/useFxTable";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Plus, Plane, PieChart as PieIcon, Crown } from "lucide-react";
import { categoryBreakdown, donutSlices } from "@/lib/expenseCategories";
import { spendInsights, type InsightExpense, type InsightTrip } from "@/lib/spendInsights";
import { Button } from "@/components/ui/button";

type Props = {
  /** Gastos ya cargados por la página (no se vuelven a pedir). */
  items: InsightExpense[];
  trips: InsightTrip[];
  activeTripId?: string | null;
  /** Abre el formulario de "Mis gastos". */
  onAddExpense?: () => void;
};

const mxn = (n: number) => formatMoney(Math.round(n), "MXN", 0);
/** Cifra grande con "MXN" chico al lado (en dos columnas de móvil no se parte en dos renglones). */
const Big = ({ n }: { n: number }) => (
  // Espacio real (no separable) entre la cifra y "MXN": con solo margen, el texto se leía "$934MXN".
  <>{`$${Math.round(n).toLocaleString("es-MX")}\u00A0`}<span className="text-[0.45em] text-muted-foreground font-sans tracking-wide">MXN</span></>
);

/**
 * Resumen: en qué se te va el dinero, en pesos. Útil desde el primer gasto: total, mes actual, la
 * categoría donde más gastas, el gasto por viaje y, con un viaje en curso, el promedio por día
 * contra el presupuesto por día. recharts (~100 kB) solo se carga al abrir esta pestaña.
 */
const SmartSpendPanel = ({ items, trips, activeTripId, onAddExpense }: Props) => {
  const fx = useFxTable();

  const summary = useMemo(() => (fx ? summarizeSpend(items, "MXN", fx) : null), [items, fx]);
  const insights = useMemo(() => (fx ? spendInsights(items, trips, fx, { activeTripId }) : null), [items, trips, fx, activeTripId]);
  const data = useMemo(() => (summary ? donutSlices(summary.byCat) : []), [summary]);
  const breakdown = useMemo(() => (summary ? categoryBreakdown(summary.byCat) : []), [summary]);

  if (items.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6 md:p-10 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/30 grid place-items-center mb-4">
          <PieIcon className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <p className="font-display text-2xl mb-2">Aquí verás en qué se te va el dinero</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          Con tu primer gasto te mostramos el total en pesos, la categoría donde más gastas y cuánto llevas en cada viaje.
        </p>
        {onAddExpense && (
          <Button onClick={onAddExpense} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4" aria-hidden="true" /> Registra tu primer gasto
          </Button>
        )}
      </div>
    );
  }

  if (!fx || !summary || !insights) {
    return <div className="glass-card rounded-2xl p-10 text-center text-sm text-muted-foreground">Convirtiendo a pesos…</div>;
  }

  const delta = summary.lastMonth > 0 ? ((summary.thisMonth - summary.lastMonth) / summary.lastMonth) * 100 : null;
  const a = insights.active;
  const maxTrip = Math.max(1, ...insights.perTrip.map((t) => t.total));

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Viaje activo primero: ¿voy bien con el presupuesto? */}
      {a && (
        <section aria-label={`Tu viaje a ${a.label}`} className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 md:p-6">
          <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-1 flex items-center gap-1.5">
            <Plane className="w-3 h-3" aria-hidden="true" /> Tu viaje a {a.label}
          </p>
          <p className="font-display text-2xl md:text-3xl">
            <Big n={a.total} />
            {a.presupuesto != null && <span className="text-sm md:text-base text-muted-foreground font-sans"> de {mxn(a.presupuesto)}</span>}
          </p>
          {a.usoPresupuesto != null && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-surface overflow-hidden" role="progressbar" aria-label="Presupuesto usado"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, a.usoPresupuesto) * 100)}>
                <div className={`h-full rounded-full ${a.usoPresupuesto > 1 ? "bg-destructive" : "bg-gradient-gold"}`}
                  style={{ width: `${Math.min(100, a.usoPresupuesto * 100)}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{(a.usoPresupuesto * 100).toFixed(0)}% del presupuesto del viaje</p>
            </div>
          )}
          <p className="text-sm text-foreground/85 mt-3">
            {a.promedioDiario != null ? (
              <>
                Vas en <strong>{mxn(a.promedioDiario)}/día</strong>
                {a.presupuestoDiario != null && (
                  <> · tu presupuesto da <strong>{mxn(a.presupuestoDiario)}/día</strong>
                    {a.promedioDiario > a.presupuestoDiario
                      ? <span className="text-destructive"> (vas arriba)</span>
                      : <span className="text-emerald-500"> (vas bien)</span>}
                  </>
                )}
                {a.diasViaje ? <span className="text-muted-foreground"> · día {a.diasTranscurridos} de {a.diasViaje}</span> : null}
              </>
            ) : a.total > 0 ? (
              <>Esto es lo que llevas antes de salir (vuelos, hotel, reservas).</>
            ) : (
              <>Aún no registras gastos de este viaje.</>
            )}
          </p>
          {a.presupuesto == null && (
            <p className="text-[11px] text-muted-foreground mt-1">Este viaje no tiene presupuesto; cuando lo cotices, aquí verás si vas bien.</p>
          )}
        </section>
      )}

      {/* Tres cifras que se leen en un vistazo. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-1">Total gastado</p>
          <p className="font-display text-2xl md:text-4xl whitespace-nowrap"><Big n={insights.total} /></p>
          <p className="text-[11px] text-muted-foreground mt-1">{insights.count} {insights.count === 1 ? "gasto" : "gastos"}</p>
        </div>
        <div className="glass-card rounded-2xl p-4 md:p-6">
          <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-1">Este mes</p>
          <p className="font-display text-2xl md:text-4xl whitespace-nowrap"><Big n={summary.thisMonth} /></p>
          {delta != null ? (
            <p className={`flex items-center gap-1 text-[11px] mt-1 ${delta >= 0 ? "text-destructive" : "text-emerald-500"}`}>
              {delta >= 0 ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
              {Math.abs(delta).toFixed(0)}% vs mes anterior
            </p>
          ) : <p className="text-[11px] text-muted-foreground mt-1">Sin gastos el mes pasado</p>}
        </div>
        <div className="glass-card rounded-2xl p-4 md:p-6 col-span-2 md:col-span-1">
          <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-1">Donde más gastas</p>
          {insights.topCategory ? (
            <>
              <p className="font-display text-xl md:text-3xl truncate">{insights.topCategory.name}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {mxn(insights.topCategory.total)} · {insights.topCategory.pct.toFixed(0)}% de todo
              </p>
            </>
          ) : <p className="text-sm text-muted-foreground">Sin gastos convertibles todavía.</p>}
        </div>
      </div>

      {/* Por viaje */}
      <section className="glass-card rounded-2xl p-4 md:p-6">
        <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-3">Por viaje</p>
        <ul className="space-y-3">
          {insights.perTrip.map((t) => (
            <li key={t.tripId ?? "sin-viaje"}>
              <div className="flex justify-between text-sm mb-1 gap-3">
                <span className="truncate flex items-center gap-1.5">
                  {t.tripId && t.tripId === activeTripId && <Crown className="w-3 h-3 text-primary shrink-0" aria-label="Viaje activo" />}
                  {t.label} <span className="text-muted-foreground text-xs">· {t.count} {t.count === 1 ? "gasto" : "gastos"}</span>
                </span>
                <span className="shrink-0">{mxn(t.total)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${(t.total / maxTrip) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Por categoría: dona y desglose en una sola tarjeta. */}
      <section className="glass-card rounded-2xl p-4 md:p-6">
        <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-2">Por categoría</p>
        {breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sin gastos convertibles todavía.</p>
        ) : (
          <div className="grid md:grid-cols-[220px_1fr] gap-4 md:gap-8 items-center">
            <div className="h-40 md:h-52">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={data.length > 1 ? 2 : 0} stroke="hsl(var(--surface))" strokeWidth={2}>
                    {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                    formatter={(v: number) => mxn(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-3">
              {breakdown.map((c) => (
                <li key={c.name}>
                  <div className="flex justify-between text-sm mb-1 gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} aria-hidden="true" />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{mxn(c.value)} · {c.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: c.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        En pesos mexicanos · {fxLabel(fx)}
        {summary.unconvertedCount > 0 && ` · ${summary.unconvertedCount} gasto(s) sin convertir (${summary.unconvertedCurrencies.join(", ")}: sin tipo de cambio disponible)`}
      </p>
    </div>
  );
};

export default SmartSpendPanel;
