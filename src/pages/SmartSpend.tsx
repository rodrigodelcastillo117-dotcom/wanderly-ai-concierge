import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { TripSavingsCalculator } from "@/components/TripSavingsCalculator";


const COLORS = ["#C9A961", "#E0C586", "#8b7355", "#6b5a45", "#3f3528"];
const CATEGORIAS = ["Alojamiento", "Gastronomía", "Experiencias", "Transporte", "Otros"];

const SmartSpend = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<{ amount: number; category: string; expense_date: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("expenses").select("amount,category,expense_date").eq("user_id", user.id)
      .then(({ data }) => setItems((data as any) ?? []));
  }, [user]);

  const { thisMonth, lastMonth, byCat, total } = useMemo(() => {
    const now = new Date();
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
    const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let thisMonth = 0, lastMonth = 0;
    const byCat: Record<string, number> = {};
    items.forEach((x) => {
      const d = new Date(x.expense_date);
      const amt = Number(x.amount);
      if (d >= m0) thisMonth += amt;
      else if (d >= m1) lastMonth += amt;
      byCat[x.category] = (byCat[x.category] ?? 0) + amt;
    });
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    return { thisMonth, lastMonth, byCat, total };
  }, [items]);

  const delta = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;
  const data = CATEGORIAS.map((c) => ({ name: c, value: byCat[c] ?? 0 })).filter((d) => d.value > 0);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-5xl">
        <h1 className="font-display text-3xl md:text-5xl mb-3">Smart Spend</h1>
        <p className="text-muted-foreground mb-6 md:mb-10">Análisis inteligente de tus gastos.</p>

        <div className="glass-card rounded-2xl p-6 md:p-8 mb-6">
          <p className="text-xs text-primary tracking-[0.2em] uppercase mb-2">Este mes</p>
          <div className="flex items-end gap-4 flex-wrap">
            <p className="font-display text-3xl md:text-5xl">${thisMonth.toLocaleString("es-MX")}</p>
            {lastMonth > 0 && (
              <span className={`flex items-center gap-1 text-sm ${delta >= 0 ? "text-destructive" : "text-emerald-500"}`}>
                {delta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {Math.abs(delta).toFixed(0)}% vs mes anterior
              </span>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
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
                      formatter={(v: number) => `$${v.toLocaleString("es-MX")}`}
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

        <div className="mt-8">
          <TripSavingsCalculator />
        </div>

        <Link to="/dashboard/gastos" className="mt-6 inline-block px-5 py-2.5 rounded-full border border-primary/40 text-primary text-sm hover:bg-primary/10 transition">
          Ver detalles y análisis →
        </Link>
      </div>
    </DashboardLayout>
  );
};

export default SmartSpend;

