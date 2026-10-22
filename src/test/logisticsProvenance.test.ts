import { describe, it, expect } from "vitest";
import { forceEstimated, labelExperiences, markLive, pricingSources } from "../../supabase/functions/logistics-plan/provenance";

describe("logistics-plan: el modelo no decide qué es 'en vivo' (B-05)", () => {
  it("sin datos en vivo, una etiqueta 'travelpayouts'/'serpapi' del modelo termina en estimado", () => {
    const flights = forceEstimated([
      { tier: "ahorro", fuente_precio: "travelpayouts", consultado_at: "2026-10-22T00:00:00Z" },
      { tier: "premium", fuente_precio: "serpapi" },
      { tier: "equilibrio" },
    ]);
    expect(flights.map((f) => f.fuente_precio)).toEqual(["estimado", "estimado", "estimado"]);
    expect(flights.every((f) => f.estado_dato === "ESTIMADO" && !("consultado_at" in f))).toBe(true);
  });

  it("lo armado con la lista del proveedor lleva su hora; Travelpayouts (caché ≤48 h) y fechas aproximadas → estimado", () => {
    const live = markLive([{ tier: "ahorro" }], "fuente_precio", "serpapi", "2026-10-22T10:00:00Z");
    expect(live[0]).toMatchObject({ fuente_precio: "serpapi", consultado_at: "2026-10-22T10:00:00Z", estado_dato: "CONSULTADO_EN_VIVO" });
    const tp = markLive([{ tier: "ahorro" }], "fuente_precio", "travelpayouts", "2026-10-22T10:00:00Z");
    expect(tp[0]).toMatchObject({ fuente_precio: "travelpayouts", consultado_at: "2026-10-22T10:00:00Z", estado_dato: "ESTIMADO" });
    const approx = markLive([{ tier: "ahorro" }], "fuente_precio", "travelpayouts", "2026-10-22T10:00:00Z", true);
    expect(approx[0]).toMatchObject({ approximate_dates: true, estado_dato: "ESTIMADO" });
  });

  it("experiencias 'tripadvisor' solo si están en la lista de este request", () => {
    const exps = [
      { nombre: "Coliseo Romano", fuente: "tripadvisor", rating: 4.8 },
      { nombre: "Tour secreto inventado", fuente: "tripadvisor", rating: 5 },
    ];
    const conLista = labelExperiences(exps, [{ name: "Coliseo Romano" }]);
    expect(conLista.map((e) => e.fuente)).toEqual(["tripadvisor", "estimado"]);
    expect(conLista[1].rating).toBeNull();
    // TripAdvisor no respondió: ninguna conserva la etiqueta.
    expect(labelExperiences(exps, null).map((e) => e.fuente)).toEqual(["estimado", "estimado"]);
  });

  it("pricing_sources se calcula después de etiquetar", () => {
    const flights = forceEstimated([{ fuente_precio: "travelpayouts" }]);
    const per = [{ hospedaje: forceEstimated([{ fuente_precio: "serpapi" }]), experiencias: labelExperiences([{ nombre: "A B", fuente: "tripadvisor" }], null) }];
    expect(pricingSources(flights, per)).toEqual({ vuelos: "estimado", hospedaje: "estimado", experiencias: "estimado" });
  });
});
