import { describe, it, expect } from "vitest";
import { buildQuoteSnapshot, lineStateFor, saveQuoteSnapshot, STATES_IN_TOTAL } from "../../supabase/functions/_shared/quotes";

const now = new Date("2026-10-22T12:00:00Z");
const fxLive = { rate: 18.4, source: "frankfurter", fetched_at: "2026-10-21T00:00:00Z", is_fallback: false };
const base = {
  tripId: "t1", userId: "u1", origin: "analizar-viaje" as const,
  breakdown: { vuelos: 88000, hospedaje: 75000, comida: 30000, tours: 8000, transporte_local: 4000, extras: 2000 },
  travelers: 4, nights: 5, rooms: 2, dateFrom: "2026-11-10", dateTo: "2026-11-15", now,
  reference: {
    vuelos: { fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T10:00:00Z", booking_link: "https://www.aviasales.com/x" },
    hospedaje: { fuente_precio: "estimado", estado_dato: "ESTIMADO" },
  },
};

describe("buildQuoteSnapshot", () => {
  it("suma de renglones = desglose = total; guarda viajeros, noches, habitaciones, fechas y FX", () => {
    const q = buildQuoteSnapshot({ ...base, fx: fxLive });
    const sum = q.line_items.filter((l) => STATES_IN_TOTAL.includes(l.state)).reduce((s, l) => s + l.amount, 0);
    expect(q.total).toBe(207000);
    expect(sum).toBe(q.total);
    expect(Object.values(q.breakdown).reduce((a, b) => a + b, 0)).toBe(q.total);
    expect(q).toMatchObject({ travelers: 4, nights: 5, rooms: 2, date_from: "2026-11-10", date_to: "2026-11-15", fx_rate: 18.4, fx_source: "frankfurter", fx_is_fallback: false, currency: "MXN" });
    const byCat = Object.fromEntries(q.line_items.map((l) => [l.category, l]));
    expect(byCat.vuelos).toMatchObject({ state: "COTIZADO", source: "serpapi", qty: 4, qty_basis: "per_person" });
    expect(byCat.hospedaje).toMatchObject({ state: "ESTIMADO", qty: 10, qty_basis: "per_room_night" });
    expect(byCat.comida.state).toBe("ESTIMADO");
    // Vigencia: el precio en vivo más viejo + 24 h.
    expect(q.valid_until).toBe("2026-10-23T10:00:00.000Z");
  });

  it("con tipo de cambio de respaldo ningún renglón queda COTIZADO y la vigencia es la de un estimado (7 días)", () => {
    const q = buildQuoteSnapshot({ ...base, fx: { ...fxLive, source: "fallback", is_fallback: true } });
    expect(q.fx_is_fallback).toBe(true);
    expect(q.line_items.some((l) => l.state === "COTIZADO")).toBe(false);
    expect(q.valid_until).toBe("2026-10-29T12:00:00.000Z");
  });

  it("exclusiones y opcionales: 'ya tengo vuelo' = EXCLUIDO en 0; crucero = OPCIONAL fuera del total", () => {
    const q = buildQuoteSnapshot({
      ...base, fx: fxLive,
      breakdown: { ...base.breakdown, vuelos: 0 },
      excluded: { vuelos: true },
      optional: [{ category: "crucero", label: "Crucero", amount: 60000 }],
    });
    const byCat = Object.fromEntries(q.line_items.map((l) => [l.category, l]));
    expect(byCat.vuelos).toMatchObject({ state: "EXCLUIDO", amount: 0 });
    expect(byCat.crucero).toMatchObject({ state: "OPCIONAL", amount: 60000 });
    expect(q.total).toBe(207000 - 88000);
  });

  it("estado por renglón", () => {
    expect(lineStateFor({ estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T11:00:00Z" }, now, false)).toBe("COTIZADO");
    expect(lineStateFor({ estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-20T11:00:00Z" }, now, false)).toBe("PENDIENTE");
    expect(lineStateFor({ estado_dato: "PENDIENTE_DE_VERIFICACION" }, now, false)).toBe("PENDIENTE");
    expect(lineStateFor({ estado_dato: "CONFIRMADO" }, now, false)).toBe("PAGADO");
    expect(lineStateFor({ fuente_precio: "serpapi" }, now, false)).toBe("ESTIMADO");
    expect(lineStateFor(null, now, false)).toBe("ESTIMADO");
  });
});

describe("saveQuoteSnapshot", () => {
  it("inserta con el cliente dado y apunta trips.current_quote_id", async () => {
    const calls: any[] = [];
    const admin = {
      from: (table: string) => ({
        insert: (row: any) => { calls.push(["insert", table, row]); return { select: () => ({ single: async () => ({ data: { id: "q1", created_at: "c", valid_until: "v" }, error: null }) }) }; },
        update: (patch: any) => ({ eq: async (_c: string, id: string) => { calls.push(["update", table, patch, id]); return { error: null }; } }),
      }),
    };
    const row = buildQuoteSnapshot({ ...base, fx: fxLive });
    expect(await saveQuoteSnapshot(admin, row)).toEqual({ id: "q1", created_at: "c", valid_until: "v" });
    expect(calls[0].slice(0, 2)).toEqual(["insert", "trip_quotes"]);
    expect(calls[1]).toEqual(["update", "trips", { current_quote_id: "q1" }, "t1"]);
  });
  it("si la tabla no existe (migración sin aplicar) no rompe la cotización", async () => {
    const admin = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }) };
    const errSpy = console.error;
    console.error = () => {};
    try {
      expect(await saveQuoteSnapshot(admin, buildQuoteSnapshot({ ...base, fx: fxLive }))).toBeNull();
      expect(await saveQuoteSnapshot(null, buildQuoteSnapshot({ ...base, fx: fxLive }))).toBeNull();
    } finally { console.error = errSpy; }
  });
});
