import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMoney, fxLabel, summarizeSpend, type SpendItem } from "@/lib/fx";
import { useFxTable } from "@/hooks/useFxTable";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

const COLORS = ["#C9A961", "#E0C586", "#8b7355", "#6b5a45", "#3f3528"];
const CATEGORIAS = ["Alojamiento", "Gastronomía", "Experiencias", "Transporte", "Otros"];

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
  const data = CATEGORIAS.map((c) => ({ name: c, value: byCat[c] ?? 0 })).filter((d) => d.value > 0);

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
            {unconvertedCount > 0 && ` · ${unconvertedCount} gasto(s) sin convertir (${unconvertedCurrencies.join(", ")}: sin tipo de cambio)`}
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
                  <Pie data={data} dataKey="value" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
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
          <div className="space-y-3">
            {CATEGORIAS.map((c, i) => {
              const v = byCat[c] ?? 0;
              const pct = total > 0 ? (v / total) * 100 : 0;
              return (
                <div key={c}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                      {c}
                    </span>
                    <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[i] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmartSpendPanel;
