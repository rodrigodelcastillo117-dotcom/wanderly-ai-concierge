// «No me dio nada de paquetes que incluye Expedia… hotel + vuelo» (dueño, 10/11-nov-2026). Mientras llega la alianza con
// Expedia, un enlace con el formato DOCUMENTADO por Expedia (package deeplinks) a su búsqueda de vuelo + hotel precargada.
import { describe, expect, it } from "vitest";
import { expediaPackageUrl } from "../../supabase/functions/_shared/booking/links";
import { flightBuyLinks } from "@/components/booking/FlightBuyButtons";

describe("paquete vuelo + hotel en Expedia", () => {
  it("formato documentado: /go/package/search/FlightHotel/{ida}/{regreso}?FromAirport&Destination&NumRoom&NumAdult", () => {
    const u = new URL(expediaPackageUrl({ origin: "MEX", destination: "Cancún", depart: "2027-03-05", ret: "2027-03-08", adults: 2 })!);
    expect(u.origin).toBe("https://www.expedia.mx");
    expect(u.pathname).toBe("/go/package/search/FlightHotel/2027-03-05/2027-03-08");
    expect(Object.fromEntries(u.searchParams)).toEqual({ FromAirport: "MEX", Destination: "Cancún", NumRoom: "1", NumAdult: "2" });
    expect(new URL(expediaPackageUrl({ origin: "MEX", destination: "Las Vegas", depart: "2026-12-10", ret: "2026-12-20", adults: 5 })!).searchParams.get("NumRoom")).toBe("3");
  });
  it("sin fechas válidas, sin regreso o con grupo muy grande: no hay enlace (nunca uno roto)", () => {
    expect(expediaPackageUrl({ origin: "MEX", destination: "Cancún", depart: "2027-03-08", ret: "2027-03-05" })).toBeNull();
    expect(expediaPackageUrl({ origin: "Ciudad de México", destination: "Cancún", depart: "2027-03-05", ret: "2027-03-08" })).toBeNull();
    expect(expediaPackageUrl({ origin: "MEX", destination: "Tulum", depart: "2027-03-05", ret: "2027-03-08", adults: 10 })).toBeNull();
  });
  it("en el viaje: solo para un destino y una vez (primera opción), no en tramos internos ni en varias ciudades", () => {
    const trip = { destino: "Cancún", ciudad_origen: "Ciudad de México", fecha_salida: "2027-03-05", fecha_regreso: "2027-03-08", num_viajeros: 2, vuelos_json: [] };
    expect(flightBuyLinks({ aerolinea: "Volaris" }, trip, 0).expedia).toMatch(/^https:\/\/www\.expedia\.mx\/go\/package\/search\/FlightHotel\//);
    expect(flightBuyLinks({ aerolinea: "Volaris" }, trip, 1).expedia).toBeNull();
    expect(flightBuyLinks({ from: "Roma", to: "Florencia" }, trip, 0).expedia).toBeNull();
    expect(flightBuyLinks({}, { ...trip, destino: "Roma → Florencia" }, 0).expedia).toBeNull();
  });
});
