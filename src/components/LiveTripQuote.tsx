import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Plane, Hotel, Sparkles, RefreshCw } from "lucide-react";
import { useLiveQuote, type LiveQuote } from "@/hooks/useLiveQuote";

type Props = {
  origin?: string;
  destination?: string;
  depart?: string;
  return_date?: string;
  nights: number;
  travelers: number;
  fallbackMxn: number;
};

const fmtMXN = (n: number) =>
  `$${Math.round(n).toLocaleString("es-MX")} MXN`;

export function LiveTripQuote({ origin, destination, depart, return_date, nights, travelers, fallbackMxn }: Props) {
  const { data, loading, error } = useLiveQuote({
    origin, destination, depart, return_date, nights, travelers, enabled: true,
  });

  const display = useMotionValue(0);
  const rounded = useTransform(display, (v) => fmtMXN(v));

  useEffect(() => {
    const target = data?.total_mxn ?? (error ? fallbackMxn : 0);
    if (!target) return;
    const controls = animate(display, target, { duration: 1.6, ease: "easeOut" });
    return controls.stop;
  }, [data, error, fallbackMxn, display]);

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-8 md:p-10 mb-8 relative overflow-hidden">
        <p className="text-xs tracking-[0.2em] uppercase text-primary mb-3">Inversión total estimada</p>
        <div className="h-16 md:h-20 w-2/3 rounded-lg bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10 animate-pulse mb-4" />
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
          Cotizando tarifas y disponibilidad en tiempo real…
        </p>
      </div>
    );
  }

  const q: LiveQuote | null = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-8 md:p-10 mb-8"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-xs tracking-[0.2em] uppercase text-primary">
          Inversión total · grupo de {travelers} {travelers === 1 ? "persona" : "personas"}
        </p>
        {q && (
          <span className="text-[10px] tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" /> estimación IA · precios de mercado
          </span>
        )}
      </div>
      <motion.p className="font-display text-5xl md:text-6xl gold-text mb-2">
        {rounded as any}
      </motion.p>
      {q && (
        <p className="text-xs text-muted-foreground mb-2">
          ≈ ${q.total_usd.toLocaleString("en-US")} USD · incluye 20% buffer para experiencias diarias
        </p>
      )}
      <p className="text-sm text-muted-foreground mb-1">
        Para <span className="text-foreground font-medium">{travelers} {travelers === 1 ? "persona" : "personas"}</span> · {nights} noches
      </p>
      <p className="text-[11px] text-muted-foreground/80 mb-6 italic">
        Precio total del grupo (no por persona) · ≈ {fmtMXN(Math.round((data?.total_mxn ?? fallbackMxn) / Math.max(1, travelers)))} por persona
      </p>


      {q && (
        <div className="grid md:grid-cols-2 gap-3">
          {q.flight && (
            <div className="rounded-xl border border-border bg-surface/50 p-4">
              <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-primary/80 mb-2">
                <Plane className="w-3 h-3" /> Vuelo round-trip
              </div>
              <div className="flex items-center gap-3">
                {q.flight.airline_logo && (
                  <img src={q.flight.airline_logo} alt={q.flight.airline} className="w-8 h-8 rounded object-contain bg-white/90 p-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{q.flight.airline}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.flight.departure} → {q.flight.arrival} · {q.flight.duration} · {q.flight.stops === 0 ? "directo" : `${q.flight.stops} escala${q.flight.stops > 1 ? "s" : ""}`}
                  </p>
                </div>
                <p className="ml-auto font-display text-lg gold-text">${q.flight.price_usd.toLocaleString("en-US")}</p>
              </div>
            </div>
          )}
          {q.hotel && (
            <div className="rounded-xl border border-border bg-surface/50 p-4">
              <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-primary/80 mb-2">
                <Hotel className="w-3 h-3" /> Hospedaje {q.hotel.hotel_class ? `${q.hotel.hotel_class}★` : "premium"}
              </div>
              <div className="flex items-center gap-3">
                {q.hotel.thumbnail && (
                  <img src={q.hotel.thumbnail} alt={q.hotel.name} className="w-10 h-10 rounded object-cover" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{q.hotel.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ${q.hotel.nightly_usd.toLocaleString("en-US")}/noche × {nights}n
                    {q.hotel.rating ? ` · ${q.hotel.rating}★` : ""}
                  </p>
                </div>
                <p className="ml-auto font-display text-lg gold-text">${q.breakdown.hotel_total_usd.toLocaleString("en-US")}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!q && error && (
        <p className="text-xs text-muted-foreground mt-2">
          No pudimos cotizar en tiempo real. Mostrando estimación basada en tus selecciones.
        </p>
      )}
    </motion.div>
  );
}
