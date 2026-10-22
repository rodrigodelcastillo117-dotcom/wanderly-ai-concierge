// Modo de transporte entre paradas (grupo roadtrip): avión, tren, "En coche (road trip)" o mezcla
// por tramo. El valor viaja a logistics-plan como prefs.transport_mode / prefs.leg_modes.
import { Car, Plane, Shuffle, Train } from "lucide-react";
import type { LegMode, TransportMode } from "@/lib/roadtrip";

const MODES: Array<{ id: TransportMode; label: string; icon: typeof Car }> = [
  { id: "avion", label: "Avión", icon: Plane },
  { id: "tren", label: "Tren", icon: Train },
  { id: "coche", label: "En coche (road trip)", icon: Car },
  { id: "mixto", label: "Mezclar por tramo", icon: Shuffle },
];

const LEG_LABEL: Record<LegMode, string> = { avion: "Avión", tren: "Tren", coche: "Coche" };

export function TransportModePicker({ stops, mode, legModes, onChange }: {
  stops: string[];
  mode: TransportMode | null;
  legModes: LegMode[];
  onChange: (mode: TransportMode | null, legModes: LegMode[]) => void;
}) {
  const legs = Math.max(0, stops.length - 1);
  const current = Array.from({ length: legs }, (_, i) => legModes[i] ?? "tren");
  return (
    <div className="space-y-3" data-testid="transport-mode-picker">
      <p id="modo-transporte" className="text-xs uppercase tracking-widest text-muted-foreground">Cómo te mueves entre paradas</p>
      <div role="radiogroup" aria-labelledby="modo-transporte" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={active}
              onClick={() => onChange(active ? null : m.id, m.id === "mixto" ? current : Array.from({ length: legs }, () => (m.id === "mixto" ? "tren" : (m.id as LegMode))))}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition min-h-[44px] ${
                active ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-surface hover:border-primary/30 text-muted-foreground"}`}>
              <Icon className={`w-4 h-4 shrink-0 ${active ? "text-primary" : ""}`} aria-hidden="true" />
              <span className="min-w-0 leading-tight">{m.label}</span>
            </button>
          );
        })}
      </div>
      {mode === null && <p className="text-[11px] text-muted-foreground">Sin elegir, IATOS AI propone el transporte de cada tramo.</p>}
      {mode === "mixto" && legs > 0 && (
        <ul className="space-y-2" aria-label="Transporte por tramo">
          {current.map((lm, i) => (
            <li key={`${stops[i]}-${stops[i + 1]}-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <span className="text-sm min-w-0 flex-1 break-words">{stops[i]} → {stops[i + 1]}</span>
              <div className="flex gap-1" role="radiogroup" aria-label={`Tramo ${i + 1}: ${stops[i]} a ${stops[i + 1]}`}>
                {(["avion", "tren", "coche"] as LegMode[]).map((opt) => (
                  <button key={opt} type="button" role="radio" aria-checked={lm === opt}
                    onClick={() => onChange("mixto", current.map((x, j) => (j === i ? opt : x)))}
                    className={`rounded-full border px-3 py-1 text-xs min-h-[32px] ${lm === opt ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                    {LEG_LABEL[opt]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
