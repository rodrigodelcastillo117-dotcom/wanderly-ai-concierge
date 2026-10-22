// Punto 2 del caso Roma → Florencia → Venecia: la tarifa de referencia de Aviasales guardada era
// MEX→BUH (Bucarest, 65 h) y se presentó como vuelo a Roma en los 3 niveles. Se rechaza cualquier
// tarifa cuyo destino (o aeropuerto del área) no coincida con el pedido o con duración absurda.
import { describe, expect, it } from "vitest";
import { AVIASALES_BUH, CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { fareProblems, filterFares, knownCityCode, routeFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard";
import { offerFromTripFlight, tripFlightProblems } from "../../supabase/functions/_shared/booking/offers";
import { buildPurchasePlan } from "@/lib/purchasePlan";

// Fila de Travelpayouts como la devuelve travelpayouts-flights (lo que llegó a logistics-plan).
const tpRow = (over: Record<string, unknown> = {}) => ({
  airline: "Y4", flight_number: "102", price: 1282, origin_airport: "MEX", destination_airport: "OTP", origin: "MEX", destination: "BUH",
  duration_minutes: 65 * 60, duration_to_minutes: 26 * 60, duration_back_minutes: 39 * 60, stops: 2, booking_link: AVIASALES_BUH, ...over,
});
const WANT_ROMA = { origin: "MEX", destination: "ROM", originCity: "Ciudad de México ", destinationCity: "Roma" };

describe("filtro de tarifas (travelpayouts-flights, logistics-plan, analizar-viaje)", () => {
  it("el caso real: MEX→BUH no es Roma y se rechaza", () => {
    expect(routeFromAviasalesLink(AVIASALES_BUH)).toEqual({ origin: "MEX", destination: "BUH" });
    expect(fareProblems(tpRow(), WANT_ROMA)).toContain("destino_distinto");
    // Aunque la API dijera ROM en el campo destination, el enlace (BUH) la delata.
    expect(fareProblems(tpRow({ destination: "ROM", destination_airport: null }), WANT_ROMA)).toContain("destino_distinto");
    // Y aunque el código pedido a la API ya viniera mal (BUH), manda la ciudad que pidió el usuario.
    expect(fareProblems(tpRow(), { ...WANT_ROMA, destination: "BUH" })).toContain("destino_distinto");
  });

  it("acepta otro aeropuerto del área metropolitana (CIA para Roma) y FCO", () => {
    const times = { airline: "AF", duration_minutes: 34 * 60, duration_to_minutes: 16 * 60, duration_back_minutes: 18 * 60 };
    const fco = tpRow({ ...times, destination: "ROM", destination_airport: "FCO", booking_link: "https://www.aviasales.com/search/MEX2210ROM01112?marker=1" });
    const cia = tpRow({ ...times, destination: "ROM", destination_airport: "CIA", booking_link: "https://www.aviasales.com/search/MEX2210CIA01112?marker=1" });
    expect(fareProblems(fco, WANT_ROMA)).toEqual([]);
    expect(fareProblems(cia, WANT_ROMA)).toEqual([]);
  });

  it("descarta duraciones absurdas para la distancia (una ida de 50 h MEX→Roma)", () => {
    const ok = tpRow({ airline: "AF", destination: "ROM", destination_airport: "FCO", booking_link: null, duration_to_minutes: 16 * 60, duration_back_minutes: 18 * 60 });
    expect(fareProblems(ok, WANT_ROMA)).toEqual([]);
    expect(fareProblems({ ...ok, duration_to_minutes: 50 * 60 }, WANT_ROMA)).toContain("duracion_absurda");
    // Una ruta corta (CDMX → Cancún): 20 h de ida es absurdo.
    expect(fareProblems({ origin: "MEX", destination: "CUN", duration_to: 20 * 60 }, { origin: "MEX", destination: "CUN" })).toContain("duracion_absurda");
  });

  it("filterFares deja solo las válidas: con la única tarifa de otra ruta no queda ninguna (vuelo por cotizar)", () => {
    const { valid, rejected } = filterFares([tpRow()], WANT_ROMA);
    expect(valid).toEqual([]);
    expect(rejected[0].problems).toContain("destino_distinto");
    expect(knownCityCode("Roma")).toBe("ROM");
    expect(knownCityCode("Ciudad de México ")).toBe("MEX");
  });
});

describe("tarifas ya guardadas en el viaje (vuelos_json)", () => {
  it("las 3 filas de Aviasales MEX→BUH tienen problema; el coche y los estimados no son 'otra ruta'", () => {
    const problems = CASO_TRIP.vuelos_json.map((v) => tripFlightProblems(v, CASO_TRIP));
    expect(problems.slice(0, 3).every((p) => p.includes("destino_distinto_al_viaje"))).toBe(true);
    expect(problems[3]).toEqual([]); // Sixt / Hertz (coche): no es tarifa de vuelo
  });

  it("una tarifa de otra ruta no aporta precio ni enlace: nada de BUH en lo que se abre", () => {
    const o = offerFromTripFlight(CASO_TRIP.vuelos_json[0], { trip: CASO_TRIP, city: "Roma", index: 0 });
    expect(o.price).toBeNull();
    expect(o.rejected.map((r) => r.reason)).toContain("destino_distinto_al_viaje");
    expect(o.actions.every((a) => !/BUH|OTP|aviasales/.test(a.url ?? ""))).toBe(true);
  });

  it("'Comprar mi viaje' nunca ofrece la tarifa MEX→BUH: elige otra fila válida o deja el vuelo por cotizar", () => {
    const soloBuh = { ...CASO_TRIP, vuelos_json: CASO_TRIP.vuelos_json.slice(0, 3) };
    const [vuelo] = buildPurchasePlan(soloBuh, { selVuelo: -1, selHospedaje: -1, selTours: [] });
    expect(vuelo.title).toBe("Vuelo · por cotizar");
    expect(vuelo.price).toBeNull();
    expect(vuelo.priceNote).toMatch(/Aún no tenemos precio real para esta ruta/);
    expect(vuelo.lleva.join(" ")).not.toMatch(/BUH/);
    expect(vuelo.lleva[0]).toBe("MEX → FCO");
  });
});
