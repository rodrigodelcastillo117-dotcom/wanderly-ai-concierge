// Presupuesto objetivo = TOTAL del viaje para todos los viajeros (vuelos, hoteles, comida, todo).
// Así lo usa la app (RealTripTotal lo compara contra el total del viaje) y así lo recibe la IA;
// antes la pantalla solo decía "Presupuesto" y el dueño preguntó si era diario, por persona o total.
import { Slider } from "@/components/ui/slider";

export const BUDGET_MIN = 5_000;
export const BUDGET_MAX = 1_000_000;
export const BUDGET_DEFAULT = 30_000;

/** Paso del slider según el monto: fino en montos chicos, grueso en viajes grandes. */
export function budgetStep(v: number): number {
  if (v < 50_000) return 1_000;
  if (v < 200_000) return 5_000;
  return 10_000;
}

export function nightsBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

const mxn = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

/** "≈ $19,000 por persona · $3,800 por persona por día" (solo con lo que se sabe). */
export function budgetHint(total: number, travelers: number, nights: number | null): string {
  const people = Math.max(1, travelers || 1);
  const perPerson = total / people;
  const parts = [people > 1 ? `≈ ${mxn(perPerson)} por persona` : null];
  if (nights && nights > 0) {
    const days = nights + 1;
    parts.push(`${mxn(perPerson / days)} por ${people > 1 ? "persona por " : ""}día`);
  }
  return parts.filter(Boolean).join(" · ");
}

export function BudgetField({ value, onChange, travelers, nights, size = "lg" }: {
  value: number | null;
  onChange: (v: number | null) => void;
  travelers: number;
  nights: number | null;
  size?: "lg" | "sm";
}) {
  const people = Math.max(1, travelers || 1);
  const hint = value !== null ? budgetHint(value, people, nights) : "";
  return (
    <div className="space-y-3" data-testid="budget-field">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {value === null ? "Sin presupuesto fijo" : `Total del viaje · ${people === 1 ? "1 persona" : `${people} personas`}`}
        </span>
        {value !== null && (
          <span className={`font-display gold-text ${size === "lg" ? "text-4xl" : "text-2xl"}`}>
            {mxn(value)}<span className="text-sm text-muted-foreground ml-1">MXN</span>
          </span>
        )}
      </div>
      <Slider
        aria-label="Presupuesto total del viaje en MXN"
        value={[value ?? BUDGET_DEFAULT]}
        onValueChange={(v) => onChange(v[0])}
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={budgetStep(value ?? BUDGET_DEFAULT)}
      />
      <p className="text-xs text-muted-foreground">
        Todo incluido: vuelos, hoteles, comida y experiencias{hint ? ` · ${hint}` : ""}.
      </p>
      <button
        type="button"
        onClick={() => onChange(value === null ? BUDGET_DEFAULT : null)}
        className="text-sm text-primary hover:underline"
      >
        {value === null ? "Establecer un presupuesto" : "Quitar presupuesto fijo"}
      </button>
    </div>
  );
}
