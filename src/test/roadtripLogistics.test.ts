// Road trips (grupo roadtrip): logistics-plan con el coche como modo por tramo y Google Routes simulado.
import { describe, expect, it, vi } from "vitest";
import { legModesFor, MAX_ROUTE_CALLS, planRoadTrip, roadTripPromptBlock } from "../../supabase/functions/logistics-plan/roadtrip";

describe("modo por tramo en logistics-plan", () => {
  it("lo que pide el viajero manda; sin elección, solo el destino roadtrip implica coche", () => {
    expect(legModesFor(["Roma", "Florencia", "Venecia"], { transport_mode: "coche" }, false)).toEqual(["coche", "coche"]);
    expect(legModesFor(["Roma", "Florencia", "Venecia"], { transport_mode: "mixto", leg_modes: ["tren", "coche"] }, false)).toEqual(["tren", "coche"]);
    expect(legModesFor(["Roma", "Florencia"], { transport_mode: "tren" }, true)).toEqual(["tren"]);
    expect(legModesFor(["Reikiavik", "Akureyri"], undefined, true)).toEqual(["coche"]);
    expect(legModesFor(["Roma", "Florencia"], undefined, false)).toEqual([]);
  });
});

describe("planRoadTrip", () => {
  it("consulta Google por cada tramo en coche (con nombre y país) y marca CONSULTADO", async () => {
    const route = vi.fn(async () => ({ ok: true, distance_meters: 76000, duration_seconds: 4320, consultado_at: "2026-10-22T12:00:00Z" }));
    const p = await planRoadTrip({ destinations: ["Florencia", "Siena", "Roma"], legModes: ["coche", "tren"], legDates: ["2026-11-10", "2026-11-12"], route });
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith("Florence, Italy", "Siena, Italy");
    expect(p!.legs).toHaveLength(1);
    expect(p!.legs[0]).toMatchObject({ distance_km: 76, duration_min: 72, estado: "CONSULTADO", date: "2026-11-10" });
    expect(p!.api).toMatchObject({ calls: 1, sku: "Compute Routes Essentials", list_price_usd: 0.005 });
  });

  it("si Google falla o lanza error, el tramo queda ESTIMADO (nunca sin etiqueta)", async () => {
    const route = vi.fn(async () => { throw new Error("quota"); });
    const p = await planRoadTrip({ destinations: ["Florencia", "Siena"], legModes: ["coche"], legDates: [null], route });
    expect(p!.legs[0].estado).toBe("ESTIMADO");
    const none = await planRoadTrip({ destinations: ["Florencia", "Siena"], legModes: ["coche"], legDates: [null], route: null });
    expect(none!.legs[0].estado).toBe("ESTIMADO");
    expect(none!.api.calls).toBe(0);
  });

  it("sin tramos en coche no consulta nada ni devuelve plan", async () => {
    const route = vi.fn();
    expect(await planRoadTrip({ destinations: ["Roma", "Florencia"], legModes: ["tren"], legDates: [null], route })).toBeNull();
    expect(route).not.toHaveBeenCalled();
  });

  it("tope de llamadas por plan", async () => {
    const stops = Array.from({ length: MAX_ROUTE_CALLS + 4 }, (_, i) => (i % 2 ? "Siena" : "Florencia"));
    const route = vi.fn(async () => ({ ok: true, distance_meters: 76000, duration_seconds: 4320 }));
    const p = await planRoadTrip({ destinations: stops, legModes: stops.slice(1).map(() => "coche" as const), legDates: [], route });
    expect(route).toHaveBeenCalledTimes(MAX_ROUTE_CALLS);
    expect(p!.legs.filter((l) => l.estado === "ESTIMADO")).toHaveLength(stops.length - 1 - MAX_ROUTE_CALLS);
  });
});

describe("prompt del modelo", () => {
  it("dice el modo de cada tramo, copia km reales y prohíbe inventar gasolina o casetas", async () => {
    const p = await planRoadTrip({ destinations: ["Florencia", "Siena", "Roma"], legModes: ["coche", "tren"], legDates: [], route: async () => ({ ok: true, distance_meters: 76000, duration_seconds: 4320 }) });
    const b = roadTripPromptBlock(["Florencia", "Siena", "Roma"], ["coche", "tren"], p);
    expect(b).toMatch(/Florencia → Siena: coche — 76 km, ~1\.2 h de manejo \(Google Maps, sin tráfico\)/);
    expect(b).toMatch(/Siena → Roma: tren/);
    expect(b).toMatch(/NO inventes km/);
    expect(b).toMatch(/NO pongas precios de gasolina, casetas, viñetas ni estacionamiento/);
    expect(roadTripPromptBlock(["Roma", "Florencia"], [], null)).toBe("");
  });
});
