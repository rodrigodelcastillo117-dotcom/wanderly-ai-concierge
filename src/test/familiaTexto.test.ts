// Viaje en familia (recorrido 9-nov-2026): «Cancún … con mi esposa y nuestros 2 hijos de 6 y 9 años» salía con
// «nuestros» y «años» como ciudades y 4 pendientes («¿Cómo llegarán a Cancún?», «¿Regresarán a CDMX?»…).
import { describe, expect, it } from "vitest";
import IATO from "./fixtures/familiaCancunIato.json";
import { buildLocalSpec, finalizeSpec } from "@/lib/tripSpecLocal";
import { openQuestions } from "../../supabase/functions/_shared/tripSpec.ts";
import { parseMultiCityText } from "@/lib/multiCityText";

const Q = "Cancún 5 noches del 10 al 15 de julio de 2027 con mi esposa y nuestros 2 hijos de 6 y 9 años, saliendo de Ciudad de México";

describe("viaje en familia", () => {
  it("el lector rápido solo ve Cancún", () => {
    expect(parseMultiCityText(Q)).toMatchObject({ cities: ["Cancún"], unknown: [], origin: "Ciudad de México" });
    const s = finalizeSpec(buildLocalSpec(Q, {}), Q);
    expect(s.paradas.map((p) => p.ciudad)).toEqual(["Cancún"]);
  });
  it("con la respuesta real de Iato: sin preguntas (vuelo de ida y regreso obvio, 4 viajeros, fechas)", () => {
    const s = finalizeSpec(IATO as any, Q, { origen: "Querétaro" });
    expect(openQuestions(s)).toEqual([]);
    expect(s.paradas[0].llegada_por).toBe("vuelo");
    expect(s.regreso.modo).toBe("vuelo");
    expect(s.viajeros).toBe(4);
  });
});

import { contarViajeros, parseTripFallback } from "@/lib/parseTripFallback";
describe("cuántos viajan", () => {
  const c = (q: string) => parseTripFallback(q).viajeros;
  it("familia: yo + esposa + 2 hijos = 4 (antes 2)", () => expect(c(Q)).toBe(4));
  it("casos comunes", () => {
    expect(c("Cancún con mi esposa")).toBe(2);
    expect(c("Mazatlán 2 adultos y 3 niños")).toBe(5);
    expect(c("Oaxaca somos 6")).toBe(6);
    expect(c("Puebla 4 personas")).toBe(4);
    expect(c("Roma con mis papás")).toBe(3);
    expect(c("Madrid con mi hija")).toBe(2);
    expect(c("Tulum dos adultos y un bebé")).toBe(3);
    expect(c("Viaje sola a Lisboa")).toBe(1);
    expect(c("Viaje a Lisboa")).toBeNull();
  });
  it("contarViajeros recibe el texto ya normalizado", () => expect(contarViajeros("con mi esposa y nuestros 2 hijos de 6 y 9 anos")).toBe(4));
});
