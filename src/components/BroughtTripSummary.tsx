// Resumen de un viaje traído ("Ya tengo mi viaje"): la persona ya compró vuelos y hotel. Se dice tal
// cual — "Vuelos y hotel: ya los tienes" — sin precio inventado, sin "$0" y sin "estimado": el total
// del viaje no los suma. Cada ciudad con sus fechas y su hotel ubicado en Google Maps.
import { ExternalLink, Hotel, MapPin, Plane } from "lucide-react";
import { broughtFlights, fmtDay, tripBases } from "@/lib/broughtTrip";
import type { ReactNode } from "react";

export function BroughtTripSummary({ trip, children }: { trip: any; children?: ReactNode }) {
  const bases = tripBases(trip);
  const flights = broughtFlights(trip);
  return (
    <section className="glass-card rounded-2xl border border-primary/25 p-4 md:p-6" aria-labelledby="brought-title" data-testid="brought-summary">
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-primary">Lo trajiste tú</span>
      <h2 id="brought-title" className="mt-2 font-display text-2xl md:text-3xl">Vuelos y hotel: ya los tienes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        No les ponemos precio ni los sumamos al total. Aquí planeas lo demás: restaurantes, museos, tours y experiencias.
      </p>

      {flights.length > 0 && (
        <ul className="mt-4 space-y-1.5" aria-label="Tus vuelos">
          {flights.map((f, i) => (
            <li key={`${f.numero_vuelo}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm" data-testid="brought-flight">
              <Plane aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-medium">Vuelo {f.numero_vuelo}</span>
              {f.fecha && <span className="text-muted-foreground">· {fmtDay(f.fecha)}</span>}
              <span className="text-xs text-emerald-400">· Ya lo tienes</span>
            </li>
          ))}
        </ul>
      )}

      <ol className="mt-4 divide-y divide-white/[0.06]" aria-label="Tus ciudades y hoteles">
        {bases.map((b, i) => (
          <li key={`${b.ciudad}-${i}`} className="py-2.5" data-testid="brought-base" data-city={b.ciudad}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium"><MapPin aria-hidden className="h-3.5 w-3.5 text-primary" /> {b.ciudad}</span>
              {b.llegada && b.salida && (
                <span className="text-xs text-muted-foreground">
                  {fmtDay(b.llegada)} – {fmtDay(b.salida)}{b.noches ? ` · ${b.noches} ${b.noches === 1 ? "noche" : "noches"}` : ""}
                </span>
              )}
            </p>
            {b.hotel ? (
              <p className="mt-1 flex items-start gap-1.5 text-xs" data-testid="brought-hotel">
                <Hotel aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
                <span className="min-w-0 break-words">
                  <span className="text-foreground">{b.hotel.nombre}</span>
                  {b.hotel.direccion && <span className="text-muted-foreground"> · {b.hotel.direccion}</span>}
                  <span className="text-emerald-400"> · Ya lo tienes</span>
                  {b.hotel.maps_url && (
                    <a href={b.hotel.maps_url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline">
                      Ver en Google Maps <ExternalLink aria-hidden className="h-3 w-3" />
                    </a>
                  )}
                </span>
              </p>
            ) : (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Hotel aria-hidden className="h-3.5 w-3.5 shrink-0" /> Hotel: ya lo tienes (no nos dijiste cuál)</p>
            )}
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}

export default BroughtTripSummary;
