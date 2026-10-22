// Cierre 2 · grupo enlaces: formato EXACTO de cada enlace de compra con la cotización de ejemplo del
// dueño (CDMX→Madrid del 12 al 19 de diciembre de 2026, 2 adultos, 1 habitación; MEX→CUN en Aeroméxico).
// Cada formato se comprobó abriéndolo en Chromium (docs/iatos/evidencia/enlaces/, resumen en
// docs/iatos/cierre2/ENLACES_COMPRA.md). Si un sitio no recibe un dato por URL, el enlace no lo inventa.
import { describe, expect, it } from "vitest";
import {
  airaloLink, aviasalesLink, bookingLink, cruiseDirectLink, discoverCarsLink, esimSlugs, ferryhopperLink, getYourGuideLink,
  googleFlightsLink, holaflyLink, kayakCarsLink, kayakFlightsLink, omioLink, PREFILL, prefillLine, rentalcarsLink, trainlineLink,
  vacationsToGoLink, welcomePickupsLink, WP_AFF_TRACK_ID,
} from "@/lib/affiliateLinks";
import {
  aviasalesSearchUrl, bookingSearchUrl, getYourGuideSearchUrl, googleFlightsSearchUrl, parseAviasalesSearch, parseGoogleFlightsSearch, resyWithDate,
} from "../../supabase/functions/_shared/booking/links";
import { offerFromFlightResult, offerFromTripFlight, offerFromTripTour, offerFromVenue } from "../../supabase/functions/_shared/booking/offers";
import { checkAllowlisted } from "../../supabase/functions/_shared/booking/allowlist";
import { bookingUrl } from "../../supabase/functions/hotels-search/search";
import { groundSearchLinks } from "../../supabase/functions/analizar-viaje/groundTransport";

const IDA = "2026-12-12";
const VUELTA = "2026-12-19";
const q = (u: string) => new URL(u).searchParams;

