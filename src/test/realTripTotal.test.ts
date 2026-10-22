import { describe, it, expect } from "vitest";
import { tripTotals } from "@/components/RealTripTotal";

describe("tripTotals", () => {
  it("shows the quoted total even when it is above the budget (antes mostraba el presupuesto)", () => {
    const t = tripTotals({ total_estimado: 185000, presupuesto_objetivo: 120000 }, 2);
    expect(t.total).toBe(185000);
    expect(t.porPersona).toBe(92500);
    expect(t.excedente).toBe(65000);
  });

  it("has no excess when the quote fits the budget or there is no budget", () => {
    expect(tripTotals({ total_estimado: 90000, presupuesto_objetivo: 120000 }, 2).excedente).toBe(0);
    expect(tripTotals({ total_estimado: 90000 }, 2).excedente).toBe(0);
  });

  it("falls back to the breakdown and then to the items", () => {
    expect(tripTotals({ desglose_presupuesto: { vuelos: 30000, hospedaje: 20000 } }, 2).total).toBe(50000);
    const items = { vuelos_json: [{ precio_por_persona: 10000 }], hospedaje_json: [{ precio_por_noche: 3000, noches: 4 }] };
    expect(tripTotals(items, 2).total).toBe(32000);
  });
});
