import { describe, it, expect } from "vitest";
import { nightsBetween, reconcileEdit, sanitizeTripMeta } from "../../supabase/functions/editar-viaje-ai/reconcile";

const before = {
  fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", num_viajeros: 2,
  vuelos_json: [
    { tier: "ahorro", aerolinea: "Iberia", precio_por_persona: 20000, fuente_precio: "travelpayouts", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-20T10:00:00Z" },
    { tier: "premium", aerolinea: "Aeroméxico", precio_por_persona: 40000, fuente_precio: "estimado" },
  ],
  hospedaje_json: [{ nombre: "Hotel Real", precio_por_noche: 4000, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-20T10:00:00Z" }],
  tours_json: [{ nombre: "Museo del Prado", precio_por_persona: 800, fuente: "tripadvisor" }],
};

describe("editar-viaje-ai: lo no re-verificado no puede decir 'en vivo' (B-06)", () => {
  it("precio cambiado → estimado y PENDIENTE_DE_VERIFICACION; sin cambios → conserva su origen", () => {
    const after = {
      ...before,
      vuelos_json: [
        { ...before.vuelos_json[0] },
        { ...before.vuelos_json[1], precio_por_persona: 38000, fuente_precio: "serpapi" }, // el modelo "sube" la etiqueta
      ],
      hospedaje_json: [{ nombre: "Hotel Real", precio_por_noche: 6500, fuente_precio: "serpapi" }],
    };
    const r = reconcileEdit(before, after);
    expect(r.vuelos_json[0]).toMatchObject({ fuente_precio: "travelpayouts", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-20T10:00:00Z" });
    expect(r.vuelos_json[1]).toMatchObject({ fuente_precio: "estimado", estado_dato: "ESTIMADO" });
    expect(r.hospedaje_json[0]).toMatchObject({ fuente_precio: "estimado", estado_dato: "PENDIENTE_DE_VERIFICACION" });
    expect(r.hospedaje_json[0].consultado_at).toBeUndefined();
  });

  it("el modelo no puede subir a 'en vivo' un elemento que no cambió", () => {
    const after = { ...before, vuelos_json: [before.vuelos_json[0], { ...before.vuelos_json[1], fuente_precio: "serpapi" }] };
    expect(reconcileEdit(before, after).vuelos_json[1].fuente_precio).toBe("estimado");
  });

  it("si se movieron las fechas, todo lo que era en vivo queda pendiente", () => {
    const after = { ...before, fecha_salida: "2026-11-17", fecha_regreso: "2026-11-22" };
    const r = reconcileEdit(before, after);
    expect(r.vuelos_json[0]).toMatchObject({ fuente_precio: "estimado", estado_dato: "PENDIENTE_DE_VERIFICACION" });
    expect(r.hospedaje_json[0]).toMatchObject({ fuente_precio: "estimado", estado_dato: "PENDIENTE_DE_VERIFICACION" });
    // El lugar del tour sigue siendo real; su precio ya era estimado.
    expect(r.tours_json[0]).toMatchObject({ fuente: "tripadvisor", estado_dato: "ESTIMADO" });
  });

  it("hotel nuevo inventado → estimado", () => {
    const after = { ...before, hospedaje_json: [{ nombre: "Gran Hotel Inventado", precio_por_noche: 9000, fuente_precio: "serpapi" }] };
    expect(reconcileEdit(before, after).hospedaje_json[0]).toMatchObject({ fuente_precio: "estimado", estado_dato: "PENDIENTE_DE_VERIFICACION" });
  });

  it("descarta fechas inválidas, regreso antes de salida y viajeros fuera de rango", () => {
    expect(sanitizeTripMeta(before, { fecha_salida: "10/11/2026", fecha_regreso: "2026-11-15", num_viajeros: 0 }))
      .toEqual({ fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", num_viajeros: 2 });
    expect(sanitizeTripMeta(before, { fecha_salida: "2026-11-20", fecha_regreso: "2026-11-12", num_viajeros: 4 }))
      .toEqual({ fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", num_viajeros: 4 });
    expect(nightsBetween("2026-11-10", "2026-11-15")).toBe(5);
    expect(nightsBetween(null, "2026-11-15")).toBe(0);
  });
});
