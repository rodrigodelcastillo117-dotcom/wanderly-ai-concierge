import { describe, it, expect } from "vitest";
// Prueba el código REAL de analizar-viaje (antes este archivo probaba una copia de la lógica).
import { detectExclusions, hotelPriceRooms, normalizarVuelos, reconcileBudget, roomsFor } from "../../supabase/functions/analizar-viaje/budget";
import { computeTripDesglose, hotelPriceRooms as clientHotelPriceRooms } from "@/lib/quote";

const analysis = (over: Record<string, unknown> = {}) => ({
  desglose_presupuesto: { vuelos: 50000, hospedaje: 20000, comida: 9000, tours: 5000, transporte_local: 2000, extras: 1000 },
  vuelos: [
    { tier: "ahorro", precio_por_persona: 18000 },
    { tier: "equilibrio", precio_por_persona: 22000 },
    { tier: "premium", precio_por_persona: 45000 },
  ],
  hospedaje: [{ precio_por_noche: 3000 }, { precio_por_noche: 5000 }, { precio_por_noche: 9000 }],
  ...over,
});

describe("habitaciones = ceil(viajeros/2) (igual que logistics-plan)", () => {
  it("1→1, 2→1, 3→2, 6→3", () => {
    expect([1, 2, 3, 6].map(roomsFor)).toEqual([1, 1, 2, 3]);
  });
  it("6 viajeros, hotel medio de $5,000, 5 noches → $75,000 (antes $25,000 por una sola habitación)", () => {
    const r = reconcileBudget(analysis(), { dias: 5, viajeros: 6 });
    expect(r.rooms).toBe(3);
    expect(r.desglose.hospedaje).toBe(75000);
    expect(r.desglose.vuelos).toBe(22000 * 6);
  });
});

describe("total = suma exacta del desglose", () => {
  it("sobrescribe cualquier total incoherente del modelo", () => {
    const r = reconcileBudget(analysis({ total_estimado: 999999 }), { dias: 5, viajeros: 2 });
    expect(r.total).toBe(Object.values(r.desglose).reduce((a, b) => a + b, 0));
    expect(r.desglose).toMatchObject({ vuelos: 44000, hospedaje: 25000, comida: 9000, tours: 5000, transporte_local: 2000, extras: 1000 });
    expect(r.valido).toBe(true);
  });
  it("redondea a enteros y descarta valores no numéricos", () => {
    const r = reconcileBudget({ desglose_presupuesto: { vuelos: 1000.4, hospedaje: "abc", extras: null }, vuelos: [], hospedaje: [] }, { dias: 3, viajeros: 1 });
    expect(r.desglose).toMatchObject({ vuelos: 1000, hospedaje: 0, extras: 0 });
    expect(r.total).toBe(1000);
  });
  it("una cotización en cero no es válida (aunque el modelo diga un total)", () => {
    const r = reconcileBudget({ total_estimado: 50000, desglose_presupuesto: { vuelos: 0, hospedaje: 0 } }, { dias: 3, viajeros: 2 });
    expect(r.valido).toBe(false);
  });
  it("acota la comida al techo por persona y día", () => {
    const r = reconcileBudget(analysis({ desglose_presupuesto: { comida: 999999 } }), { dias: 2, viajeros: 2 });
    expect(r.desglose.comida).toBe(12000 * 2 * 2);
  });
});

describe("respeta las exclusiones del usuario (D-05)", () => {
  it("'ya tengo vuelos, solo hotel' → vuelos en 0 aunque el modelo haya puesto un monto", () => {
    const r = reconcileBudget(analysis(), { dias: 5, viajeros: 2, notas: "Ya tengo vuelos, solo hotel por favor" });
    expect(r.exclusions.vuelos).toBe(true);
    expect(r.desglose.vuelos).toBe(0);
    expect(r.desglose.hospedaje).toBe(25000);
  });
  it("vuelos en 0 del modelo se quedan en 0", () => {
    const r = reconcileBudget(analysis({ desglose_presupuesto: { vuelos: 0, hospedaje: 20000 } }), { dias: 5, viajeros: 2 });
    expect(r.desglose.vuelos).toBe(0);
  });
  it("'sin hotel' → hospedaje 0; 'sin hotel en París' → se respeta el monto parcial del modelo", () => {
    expect(reconcileBudget(analysis(), { dias: 5, viajeros: 2, notas: "sin hotel, me quedo con familia" }).desglose.hospedaje).toBe(0);
    const parcial = reconcileBudget(analysis({ desglose_presupuesto: { vuelos: 50000, hospedaje: 12000 } }), { dias: 7, viajeros: 2, notas: "París sin hospedaje; sin hotel en París, en Roma sí" });
    expect(parcial.exclusions.hospedaje).toBe("partial");
    expect(parcial.desglose.hospedaje).toBe(12000);
  });
  it("hospedaje en 0 del modelo se queda en 0", () => {
    expect(reconcileBudget(analysis({ desglose_presupuesto: { vuelos: 1, hospedaje: 0 } }), { dias: 5, viajeros: 4 }).desglose.hospedaje).toBe(0);
  });
  it("detecta exclusiones comunes", () => {
    expect(detectExclusions("Ya tengo mi vuelo")).toMatchObject({ vuelos: true, hospedaje: false });
    expect(detectExclusions("vamos en carro desde CDMX")).toMatchObject({ vuelos: true });
    expect(detectExclusions("ya tengo dónde quedarme en Roma")).toMatchObject({ hospedaje: "partial" });
    expect(detectExclusions("solo vuelos")).toMatchObject({ hospedaje: "all", tours: true });
    expect(detectExclusions("sin tours, sin comida")).toMatchObject({ tours: true, comida: true });
    expect(detectExclusions("hotel boutique con vista al mar")).toEqual({ vuelos: false, hospedaje: false, tours: false, comida: false });
    expect(detectExclusions(null)).toEqual({ vuelos: false, hospedaje: false, tours: false, comida: false });
  });
});

