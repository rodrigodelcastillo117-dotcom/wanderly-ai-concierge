// "Toscana → Siena · Lucca": cómo se recorrerá cada región escrita en la ruta, antes de generar.
// Las bases salen de la tabla curada (_shared/regions.ts), igual que en logistics-plan; se puede quitar
// una base (×) o sumar otra de la misma tabla (+).
import { X, Plus } from "lucide-react";
import { expandRegions, findRegion, normPlace } from "../../../supabase/functions/_shared/regions.ts";

type Props = {
  stops: string[];
  nights?: number[] | null;
  choices: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
};

export function RegionBases({ stops, nights, choices, onChange }: Props) {
  const r = expandRegions(stops, nights ?? undefined, choices);
  if (!r.expansions.length) return null;
  const used = new Set(r.destinations.map(normPlace));
  return (
    <div className="mt-3 space-y-1.5" data-testid="region-bases">
      {r.expansions.map((e) => {
        const region = findRegion(e.region);
        const idx = stops.findIndex((s) => findRegion(s)?.name === e.region);
        const max = nights && idx >= 0 ? nights[idx] : Infinity;
        const extra = (region?.bases ?? []).map((b) => b[0]).filter((b) => !used.has(normPlace(b)));
        const set = (ciudades: string[]) => onChange({ ...choices, [e.region]: ciudades });
        return (
          <div key={e.region} className="flex flex-wrap items-center gap-1.5 text-[11px]">
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
            {e.ciudades.length < Math.min(3, max) && extra.map((c) => (
              <button key={c} type="button" aria-label={`Agregar ${c}`}
                className="inline-flex items-center gap-0.5 rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-primary hover:border-primary/40"
                onClick={() => set([...e.ciudades, c])}>
                <Plus className="w-3 h-3" /> {c}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
