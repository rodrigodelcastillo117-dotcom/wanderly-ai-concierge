// Road trips (grupo roadtrip): cálculos de distancia, tiempo, combustible y costos etiquetados.
import { describe, expect, it } from "vitest";
import {
  AVG_KMH, buildRoadTripPlan, countryOf, DEFAULT_L_PER_100, detectRoadTrip, estimateLeg, findCity, mapsDrivingUrl, placeQuery, resolveLegModes,
  ROAD_FACTOR, splitDays, suggestedStopsFor,
} from "../../supabase/functions/_shared/roadtrip/plan";
import { COUNTRIES, CURATED_ROUTES } from "../../supabase/functions/_shared/roadtrip/data";
import { haversineKm } from "../../supabase/functions/_shared/geo-distance";

const live = (km: number, min: number) => ({ ok: true, distance_meters: km * 1000, duration_seconds: min * 60, consultado_at: "2026-10-22T12:00:00Z" });

describe("distancia y tiempo por tramo", () => {
  it("con Google Routes el tramo es CONSULTADO con su fecha", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [live(76, 72)] })!;
    expect(p.legs[0]).toMatchObject({ distance_km: 76, duration_min: 72, estado: "CONSULTADO", fuente: "google_routes", consultado_at: "2026-10-22T12:00:00Z" });
  });

  it("sin respuesta de Google es ESTIMADO: línea recta × 1.3 a 70 km/h", () => {
    const a = findCity("Florencia")!;
    const b = findCity("Siena")!;
    const km = Math.round(haversineKm(a, b) * ROAD_FACTOR);
    expect(estimateLeg("Florencia", "Siena")).toEqual({ distance_km: km, duration_min: Math.round((km / AVG_KMH) * 60) });
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [{ ok: false }] })!;
    expect(p.legs[0]).toMatchObject({ distance_km: km, estado: "ESTIMADO", fuente: "estimado_linea_recta", consultado_at: null });
  });

  it("una respuesta de Google sin distancia o con 0 s no cuenta como consultada", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [{ ok: true, distance_meters: null, duration_seconds: 0 }] })!;
    expect(p.legs[0].estado).toBe("ESTIMADO");
  });

  it("ciudad desconocida y sin Google: SIN_DATOS, sin inventar km", () => {
    const p = buildRoadTripPlan({ stops: ["Pueblo Inventado", "Siena"], legModes: ["coche"] })!;
    expect(p.legs[0]).toMatchObject({ distance_km: null, duration_min: null, estado: "SIN_DATOS" });
    expect(p.legs[0].fuel.monto).toBeNull();
  });

  it("solo los tramos en coche entran al plan; sin coche no hay plan", () => {
    expect(buildRoadTripPlan({ stops: ["Roma", "Florencia", "Venecia"], legModes: ["tren", "tren"] })).toBeNull();
    const p = buildRoadTripPlan({ stops: ["Roma", "Florencia", "Siena", "Venecia"], legModes: ["tren", "coche", "avion"] })!;
    expect(p.legs.map((l) => [l.from, l.to])).toEqual([["Florencia", "Siena"]]);
  });
});

describe("combustible (distancia × consumo × precio oficial por país)", () => {
  it("es ESTIMADO con la fórmula, la fuente oficial y la fecha del dato", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [live(100, 80)] })!;
    const price = COUNTRIES.IT.fuel!.petrol;
    expect(p.legs[0].fuel).toMatchObject({ estado: "ESTIMADO", moneda: "EUR", monto: Math.round(100 * (DEFAULT_L_PER_100 / 100) * price * 100) / 100 });
    expect(p.legs[0].fuel.fuente?.url).toBe("https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en");
    expect(p.legs[0].fuel.fuente?.data_date).toBe("2026-10-19");
    expect(p.legs[0].fuel.detalle).toMatch(/100 km × 7 L\/100 km/);
  });

  it("respeta diésel y un consumo distinto", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], live: [live(200, 150)], fuelType: "diesel", litersPer100: 5 })!;
    expect(p.legs[0].fuel.monto).toBe(Math.round(200 * 0.05 * COUNTRIES.IT.fuel!.diesel * 100) / 100);
  });

  it("Reino Unido en libras con la fuente del gobierno británico", () => {
    const p = buildRoadTripPlan({ stops: ["Inverness", "Ullapool"], legModes: ["coche"], live: [live(95, 90)] })!;
    expect(p.legs[0].fuel.moneda).toBe("GBP");
    expect(p.legs[0].fuel.fuente?.url).toBe("https://www.gov.uk/government/statistics/weekly-road-fuel-prices");
  });

  it("país sin precio oficial verificado (Islandia, Suiza): POR_CONFIRMAR sin monto", () => {
    const p = buildRoadTripPlan({ stops: ["Reikiavik", "Vík"], legModes: ["coche"], live: [live(180, 140)] })!;
    expect(p.legs[0].fuel).toMatchObject({ estado: "POR_CONFIRMAR", monto: null });
    expect(p.costs.find((c) => c.id === "combustible-sin-precio")?.estado).toBe("POR_CONFIRMAR");
  });

  it("suma el combustible por moneda en el total parcial", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena", "Montalcino"], legModes: ["coche", "coche"], live: [live(76, 72), live(41, 45)] })!;
    const sum = Math.round((p.legs[0].fuel.monto! + p.legs[1].fuel.monto!) * 100) / 100;
    expect(p.costs.find((c) => c.id === "combustible-total-EUR")?.monto).toBeCloseTo(sum, 2);
    expect(p.totals_by_currency.EUR).toBeCloseTo(sum, 2);
  });
});

