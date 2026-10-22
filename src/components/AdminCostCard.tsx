// Costo de proveedores de los últimos 30 días, por plan y por función (solo administradores).
// Lee public.admin_cost_metrics(), que agrega ai_usage_log en el servidor y rechaza a quien no
// está en public.admins. Son ESTIMACIONES con precios públicos (supabase/functions/_shared/usage.ts).
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PlanRow = { plan: string; cost_usd: number; calls: number; searches: number; users: number };
type FnRow = { function: string; provider: string; cost_usd: number; calls: number; searches: number; input_tokens: number; output_tokens: number };
export type CostMetrics = {
  generated_at: string;
  days: number;
  total: { cost_usd: number; calls: number; searches: number; users: number };
  by_plan: PlanRow[];
  by_function: FnRow[];
  cache: { entries: number; hits: number };
};

const PLAN_LABEL: Record<string, string> = { free: "Gratis", trial: "Prueba PRO", pro: "PRO", system: "Tareas automáticas" };
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Claude", gemini: "Gemini", lovable: "IA de respaldo", serpapi: "SerpApi", pexels: "Pexels", perplexity: "Perplexity",
};

const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? "—" : `US$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("es-MX"));

/** Acepta solo la forma esperada: si el servidor manda otra cosa, no se dibuja nada. */
function isCostMetrics(v: unknown): v is CostMetrics {
  const m = v as CostMetrics | null;
  return !!m && typeof m === "object" && !!m.total && Array.isArray(m.by_plan) && Array.isArray(m.by_function);
}

export function AdminCostCard() {
  const [data, setData] = useState<CostMetrics | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva, aún no está en los tipos generados
    const { data: d, error } = await supabase.rpc("admin_cost_metrics" as any, { _days: 30 });
    if (error || !isCostMetrics(d)) {
      setState("error");
      return;
    }
    setData(d);
    setState("ok");
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-3">
      <h2 className="text-primary text-[11px] tracking-[0.3em] uppercase">Costo de proveedores · 30 días</h2>
      {state === "loading" && (
        <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        </div>
      )}
      {state === "error" && (
        <p className="rounded-xl bg-surface/60 border border-white/[0.06] p-4 text-xs text-muted-foreground">
          No pudimos cargar el costo (¿falta aplicar la migración del registro de uso?).
        </p>
      )}
      {state === "ok" && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Costo estimado</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{usd(data.total.cost_usd)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n(data.total.calls)} llamadas</p>
            </div>
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Búsquedas SerpApi</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{n(data.total.searches)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">reales (sin contar la caché)</p>
            </div>
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Usuarios con costo</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{n(data.total.users)}</p>
            </div>
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Caché compartida</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{n(data.cache.hits)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">aciertos · {n(data.cache.entries)} guardadas</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-sm font-medium mb-2">Por plan</p>
              {data.by_plan.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin registros en este periodo.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-normal py-1">Plan</th><th className="text-right font-normal">Usuarios</th><th className="text-right font-normal">Búsquedas</th><th className="text-right font-normal">Costo</th></tr>
                  </thead>
                  <tbody>
                    {data.by_plan.map((r) => (
                      <tr key={r.plan} className="border-t border-white/[0.05]">
                        <td className="py-1">{PLAN_LABEL[r.plan] ?? r.plan}</td><td className="text-right">{n(r.users)}</td>
                        <td className="text-right">{n(r.searches)}</td><td className="text-right">{usd(r.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-sm font-medium mb-2">Por función</p>
              {data.by_function.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin registros en este periodo.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left font-normal py-1">Función</th><th className="text-right font-normal">Llamadas</th><th className="text-right font-normal">Costo</th></tr>
                  </thead>
                  <tbody>
                    {data.by_function.map((r) => (
                      <tr key={`${r.function}-${r.provider}`} className="border-t border-white/[0.05]">
                        <td className="py-1">{r.function} <span className="text-muted-foreground">· {PROVIDER_LABEL[r.provider] ?? r.provider}</span></td>
                        <td className="text-right">{n(r.calls)}</td><td className="text-right">{usd(r.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Estimación con precios públicos (SerpApi a US$0.015 por búsqueda; tokens según el modelo que respondió). La factura de cada proveedor manda.
          </p>
        </div>
      )}
    </section>
  );
}
