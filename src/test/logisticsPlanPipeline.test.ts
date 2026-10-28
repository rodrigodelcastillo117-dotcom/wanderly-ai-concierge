// Defecto 11 del E2E en producción (28-oct-2026): el multidestino Italia tardó 118 s. Mejoras seguras de
// logistics-plan (mismas búsquedas, mismo modelo, mismos prompts): lo que no depende del perfil arranca
// antes de leerlo, los gustos se esperan después de lanzar hoteles y restaurantes, y la verificación de
// lugares de cada ciudad corre en cuanto llega SU respuesta de la IA (a la par de la llamada global).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/logistics-plan/index.ts", "utf8");
const at = (needle: string) => { const i = src.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };

describe("logistics-plan: tiempo sin bajar calidad ni gastar más búsquedas", () => {
  it("vuelos, atracciones y road trip arrancan antes de leer el perfil", () => {
    const perfil = at("// ───── Perfil + tier del presupuesto ─────");
    expect(at("const multiFlightsPromise = openJaw.ok")).toBeLessThan(perfil);
    expect(at('const tpFlightsPromise = invokeFn("travelpayouts-flights"')).toBeLessThan(perfil);
    expect(at("const attractionsPromises = cityWindows.map")).toBeLessThan(perfil);
    expect(at("const roadTripPromise = planRoadTrip(")).toBeLessThan(perfil);
    // Hoteles y restaurantes siguen usando el nivel de presupuesto y la comida del perfil.
    expect(at("hotel_class: HOTEL_CLASS_BY_TIER[selectedTier]")).toBeGreaterThan(perfil);
    // Los gustos (hasta 1.2 s) se esperan DESPUÉS de lanzar hoteles y restaurantes.
    expect(at("const gustos = renderTasteProfile(await tastePromise")).toBeGreaterThan(at("const cityLivePromises = cityWindows.map"));
  });
  it("cada ciudad verifica sus lugares en cuanto llega su respuesta (no al final de la global)", () => {
    expect(src).toMatch(/const cityVerifiedPromises = cityPromises\.map\(async \(p, i\) =>/);
    expect(src).toMatch(/await Promise\.all\(\[globalPromise, \.\.\.cityVerifiedPromises\]\)/);
    expect(src).not.toMatch(/const verified = await Promise\.all\(perDestination\.map/);
    // Mismo presupuesto de Google por ciudad: 10 s, 4 a la vez, 3.5 s por búsqueda.
    expect(src).toMatch(/deadline: Math\.min\(Date\.now\(\) \+ 10_000, __deadline - 8_000\), concurrency: 4, timeoutMs: 3_500/);
  });
  it("no se agregan búsquedas de SerpApi: una de hoteles y una de atracciones por ciudad, una de vuelos open-jaw", () => {
    expect(src.match(/invokeFn\("hotels-search"/g)).toHaveLength(1);
    expect(src.match(/invokeFn\("tripadvisor-search"/g)).toHaveLength(1);
    expect(src.match(/invokeFn\("flights-search"/g)).toHaveLength(1);
  });
});
