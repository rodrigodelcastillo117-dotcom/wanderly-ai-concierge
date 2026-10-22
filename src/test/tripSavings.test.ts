import { describe, it, expect } from "vitest";
import { computeSavings, defaultState, isUpcoming, type Trip } from "@/components/TripSavingsCalculator";

const now = new Date(2026, 9, 22); // 22 oct 2026
const trip = (over: Partial<Trip> = {}): Trip => ({
  id: "t", destino: "París", pais_destino: "Francia", fecha_salida: "2027-04-22", fecha_regreso: null,
  total_estimado: 159000, moneda: "MXN", ...over,
});
const state = (over: Partial<ReturnType<typeof defaultState>> = {}) => ({ ...defaultState(), ...over });

describe("computeSavings", () => {
  it("computes the monthly saving from income, expenses and savings", () => {
    const s = state({ sueldo: "35000", extras: "5000", patrimonio: "20000" });
    s.fijos.renta = "12000";
    s.variables.restaurantes = "3000";
    const r = computeSavings(s, trip(), now);
    expect(r.ingreso).toBe(40000);
    expect(r.capacidadAhorro).toBe(25000);
    expect(r.meses).toBe(6);
    expect(Math.round(r.ahorroRequerido)).toBe(23167); // (159,000 − 20,000) / 6
    expect(r.estado).toBe("ajustado");
  });

  it("asks for income instead of saying the trip is unaffordable", () => {
    expect(computeSavings(state(), trip(), now).estado).toBe("sin_ingresos");
  });

  it("handles a trip with no cost or already covered by savings", () => {
    expect(computeSavings(state({ sueldo: "30000" }), trip({ total_estimado: 0 }), now).estado).toBe("sin_costo");
    expect(computeSavings(state({ patrimonio: "200000" }), trip(), now).estado).toBe("pagado");
  });

  it("treats a trip this month as one month left", () => {
    const r = computeSavings(state({ sueldo: "500000" }), trip({ fecha_salida: "2026-10-30" }), now);
    expect(r.meses).toBe(0);
    expect(r.ahorroRequerido).toBe(159000);
  });
});

describe("isUpcoming", () => {
  it("excludes trips that already left", () => {
    expect(isUpcoming({ fecha_salida: "2026-06-29" }, now)).toBe(false);
    expect(isUpcoming({ fecha_salida: "2026-10-22" }, now)).toBe(true);
    expect(isUpcoming({ fecha_salida: null }, now)).toBe(true);
  });
});
