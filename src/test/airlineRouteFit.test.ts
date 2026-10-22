// Punto 9 del caso Roma → Florencia → Venecia: "Volaris NO vuela a Europa". La tarjeta de compra
// decía "Y4 102 … Va precargado: MEX → BUH · 22 oct – 1 nov 2026 · 2 adultos · solo Volaris". Una
// aerolínea regional en ruta intercontinental no se usa ni se filtra, y lo precargado nunca lleva
// un destino distinto al del viaje.
import { describe, expect, it } from "vitest";
import { AVIASALES_BUH, CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { airlineFitsRoute } from "../../supabase/functions/_shared/airports";
import { fareProblems } from "../../supabase/functions/_shared/fareGuard";
import { offerFromTripFlight, tripFlightProblems } from "../../supabase/functions/_shared/booking/offers";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";
import { buildPurchasePlan, prefillMatchesTrip } from "@/lib/purchasePlan";

describe("aerolínea que no opera la ruta", () => {
  it("Volaris (Y4) y Viva (VB) no vuelan México → Europa; sí México → Cancún. Aeroméxico sí a Roma", () => {
    expect(airlineFitsRoute("Y4", "Ciudad de México", "Roma")).toBe(false);
    expect(airlineFitsRoute("VB", "MEX", "MAD")).toBe(false);
    expect(airlineFitsRoute("Y4", "Ciudad de México", "Cancún")).toBe(true);
    expect(airlineFitsRoute("AM", "Ciudad de México", "Roma")).toBe(true);
    expect(airlineFitsRoute("FR", "Roma", "Venecia")).toBe(true);
  });

  it("el servidor descarta una tarifa de Volaris a Roma aunque el destino fuera correcto", () => {
    const row = { airline: "Y4", origin: "MEX", destination: "ROM", destination_airport: "FCO", duration_to: 16 * 60, duration_back: 17 * 60 };
    expect(fareProblems(row, { origin: "MEX", destination: "ROM", originCity: "Ciudad de México", destinationCity: "Roma" })).toEqual(["aerolinea_no_opera_la_ruta"]);
  });

  it("una fila guardada de Volaris a Roma con enlace correcto: no se usa su aerolínea ni su precio", () => {
    const v = { ...CASO_TRIP.vuelos_json[0], booking_link: "https://www.aviasales.com/search/MEX2210ROM01112?marker=533299", duracion: "16h" };
    expect(tripFlightProblems(v, CASO_TRIP)).toEqual(["aerolinea_no_opera_la_ruta"]);
    const o = offerFromTripFlight(v, { trip: CASO_TRIP, city: "Roma", index: 0 });
    expect(o.price).toBeNull();
    const gf = o.actions.find((a) => a.processor === "Google Flights")!;
    expect(parseGoogleFlightsSearch(gf.url!)!.airlines).toEqual([]);
  });
});

describe("el caso exacto de la tarjeta de compra", () => {
  it("ya no dice 'MEX → BUH … solo Volaris': lleva la ruta del viaje y ninguna aerolínea", () => {
    const [vuelo] = buildPurchasePlan(CASO_TRIP, { selVuelo: 0, selHospedaje: -1, selTours: [] });
    const lleva = vuelo.lleva.join(" · ");
    expect(lleva).not.toMatch(/BUH|Volaris/);
    expect(lleva).toBe("MEX → FCO · regreso VCE → MEX · 22 oct – 1 nov 2026 · 2 adultos");
    expect(vuelo.title).toBe("Vuelo · aerolínea por confirmar");
    expect(vuelo.price).toBeNull();
  });

  it("aunque el servidor (antes del despliegue) mande el enlace viejo, no se ofrece un destino distinto", () => {
    const viejo = [{ kind: "equivalent_search", tier: 2, url: "https://www.google.com/travel/flights?tfs=GhoSCjIwMjYtMTAtMjJqBRIDTUVYcgUSA0JVSBoaEgoyMDI2LTExLTAxagUSA0JVSHIFEgNNRVhAAUABSAGYAQE%3D&hl=es-419", processor: "Google Flights" }];
    expect(prefillMatchesTrip(viejo[0].url, CASO_TRIP)).toBe(false);
    expect(prefillMatchesTrip(AVIASALES_BUH, CASO_TRIP)).toBe(false);
    const [vuelo] = buildPurchasePlan(CASO_TRIP, { selVuelo: 0, selHospedaje: -1, selTours: [] }, { vuelos_json: { 0: viejo as any } });
    expect(parseGoogleFlightsSearch(vuelo.url!)).toMatchObject({ destination: "FCO", return_from: "VCE" });
  });
});
