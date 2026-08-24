import { BadgeCheck, Sparkles } from "lucide-react";

/** Fuentes que consideramos "precio verificado en vivo" (API de inventario real). */
const LIVE_SOURCES = new Set([
  "serpapi",
  "serpapi-hotels",
  "google_hotels",
  "google_flights",
  "travelpayouts",
  "aviasales",
]);

const LABELS: Record<string, string> = {
  serpapi: "Precio verificado en vivo · Google",
  "serpapi-hotels": "Precio verificado en vivo · Google Hotels",
  google_hotels: "Precio verificado en vivo · Google Hotels",
  google_flights: "Precio verificado en vivo · Google Flights",
  travelpayouts: "Precio verificado en vivo · Aviasales",
  aviasales: "Precio verificado en vivo · Aviasales",
};

export const isLivePrice = (source?: string | null) => Boolean(source && LIVE_SOURCES.has(source));

export function PriceSourceBadge({ source, className = "" }: { source?: string | null; className?: string }) {
  if (!source) return null;
  const live = isLivePrice(source);
  const label = live ? (LABELS[source] ?? "Precio verificado en vivo") : "Estimado por IA";

  return (
    <span
      title={live ? "Tarifa consultada en tiempo real con el proveedor" : "Aproximación generada por IA; puede variar al reservar"}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${
        live
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-surface/60 text-muted-foreground"
      } ${className}`}
    >
      {live ? <BadgeCheck className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
      {label}
    </span>
  );
}
