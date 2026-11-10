import { describe, expect, it } from "vitest";
import { edadesNinos, habitacionesPara, ocupacionDe, sanitizeOcupacion } from "../../supabase/functions/_shared/ocupacion.ts";

describe("ocupación con niños", () => {
  it("lee las edades", () => {
    expect(edadesNinos("Cancún con mi esposa y nuestros 2 hijos de 6 y 9 años")).toEqual([6, 9]);
    expect(edadesNinos("Mazatlán 2 adultos y 2 niños (4 y 7 años)")).toEqual([4, 7]);
    expect(edadesNinos("Tulum con mi hija de 12")).toEqual([12]);
    expect(edadesNinos("Huatulco con tres niños de 3, 5 y 8 años")).toEqual([3, 5, 8]);
    expect(edadesNinos("Madrid con mis hijos")).toEqual([]);
    expect(edadesNinos("Roma 10 días")).toEqual([]);
  });
  it("2 adultos + 2 niños en 1 habitación; si no cuadra, nada", () => {
    const o = sanitizeOcupacion([6, 9], 4)!;
    expect(o).toEqual({ adultos: 2, ninos: [6, 9] });
    expect(habitacionesPara(o)).toBe(1);
    expect(sanitizeOcupacion([6, 9], 2)).toBeNull();
    expect(sanitizeOcupacion([], 4)).toBeNull();
    expect(ocupacionDe({ num_viajeros: 4, itinerario_json: { days: [], ocupacion: { adultos: 2, ninos: [6, 9] } } })).toEqual(o);
    expect(ocupacionDe({ num_viajeros: 4, itinerario_json: [] })).toBeNull();
  });
});

import { offerFromTripHotel } from "../../supabase/functions/_shared/booking/offers.ts";
import { bookingUrl } from "../../supabase/functions/hotels-search/search.ts";
describe("Booking del viaje con niños", () => {
  const trip: any = { id: "t", destino: "Cancún", fecha_salida: "2027-07-10", fecha_regreso: "2027-07-15", num_viajeros: 4,
    itinerario_json: { days: [], ocupacion: { adultos: 2, ninos: [6, 9] } } };
  it("hotels-search arma Booking con 2 adultos, 2 niños y 1 habitación", () => {
    const u = new URL(bookingUrl("Iberostar Cancún", "2027-07-10", "2027-07-15", 2, "", [6, 9]));
    expect(u.searchParams.get("group_adults")).toBe("2");
    expect(u.searchParams.get("group_children")).toBe("2");
    expect(u.searchParams.getAll("age")).toEqual(["6", "9"]);
    expect(u.searchParams.get("no_rooms")).toBe("1");
  });
  it("Comprar usa ese enlace (no lo rechaza por «otros viajeros») y sin él arma uno igual", () => {
    const link = bookingUrl("Iberostar Selection Cancún Cancún", "2027-07-10", "2027-07-15", 2, "", [6, 9]);
    for (const h of [{ nombre: "Iberostar Selection Cancún", booking_link: link }, { nombre: "Iberostar Selection Cancún" }]) {
      const o = offerFromTripHotel(h, { trip, city: "Cancún", index: 0 });
      const urls = o.actions.map((a) => String(a.url ?? "")).filter((x) => x.includes("booking.com"));
      expect(urls.length).toBeGreaterThan(0);
      const u = new URL(urls[0]);
      expect([u.searchParams.get("group_adults"), u.searchParams.get("group_children"), u.searchParams.get("no_rooms")]).toEqual(["2", "2", "1"]);
    }
  });
});