describe("costos honestos del coche", () => {
  it("renta POR_COTIZAR, casetas y estacionamiento POR_CONFIRMAR: ninguno con monto", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"], legDates: ["2026-11-10"] })!;
    for (const id of ["renta-0", "peajes", "estacionamiento"]) {
      const c = p.costs.find((x) => x.id === id)!;
      expect(c.monto).toBeNull();
      expect(["POR_COTIZAR", "POR_CONFIRMAR"]).toContain(c.estado);
    }
  });

  it("cada costo con monto lleva estado ESTIMADO o CONSULTADO y una fuente https", () => {
    const p = buildRoadTripPlan({ stops: ["Múnich", "Salzburgo", "Innsbruck", "Zúrich"], legModes: ["coche", "coche", "coche"], legDates: ["2026-11-10", "2026-11-12", "2026-11-14"] })!;
    for (const c of p.costs.filter((x) => x.monto !== null)) {
      expect(["ESTIMADO", "CONSULTADO"]).toContain(c.estado);
      expect(c.fuente?.url).toMatch(/^https:\/\//);
      expect(c.fuente?.consulted_at).toBe("2026-10-22");
    }
  });

  it("viñetas con el precio oficial según los días con auto (Austria 10 días, Suiza 40 CHF)", () => {
    const p = buildRoadTripPlan({ stops: ["Múnich", "Salzburgo", "Innsbruck", "Zúrich"], legModes: ["coche", "coche", "coche"], legDates: ["2026-11-10", "2026-11-12", "2026-11-14"] })!;
    expect(p.costs.find((c) => c.id === "vineta-AT")).toMatchObject({ monto: 12.8, moneda: "EUR", estado: "CONSULTADO" });
    expect(p.costs.find((c) => c.id === "vineta-CH")).toMatchObject({ monto: 40, moneda: "CHF", estado: "CONSULTADO" });
    // Alemania no tiene viñeta curada: no se inventa.
    expect(p.costs.find((c) => c.id === "vineta-DE")).toBeUndefined();
    // Un solo día con auto: viñeta de 1 día.
    const oneDay = buildRoadTripPlan({ stops: ["Salzburgo", "Viena"], legModes: ["coche"], legDates: ["2026-11-01"] })!;
    expect(oneDay.costs.find((c) => c.id === "vineta-AT")).toMatchObject({ monto: 9.6, concepto: expect.stringContaining("1 día") });
    const twoWeeks = buildRoadTripPlan({ stops: ["Salzburgo", "Innsbruck", "Viena"], legModes: ["coche", "coche"], legDates: ["2026-11-01", "2026-11-15"] })!;
    expect(twoWeeks.costs.find((c) => c.id === "vineta-AT")).toMatchObject({ monto: 32, concepto: expect.stringContaining("2 meses") });
  });
});