describe("vuelos", () => {
  it("Google Flights (tfs): ruta, fechas, 2 adultos y solo Aeroméxico — la URL exacta que se verificó (D-GF-AM.jpg)", () => {
    const u = googleFlightsLink("MEX", "CUN", IDA, VUELTA, 2, { airline: "AM" });
    expect(u).toBe("https://www.google.com/travel/flights?tfs=Gh4SCjIwMjYtMTItMTIyAkFNagUSA01FWHIFEgNDVU4aHhIKMjAyNi0xMi0xOTICQU1qBRIDQ1VOcgUSA01FWEABQAFIAZgBAQ%3D%3D&hl=es-419");
    expect(parseGoogleFlightsSearch(u)).toEqual({ origin: "MEX", destination: "CUN", depart: IDA, ret: VUELTA, adults: 2, children: 0, airlines: ["AM"], one_way: false });
  });
  it("Google Flights: CDMX→Madrid con un niño y solo ida", () => {
    expect(parseGoogleFlightsSearch(googleFlightsLink("MEX", "MAD", IDA, VUELTA, 2, { children: 1 })))
      .toEqual({ origin: "MEX", destination: "MAD", depart: IDA, ret: VUELTA, adults: 2, children: 1, airlines: [], one_way: false });
    expect(parseGoogleFlightsSearch(googleFlightsLink("MEX", "CUN", IDA, undefined, 2))).toMatchObject({ ret: null, one_way: true, adults: 2 });
  });
  it("Google Flights: ya no usa el texto ?q= (abría el formulario vacío, F8) y sin IATA no inventa una búsqueda", () => {
    expect(googleFlightsLink("MEX", "MAD", IDA, VUELTA, 2)).not.toContain("q=");
    expect(googleFlightsLink("Ciudad de México", "Madrid", IDA, VUELTA, 2)).toBe("https://www.google.com/travel/flights?hl=es-419");
    expect(googleFlightsSearchUrl({ origin: "MEX", destination: "MAD", depart: VUELTA, ret: IDA, adults: 1 })).toBeNull();
  });
  it("Aviasales: DDMM + adultos + niños (/search/MEX1212MAD191221 = 2 adultos y 1 niño, D-AVIA-NINOS.jpg)", () => {
    expect(aviasalesLink("MEX", "MAD", IDA, VUELTA, 2)).toBe("https://www.aviasales.com/search/MEX1212MAD19122?marker=533299");
    expect(aviasalesLink("MEX", "MAD", IDA, VUELTA, 2, 1)).toBe("https://www.aviasales.com/search/MEX1212MAD191221?marker=533299");
    expect(aviasalesLink("MEX", "CUN", IDA, undefined, 2)).toBe("https://www.aviasales.com/search/MEX1212CUN2?marker=533299");
    expect(parseAviasalesSearch("https://www.aviasales.com/search/MEX1212MAD191221")).toEqual({ origin: "MEX", destination: "MAD", depart: "1212", ret: "1912", adults: 2, children: 1 });
    expect(parseAviasalesSearch("https://www.aviasales.com/search/MEX1212CUN21")).toEqual({ origin: "MEX", destination: "CUN", depart: "1212", ret: null, adults: 2, children: 1 });
    expect(aviasalesSearchUrl({ origin: "MEX", destination: "MAD", depart: IDA, adults: 8, children: 4 })).toBe("https://www.aviasales.com/search/MEX1212MAD81?marker=533299");
  });
  it("Kayak: los pasajeros van en la ruta (/2adults), no en ?adults= (que Kayak ignoraba)", () => {
    expect(kayakFlightsLink("MEX", "MAD", IDA, VUELTA, 2)).toBe("https://www.kayak.com/flights/MEX-MAD/2026-12-12/2026-12-19/2adults");
    expect(kayakFlightsLink("MEX", "MAD", IDA, VUELTA, 2, [8])).toBe("https://www.kayak.com/flights/MEX-MAD/2026-12-12/2026-12-19/2adults/children-8");
    expect(kayakFlightsLink("MEX", "CUN", IDA, undefined, 1)).toBe("https://www.kayak.com/flights/MEX-CUN/2026-12-12/1adults");
  });
  it("vuelo del viaje (Aeroméxico): primero Google Flights con la ruta del enlace, fechas y viajeros del viaje y solo AM", () => {
    const trip = { id: "t1", destino: "Cancún", ciudad_origen: "Ciudad de México", fecha_salida: IDA, fecha_regreso: VUELTA, num_viajeros: 2 };
    const o = offerFromTripFlight({ aerolinea: "Aeroméxico", fuente_precio: "travelpayouts", precio_por_persona: 4800,
      booking_link: "https://www.aviasales.com/search/MEX1212CUN19122?marker=533299" }, { trip, now: Date.parse("2026-10-22T12:00:00Z") });
    const [gf, av] = o.actions.filter((a) => a.kind === "equivalent_search");
    expect(gf.processor).toBe("Google Flights");
    expect(parseGoogleFlightsSearch(gf.url!)).toEqual({ origin: "MEX", destination: "CUN", depart: IDA, ret: VUELTA, adults: 2, children: 0, airlines: ["AM"], one_way: false });
    expect(gf.preserves).toMatchObject({ dates: true, travelers: true });
    expect(av.url).toBe("https://www.aviasales.com/search/MEX1212CUN19122?marker=533299");
    expect(checkAllowlisted(gf.url!).ok).toBe(true);
    expect(o.details).toMatchObject({ airline_code: "AM", search: { origin: "MEX", destination: "CUN", depart: IDA, return_date: VUELTA, adults: 2 } });
  });
  it("resultado de Travelpayouts (sin URL de SerpApi): Google Flights filtrado por la aerolínea del resultado", () => {
    const o = offerFromFlightResult({ airline: "Iberia", price_usd: 900 }, { dep_iata: "MEX", arr_iata: "MAD", depart: IDA, return_date: VUELTA, travelers: 2, source: "travelpayouts" });
    const gf = o.actions.find((a) => a.processor === "Google Flights")!;
    expect(parseGoogleFlightsSearch(gf.url!)).toMatchObject({ airlines: ["IB"], adults: 2, depart: IDA, ret: VUELTA });
  });
});

