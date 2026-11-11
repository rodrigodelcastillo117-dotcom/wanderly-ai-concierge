// El nivel de hotel con que arranca la cotización aprende de lo que la persona eligió (dueño, 11-nov-2026).
import { describe, expect, it } from "vitest";
import { learnedHotelTier } from "../../supabase/functions/_shared/learnedTier";

const H = [{ tier: "ahorro" }, { tier: "equilibrio" }, { tier: "premium" }, { tier: "alternativa" }];
const trip = (sel: any) => ({ hospedaje_json: H, selections: sel });

describe("aprende el nivel de hotel de las elecciones", () => {
  it("2 de 2 eligió el económico → ahorro", () => {
    expect(learnedHotelTier([trip({ hospedaje: { i: 0 } }), trip({ hoteles: [{ ciudad: "Roma", i: 0 }] })])).toEqual({ tier: "ahorro", veces: 2, de: 2 });
  });
  it("una sola elección, o elecciones repartidas: no se adivina", () => {
    expect(learnedHotelTier([trip({ hospedaje: { i: 2 } })])).toBeNull();
    expect(learnedHotelTier([trip({ hospedaje: { i: 0 } }), trip({ hospedaje: { i: 2 } })])).toBeNull();
  });
  it("alternativas y viajes sin selección no cuentan", () => {
    expect(learnedHotelTier([trip({ hospedaje: { i: 3 } }), trip(null), trip({ hospedaje: { i: 2 } }), trip({ hospedaje: { i: 2 } })])).toEqual({ tier: "premium", veces: 2, de: 2 });
    expect(learnedHotelTier(null)).toBeNull();
  });
});
