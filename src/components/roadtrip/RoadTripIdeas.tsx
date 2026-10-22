// Ideas de road trips (grupo roadtrip): rutas curadas de sitios oficiales de turismo, con foto
// ilustrativa de Pexels (marcada "Foto ilustrativa" por SmartImage), paradas, días y mejor época.
// "Planear este road trip" abre la ruta de varios destinos con las paradas y el coche ya elegidos.
import { CalendarDays, Car, ExternalLink, MapPin, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { SmartImage } from "@/components/media/SmartImage";
import { CURATED_ROUTES, COUNTRIES, routePlannerPath, uniqueStops } from "@/lib/roadtrip";

export function RoadTripIdeas({ limit, title = "Ideas de road trips", className = "" }: { limit?: number; title?: string; className?: string }) {
  const routes = typeof limit === "number" ? CURATED_ROUTES.slice(0, limit) : CURATED_ROUTES;
  return (
    <section className={`space-y-4 ${className}`} aria-label={title} data-testid="roadtrip-ideas">
      <div className="flex items-center gap-2">
        <Car className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="font-display text-xl md:text-2xl">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground">Rutas tomadas de los sitios oficiales de turismo de cada región. Lo que la fuente no dice va marcado como sugerencia de IATOS.</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {routes.map((r) => {
          const stops = uniqueStops(r);
          const days = r.days_source ? (r.days_source.min === r.days_source.max ? `${r.days_source.min} días (según la fuente)` : `${r.days_source.min}–${r.days_source.max} días (según la fuente)`) : `${r.days_suggested} días (sugerencia IATOS)`;
          return (
            <li key={r.id} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col" data-route={r.id}>
              <SmartImage alt={`Foto ilustrativa: ${r.name}`} stockQuery={r.photo_query} size="card" className="h-36 w-full" captionPosition="bottom-right" />
              <div className="p-4 space-y-2 flex-1 flex flex-col">
                <p className="text-[10px] uppercase tracking-[0.2em] text-primary">{r.countries.map((c) => COUNTRIES[c].name).join(" · ")}</p>
                <h4 className="font-display text-lg leading-tight">{r.name}</h4>
                <p className="text-xs text-muted-foreground">{r.highlights}</p>
                <p className="text-xs flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{stops.join(" → ")}</span></p>
                <p className="text-xs flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />{days}{r.distance_source ? ` · ${r.distance_source}` : ""}</p>
                <p className="text-xs flex items-start gap-1.5"><Sun className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{r.best_season.text} <span className="text-muted-foreground">({r.best_season.from === "fuente" ? "según la fuente" : "sugerencia IATOS"})</span></span></p>
                <a href={r.source.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 break-all">
                  Fuente: {r.source.label} <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                </a>
                <div className="pt-2 mt-auto">
                  <Link to={routePlannerPath(r, r.days_source?.max ?? r.days_suggested)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 px-3 py-2 text-sm min-h-[44px]">
                    <Car className="w-4 h-4" aria-hidden="true" /> Planear este road trip
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
