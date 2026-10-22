// Punto 7 del caso Roma → Florencia → Venecia: las tarjetas decían "2 escala(s)" sin decir dónde.
// Las ciudades de escala salen de la ruta del enlace de Aviasales (token t: MEX CUN MAD OTP …); sin
// ese dato se dice "Escalas por confirmar", nunca un número suelto.
import { describe, expect, it } from "vitest";
import { AVIASALES_BUH, CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { layoverCodesFromAviasalesLink } from "../../supabase/functions/_shared/fareGuard";
import { flightLayoverCities, flightStopsLabel } from "@/lib/flightDisplay";
import { multiDestTripRows } from "@/lib/multiDestTrip";

describe("ciudades de escala", () => {
  it("del token de Aviasales del caso: Cancún y Madrid (y así se ve que la tarifa iba a Bucarest)", () => {
    expect(layoverCodesFromAviasalesLink(AVIASALES_BUH)).toEqual(["CUN", "MAD"]);
    expect(flightLayoverCities(CASO_TRIP.vuelos_json[0])).toEqual(["Cancún", "Madrid"]);
    expect(flightStopsLabel({ ...CASO_TRIP.vuelos_json[0], fuente_precio: "travelpayouts" })).toBe("Escalas: Cancún · Madrid");
  });

  it("sin dato de escalas: 'Escalas por confirmar' (ni '2 escala(s)' ni 'Directo' inventado)", () => {
    expect(flightStopsLabel({ aerolinea: "Iberia", escalas: "2 escala(s)", fuente_precio: "travelpayouts", booking_link: "https://www.aviasales.com/search/MEX2210MAD01112" })).toBe("Escalas por confirmar");
    expect(flightStopsLabel({ aerolinea: "Iberia", escalas: "Directo", fuente_precio: "estimado" })).toBe("Escalas por confirmar");
    // Directo solo con una tarifa real que lo dice (Google Flights) o una ruta sin escalas en el enlace.
    expect(flightStopsLabel({ aerolinea: "Aeroméxico", escalas: "Directo", fuente_precio: "serpapi" })).toBe("Directo");
    expect(flightStopsLabel({ aerolinea: "Aeroméxico", fuente_precio: "travelpayouts",
      booking_link: "https://www.aviasales.com/search/MEX2210MAD01112?t=AM1793MEXMAD1793MADMEX_ab_900" })).toBe("Directo");
  });

  it("al guardar la ruta, cada tarifa real lleva sus ciudades de escala", () => {
    const flights = [{ tier: "ahorro", from: "Ciudad de México", to: "Roma", airline_suggested: "AF 179", price_per_person_usd: 1100, fuente_precio: "travelpayouts",
      booking_link: "https://www.aviasales.com/search/MEX2210ROM01112?t=AF1793MEXCDGFCO1793FCOCDGMEX_ab_1100&marker=1" }];
    const { vuelos_json } = multiDestTripRows({ fx_usd_mxn: 18, flights, per_destination: [] }, ["Roma"], "Ciudad de México");
    expect(vuelos_json[0]).toMatchObject({ escalas_ciudades: ["París"], escalas: "Escalas: París" });
  });
});
