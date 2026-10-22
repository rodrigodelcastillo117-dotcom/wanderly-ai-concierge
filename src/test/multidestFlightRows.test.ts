// Punto 3 del caso Roma → Florencia → Venecia: en vuelos_json había filas "estimado" de la IA que
// decían "Directo" (Iberia MEX→Roma directo 15h 20m) y una renta de auto metida como vuelo ("Sixt /
// Hertz … vía Aeropuerto FCO - Retiro de Coche"). La causa: MultiDestRoute ponía "Directo" a todo
// vuelo y metía en vuelos_json todas las arrival_options (coche y tren incluidos), y el prompt de
// logistics-plan pedía "maneras de llegar" a la primera ciudad desde el origen.
import { describe, expect, it } from "vitest";
import { CASO_TRIP, LOGISTICS_FLIGHTS } from "./fixtures/casoRomaFlorenciaVenecia";
import { groundOptionsForCity, multiDestTripRows } from "@/lib/multiDestTrip";
import { flightAirlineLabel, flightDurationLabel, flightStopsLabel } from "@/lib/flightDisplay";
import { firstCityArrivals, scrubEstimatedFlight } from "../../supabase/functions/logistics-plan/provenance";

// Lo que devolvió logistics-plan para el caso (arrival_options como las guardó el cliente).
const LOGISTICS = {
  fx_usd_mxn: 18.76,
  flights: LOGISTICS_FLIGHTS,
  per_destination: [
    { city: "Roma", nights: 4, arrival_options: [
      { mode: "coche", provider: "Sixt / Hertz", from: "Ciudad de México (vía Aeropuerto FCO - Retiro de Coche)", duration: "45 min", price_per_person_usd: 80, tier: "premium" },
      { mode: "vuelo", provider: "Aeroméxico", from: "Ciudad de México", duration: "12h 45m", price_per_person_usd: 1320, tier: "equilibrio" },
      { mode: "vuelo", provider: "Iberia", from: "Ciudad de México", duration: "15h 20m", price_per_person_usd: 1050, tier: "ahorro" },
    ], hospedaje: [], restaurantes: [], experiencias: [] },
    { city: "Florencia", nights: 3, arrival_options: [
      { mode: "coche", provider: "Hertz / Sixt Italia", from: "Roma", duration: "3h 10m", price_per_person_usd: 100, scenic: true },
      { mode: "tren", provider: "Trenitalia / Italo", from: "Roma", duration: "1h 35m", price_per_person_usd: 60 },
    ], hospedaje: [], restaurantes: [], experiencias: [] },
    { city: "Venecia", nights: 3, arrival_options: [
      { mode: "coche", provider: "Sixt / Europcar", from: "Florencia", duration: "3h 20m", price_per_person_usd: 95 },
      { mode: "tren", provider: "Trenitalia / Italo", from: "Florencia", duration: "2h 05m", price_per_person_usd: 48 },
      { mode: "vuelo", provider: "ITA Airways", from: "Florencia", duration: "55m", price_per_person_usd: 140 },
    ], hospedaje: [], restaurantes: [], experiencias: [] },
  ],
};

describe("filas del viaje multi-destino (MultiDestRoute → multiDestTripRows)", () => {
  const { vuelos_json } = multiDestTripRows(LOGISTICS, ["Roma", "Florencia", "Venecia"], "Ciudad de México ");

  it("vuelos_json lleva solo vuelos: ni coche ni tren, ni la renta de auto 'vía Aeropuerto FCO'", () => {
    expect(vuelos_json.every((v) => v.mode === "vuelo")).toBe(true);
    expect(vuelos_json.some((v) => /Sixt|Hertz|Trenitalia|Europcar/.test(v.aerolinea))).toBe(false);
    // 3 tarifas internacionales + el vuelo interno Florencia → Venecia; los "vuelos" a Roma desde el
    // origen (Aeroméxico, Iberia) duplicaban el internacional con datos inventados y no entran.
    expect(vuelos_json.map((v) => `${v.from}→${v.to}`)).toEqual(["Ciudad de México→Roma", "Ciudad de México→Roma", "Ciudad de México→Roma", "Florencia→Venecia"]);
  });

  it("un vuelo estimado no nombra aerolínea ni dice 'Directo'", () => {
    const interno = vuelos_json[3];
    expect(interno).toMatchObject({ aerolinea: "Aerolínea por confirmar", escalas: "Escalas por confirmar", fuente_precio: "estimado" });
    expect(vuelos_json.some((v) => v.escalas === "Directo")).toBe(false);
  });

  it("el origen se guarda sin el espacio final y cada vuelo internacional con sus aeropuertos", () => {
    expect(vuelos_json[0]).toMatchObject({ from: "Ciudad de México", dep_iata: "MEX", arr_iata: "FCO" });
  });
});

describe("viajes ya guardados (vuelos_json mezclado)", () => {
  it("las filas estimadas de la IA se muestran sin aerolínea ni 'Directo'", () => {
    const iberia = CASO_TRIP.vuelos_json.find((v) => v.aerolinea === "Iberia")!;
    expect(flightAirlineLabel(iberia)).toBe("Aerolínea por confirmar");
    expect(flightStopsLabel(iberia)).toBe("Escalas por confirmar");
    expect(flightDurationLabel(iberia)).toBe("≈ 15h 20m (estimado)");
  });

  it("coche y tren salen de 'vuelos' y se muestran como transporte por tierra (sin la renta 'desde Ciudad de México')", () => {
    expect(groundOptionsForCity(CASO_TRIP, "Roma")).toEqual([]);
    const flor = groundOptionsForCity(CASO_TRIP, "Florencia");
    expect(flor.map((g) => [g.mode, g.aerolinea])).toEqual([["coche", "Hertz / Sixt Italia"], ["tren", "Trenitalia / Italo"]]);
  });
});

describe("logistics-plan (servidor)", () => {
  it("un vuelo estimado se guarda sin aerolínea ni escalas inventadas", () => {
    expect(scrubEstimatedFlight({ tier: "ahorro", airline_suggested: "Iberia", stops: "Directo", fuente_precio: "estimado" }))
      .toMatchObject({ airline_suggested: "Aerolínea por confirmar", stops: "Escalas por confirmar", estado_dato: "ESTIMADO" });
    expect(scrubEstimatedFlight({ mode: "vuelo", provider: "ITA Airways", stops: "Directo" })).toMatchObject({ provider: "Aerolínea por confirmar", stops: "Escalas por confirmar" });
  });
  it("a la primera ciudad no se 'llega' en coche desde el origen ni con otro vuelo internacional", () => {
    const kept = firstCityArrivals([...LOGISTICS.per_destination[0].arrival_options,
      { mode: "tren", provider: "Leonardo Express", from: "Aeropuerto FCO", duration: "32 min" }], "Ciudad de México");
    expect(kept.map((o: any) => o.provider)).toEqual(["Leonardo Express"]);
  });
});
