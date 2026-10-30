import { useCallback, useEffect, useState } from "react";
import { Download, Inbox, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminDenied } from "@/components/AdminGate";
import { ServiceHealthCard } from "@/components/ServiceHealthCard";
import { AdminCostCard } from "@/components/AdminCostCard";
import { AdminReferralRewardsCard } from "@/components/AdminReferralRewardsCard";
import { AdminCommissionsCard } from "@/components/AdminCommissionsCard";
import { Button } from "@/components/ui/button";

type Weekly = { week: string; signups: number; trips: number; bookings: number };
type Metrics = {
  generated_at: string;
  users: { total: number; last_7d: number; last_30d: number; active_30d: number };
  activation: { users_with_trip: number; pct: number };
  trips: { total: number; last_30d: number; avg_total_mxn: number | null };
  concierge: { conversations: number; users: number; messages: number };
  bookings: { total: number; last_30d: number; by_category: Record<string, number> };
  affiliate_clicks: { total: number; last_30d: number };
  price_watches: { active: number; total: number; alerts_sent: number; checks: number };
  subscriptions: Record<string, number>;
  fixer: { total: number; last_30d: number };
  referrals: { total: number; last_30d: number; referrers: number };
  weekly: Weekly[];
};

const CATEGORY: Record<string, string> = {
  flight: "Vuelos", hotel: "Hoteles", car: "Autos", activity: "Actividades", restaurant: "Restaurantes",
  train: "Trenes", ferry: "Ferries", esim: "eSIM", insurance: "Seguros", other: "Otro",
};
const SUB_STATUS: Record<string, string> = {
  active: "Pagando", trialing: "En prueba", comped: "Cortesía", past_due: "Pago vencido", canceled: "Canceladas",
};

const n = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("es-MX"));
const pl = (v: number, one: string, many: string) => `${n(v)} ${Number(v) === 1 ? one : many}`;
const shortWeek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-primary text-[11px] tracking-[0.3em] uppercase">{title}</h2>
      {children}
    </section>
  );
}