describe("hoteles", () => {
  it("Booking.com: hotel + ciudad, fechas, 2 adultos, 1 habitación (y niños con edad, D-BK-NINOS.jpg)", () => {
    expect(bookingSearchUrl({ query: "Hotel Urban Madrid", checkin: IDA, checkout: VUELTA, adults: 2 }))
      .toBe("https://www.booking.com/searchresults.html?ss=Hotel+Urban+Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1");
    expect(bookingSearchUrl({ query: "Madrid", checkin: IDA, checkout: VUELTA, adults: 2, childAges: [8] }))
      .toBe("https://www.booking.com/searchresults.html?ss=Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1&group_children=1&age=8");
  });
  it("bookingLink de las herramientas: habitaciones como la cotización (4 adultos = 2 hab.) y marker", () => {
    const p = q(bookingLink("Madrid", IDA, VUELTA, 4));
    expect([p.get("group_adults"), p.get("no_rooms"), p.get("checkin"), p.get("checkout"), p.get("marker")]).toEqual(["4", "2", IDA, VUELTA, "533299"]);
  });
  it("hotels-search: el enlace de Booking ya no pasa por tp.media/click (respondía 400, H0)", () => {
    const u = bookingUrl("Madrid", IDA, VUELTA, 2, "533299");
    expect(u).toBe("https://www.booking.com/searchresults.html?ss=Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1");
    expect(u).not.toContain("tp.media");
  });
});

describe("actividades y restaurantes", () => {
  it("GetYourGuide aplica las fechas del viaje (date_from/date_to, D-GYG.jpg)", () => {
    expect(getYourGuideLink("Madrid", undefined, { from: IDA, to: VUELTA }))
      .toBe("https://www.getyourguide.com/s/?q=Madrid&date_from=2026-12-12&date_to=2026-12-19&marker=533299");
    expect(getYourGuideSearchUrl("Madrid", "Museo del Prado")).toBe("https://www.getyourguide.com/s/?q=Museo%20del%20Prado%20Madrid&marker=533299");
  });
  it("experiencia del viaje: la búsqueda de GetYourGuide lleva las fechas del viaje", () => {
    const trip = { id: "t1", destino: "Madrid", fecha_salida: IDA, fecha_regreso: VUELTA, num_viajeros: 2 };
    const o = offerFromTripTour({ nombre: "Museo del Prado", precio_por_persona: 400 }, { trip, city: "Madrid", index: 0 });
    const gyg = o.actions.find((a) => a.processor === "GetYourGuide")!;
    expect(gyg.url).toBe("https://www.getyourguide.com/s/?q=Museo%20del%20Prado%20Madrid&date_from=2026-12-12&date_to=2026-12-19&marker=533299");
    expect(gyg.preserves.dates).toBe(true);
  });
  it("Resy: fecha y personas en la página del lugar (D-RESY.jpg); la hora no se puede fijar", () => {
    expect(resyWithDate("https://resy.com/cities/new-york-ny/venues/eleven-madison-park", "2026-12-13", 2))
      .toBe("https://resy.com/cities/new-york-ny/venues/eleven-madison-park?date=2026-12-13&seats=2");
    expect(resyWithDate("https://www.opentable.com/r/x", "2026-12-13", 2)).toBe("https://www.opentable.com/r/x");
    const o = offerFromVenue({ name: "Eleven Madison Park", city: "New York", country: "US", source: "prive_catalog",
      booking_url: "https://resy.com/cities/new-york-ny/venues/eleven-madison-park", verified_at: "2026-10-01" }, "restaurant",
    { draft: { venue: "Eleven Madison Park", product_type: "restaurant", date: "2026-12-13", time: "20:30", party_size: 2, lang: "en" } });
    const page = o.actions.find((a) => a.kind === "official_booking_page")!;
    expect(page.url).toBe("https://resy.com/cities/new-york-ny/venues/eleven-madison-park?date=2026-12-13&seats=2");
    expect(page.preserves).toMatchObject({ product: true, dates: true, travelers: true });
  });
});

