// Recorrido en producción (9-nov-2026): «¿Cuánto me va a costar mi viaje a Puerto Escondido y qué parte es estimada?»
// Iato: «No tengo la fecha de consulta», «Tours: no tienen precio guardado», «No puedo desglosar los 54,988 MXN».
// La página del viaje sí lo muestra todo. Ahora el contexto del viaje lleva el desglose, la hora de la cotización y
// el precio de los tours.
import { describe, expect, it } from "vitest";
import { compactTripForPrompt } from "../../supabase/functions/concierge-chat/context";

const PUERTO = {
  id: "c0b1", destino: "Puerto Escondido", fecha_salida: "2026-11-12", fecha_regreso: "2026-11-16", num_viajeros: 2, moneda: "MXN",
  created_at: "2026-10-22T18:30:00Z", total_estimado: 54988,
  desglose_presupuesto: { vuelos: 20108, hospedaje: 13380, comida: 12000, tours: 5000, transporte_local: 2500, extras: 2000, casetas: 0 },
  vuelos_json: [{ aerolinea: "Volaris", precio_por_persona: 10054, fuente_precio: "serpapi" }],
  hospedaje_json: [{ nombre: "Cielito Lindo Suites", precio_por_noche: 3345, fuente_precio: "serpapi" }],
  tours_json: [{ nombre: "Liberación de tortugas", precio_por_persona: 450 }, { nombre: "Snorkel en Carrizalillo", precio: 2200, fuente_precio: "estimado" }, { nombre: "Sin precio" }],
};

describe("contexto del viaje para Iato", () => {
  const c: any = compactTripForPrompt(PUERTO, { todayISO: "2026-11-09", tz: "America/Mexico_City" });

  it("lleva el desglose del total por categoría (sin ceros) y cómo leerlo", () => {
    expect(c.total_estimado).toBe(54988);
    expect(c.desglose_total_mxn).toEqual({
      vuelos: 20108, hospedaje: 13380, "comida (estimado)": 12000, "tours y experiencias": 5000,
      "transporte entre ciudades y local (estimado)": 2500,
      "extras: impuestos de ciudad, visas y colchón por tipo de cambio (estimado; NO incluye vuelos ni trenes)": 2000,
    });
    expect(Object.values(c.desglose_total_mxn as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(54988);
    expect(c.desglose_nota).toMatch(/estimado/);
  });

  it("vuelo y hotel dicen cuándo se cotizaron (la del viaje si el precio no trae hora)", () => {
    expect(c.vuelos[0].precio_consultado).toMatch(/22 oct 2026/);
    expect(c.hospedaje[0].precio_consultado).toMatch(/22 oct 2026/);
  });

  it("los tours llevan su precio por persona", () => {
    expect(c.tours.map((t: any) => [t.nombre, t.precio_por_persona])).toEqual([
      ["Liberación de tortugas", 450], ["Snorkel en Carrizalillo", 2200], ["Sin precio", undefined],
    ]);
  });

  it("un viaje sin desglose no inventa uno", () => {
    const s: any = compactTripForPrompt({ ...PUERTO, desglose_presupuesto: null }, { todayISO: "2026-11-09" });
    expect(s.desglose_total_mxn).toBeUndefined();
    expect(s.desglose_nota).toBeUndefined();
  });
});
