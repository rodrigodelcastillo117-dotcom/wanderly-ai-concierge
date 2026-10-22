// Cierre de auditoría — grupo iato-cotiz: cotizaciones y operación (ver
// docs/iatos/cierre/IATO_COTIZACIONES_OPERACION.md). Reproducciones que fallan antes de la corrección.
import { describe, it, expect } from "vitest";
import { tripDatesProblem } from "../../supabase/functions/analizar-viaje/dates";
import { priceDropBody } from "../../supabase/functions/price-watch-cron/rules";

// ═══ AUD-Q-07 · analizar-viaje cotiza fechas pasadas o inválidas ═══
describe("AUD-Q-07 · fechas del análisis", () => {
  const now = new Date("2026-10-22T18:00:00Z");
  it("salida en el pasado → se rechaza antes de apartar la cuota", () => {
    expect(tripDatesProblem({ fecha_salida: "2026-03-01", fecha_regreso: "2026-03-08" }, now)).toMatch(/ya pasó/);
  });
  it("fecha imposible o regreso antes de la salida → se rechaza", () => {
    expect(tripDatesProblem({ fecha_salida: "2026-13-40", fecha_regreso: "2026-12-01" }, now)).toMatch(/no es válida/);
    expect(tripDatesProblem({ fecha_salida: "2026-12-10", fecha_regreso: "2026-12-01" }, now)).toMatch(/regreso/);
  });
  it("hoy en México (UTC ya es mañana) y fechas futuras son válidas; sin fechas se resuelven después", () => {
    expect(tripDatesProblem({ fecha_salida: "2026-10-22", fecha_regreso: "2026-10-25" }, new Date("2026-10-23T03:00:00Z"))).toBeNull();
    expect(tripDatesProblem({ fecha_salida: "2026-12-10", fecha_regreso: "2026-12-17" }, now)).toBeNull();
    expect(tripDatesProblem({}, now)).toBeNull();
  });
});

// ═══ AUD-OPS-08 · alerta de precio: "tipo de cambio de hoy" aunque se usó la tabla de respaldo ═══
describe("AUD-OPS-08 · copia honesta del tipo de cambio en la alerta", () => {
  it("con tipo de cambio de respaldo no dice 'de hoy'", () => {
    const b = priceDropBody({ price: 9000, before: 10000, totalSaving: 2000, adults: 2, fxIsFallback: true });
    expect(b).not.toMatch(/de hoy/);
    expect(b).toMatch(/tipo de cambio de referencia/);
  });
  it("con tipo de cambio en vivo conserva el texto de siempre", () => {
    expect(priceDropBody({ price: 9000, before: 10000, totalSaving: 1000, adults: 1, fxIsFallback: false }))
      .toBe("Ahora $9,000 MXN (antes $10,000 MXN, al tipo de cambio de hoy). Ahorras $1,000 MXN.");
  });
});
