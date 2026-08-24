import { describe, it, expect } from "vitest";

/**
 * Contrato de coherencia de presupuesto que aplica `analizar-viaje`:
 * total_estimado SIEMPRE es la suma exacta del desglose, redondeada a entero,
 * y nunca se acepta un total de 0 como cotización válida.
 */
function normalizarPresupuesto(desglose: Record<string, unknown>, totalIa: number) {
  const limpio = Object.fromEntries(
    Object.entries(desglose ?? {}).map(([k, v]) => [k, Math.round(Number(v) || 0)]),
  );
  const suma = Object.values(limpio).reduce((s, v) => s + v, 0);
  if (suma > 0) return { desglose: limpio, total: suma, valido: true };
  if (Number(totalIa) > 0) return { desglose: limpio, total: Math.round(totalIa), valido: true };
  return { desglose: limpio, total: 0, valido: false };
}

describe("cotización: coherencia del presupuesto", () => {
  it("el total sobrescribe cualquier total incoherente de la IA", () => {
    const r = normalizarPresupuesto(
      { vuelos: 24000, hospedaje: 18000, comidas: 9000, tours: 5000 },
      99999,
    );
    expect(r.total).toBe(56000);
    expect(r.valido).toBe(true);
  });

  it("redondea a enteros y descarta valores no numéricos", () => {
    const r = normalizarPresupuesto({ vuelos: 1000.4, hospedaje: "abc" as any, extras: null as any }, 0);
    expect(r.desglose).toEqual({ vuelos: 1000, hospedaje: 0, extras: 0 });
    expect(r.total).toBe(1000);
  });

  it("marca como inválida una cotización en cero (nunca se guarda)", () => {
    const r = normalizarPresupuesto({ vuelos: 0, hospedaje: 0 }, 0);
    expect(r.valido).toBe(false);
  });
});
