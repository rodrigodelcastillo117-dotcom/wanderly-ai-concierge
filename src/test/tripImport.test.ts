// "Sube un viaje que ya hiciste": borrador, duplicados, precios pagados (sin inventar) y lo que se guarda.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateExtraction } from "../../supabase/functions/parse-trip-file/schema.ts";
import {
  buildImportPayload, docKindFor, draftFromParse, formatPaid, importRefs, isPastTrip, paidTotals, PAID_LABEL, validateDraft,
} from "@/lib/tripImport";

const parsed = (name: string) => {
  const r = validateExtraction(JSON.parse(readFileSync(`src/test/fixtures/trip-docs/${name}.json`, "utf8")));
  if (!r.ok) throw new Error((r as { error?: string }).error);
  return { ok: true, extraccion: r.data, avisos: r.avisos, fx: { USD: { rate: 18.5, source: "frankfurter", fetched_at: "2026-10-22" } } };
};

describe("importar viaje pasado", () => {
  it("borrador editable con lo leído, en la moneda del documento", () => {
    const d = draftFromParse(parsed("boarding-pass-aeromexico"));
    expect(d).toMatchObject({ destino: "Nueva York", fecha_salida: "2026-05-02", fecha_regreso: "2026-05-08", moneda: "USD", num_viajeros: 1 });
    expect(d.vuelos.map((v) => v.precio)).toEqual([812.4, null]);
    expect(isPastTrip(d, "2026-10-22")).toBe(true);
    expect(validateDraft(d)).toEqual([]);
  });

  it("llaves de duplicado: PNR y vuelo+fecha (sin ceros a la izquierda)", () => {
    const d = draftFromParse(parsed("boarding-pass-aeromexico"));
    expect(importRefs(d).sort()).toEqual(["PNR:ZXC789", "VUELO:AM402:2026-05-02", "VUELO:AM403:2026-05-08"]);
    const h = draftFromParse(parsed("hotel-confirmation"));
    expect(importRefs(h)).toEqual(["HOTEL:4417220981"]);
  });

  it("guarda lo PAGADO tal cual; a pesos solo con el tipo de cambio del servidor", () => {
    const d = draftFromParse(parsed("boarding-pass-aeromexico"));
    const { p_trip } = buildImportPayload(d, { archivos: 2, today: "2026-10-22" });
    expect(p_trip).toMatchObject({ pagado_total: 812.4, pagado_moneda: "USD", total_estimado: 15029 });
    expect(p_trip.vuelos_json[0]).toMatchObject({ pagado: { monto: 812.4, moneda: "USD", fuente: "documento" }, desde_pdf: true });
    expect(p_trip.vuelos_json[1].pagado).toBeNull(); // sin precio en el documento: vacío
    expect(p_trip.itinerario_json.importado).toMatchObject({ fuente: "documento", archivos: 2 });
  });

  it("sin tipo de cambio no se convierte (nunca 1:1) y con varias monedas no hay total único", () => {
    const d = { ...draftFromParse(parsed("boarding-pass-aeromexico")), fx: null };
    expect(buildImportPayload(d, { archivos: 1, today: "2026-10-22" }).p_trip.total_estimado).toBeNull();
    const mixed = { ...d, hoteles: [{ nombre: "H", ciudad: "", check_in: "", check_out: "", confirmacion: "", precio: 5000, moneda: "MXN", costo_cero: false, archivo: null }] };
    expect(paidTotals(mixed)).toEqual({ USD: 812.4, MXN: 5000 });
    expect(buildImportPayload(mixed, { archivos: 1, today: "2026-10-22" }).p_trip).toMatchObject({ pagado_total: null, pagado_moneda: null });
  });

  it("sin precios en los documentos: todo vacío (no se inventa)", () => {
    const d = draftFromParse({ extraccion: { destino: "Lima", fecha_salida: "2025-01-10", vuelos: [{ aerolinea: "LATAM", precio_total: null }] } });
    const { p_trip } = buildImportPayload(d, { archivos: 1, today: "2026-10-22" });
    expect([p_trip.pagado_total, p_trip.total_estimado, p_trip.vuelos_json[0].precio_total]).toEqual([null, null, null]);
  });

  it("errores claros antes de guardar", () => {
    const d = draftFromParse(parsed("boarding-pass-aeromexico"));
    expect(validateDraft({ ...d, destino: " " })).toContain("Escribe el destino del viaje.");
    expect(validateDraft({ ...d, fecha_regreso: "2026-05-01" })).toContain("El regreso no puede ser antes de la salida.");
    expect(validateDraft({ ...d, fecha_salida: "" })[0]).toMatch(/Falta la fecha de salida/);
  });

  it("etiquetas y tipos de documento", () => {
    expect(PAID_LABEL).toBe("Pagado (de tu documento)");
    expect(formatPaid(2236.5, "USD")).toBe("USD 2,236.50");
    expect(docKindFor("pase_abordar")).toBe("boleto");
    expect(docKindFor("hotel")).toBe("reserva");
    expect(docKindFor(undefined)).toBe("otro");
  });
});