// Single-series weekly bars: one hue, rounded data-ends at the baseline, 2px gaps,
// hover tooltip per bar with a hit target taller than the mark.
function WeeklyBars({ title, unit, data }: { title: string; unit: string; data: { week: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 300, h = 120, padTop = 8, padBottom = 18;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = w / data.length;
  const barW = Math.max(2, Math.min(14, slot * 0.55));
  const plotH = h - padTop - padBottom;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{n(total)} en 12 semanas</p>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" role="img" aria-label={`${title}, por semana`}>
          <line x1={0} x2={w} y1={h - padBottom} y2={h - padBottom} stroke="hsl(var(--border))" strokeWidth={1} />
          {data.map((d, i) => {
            const bh = d.value === 0 ? 0 : Math.max(2, (d.value / max) * plotH);
            const x = i * slot + (slot - barW) / 2;
            const y = h - padBottom - bh;
            const r = Math.min(4, barW / 2, bh);
            return (
              <g key={d.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * slot} y={0} width={slot} height={h - padBottom} fill="transparent" />
                {bh > 0 && (
                  <path
                    pointerEvents="none"
                    d={`M${x},${h - padBottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${h - padBottom} Z`}
                    fill="hsl(var(--primary))"
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
              </g>
            );
          })}
          <text x={0} y={h - 4} fontSize={9} fill="hsl(var(--muted-foreground))">{shortWeek(data[0].week)}</text>
          <text x={w} y={h - 4} fontSize={9} textAnchor="end" fill="hsl(var(--muted-foreground))">
            {shortWeek(data[data.length - 1].week)}
          </text>
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-md border border-white/10 bg-background/95 px-2 py-1 text-xs whitespace-nowrap shadow-lg"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          >
            <span className="text-muted-foreground">Semana del {shortWeek(data[hover].week)}: </span>
            <span className="text-foreground font-medium">{n(data[hover].value)} {unit}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const AdminMetrics = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    const { data, error } = await supabase.rpc("admin_metrics");
    if (error) {
      setState(error.code === "42501" || /not_authorized/.test(error.message) ? "forbidden" : "error");
      return;
    }
    setMetrics(data as unknown as Metrics);
    setState("ok");
  }, []);

  useEffect(() => { load(); }, [load]);

  const download = () => {
    if (!metrics) return;
    const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `iatos-metricas-${metrics.generated_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (state === "loading") {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      </DashboardLayout>
    );
  }

  // Denegación con explicación y salida (la misma que AdminGate).
  if (state === "forbidden") return <AdminDenied />;
  if (state !== "ok" || !metrics) {
    return (
      <DashboardLayout>
        <div className="max-w-md mx-auto px-4 py-24 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 text-primary mx-auto" />
          <p className="font-display text-2xl">
            No pudimos cargar las métricas
          </p>
          {state === "error" && <Button variant="outline" onClick={load}>Reintentar</Button>}
        </div>
      </DashboardLayout>
    );
  }

  const m = metrics;
  const categories = Object.entries(m.bookings.by_category).sort((a, b) => b[1] - a[1]);
  const subs = Object.entries(m.subscriptions).sort((a, b) => b[1] - a[1]);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <h1 className="font-display text-3xl md:text-4xl">Métricas de IATOS</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Datos en vivo de la base de producción · {new Date(m.generated_at).toLocaleString("es-MX")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90">
              <Link to="/dashboard/admin/operaciones"><Inbox className="w-3.5 h-3.5 mr-1.5" />Mesa de operaciones</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Actualizar</Button>
            <Button variant="outline" size="sm" onClick={download}><Download className="w-3.5 h-3.5 mr-1.5" />Descargar</Button>
          </div>
        </div>

        <ServiceHealthCard />

        <Section title="Usuarios">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Registrados" value={n(m.users.total)} />
            <Stat label="Nuevos · 7 días" value={n(m.users.last_7d)} />
            <Stat label="Nuevos · 30 días" value={n(m.users.last_30d)} />
            <Stat label="Activos · 30 días" value={n(m.users.active_30d)} hint="Cotizaron, usaron concierge o reservaron" />
          </div>
        </Section>

        <Section title="Producto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Activación" value={`${m.activation.pct}%`} hint={`${pl(m.activation.users_with_trip, "cotizó", "cotizaron")} al menos un viaje`} />
            <Stat label="Viajes cotizados" value={n(m.trips.total)} hint={`${n(m.trips.last_30d)} en 30 días`} />
            <Stat label="Viaje promedio" value={m.trips.avg_total_mxn ? `$${n(m.trips.avg_total_mxn)}` : "—"} hint="MXN, total estimado" />
            <Stat label="Concierge" value={n(m.concierge.messages)} hint={`mensajes · ${pl(m.concierge.users, "usuario", "usuarios")}`} />
          </div>
        </Section>

        <Section title="Monetización">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Clics a reservar" value={n(m.bookings.total)} hint={`${n(m.bookings.last_30d)} en 30 días`} />
            <Stat label="Clics de afiliado" value={n(m.affiliate_clicks.total)} hint={`${n(m.affiliate_clicks.last_30d)} en 30 días`} />
            <Stat label="Alertas de precio" value={n(m.price_watches.active)} hint={`activas · ${pl(m.price_watches.alerts_sent, "aviso enviado", "avisos enviados")}`} />
            <Stat label="Invitaciones" value={n(m.referrals.total)} hint={`${pl(m.referrals.referrers, "usuario invitó", "usuarios invitaron")}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-sm font-medium mb-2">Reservas por categoría</p>
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aún no hay clics a reservar.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {categories.map(([k, v]) => (
                    <li key={k} className="flex justify-between"><span className="text-muted-foreground">{CATEGORY[k] ?? k}</span><span>{n(v)}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4">
              <p className="text-sm font-medium mb-2">Suscripciones</p>
              {subs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin suscripciones registradas.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {subs.map(([k, v]) => (
                    <li key={k} className="flex justify-between"><span className="text-muted-foreground">{SUB_STATUS[k] ?? k}</span><span>{n(v)}</span></li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-3">Escalaciones al Fixer humano: {n(m.fixer.total)} ({n(m.fixer.last_30d)} en 30 días)</p>
            </div>
          </div>
          <AdminReferralRewardsCard />
        </Section>

        <AdminCommissionsCard />

        <AdminCostCard />

        <Section title="Tendencia semanal">
          <div className="grid md:grid-cols-3 gap-3">
            <WeeklyBars title="Registros" unit="registros" data={m.weekly.map((x) => ({ week: x.week, value: x.signups }))} />
            <WeeklyBars title="Viajes cotizados" unit="viajes" data={m.weekly.map((x) => ({ week: x.week, value: x.trips }))} />
            <WeeklyBars title="Clics a reservar" unit="clics" data={m.weekly.map((x) => ({ week: x.week, value: x.bookings }))} />
          </div>
          <details className="rounded-xl bg-surface/60 border border-white/[0.06] p-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Ver tabla</summary>
            <table className="w-full mt-3 text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left font-normal py-1">Semana</th><th className="text-right font-normal">Registros</th><th className="text-right font-normal">Viajes</th><th className="text-right font-normal">Reservas</th></tr>
              </thead>
              <tbody>
                {m.weekly.map((x) => (
                  <tr key={x.week} className="border-t border-white/[0.05]">
                    <td className="py-1">{shortWeek(x.week)}</td><td className="text-right">{n(x.signups)}</td>
                    <td className="text-right">{n(x.trips)}</td><td className="text-right">{n(x.bookings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Section>
      </div>
    </DashboardLayout>
  );
};

export default AdminMetrics;