describe("trenes, autos, eSIM, ferries, cruceros y traslados", () => {
  it("Omio ya no manda a /search?fromCity=… (respondía 410) ni Trainline a un #hash que ignora", () => {
    expect(omioLink("Madrid", "Barcelona", "2026-12-15")).toBe("https://www.omio.com/?marker=533299");
    expect(trainlineLink("Madrid", "Barcelona", "2026-12-15")).toBe("https://www.thetrainline.com/?marker=533299");
    expect(prefillLine("omio")).toMatch(/no recibe la ruta/);
  });
  it("autobús en trayectos cortos: rutas de Google Maps en transporte público (Omio /search respondía 410 para CDMX–Puebla)", () => {
    const l = groundSearchLinks("Ciudad de México", "Puebla", "2026-12-12");
    expect(l.bus).toBe("https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Puebla&travelmode=transit");
    expect(l.car).toBe("https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Puebla&travelmode=driving");
    expect(checkAllowlisted(l.bus).ok).toBe(true);
  });
  it("autos: Kayak con ciudad y fechas; Discover Cars y Rentalcars abren su buscador (no aplicaban los datos)", () => {
    expect(kayakCarsLink("Madrid", IDA, VUELTA)).toBe("https://www.kayak.com/cars/Madrid/2026-12-12/2026-12-19");
    expect(discoverCarsLink("Madrid", IDA, VUELTA)).toBe("https://www.discovercars.com/?marker=533299");
    expect(rentalcarsLink("Madrid", IDA, VUELTA)).toBe("https://www.rentalcars.com/?marker=533299");
  });
  it("eSIM: el país en español se convierte al slug verificado (España → spain; Estados Unidos → usa en Holafly)", () => {
    expect(airaloLink("España")).toBe("https://www.airalo.com/spain-esim?marker=533299");
    expect(holaflyLink("España")).toBe("https://esim.holafly.com/esim-spain/?marker=533299");
    expect(airaloLink("Estados Unidos")).toBe("https://www.airalo.com/united-states-esim?marker=533299");
    expect(holaflyLink("Estados Unidos")).toBe("https://esim.holafly.com/esim-usa/?marker=533299");
    expect(holaflyLink("Emiratos Árabes Unidos")).toBe("https://esim.holafly.com/esim-dubai/?marker=533299");
    // País que no está verificado: la tienda (antes /narnia-esim → 404).
    expect(airaloLink("Narnia")).toBe("https://www.airalo.com/?marker=533299");
    expect(esimSlugs("Japón")).toEqual({ iso: "JP", airalo: "japan", holafly: "japan" });
  });
  it("ferries y cruceros: sin parámetros inventados; Vacations To Go ya no abre 'Page Not Found!'", () => {
    expect(ferryhopperLink("Pireo", "Santorini", "2026-12-15", 2)).toBe("https://www.ferryhopper.com/es/?marker=533299");
    expect(vacationsToGoLink("Mediterranean", "2026-12")).toBe("https://www.vacationstogo.com/?marker=533299");
    expect(cruiseDirectLink("Mediterranean", IDA, VUELTA)).toBe("https://www.cruisedirect.com/?marker=533299");
  });
  it("Welcome Pickups: solo el seguimiento del afiliado (la página ignoraba origen, fecha y hora)", () => {
    const u = welcomePickupsLink({ origen: "MAD", destino: "Hotel Urban", fecha: IDA, hora: "14:00", pax: 2, ciudad: "Madrid" });
    expect(u).toBe(`https://www.welcomepickups.com/?aff_track_id=${WP_AFF_TRACK_ID}&utm_source=travelpayouts&utm_medium=iatos_concierge&utm_campaign=transfer_madrid`);
  });
  it("cada proveedor dice qué lleva y qué completar; ninguno promete datos que no recibe", () => {
    for (const [k, p] of Object.entries(PREFILL)) {
      expect(prefillLine(k)).toBeTruthy();
      if (p.estado !== "ok") expect(p.completa, k).toBeTruthy();
    }
    expect(prefillLine("aeromexico")).toMatch(/no recibe ruta ni fechas/);
    expect(prefillLine("google_flights")).toMatch(/^Llega con: ruta, fechas, pasajeros/);
  });
});
