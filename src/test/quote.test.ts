import { describe, it, expect } from "vitest";
import { computeTripDesglose, quoteStaleness, quoteValidity, staleQuoteMessage, tripNights, type QuoteSnapshot } from "@/lib/quote";

const snap = (over: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
  id: "q1", created_at: "2026-10-22T10:00:00Z", valid_until: "2026-10-23T10:00:00Z", travelers: 2, nights: 5, rooms: 1,
  date_from: "2026-11-10", date_to: "2026-11-15", total: 100000, currency: "MXN", fx_rate: 18.4, fx_source: "frankfurter",
  fx_at: "2026-10-21T00:00:00Z", fx_is_fallback: false, ...over,
});
const trip = { num_viajeros: 2, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", total_estimado: 100000 };

describe("cotización desactualizada al cambiar viajeros o fechas (D-02)", () => {
  it("mismos viajeros y fechas → vigente", () => {
    expect(quoteStaleness(trip, snap())).toMatchObject({ stale: false, reasons: [] });
  });
  it("cambiar a 4 viajeros → desactualizada; la base sigue siendo 2 (no se reparte el total viejo)", () => {
    const s = quoteStaleness({ ...trip, num_viajeros: 4 }, snap());
    expect(s).toMatchObject({ stale: true, reasons: ["viajeros"], basis: { travelers: 2 } });
    expect(staleQuoteMessage(s.basis!)).toMatch(/^Cotización para 2 viajeros del 10 nov\.? al 15 nov\.? 2026; actualiza la cotización$/);
  });
  it("cambiar fechas → desactualizada", () => {
    expect(quoteStaleness({ ...trip, fecha_regreso: "2026-11-18" }, snap()).reasons).toEqual(["fechas"]);
  });
  it("sin snapshot usa trips.quote_basis; sin nada (viaje viejo) no inventa", () => {
    const legacy = { ...trip, num_viajeros: 3, quote_basis: { num_viajeros: 2, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15" } };
    expect(quoteStaleness(legacy, null)).toMatchObject({ stale: true, basis: { travelers: 2 } });
    expect(quoteStaleness({ ...trip, num_viajeros: 3 }, null)).toMatchObject({ stale: false, basis: null });
    expect(quoteStaleness({ ...trip, quote_needs_update: true, quote_basis: { num_viajeros: 2, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15" } }, null).stale).toBe(true);
  });
});

describe("fecha y vigencia de la cotización", () => {
  it("vigente: 'Cotizado el … · válido hasta …'", () => {
    const v = quoteValidity(trip, snap(), new Date("2026-10-22T12:00:00Z"));
    expect(v.expired).toBe(false);
    expect(v.label).toMatch(/^Cotizado el .+ · válido hasta .+/);
  });
  it("vencida: 'Precio de hace X; verifica antes de reservar'", () => {
    const v = quoteValidity(trip, snap(), new Date("2026-10-25T10:00:00Z"));
    expect(v.expired).toBe(true);
    expect(v.label).toBe("Precio de hace 3 días; verifica antes de reservar");
  });
  it("viaje sin snapshot: vale 24 h desde que se guardó", () => {
    expect(quoteValidity({ updated_at: "2026-10-01T00:00:00Z" }, null, new Date("2026-10-22T00:00:00Z")).label).toBe("Precio de hace 21 días; verifica antes de reservar");
    expect(quoteValidity({}, null).label).toBe("Sin fecha de cotización; verifica los precios antes de reservar");
  });
});

describe("desglose según selecciones (TripDetail)", () => {
  const t = {
    desglose_presupuesto: { vuelos: 44000, hospedaje: 25000, comida: 9000, tours: 20000, transporte_local: 2000, extras: 1000 },
    vuelos_json: [{ precio_por_persona: 18000 }, { precio_por_persona: 22000 }],
    hospedaje_json: [{ precio_por_noche: 5000 }],
    tours_json: [{ precio_por_persona: 1000 }, { precio_por_persona: 2000 }],
  };
  const sel = (over = {}) => ({ selVuelo: -1, selHospedaje: -1, nochesHospedaje: 5, selTours: new Set<number>(), ...over });
  it("sin selección usa la cotización", () => {
    expect(computeTripDesglose(t, sel(), 2)).toEqual(t.desglose_presupuesto);
  });
  it("'ya lo tengo' = 0; hotel elegido = noche × noches × habitaciones", () => {
    const d = computeTripDesglose(t, sel({ selVuelo: -2, selHospedaje: 0 }), 4);
    expect(d.vuelos).toBe(0);
    expect(d.hospedaje).toBe(5000 * 5 * 2);
  });
  it("tours elegidos × viajeros", () => {
    expect(computeTripDesglose(t, sel({ selTours: new Set([1]) }), 3).tours).toBe(6000);
  });
  it("noches por fechas; sin fechas, por el itinerario", () => {
    expect(tripNights({ fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15" }, 3)).toBe(5);
    expect(tripNights({}, 6)).toBe(5);
    expect(tripNights({}, 0)).toBe(1);
  });
});
