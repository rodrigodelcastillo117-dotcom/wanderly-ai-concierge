// Punto 10 del caso Roma → Florencia → Venecia: "Comprar mi viaje" ofrecía "Hotel Eden · Roma ·
// 22 oct – 1 nov · 10 noches · $280,290": todas las noches en Roma. Ahora hay un hotel por ciudad con
// las noches de cada tramo, Booking precargado con esas fechas, y el desglose suma lo mismo.
import { describe, expect, it } from "vitest";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute";
import { parseBookingSearch } from "../../supabase/functions/_shared/booking/links";
import { offerFromTripHotel } from "../../supabase/functions/_shared/booking/offers";
import { buildPurchasePlan } from "@/lib/purchasePlan";
import { cityHotelChoices } from "@/lib/cityHotels";
import { computeTripDesglose } from "@/lib/quote";

const NONE = { selVuelo: -1, selHospedaje: -1, selTours: [] as number[] };

describe("noches por ciudad", () => {
  it("las del plan guardado: Roma 4, Florencia 3, Venecia 3", () => {
    expect(cityStays(CASO_TRIP)).toEqual([
      { city: "Roma", checkin: "2026-10-22", checkout: "2026-10-26", nights: 4 },
      { city: "Florencia", checkin: "2026-10-26", checkout: "2026-10-29", nights: 3 },
      { city: "Venecia", checkin: "2026-10-29", checkout: "2026-11-01", nights: 3 },
    ]);
  });
  it("si el usuario cambió las fechas, se reparten de nuevo (mismo criterio que el servidor)", () => {
    const t = { ...CASO_TRIP, fecha_salida: "2026-10-23", fecha_regreso: "2026-10-30", itinerario_json: { ...CASO_TRIP.itinerario_json, days: [] } };
    expect(cityStays(t).map((s) => [s.city, s.checkin, s.nights])).toEqual([["Roma", "2026-10-23", 3], ["Florencia", "2026-10-26", 2], ["Venecia", "2026-10-28", 2]]);
  });
});

describe("Comprar mi viaje: un hotel por ciudad", () => {
  it("tres hoteles (el nivel de la cotización: premium) con las noches y fechas de cada ciudad", () => {
    const hotels = buildPurchasePlan(CASO_TRIP, NONE).filter((i) => i.kind === "hospedaje");
    expect(hotels.map((h) => [h.title, h.subtitle])).toEqual([
      ["Hospedaje · Hotel de la Ville", "Roma · 22–26 oct 2026 · 4 noches"],
      ["Hospedaje · Four Seasons Firenze", "Florencia · 26–29 oct 2026 · 3 noches"],
      ["Hospedaje · Aman Venice", "Venecia · 29 oct – 1 nov 2026 · 3 noches"],
    ]);
    expect(hotels.map((h) => h.price)).toEqual([32795 * 4, 37035 * 3, 53226 * 3]);
    // Booking.com con las fechas de esa ciudad y 2 adultos.
    expect(parseBookingSearch(hotels[1].url!)).toEqual({ ss: "Four Seasons Firenze Florencia", checkin: "2026-10-26", checkout: "2026-10-29", adults: 2 });
    // Nunca más "Hotel Eden · 10 noches".
    expect(hotels.some((h) => /10 noches/.test(h.subtitle ?? ""))).toBe(false);
  });

  it("el total de los hoteles cuadra con el renglón de hospedaje de la cotización (diferencia solo de redondeo a pesos)", () => {
    const sum = cityHotelChoices(CASO_TRIP).reduce((s, c) => s + (c.total ?? 0), 0);
    expect(sum).toBe(401963);
    expect(Math.abs(sum - CASO_TRIP.desglose_presupuesto.hospedaje)).toBeLessThanOrEqual(5);
  });

  it("elegir otro hotel en Florencia cambia solo Florencia, y el desglose suma ciudad por ciudad", () => {
    const milu = CASO_TRIP.hospedaje_json.findIndex((h) => h.nombre === "Milu");
    const sel = { ...NONE, selHoteles: { Florencia: milu } };
    const hotels = buildPurchasePlan(CASO_TRIP, sel).filter((i) => i.kind === "hospedaje");
    expect(hotels.map((h) => h.title)).toEqual(["Hospedaje · Hotel de la Ville", "Hospedaje · Milu", "Hospedaje · Aman Venice"]);
    const d = computeTripDesglose(CASO_TRIP, { selVuelo: -1, selHospedaje: -1, nochesHospedaje: 10, selTours: new Set(), selHoteles: sel.selHoteles }, 2);
    expect(d.hospedaje).toBe(32795 * 4 + 7017 * 3 + 53226 * 3);
    expect(d.hospedaje).toBe(hotels.reduce((s, h) => s + (h.price ?? 0), 0));
  });

  it("la tarjeta del hotel en la página (offerFromTripHotel) también usa las fechas de su ciudad", () => {
    const venecia = CASO_TRIP.hospedaje_json.find((h) => h.ciudad === "Venecia")!;
    const o = offerFromTripHotel(venecia, { trip: CASO_TRIP, city: "Venecia" });
    expect(o.travel_dates).toEqual({ start: "2026-10-29", end: "2026-11-01" });
  });

  it("la renta de auto se recoge en la primera ciudad (no en 'Roma → Florencia → Venecia')", () => {
    const auto = buildPurchasePlan(CASO_TRIP, NONE).find((i) => i.kind === "auto")!;
    expect(auto.url).toBe("https://www.kayak.com/cars/Roma/2026-10-22/2026-11-01");
  });
});
