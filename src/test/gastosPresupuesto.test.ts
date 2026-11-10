// Recorrido Gastos 10-nov-2026: el Resumen usaba la cotización como presupuesto aunque la persona puso el suyo
// (Los Cabos: «de $132,529» en Gastos, «$100,000» en la pestaña Gastos del viaje). Ahora ambos usan tripBudget.
import { describe, it, expect } from "vitest";
import { spendInsights } from "@/lib/spendInsights";
import { tripBudget } from "@/lib/tripSpend";

const FX = { base: "USD", rates: { USD: 1, MXN: 18.5 }, fetchedAt: "2026-11-09T00:00:00Z", source: "test" } as any;
const NOW = new Date(2026, 11, 5, 12);
const items = [{ amount: 5000, currency: "MXN", category: "Restaurantes", expense_date: "2026-12-05", trip_id: "cabos" }];

describe("Resumen de Gastos: presupuesto del viaje", () => {
  it("usa el presupuesto que puso la persona antes que la cotización", () => {
    const trip = { id: "cabos", destino: "Los Cabos", fecha_salida: "2026-12-04", fecha_regreso: "2026-12-07", total_estimado: 132529, moneda: "MXN", presupuesto_objetivo: 100000, num_viajeros: 4 };
    const r = spendInsights(items, [trip], FX, { activeTripId: "cabos", now: NOW });
    expect(r.active?.presupuesto).toBe(100000);
    expect(r.active?.presupuesto).toBe(tripBudget(trip, FX)?.total);
    expect(r.active?.presupuestoDiario).toBe(25000);
  });
  it("sin presupuesto propio, la cotización (convertida a pesos)", () => {
    const trip = { id: "cabos", destino: "Los Cabos", fecha_salida: "2026-12-04", fecha_regreso: "2026-12-07", total_estimado: 2000, moneda: "USD" };
    const r = spendInsights(items, [trip], FX, { activeTripId: "cabos", now: NOW });
    expect(r.active?.presupuesto).toBe(37000);
  });
});
