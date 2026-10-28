// Tramo crucero del viaje: "Crucero: {puertos} · {fechas}" con enlaces reales para cotizarlo (la naviera
// si la dijo la persona; si no, buscadores conocidos y una búsqueda con puertos y fechas). Sin precio:
// "por cotizar con la naviera", no suma al total. Sale de itinerario_json.logistics.sea_legs (plan) o,
// si el plan no los trae, de la interpretación guardada (itinerario_json.consulta).
import { ExternalLink, Ship } from "lucide-react";
import { cruiseLine, consultaOf, type Cruise } from "../../../supabase/functions/_shared/tripSpec";
import { CRUISE_PRICE_NOTE, cruiseLinks } from "@/lib/cruiseLinks";

type Leg = { from: string | null; to: string | null; cruise: Cruise };

export function cruiseLegsOf(trip: any): Leg[] {
  const sea: any[] = Array.isArray(trip?.itinerario_json?.logistics?.sea_legs) ? trip.itinerario_json.logistics.sea_legs : [];
  const fromPlan = sea.filter((l) => l?.tipo !== "ferry").map((l) => ({
    from: l.from ?? null, to: l.to ?? null,
    cruise: { naviera: l.naviera ?? null, barco: null, puerto_salida: l.puerto_salida ?? null, puerto_llegada: l.puerto_llegada ?? null,
      fecha_salida: l.fecha_salida ?? null, fecha_llegada: l.fecha_llegada ?? null, noches: Number(l.noches) || null },
  }));
  if (fromPlan.length) return fromPlan;
  const spec = consultaOf(trip)?.interpretacion;
  if (!spec) return [];
  return spec.paradas.map((s, i) => (s.llegada_por === "crucero" && s.crucero
    ? { from: spec.paradas[i - 1]?.ciudad ?? null, to: s.ciudad, cruise: s.crucero } : null)).filter(Boolean) as Leg[];
}

export function CruiseLegsCard({ trip }: { trip: any }) {
  const legs = cruiseLegsOf(trip);
  if (!legs.length) return null;
  return (
    <section className="glass-card space-y-3 rounded-2xl p-4 sm:p-5" aria-labelledby="tramo-crucero" data-testid="tramo-crucero">
      <h2 id="tramo-crucero" className="flex items-center gap-2 font-display text-lg"><Ship className="h-5 w-5 text-primary" aria-hidden="true" /> Tu crucero</h2>
      {legs.map((l, i) => (
        <div key={i} className="rounded-xl border border-border/60 bg-surface/40 p-3.5">
          <p className="text-sm font-medium" data-testid="tramo-crucero-linea">{cruiseLine(l.cruise, l.from, l.to)}</p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="tramo-crucero-precio">{CRUISE_PRICE_NOTE}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {cruiseLinks(l.cruise, l.from, l.to).map((x) => (
              <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" title={x.nota}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-primary/40 px-3 text-xs text-primary hover:bg-primary/10">
                {x.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Los vuelos para llegar al puerto y salir del puerto de llegada están en los tramos del viaje.</p>
        </div>
      ))}
    </section>
  );
}

export default CruiseLegsCard;
