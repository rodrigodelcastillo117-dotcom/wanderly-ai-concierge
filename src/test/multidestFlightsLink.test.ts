// Punto 1 del caso Roma → Florencia → Venecia: el botón de Google Flights abría SIN destino. La
// búsqueda se armaba con la ruta de la tarifa guardada (MEX→BUH, un código de ciudad que Google
// Flights deja vacío). Ahora la ruta sale del viaje: ida MEX→FCO, regreso VCE→MEX (open-jaw), con
// fechas y pasajeros del viaje; si no se reconoce un aeropuerto, el botón lo dice.
import { describe, expect, it } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { cityAirports, codeServesCity, mainAirport } from "../../supabase/functions/_shared/airports";
import { googleFlightsSearchUrl, kayakFlightsSearchUrl, parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";
import { tripDestinations, tripFlightRoute, tripFlightSearches } from "../../supabase/functions/_shared/booking/tripRoute";
import { offerFromTripFlight } from "../../supabase/functions/_shared/booking/offers";
import { buildPurchasePlan } from "@/lib/purchasePlan";
import { googleFlightsSearch, kayakFlightsLink } from "@/lib/affiliateLinks";
import { quickIata } from "../../supabase/functions/flights-search/search";

describe("aeropuertos: ciudad → IATA", () => {
  it("entiende 'Ciudad de México ' (espacio al final y acento), Roma, Venecia y nombres en inglés", () => {
    expect(mainAirport("Ciudad de México ")).toBe("MEX");
    expect(mainAirport("Roma")).toBe("FCO");
    expect(mainAirport("Venice, Italy")).toBe("VCE");
    expect(mainAirport("Florencia")).toBe("FLR");
    expect(quickIata("Ciudad de México ")).toBe("MEX");
  });
  it("un código de ciudad se cambia por su aeropuerto (Google Flights deja vacío ROM o BUH)", () => {
    expect(mainAirport("ROM")).toBe("FCO");
    expect(mainAirport("BUH")).toBe("OTP");
    expect(mainAirport("CIA")).toBe("CIA");
    expect(mainAirport("Xyzópolis")).toBeNull();
  });
  it("área metropolitana: CIA y ROM son Roma; BUH y OTP no", () => {
    expect(codeServesCity("CIA", "Roma")).toBe(true);
    expect(codeServesCity("ROM", "Roma")).toBe(true);
    expect(codeServesCity("BUH", "Roma")).toBe(false);
    expect(codeServesCity("OTP", "Roma")).toBe(false);
    expect(cityAirports("Venecia")?.country).toBe("Italia");
  });
});

describe("Google Flights y Kayak: viaje multi-destino (open-jaw)", () => {
  it("la ruta del viaje: ida a la primera ciudad y regreso desde la última", () => {
    expect(tripDestinations(CASO_TRIP)).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(tripFlightRoute(CASO_TRIP)).toMatchObject({ origin: "MEX", destination: "FCO", returnFrom: "VCE", depart: "2026-10-22", ret: "2026-11-01", adults: 2, multi: true, missing: [] });
  });

  it("Google Flights lleva MEX→FCO, regreso VCE→MEX, fechas y 2 pasajeros (Varias ciudades)", () => {
    const { google, kayak } = tripFlightSearches(CASO_TRIP);
    expect(parseGoogleFlightsSearch(google!)).toEqual({ origin: "MEX", destination: "FCO", depart: "2026-10-22", ret: "2026-11-01",
      adults: 2, children: 0, airlines: [], one_way: false, return_from: "VCE" });
    // Tipo de viaje 3 (varios destinos): el último byte del tfs antes del padding.
    const bytes = Array.from(atob(new URL(google!).searchParams.get("tfs")!), (c) => c.charCodeAt(0));
    expect(bytes.slice(-3)).toEqual([0x98, 0x01, 3]);
    expect(kayak).toBe("https://www.kayak.com/flights/MEX-FCO/2026-10-22/VCE-MEX/2026-11-01/2adults");
  });

  it("ida y vuelta normal no cambia (mismo destino de ida y de regreso)", () => {
    const u = googleFlightsSearchUrl({ origin: "MEX", destination: "MAD", depart: "2026-12-12", ret: "2026-12-19", adults: 2, returnFrom: "MAD" })!;
    expect(parseGoogleFlightsSearch(u)).toEqual({ origin: "MEX", destination: "MAD", depart: "2026-12-12", ret: "2026-12-19", adults: 2, children: 0, airlines: [], one_way: false });
    expect(kayakFlightsSearchUrl({ origin: "MEX", destination: "MAD", depart: "2026-12-12", ret: "2026-12-19", adults: 2 })).toBe("https://www.kayak.com/flights/MEX-MAD/2026-12-12/2026-12-19/2adults");
    expect(kayakFlightsLink("MEX", "ROM", "2026-12-12", "2026-12-19", 2)).toBe("https://www.kayak.com/flights/MEX-FCO/2026-12-12/2026-12-19/2adults");
  });

  it("la oferta del vuelo del viaje ya no usa la ruta de la tarifa (MEX→BUH) sino la del viaje", () => {
    const offer = offerFromTripFlight(CASO_TRIP.vuelos_json[0], { trip: CASO_TRIP, city: "Roma", index: 0 });
    const gf = offer.actions.find((a) => a.processor === "Google Flights");
    expect(parseGoogleFlightsSearch(gf!.url!)).toMatchObject({ origin: "MEX", destination: "FCO", return_from: "VCE", adults: 2 });
    expect(offer.actions.some((a) => /BUH|OTP/.test(a.url ?? ""))).toBe(false);
    expect(offer.actions.some((a) => a.processor === "Kayak")).toBe(true);
  });

  it("'Comprar mi viaje': el botón de vuelo lleva origen, destino, regreso, fechas y 2 adultos", () => {
    const [vuelo] = buildPurchasePlan(CASO_TRIP, { selVuelo: -1, selHospedaje: -1, selTours: [] });
    expect(vuelo.kind).toBe("vuelo");
    expect(vuelo.site).toBe("Google Flights");
    expect(parseGoogleFlightsSearch(vuelo.url!)).toMatchObject({ origin: "MEX", destination: "FCO", return_from: "VCE", depart: "2026-10-22", ret: "2026-11-01", adults: 2 });
    expect(vuelo.lleva).toEqual(["MEX → FCO", "regreso VCE → MEX", "22 oct – 1 nov 2026", "2 adultos"]);
    expect(vuelo.buttonLabel ?? null).toBeNull();
  });

  it("si un aeropuerto no se reconoce, el botón lo dice en vez de fingir la búsqueda", () => {
    const trip = { ...CASO_TRIP, destino: "Xyzópolis → Venecia", itinerario_json: { destinations: ["Xyzópolis", "Venecia"] }, vuelos_json: [] };
    const [vuelo] = buildPurchasePlan(trip, { selVuelo: -1, selHospedaje: -1, selTours: [] });
    expect(vuelo.title).toBe("Vuelo · por cotizar");
    expect(vuelo.buttonLabel).toBe("Abre Google Flights y escribe el destino");
    expect(vuelo.url).toBe("https://www.google.com/travel/flights?hl=es-419");
    expect(vuelo.lleva).toEqual([]);
    expect(vuelo.completa).toMatch(/No reconocimos el aeropuerto de Xyzópolis/);
    expect(googleFlightsSearch("Ciudad de México", "Xyzópolis", "2026-10-22", "2026-11-01", 2).prefilled).toBe(false);
  });
});
