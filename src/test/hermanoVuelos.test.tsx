// Defectos 3 y 18 (E2E 28-oct-2026, hermano del dueño):
//  3. Nueva York: "Descartamos 1 tarifa… El vuelo queda por cotizar" junto a "Vuelos · en vivo $18,930 MXN"
//     sumado al total. "Por cotizar" solo cuando de verdad no queda ningún vuelo de la ruta con precio.
// 18. "Aeromexico" y "Aeroméxico" en la misma pantalla; "Iberia · Premium" en una ruta corta sonaba a clase
//     de cabina. El nombre se normaliza al mostrar y el nivel del vuelo dice qué lo distingue.
import { describe, expect, it } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { discardedFaresNotice, displayAirlineName, flightAirlineLabel } from "@/lib/flightDisplay";
import { tripFlightProblems } from "@/lib/booking";
import { FLIGHT_TIER_WORD, TIER_WORD } from "@/lib/buyFlow";
import { buildPurchasePlan } from "@/lib/purchasePlan";

const liveFlight = {
  tier: "equilibrio", mode: "vuelo", aerolinea: "Aeromexico", escalas: "Directo", duracion: "11h 0m", precio_por_persona: 16190,
  fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T15:00:00Z", ciudad: "Roma",
  from: "Ciudad de México", to: "Roma", dep_iata: "MEX", arr_iata: "FCO",
};

describe("3 · aviso de tarifas descartadas", () => {
  it("con un vuelo vigente con precio: solo dice que se descartó (sin 'queda por cotizar'), en singular", () => {
    const trip = { ...CASO_TRIP, vuelos_json: [CASO_TRIP.vuelos_json[0], liveFlight] };
    expect(tripFlightProblems(liveFlight, trip)).toEqual([]);
    const n = discardedFaresNotice(trip)!;
    expect(n).toMatch(/^Descartamos 1 tarifa de vuelo de esta cotización porque no era de tu ruta\./);
    expect(n).not.toMatch(/por cotizar/);
  });

  it("sin ningún vuelo de la ruta con precio: el vuelo queda por cotizar", () => {
    const trip = { ...CASO_TRIP, vuelos_json: CASO_TRIP.vuelos_json.slice(0, 3) };
    const n = discardedFaresNotice(trip)!;
    expect(n).toMatch(/^Descartamos 3 tarifas de vuelo de esta cotización porque no eran de tu ruta\./);
    expect(n).toMatch(/El vuelo queda por cotizar/);
  });

  it("sin tarifas descartadas no hay aviso", () => {
    expect(discardedFaresNotice({ ...CASO_TRIP, vuelos_json: [liveFlight] })).toBeNull();
  });
});

describe("18 · nombres y niveles de vuelo", () => {
  it("Aeromexico → Aeroméxico (en la tarjeta y en el renglón de Comprar)", () => {
    expect(displayAirlineName("Aeromexico")).toBe("Aeroméxico");
    expect(displayAirlineName("AEROMEXICO Connect")).toBe("Aeroméxico Connect");
    expect(displayAirlineName("Iberia")).toBe("Iberia");
    expect(flightAirlineLabel(liveFlight)).toBe("Aeroméxico");
    const trip = { ...CASO_TRIP, vuelos_json: [liveFlight] };
    const plan = buildPurchasePlan(trip as any, { selVuelo: 0, selHospedaje: -1, selTours: new Set() } as any);
    const vuelo = plan.find((i: any) => i.kind === "vuelo");
    expect(vuelo?.title).toBe("Vuelo · Aeroméxico");
  });

  it("el nivel 'premium' de un vuelo se muestra como 'Más cómodo' (el valor interno no cambia)", () => {
    expect(FLIGHT_TIER_WORD.premium).toBe("Más cómodo");
    expect(FLIGHT_TIER_WORD.ahorro).toBe("Más barato");
    expect(Object.keys(FLIGHT_TIER_WORD)).toEqual(Object.keys(TIER_WORD));
  });
});
