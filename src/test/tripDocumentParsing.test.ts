// IATOS-064: la respuesta del modelo al leer documentos se valida campo por campo (fixtures escritas
// con el formato documentado en parse-trip-file; nunca se llama a la IA en pruebas).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { amount, isoDate, validateExtraction } from "../../supabase/functions/parse-trip-file/schema.ts";
import { validateTripParams } from "../../supabase/functions/parsear-viaje/schema.ts";

const fixture = (name: string) => JSON.parse(readFileSync(`src/test/fixtures/trip-docs/${name}.json`, "utf8"));

describe("parse-trip-file: validación estricta", () => {
  it("pase de abordar + e-ticket: normaliza IATA, moneda, hora, número de vuelo y PNR", () => {
    const r = validateExtraction(fixture("boarding-pass-aeromexico"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [ida, vuelta] = r.data.vuelos;
    expect(ida).toMatchObject({ numero_vuelo: "AM0402", from_iata: "MEX", to_iata: "JFK", hora_salida: "08:05", precio_total: 812.4, moneda: "USD", confirmacion: "ZXC789", archivo: 1 });
    // "—" no es un precio: queda vacío (no se inventa) y se avisa.
    expect(vuelta.precio_total).toBeNull();
    expect(r.avisos.join(" ")).toMatch(/precio de vuelo no era un número/);
    expect(r.data.documentos).toEqual([{ archivo: 0, tipo: "pase_abordar", pagado: true }, { archivo: 1, tipo: "boleto", pagado: true }]);
  });

  it("confirmación de hotel: montos con símbolos, gratis = 0, sin nombre se descarta, fechas del documento", () => {
    const r = validateExtraction(fixture("hotel-confirmation"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.vuelos).toEqual([]); // venía como objeto, no como lista
    expect(r.avisos.join(" ")).toMatch(/lista de vuelos venía con un formato inválido/);
    expect(r.data.hoteles).toHaveLength(2);
    expect(r.data.hoteles[0]).toMatchObject({ nombre: "Casa Antigua", precio_total: 7350, moneda: "MXN", confirmacion: "4417220981" });
    expect(r.data.hoteles[1]).toMatchObject({ costo_cero: true, precio_total: 0, check_in: null });
    expect(r.data.num_viajeros).toBe(2);
    // Sin fechas generales: salen de las del hotel (del documento, no inventadas).
    expect([r.data.fecha_salida, r.data.fecha_regreso]).toEqual(["2025-11-01", "2025-11-04"]);
  });

  it("respuesta inútil o que no es JSON: error claro", () => {
    expect(validateExtraction(fixture("model-garbage"))).toEqual({ ok: false, error: "No encontramos vuelos, hoteles ni destino en los archivos" });
    expect(validateExtraction("Lo siento, no puedo").ok).toBe(false);
    expect(validateExtraction([1, 2]).ok).toBe(false);
    const fenced = validateExtraction('```json\n{"destino":"Lima","fecha_salida":"2026-02-30"}\n```');
    expect(fenced.ok && fenced.data.fecha_salida).toBeNull(); // 30 de febrero no existe
  });

  it("regreso antes de la salida: se corrige y se avisa", () => {
    const r = validateExtraction({ destino: "Mérida", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-01" });
    expect(r.ok && [r.data.fecha_salida, r.data.fecha_regreso]).toEqual(["2026-03-01", "2026-03-10"]);
    expect(r.ok && r.avisos[0]).toMatch(/se intercambiaron/);
  });

  it("montos y fechas", () => {
    expect(amount("1.234,56")).toBe(1234.56);
    expect(amount("$ 12,500")).toBe(12500);
    expect(amount("N/A")).toBeNull();
    expect(amount(-5)).toBeNull();
    expect(isoDate("2026-12-01")).toBe("2026-12-01");
    expect(isoDate("01/12/2026")).toBeNull();
  });
});

describe("parsear-viaje: validación estricta", () => {
  it("limpia tipos y sin destino no hay viaje", () => {
    const r = validateTripParams('{"destino":"Tokio","destinations":["Tokio","Kioto"],"fecha_salida":"2026-07-01","fecha_regreso":"2026-06-20","num_viajeros":"30","presupuesto_objetivo":"$60,000"}');
    expect(r).toEqual({ ok: true, data: expect.objectContaining({ destino: "Tokio", is_multi: true, fecha_salida: "2026-06-20", fecha_regreso: "2026-07-01", num_viajeros: 2, presupuesto_objetivo: 60000 }) });
    expect(validateTripParams('{"notas":"algo"}')).toEqual({ ok: false, error: "sin_destino" });
    expect(validateTripParams("nada")).toEqual({ ok: false, error: "respuesta_invalida" });
  });
});
