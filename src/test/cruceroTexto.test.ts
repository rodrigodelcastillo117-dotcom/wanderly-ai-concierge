// Crucero escrito como lo escribe un viajero (recorrido 9-nov-2026): el borrador salía «Ciudad de México → Ciudad de
// México → Miami → Miami → crucero (puerto por confirmar → regresa) → regresa → Miami» y «2 noches» en total.
import { describe, expect, it } from "vitest";
import { buildLocalSpec, finalizeSpec } from "@/lib/tripSpecLocal";
import { durationSaid } from "../../supabase/functions/_shared/tripSpec.ts";
import { parseMultiCityText } from "@/lib/multiCityText";

const Q = "Vuelo de Ciudad de México a Miami, 2 noches en Miami, luego crucero de 5 noches por el Caribe con Royal Caribbean que sale de Miami y regresa a Miami, 2 adultos";

describe("crucero: lector rápido", () => {
  it("sale de CDMX, Miami 2 noches y el crucero Miami → Miami de 5 noches con Royal Caribbean; 7 noches en total", () => {
    const s = finalizeSpec(buildLocalSpec(Q, { origen: "Querétaro" }), Q, { origen: "Querétaro" });
    expect(s.origen).toBe("Ciudad de México");
    expect(s.paradas.map((p) => [p.ciudad, p.llegada_por === "crucero", p.noches])).toEqual([["Miami", false, 2], ["Miami", true, null]]);
    expect(s.paradas[1].crucero).toMatchObject({ puerto_salida: "Miami", puerto_llegada: "Miami", noches: 5, naviera: "Royal Caribbean" });
    expect(s.noches_total).toBe(7);
    expect(s.preguntas.filter((q) => !q.resuelta).map((q) => q.tipo)).toEqual(["fechas"]);
  });
  it("varias «N noches» se suman; con días manda la duración de siempre", () => {
    expect(durationSaid("2 noches en Miami y crucero de 5 noches")).toEqual({ days: 8, nights: 7 });
    expect(durationSaid("10 días, 3 noches en Roma")).toEqual({ days: 10, nights: 9 });
    expect(durationSaid("5 noches en Cancún")).toEqual({ days: 6, nights: 5 });
  });
  it("«Vuelo de X a Y» marca la salida", () => {
    expect(parseMultiCityText("Vuelo de Ciudad de México a Madrid y París")).toMatchObject({ origin: "Ciudad de México", cities: ["Madrid", "París"] });
  });
});
