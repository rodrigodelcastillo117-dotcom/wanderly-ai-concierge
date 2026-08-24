import { describe, it, expect } from "vitest";
import { detectRouteIntent } from "@/lib/detectRouteIntent";

describe("cotización: detección de destino", () => {
  it("no parte ciudades con espacios en el nombre", () => {
    for (const ciudad of ["Buenos Aires", "La Paz", "Ciudad de México", "New York"]) {
      const r = detectRouteIntent(ciudad);
      expect(r.mode).toBe("single");
    }
  });

  it("detecta multi-destino solo con separadores explícitos", () => {
    const r = detectRouteIntent("Madrid, Barcelona y Sevilla");
    expect(r.mode).toBe("multi");
    expect(r.destinations.length).toBeGreaterThanOrEqual(2);
  });

  it("maneja el separador de flecha", () => {
    const r = detectRouteIntent("Roma -> Florencia");
    expect(r.mode).toBe("multi");
    expect(r.destinations).toEqual(expect.arrayContaining([expect.stringMatching(/Roma/i)]));
  });
});
