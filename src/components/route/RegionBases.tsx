// "Toscana → Siena · Lucca": cómo se recorrerá cada región escrita en la ruta, antes de generar.
// Las bases salen de la tabla curada (_shared/regions.ts), igual que en logistics-plan; se puede quitar
// una base (×) o sumar otra de la misma tabla (+). Lo que la tabla no conoce (un país, otra región o una
// carretera) llega en `places` (función place-resolve: Google Geocoding + ciudades de Wikidata) y se
// muestra con las mismas chips; un destino ambiguo muestra sus candidatos reales para elegir.
import { X, Plus, Car } from "lucide-react";
import { expandRegions, findRegion, normPlace, placeKey, placeLookup, type Region } from "../../../supabase/functions/_shared/regions.ts";
import type { PlaceResolution } from "../../../supabase/functions/_shared/placeResolve.ts";

type Props = {
  stops: string[];
  nights?: number[] | null;
  choices: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  /** Resoluciones de place-resolve para destinos que la tabla no conoce. */
  places?: PlaceResolution[];
  /** La persona eligió un candidato ("Córdoba, Argentina") para el destino ambiguo `input`. */
  onPick?: (input: string, label: string) => void;
};

export function RegionBases({ stops, nights, choices, onChange, places = [], onPick }: Props) {
  const lookup = placeLookup(places);
  const regionOf = (d: string): Region | null => findRegion(d) ?? lookup(d);
  const r = expandRegions(stops, nights ?? undefined, choices, lookup);
  const inStops = (p: PlaceResolution) => stops.some((s) => placeKey(s) === placeKey(p.input));
  const roads = places.filter((p) => inStops(p) && p.status === "ok" && p.kind === "route" && !r.expansions.some((e) => e.region === p.name));
  const unclear = places.filter((p) => inStops(p) && p.status === "needs_clarification");
  if (!r.expansions.length && !roads.length && !unclear.length) return null;
  const used = new Set(r.destinations.map(normPlace));
  return (
    <div className="mt-3 space-y-1.5" data-testid="region-bases">
      {r.expansions.map((e, i) => {
        const idx = stops.findIndex((s) => regionOf(s)?.name === e.region);
        const region = idx >= 0 ? regionOf(stops[idx]) : findRegion(e.region);
        const max = nights && idx >= 0 ? nights[idx] : Infinity;
        const limit = region?.kind === "route" ? 4 : 3;
        // Las de Wikidata pueden ser 8: se ofrecen las 4 más pobladas que faltan (la tabla curada, todas).
        const extra = (region?.bases ?? []).map((b) => b[0]).filter((b) => !used.has(normPlace(b))).slice(0, region?.source ? 4 : undefined);
        const set = (ciudades: string[]) => onChange({ ...choices, [e.region]: ciudades });
        return (
          <div key={`${e.region}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-primary">{e.region} →</span>
            {e.ciudades.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-foreground">
                {c}
                {e.ciudades.length > 1 && (
                  <button type="button" aria-label={`Quitar ${c}`} className="text-muted-foreground hover:text-foreground"
                    onClick={() => set(e.ciudades.filter((x) => x !== c))}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
            {e.ciudades.length < Math.min(limit, max) && extra.map((c) => (
              <button key={c} type="button" aria-label={`Agregar ${c}`}
                className="inline-flex items-center gap-0.5 rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-primary hover:border-primary/40"
                onClick={() => set([...e.ciudades, c])}>
                <Plus className="w-3 h-3" /> {c}
              </button>
            ))}
            {e.tipo === "carretera" && <span className="inline-flex items-center gap-1 text-muted-foreground"><Car className="w-3 h-3" /> en coche</span>}
            {e.fuente === "wikidata" && <span className="text-muted-foreground/70">· ciudades de Wikidata</span>}
          </div>
        );
      })}
      {roads.map((p) => (
        <div key={`road-${p.input}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-primary">{p.name ?? p.input} →</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-foreground">
            <Car className="w-3 h-3" /> recorrido en coche
          </span>
          <span className="text-muted-foreground/70">· sin paradas confirmadas en Wikidata</span>
        </div>
      ))}
      {unclear.map((p) => (
        <div key={`clar-${p.input}`} className="flex flex-wrap items-center gap-1.5 text-[11px]" role="group" aria-label={`Aclarar ${p.input}`}>
          <span className="text-amber-400/90">{(p.candidates ?? []).length ? `«${p.input}»: ¿te refieres a…?` : p.message ?? `No encontramos «${p.input}».`}</span>
          {(p.candidates ?? []).map((c) => (
            <button key={c.label} type="button" aria-label={`Elegir ${c.label}`}
              className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 px-2 py-0.5 text-foreground hover:bg-primary/10"
              onClick={() => onPick?.(p.input, c.label)}>
              {c.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