describe("normalizarVuelos", () => {
  it("compara el tier sin mayúsculas: 'Premium' no se suma a equilibrio", () => {
    const r = normalizarVuelos([
      { tier: "ahorro", precio_por_persona: 18000 },
      { tier: "equilibrio", precio_por_persona: 22000 },
      { tier: "Premium", precio_por_persona: 45000 },
    ]);
    expect(r.map((v) => [v.tier, v.precio_por_persona])).toEqual([["ahorro", 18000], ["equilibrio", 22000], ["premium", 45000]]);
  });
  it("suma tramos del mismo tier y lo marca como estimado (ya no es un vuelo de la lista)", () => {
    const r = normalizarVuelos([
      { tier: "ahorro", aerolinea: "IB", precio_por_persona: 10000, fuente_precio: "travelpayouts" },
      { tier: "ahorro", aerolinea: "A3", precio_por_persona: 3000, fuente_precio: "travelpayouts" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ precio_por_persona: 13000, fuente_precio: "estimado", aerolinea: "IB + A3" });
  });
});

// Hallazgo R10 en producción (familia de 4 a Cancún, 5 noches): el precio del hotel venía en vivo
// de Google Hotels pedido con adults=4 (ya es del grupo) y se multiplicaba otra vez por 2
// habitaciones: hospedaje $106,460 en vez de $53,230.
describe("R10: precio en vivo del grupo no se multiplica por habitaciones", () => {
  const hoteles = [
    { nombre: "Mayan Monkey", precio_por_noche: 2514, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" },
    { nombre: "JW Marriott", precio_por_noche: 10646, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" },
    { nombre: "Iberostar", precio_por_noche: 15636, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" },
  ];
  it("4 viajeros, hotel medio en vivo de $10,646, 5 noches → $53,230 (antes $106,460)", () => {
    const r = reconcileBudget(analysis({ hospedaje: hoteles }), { dias: 5, viajeros: 4 });
    expect(r.rooms).toBe(2);
    expect(r.roomsPrecio).toBe(1);
    expect(r.desglose.hospedaje).toBe(53230);
    expect(r.total).toBe(Object.values(r.desglose).reduce((s, v) => s + v, 0));
  });
  it("precio estimado sigue siendo por habitación doble (6 viajeros → 3 habitaciones)", () => {
    const est = hoteles.map((h) => ({ ...h, fuente_precio: "estimado", estado_dato: "ESTIMADO" }));
    const r = reconcileBudget(analysis({ hospedaje: est }), { dias: 5, viajeros: 6 });
    expect(r.roomsPrecio).toBe(3);
    expect(r.desglose.hospedaje).toBe(10646 * 5 * 3);
  });
  it("hotelPriceRooms: en vivo → 1; estimado o sin fuente → ceil(viajeros/2)", () => {
    expect(hotelPriceRooms({ fuente_precio: "serpapi" }, 4)).toBe(1);
    expect(hotelPriceRooms({ estado_dato: "CONSULTADO_EN_VIVO" }, 5)).toBe(1);
    expect(hotelPriceRooms({ fuente_precio: "estimado" }, 4)).toBe(2);
    expect(hotelPriceRooms({}, 3)).toBe(2);
    expect(hotelPriceRooms(null, 1)).toBe(1);
  });
  it("el cliente (src/lib/quote) usa el mismo criterio", () => {
    for (const h of [{ fuente_precio: "serpapi" }, { estado_dato: "VERIFICADO" }, { fuente_precio: "estimado" }, {}]) {
      for (const n of [1, 2, 3, 4, 7]) expect(clientHotelPriceRooms(h, n)).toBe(hotelPriceRooms(h, n));
    }
    const trip = { desglose_presupuesto: {}, hospedaje_json: hoteles, vuelos_json: [], tours_json: [] };
    const d = computeTripDesglose(trip, { selVuelo: -1, selHospedaje: 1, nochesHospedaje: 5, selTours: new Set() }, 4);
    expect(d.hospedaje).toBe(53230);
  });
});
