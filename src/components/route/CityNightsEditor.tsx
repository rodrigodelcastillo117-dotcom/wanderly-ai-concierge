// Orden y noches por ciudad de una ruta (París → Roma → Atenas). Las noches siempre suman las del viaje:
// +1 en una ciudad la quita de la que tiene más, −1 se la da a la siguiente. Así nunca queda un estado
// "no cuadra" que bloquee el botón de seguir.
import { ArrowDown, ArrowUp, Minus, Plus, X } from "lucide-react";
import { shiftNight } from "@/lib/multiCityText";

type Props = {
  cities: string[];
  nights: number[] | null;
  onChange: (nights: number[]) => void;
  /** Reordenar (planeador). Sin él no se muestran las flechas. */
  onMove?: (i: number, dir: -1 | 1) => void;
  onRemove?: (i: number) => void;
  /** Texto cuando aún no hay noches (sin fechas). */
  pendingNote?: string;
  /** "Por qué" de cada ciudad (ruta propuesta para un país). */
  notes?: (string | null)[] | null;
  className?: string;
};

const iconBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-30 disabled:hover:border-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const ghostBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const noches = (n: number) => `${n} ${n === 1 ? "noche" : "noches"}`;

export function CityNightsEditor({ cities, nights, onChange, onMove, onRemove, pendingNote, notes, className = "" }: Props) {
  const total = nights ? nights.reduce((a, b) => a + b, 0) : null;
  return (
    <div className={`space-y-2 ${className}`} data-testid="city-nights-editor">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{nights ? "Noches por ciudad" : "Orden de la ruta"}</p>
        {total != null && <p className="text-xs text-muted-foreground" data-testid="city-nights-total">{noches(total)} en {cities.length} ciudades</p>}
      </div>
      <ol className="space-y-1.5">
        {cities.map((c, i) => (
          <li key={`${c}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/60 bg-surface/40 px-2.5 py-1.5" data-testid="city-nights-row">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c}</span>
            {nights && (
              <span className="order-last flex w-full items-center gap-1 pl-8 sm:order-none sm:w-auto sm:pl-0" role="group" aria-label={`Noches en ${c}`}>
                <button type="button" className={iconBtn} aria-label={`Una noche menos en ${c}`} disabled={nights[i] <= 1}
                  onClick={() => onChange(shiftNight(nights, i, -1))}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
                <span className="w-[4.5rem] text-center text-sm tabular-nums" data-testid="city-nights-value">{noches(nights[i])}</span>
                <button type="button" className={iconBtn} aria-label={`Una noche más en ${c}`} disabled={!nights.some((n, j) => j !== i && n > 1)}
                  onClick={() => onChange(shiftNight(nights, i, 1))}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </span>
            )}
            {onMove && (
              <span className="flex shrink-0 items-center">
                <button type="button" className={ghostBtn} aria-label={`Subir ${c}`} disabled={i === 0} onClick={() => onMove(i, -1)}>
                  <ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={ghostBtn} aria-label={`Bajar ${c}`} disabled={i === cities.length - 1} onClick={() => onMove(i, 1)}>
                  <ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
              </span>
            )}
            {onRemove && cities.length > 2 && (
              <button type="button" className={ghostBtn} aria-label={`Quitar ${c}`} onClick={() => onRemove(i)}>
                <X className="h-4 w-4" aria-hidden="true" /></button>
            )}
            {notes?.[i] && <p className="order-last w-full pl-8 text-xs text-muted-foreground" data-testid="city-why">{notes[i]}</p>}
          </li>
        ))}
      </ol>
      {!nights && pendingNote && <p className="text-xs text-muted-foreground">{pendingNote}</p>}
    </div>
  );
}