describe("recogida y devolución", () => {
  it("devolver en otra ciudad avisa del cargo sin inventar el monto", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena", "Roma"], legModes: ["coche", "coche"], legDates: ["2026-11-10", "2026-11-13"] })!;
    expect(p.rentals).toHaveLength(1);
    expect(p.rentals[0]).toMatchObject({ pickup_city: "Florencia", dropoff_city: "Roma", pickup_date: "2026-11-10", dropoff_date: "2026-11-13", one_way: true });
    expect(p.rentals[0].warnings.join(" ")).toMatch(/cargo por devolver el auto en otro lugar/);
    expect(p.rentals[0].warnings.join(" ")).toMatch(/IATOS no lo estima/);
    const fee = p.costs.find((c) => c.id === "devolucion-0")!;
    expect(fee).toMatchObject({ monto: null, estado: "POR_COTIZAR" });
  });

  it("circuito (devuelve donde recoge): sin cargo one-way", () => {
    const p = buildRoadTripPlan({ stops: ["Inverness", "Ullapool", "Inverness"], legModes: ["coche", "coche"] })!;
    expect(p.rentals[0].one_way).toBe(false);
    expect(p.costs.some((c) => c.id.startsWith("devolucion"))).toBe(false);
  });

  it("devolución en otro país y cruce de frontera", () => {
    const p = buildRoadTripPlan({ stops: ["Múnich", "Salzburgo"], legModes: ["coche"] })!;
    expect(p.legs[0].crosses_border).toBe(true);
    expect(p.rentals[0].cross_border).toBe(true);
    expect(p.rentals[0].warnings.join(" ")).toMatch(/otro país \(Austria\)/);
    expect(p.notices.some((n) => n.id === "frontera")).toBe(true);
  });

  it("mezclar modos: dos tramos en coche separados por un tren son dos rentas", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena", "Roma", "Nápoles", "Positano"], legModes: ["coche", "tren", "tren", "coche"] })!;
    expect(p.rentals.map((r) => [r.pickup_city, r.dropoff_city])).toEqual([["Florencia", "Siena"], ["Nápoles", "Positano"]]);
  });
});

describe("paradas sugeridas", () => {
  it("propone paradas curadas que quedan de camino, con su fuente", () => {
    const s = suggestedStopsFor("Siena", "Pienza");
    expect(s.map((x) => x.name)).toContain("Montalcino");
    expect(s[0].source.url).toMatch(/^https:\/\//);
  });
  it("no repite los extremos y se limita a 3", () => {
    const s = suggestedStopsFor("Málaga", "Granada");
    expect(s.every((x) => x.name !== "Málaga" && x.name !== "Granada")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(3);
  });
});

describe("modos por tramo", () => {
  it("un modo para todos, mezcla por tramo y valores desconocidos", () => {
    expect(resolveLegModes(3, "coche")).toEqual(["coche", "coche"]);
    expect(resolveLegModes(4, "mixto", ["coche", "tren", "avion"])).toEqual(["coche", "tren", "avion"]);
    expect(resolveLegModes(3, "mixto", ["patineta"])).toEqual(["tren", "tren"]);
    expect(resolveLegModes(1, "coche")).toEqual([]);
  });
});

describe("ciudades, países y enlaces", () => {
  it("encuentra ciudad y país con alias en varios idiomas", () => {
    expect(findCity("Firenze")?.name).toBe("Florencia");
    expect(countryOf("Lagos")).toBe("PT");
    expect(countryOf("un pueblo en Escocia")).toBe("GB");
    expect(placeQuery("Córdoba")).toBe("Cordoba, Spain");
  });
  it("Google Maps en coche con paradas intermedias", () => {
    const u = new URL(mapsDrivingUrl(["Florencia", "Siena", "Pienza"]));
    expect(u.hostname).toBe("www.google.com");
    expect(u.searchParams.get("travelmode")).toBe("driving");
    expect(u.searchParams.get("waypoints")).toBe("Siena, Italy");
  });
  it("todas las paradas de las rutas curadas tienen coordenadas (la estimación nunca queda vacía)", () => {
    for (const r of CURATED_ROUTES) for (const s of r.stops) expect(findCity(s), `${r.id}: ${s}`).not.toBeNull();
  });
});

describe("intención y reparto de días", () => {
  it("entiende 'road trip por la Toscana en 7 días'", () => {
    expect(detectRoadTrip("quiero hacer un road trip por la Toscana en 7 días")).toMatchObject({ isRoadTrip: true, days: 7, route: { id: "toscana" } });
    expect(detectRoadTrip("Roadtrip por Islandia dos semanas")).toMatchObject({ isRoadTrip: true, days: 14, route: { id: "islandia" } });
    expect(detectRoadTrip("recorrer Andalucía en coche")).toMatchObject({ isRoadTrip: true, route: { id: "andalucia" } });
    expect(detectRoadTrip("quiero ir a Tokio").isRoadTrip).toBe(false);
  });
  it("reparte los días entre las paradas (y agrupa si hay menos días)", () => {
    const tosc = CURATED_ROUTES.find((r) => r.id === "toscana")!;
    const seven = splitDays(tosc, 7);
    expect(seven).toHaveLength(7);
    expect(seven[0].stops).toEqual(["San Gimignano"]);
    const three = splitDays(tosc, 3);
    expect(three).toHaveLength(3);
    expect(three.flatMap((d) => d.stops)).toEqual(tosc.stops);
    // Circuito: no se cuenta dos veces la ciudad de inicio.
    const ice = CURATED_ROUTES.find((r) => r.id === "islandia")!;
    expect(splitDays(ice, 8).filter((d) => d.stops.includes("Reikiavik"))).toHaveLength(1);
  });
});
