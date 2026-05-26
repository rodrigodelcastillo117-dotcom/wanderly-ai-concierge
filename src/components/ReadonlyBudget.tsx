import { useMemo } from "react";

type Props = {
  desglose: Record<string, number>;
  total: number;
};

const ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: "vuelos", label: "Vuelos", color: "hsl(var(--primary))" },
  { key: "hospedaje", label: "Hospedaje", color: "hsl(41 60% 70%)" },
  { key: "comida", label: "Comida", color: "hsl(28 50% 55%)" },
  { key: "tours", label: "Tours", color: "hsl(35 40% 45%)" },
  { key: "transporte_local", label: "Transporte", color: "hsl(25 30% 35%)" },
  { key: "extras", label: "Extras", color: "hsl(40 20% 50%)" },
];

const fmtMXN = (n: number) =>
  `$${Math.round(n).toLocaleString("es-MX")} MXN`;

export const ReadonlyBudget = ({ desglose, total }: Props) => {
  const items = useMemo(
    () =>
      ORDER
        .map((o) => ({ ...o, value: Number(desglose?.[o.key] ?? 0) }))
        .filter((i) => i.value > 0),
    [desglose],
  );

  if (items.length === 0 || total <= 0) return null;

  return (
    <div className="glass-card rounded-2xl p-6 md:p-8">
      <div className="mb-5">
        <p className="text-xs tracking-[0.2em] uppercase text-primary mb-1">Total estimado</p>
        <p className="font-display text-3xl md:text-4xl gold-text">{fmtMXN(total)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Calculado en base a las opciones seleccionadas arriba.
        </p>
      </div>

      <div className="relative flex h-5 rounded-full overflow-hidden mb-5">
        {items.map((it) => {
          const pct = (it.value / total) * 100;
          return (
            <div
              key={it.key}
              className="h-full"
              style={{ width: `${pct}%`, background: it.color }}
              title={`${it.label}: ${fmtMXN(it.value)}`}
            />
          );
        })}
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: it.color }}
            />
            <div className="flex-1">
              <div className="flex justify-between items-baseline mb-0.5">
                <span className="text-sm text-muted-foreground">{it.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round((it.value / total) * 100)}%
                </span>
              </div>
              <p className="text-sm font-medium">{fmtMXN(it.value)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReadonlyBudget;
