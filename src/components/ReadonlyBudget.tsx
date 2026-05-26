import { useMemo, useState } from "react";
import { Plane, ChevronRight, ChevronDown } from "lucide-react";

type Flight = {
  aerolinea?: string;
  from?: string;
  to?: string;
  ciudad?: string;
  precio_por_persona?: number;
  mode?: string;
};

type Props = {
  desglose: Record<string, number>;
  total: number;
  /** Vuelos individuales (multi-destino) para desglosar el rubro "Vuelos" por tramo */
  vuelos?: Flight[];
  /** Número de viajeros (para multiplicar precio_por_persona) */
  travelers?: number;
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

export const ReadonlyBudget = ({ desglose, total, vuelos = [], travelers = 1 }: Props) => {
  const items = useMemo(
    () =>
      ORDER
        .map((o) => ({ ...o, value: Number(desglose?.[o.key] ?? 0) }))
        .filter((i) => i.value > 0),
    [desglose],
  );

  // Tramos de vuelo individuales con costo total (precio_por_persona × travelers)
  const flightLegs = useMemo(() => {
    return (vuelos ?? [])
      .map((v) => ({
        label:
          v.from && (v.to || v.ciudad)
            ? `${v.from} → ${v.to || v.ciudad}`
            : v.aerolinea || "Tramo",
        airline: v.aerolinea,
        total: Number(v.precio_por_persona ?? 0) * Math.max(1, travelers),
      }))
      .filter((l) => l.total > 0);
  }, [vuelos, travelers]);

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

      {/* Desglose por tramo de vuelo */}
      {flightLegs.length > 0 && (() => {
        const vuelosTotal = items.find((i) => i.key === "vuelos")?.value ?? 0;
        const sumLegs = flightLegs.reduce((s, l) => s + l.total, 0);
        return (
          <div className="mt-6 pt-5 border-t border-border/40">
            <div className="flex items-center gap-2 mb-3">
              <Plane className="w-3.5 h-3.5 text-primary" />
              <p className="text-[10px] tracking-[0.25em] uppercase text-primary">
                Desglose por vuelo · {flightLegs.length} {flightLegs.length === 1 ? "tramo" : "tramos"}
              </p>
            </div>
            <div className="space-y-2">
              {flightLegs.map((leg, i) => {
                const pctOfTotal = (leg.total / total) * 100;
                const pctOfFlights = vuelosTotal > 0 ? (leg.total / vuelosTotal) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-border/50 bg-surface/40 px-3 py-2.5"
                  >
                    <span className="font-mono text-[10px] text-primary w-6">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{leg.label}</p>
                      {leg.airline && (
                        <p className="text-[10px] text-muted-foreground truncate">{leg.airline}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {Math.round(pctOfFlights)}% vuelos · {Math.round(pctOfTotal)}% total
                      </span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                      <span className="text-sm font-medium tabular-nums w-[110px]">
                        {fmtMXN(leg.total)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {Math.abs(sumLegs - vuelosTotal) > 1 && vuelosTotal > 0 && (
                <p className="text-[10px] text-muted-foreground/70 italic pt-1">
                  Nota: tramos suman {fmtMXN(sumLegs)} — el total de vuelos arriba ({fmtMXN(vuelosTotal)}) refleja sólo el vuelo principal seleccionado.
                </p>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ReadonlyBudget;
