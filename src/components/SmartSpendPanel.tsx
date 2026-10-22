import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMoney, fxLabel, summarizeSpend, type SpendItem } from "@/lib/fx";
import { useFxTable } from "@/hooks/useFxTable";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { categoryBreakdown, donutSlices } from "@/lib/expenseCategories";

const SmartSpendPanel = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<SpendItem[]>([]);
  const fx = useFxTable();

  useEffect(() => {
    if (!user) return;
    supabase.from("expenses").select("amount,currency,category,expense_date").eq("user_id", user.id)
      .then(({ data }) => setItems((data as any) ?? []));
  }, [user]);

  // Todo convertido a MXN con el tipo de cambio indicado (antes se sumaban MXN, USD y EUR como
  // si fueran la misma moneda) y con fechas leídas como fecha local.
  const { thisMonth, lastMonth, byCat, total, unconvertedCount, unconvertedCurrencies } = useMemo(
    () => (fx ? summarizeSpend(items, "MXN", fx) : { thisMonth: 0, lastMonth: 0, byCat: {} as Record<string, number>, total: 0, unconvertedCount: 0, unconvertedCurrencies: [] as string[] }),
    [items, fx],
  );

  const delta = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;
  // Categorías vigentes (las filas viejas, p. ej. "Alojamiento", se suman a "Hospedaje"). Antes
  // solo se dibujaban 5 categorías fijas y lo demás se perdía del desglose.
  const data = useMemo(() => donutSlices(byCat), [byCat]);
  const breakdown = useMemo(() => categoryBreakdown(byCat), [byCat]);

  return (
    <div>
      <div className="glass-card rounded-2xl p-6 md:p-8 mb-6">
        <p className="text-xs text-primary tracking-[0.2em] uppercase mb-2">Este mes</p>
        <div className="flex items-end gap-4 flex-wrap">
          <p className="font-display text-4xl md:text-5xl">{formatMoney(Math.round(thisMonth), "MXN", 0)}</p>
          {lastMonth > 0 && (
            <span className={`flex items-center gap-1 text-sm ${delta >= 0 ? "text-destructive" : "text-emerald-500"}`}>
              {delta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {Math.abs(delta).toFixed(0)}% vs mes anterior
            </span>
          )}
        </div>
        {fx && items.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            En pesos mexicanos · {fxLabel(fx)}
            {unconvertedCount > 0 && ` · ${unconvertedCount} gasto(s) sin convertir (${unconvertedCurrencies.join(", ")}: sin tipo de cambio disponible)`}
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-6">
          <p className="text-xs text-primary tracking-[0.2em] uppercase mb-4">Por categoría</p>
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Aún no hay datos. Registra tu primer gasto.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={data.length > 1 ? 2 : 0} stroke="hsl(var(--surface))" strokeWidth={2}>
                    {data.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                    formatter={(v: number) => formatMoney(Math.round(v), "MXN", 0)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="glass-card rounded-2xl p-6">
          <p className="text-xs text-primary tracking-[0.2em] uppercase mb-4">Desglose</p>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Sin gastos convertibles todavía.</p>
          ) : (
          <ul className="space-y-3">
            {breakdown.map((c) => (
                <li key={c.name}>
                  <div className="flex justify-between text-sm mb-1 gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} aria-hidden="true" />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{formatMoney(Math.round(c.value), "MXN", 0)} · {c.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: c.color }} />
                  </div>
                </li>
            ))}
          </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartSpendPanel;
