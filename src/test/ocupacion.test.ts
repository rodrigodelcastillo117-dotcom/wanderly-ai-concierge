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

import { isHostel } from "../../supabase/functions/hotels-search/search.ts";
describe("hostales fuera para familias", () => {
  it("reconoce hostales por nombre, tipo o cadena", () => {
    expect(isHostel({ name: "Mayan Monkey Cancún" })).toBe(true);
    expect(isHostel({ name: "Selina Tulum" })).toBe(true);
    expect(isHostel({ name: "Hostal del Centro" })).toBe(true);
    expect(isHostel({ name: "Casa X", type: "Hostel" })).toBe(true);
    expect(isHostel({ name: "Iberostar Selection Cancún" })).toBe(false);
    expect(isHostel({ name: "Marriott Cancun, An All-Inclusive Resort" })).toBe(false);
  });
});

import { logisticsPlanArgs, multiDestTripInsert } from "@/lib/multiDestGenerate";
import L0 from "./fixtures/roadTripBajioLogistics.json";
describe("niños en un viaje de varias ciudades", () => {
  const Q = "Querétaro, San Miguel y Guanajuato en coche con mi esposa y nuestros hijos de 5 y 11 años";
  const base: any = { userId: "u", origin: "Ciudad de México", stops: ["Querétaro", "San Miguel de Allende", "Guanajuato"], viajeros: 4, prefs: {},
    fechaSalida: "2027-04-08", fechaRegreso: "2027-04-13", consulta: { consulta_original: Q } };
  it("logistics-plan recibe las edades leídas del texto", () => {
    expect(logisticsPlanArgs(base).ninos_edades).toEqual([5, 11]);
    expect(logisticsPlanArgs({ ...base, viajeros: 2 }).ninos_edades).toBeUndefined();
  });
  it("el viaje guarda la ocupación del plan y Booking va con 2 adultos + 2 niños", () => {
    const row: any = multiDestTripInsert(base, { ...(L0 as any), ocupacion: { adultos: 2, ninos: [5, 11] } });
    expect(row.itinerario_json.ocupacion).toEqual({ adultos: 2, ninos: [5, 11] });
    const trip = { ...row, id: "t", num_viajeros: 4 };
    const h = trip.hospedaje_json[0];
    const o = offerFromTripHotel({ ...h, booking_link: null }, { trip, city: h.ciudad, index: 0 });
    const u = new URL(o.actions.map((a: any) => String(a.url ?? "")).find((x: string) => x.includes("booking.com"))!);
    expect([u.searchParams.get("group_adults"), u.searchParams.get("group_children"), u.searchParams.getAll("age").join(",")]).toEqual(["2", "2", "5,11"]);
  });
});

import { isAdultsOnly } from "../../supabase/functions/hotels-search/search.ts";
describe("solo adultos fuera para familias", () => {
  it("reconoce hoteles solo para adultos", () => {
    expect(isAdultsOnly({ name: "Hyatt Zilara Cancun" })).toBe(true);
    expect(isAdultsOnly({ name: "Hotel Casa Naré - Adults Only" })).toBe(true);
    expect(isAdultsOnly({ name: "Secrets The Vine Cancun" })).toBe(true);
    expect(isAdultsOnly({ name: "Breathless Cancun Soul" })).toBe(true);
    expect(isAdultsOnly({ name: "Iberostar Selection Cancún" })).toBe(false);
    expect(isAdultsOnly({ name: "Hyatt Ziva Cancun" })).toBe(false);
    expect(isAdultsOnly({ name: "Dreams Sands Cancun" })).toBe(false);
  });
});
