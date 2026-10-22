import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { trackBookingClick } from "@/lib/trackBooking";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { localISODatePlus } from "@/lib/localDate";
import { toastFunctionError } from "@/lib/functionErrors";
import { priceWatchView } from "@/lib/priceWatchView";

type Watch = Tables<"price_watches">;
// amount_original / currency: monto en la moneda del proveedor (migración 20261022132200; aún no
// están en los tipos generados).
type Check = Pick<Tables<"price_watch_checks">, "price_mxn" | "checked_at" | "approximate_dates" | "source"> & {
  amount_original?: number | null;
  currency?: string | null;
};

const mxn = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("es-MX")}`;

function ago(iso: string | null): string {
  if (!iso) return "pendiente";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "hace un momento";
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 220, h = 44, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i * (w - pad * 2)) / (points.length - 1);
    const y = pad + (1 - (p - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11" role="img" aria-label="Historial del precio">
      <polyline points={coords.join(" ")} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1].split(",")[0]} cy={coords[coords.length - 1].split(",")[1]} r="2.5" fill="hsl(var(--primary))" />
    </svg>
  );
}

export function PriceWatchCard({ tripId, departureDate }: { tripId: string; departureDate: string | null }) {
  const [watch, setWatch] = useState<Watch | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: w } = await supabase.from("price_watches").select("*").eq("trip_id", tripId).maybeSingle();
    setWatch(w ?? null);
    if (w) {
      const { data: c } = await supabase
        .from("price_watch_checks")
        .select("price_mxn,checked_at,approximate_dates,source,amount_original,currency")
        .eq("watch_id", w.id)
        .order("checked_at", { ascending: false })
        .limit(30);
      setChecks(((c ?? []) as unknown as Check[]).reverse());
    } else {
      setChecks([]);
    }
    setLoading(false);
  }, [tripId]);

  const tomorrow = localISODatePlus(1);
  const upcoming = !!departureDate && departureDate >= tomorrow;

  useEffect(() => { if (upcoming) load(); }, [load, upcoming]);

  if (!upcoming || loading) return null;

  const call = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("price-watch", { body: { action, trip_id: tripId } });
      if (error) {
        // FREE_LIMIT_REACHED (alertas incluidas en PRO o máximo del plan) abre el diálogo de límite.
        await toastFunctionError(error, "No pudimos actualizar la alerta. Intenta de nuevo.");
        return;
      }
      if (data?.error) {
        toast.error(data?.message ?? "No pudimos actualizar la alerta. Intenta de nuevo.");
        return;
      }
      toast.success(action === "start" ? "Te avisaremos si baja el precio" : "Alerta desactivada");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!watch || !watch.active) {
    return (
      <div className="glass-card rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <BellRing className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Vigila el precio de tus vuelos</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revisamos cada día la tarifa real de tu ruta y te avisamos si baja.
          </p>
        </div>
        <Button onClick={() => call("start")} disabled={busy} className="bg-gradient-gold text-primary-foreground hover:opacity-90 shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Activar alerta"}
        </Button>
      </div>
    );
  }

  // Comparación en la moneda del proveedor (como el servidor): un cambio del dólar no es una baja.
  const view = priceWatchView(watch as Parameters<typeof priceWatchView>[0], checks);
  const baseline = view.baselineMxn;
  const current = view.currentMxn;
  const delta = view.deltaMxn;
  const down = delta < 0;
  const exact = view.points;
  const route = `${watch.origin_iata} → ${watch.destination_iata}`;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BellRing className="w-4 h-4 text-primary shrink-0" />
          <p className="font-medium truncate">Vigilando tu vuelo {route}</p>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">Revisado {ago(watch.last_checked_at)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface/60 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Al activar</p>
          <p className="font-display text-lg">{mxn(baseline)}</p>
        </div>
        <div className="rounded-lg bg-surface/60 p-2.5 border border-primary/30">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hoy</p>
          <p className="font-display text-lg gold-text">{mxn(current)}</p>
        </div>
        <div className="rounded-lg bg-surface/60 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Más bajo</p>
          <p className="font-display text-lg">{mxn(view.lowestMxn)}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2 text-center">
        MXN por persona, viaje redondo{view.sameCurrency ? ` · comparado en ${view.currency}, al tipo de cambio de hoy` : ""}
      </p>

      {current != null && delta !== 0 && (
        <div className={`flex items-center gap-2 text-sm ${down ? "text-emerald-400" : "text-muted-foreground"}`}>
          {down ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
          {down
            ? `Bajó ${mxn(-delta)} por persona desde que activaste la alerta`
            : `Subió ${mxn(delta)} por persona desde que activaste la alerta`}
        </div>
      )}

      <Sparkline points={exact} />

      {watch.baseline_approximate && (
        <p className="text-[11px] text-muted-foreground">
          Aún no hay tarifa publicada para tu fecha exacta; usamos la más baja del mes como referencia. Solo te avisaremos con precios de tu fecha exacta.
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <PriceSourceBadge source={watch.baseline_source} consultadoAt={watch.last_checked_at} />
        <div className="flex-1" />
        <button type="button" onClick={() => call("stop")} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground transition">
          Dejar de vigilar
        </button>
        {watch.booking_link && (
          <Button
            size="sm"
            onClick={() => trackBookingClick({
              category: "flight", provider: "Aviasales", title: `Vuelo ${route}`,
              subtitle: current != null ? `${mxn(current)} MXN por persona` : undefined,
              bookingUrl: watch.booking_link!, startAt: watch.departure_date, tripId,
            })}
            className="bg-gradient-gold text-primary-foreground hover:opacity-90"
          >
            Reservar a este precio
          </Button>
        )}
      </div>
    </div>
  );
}
