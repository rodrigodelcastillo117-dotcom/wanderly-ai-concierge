// Recorrido en producción (9-nov-2026): Madrid → París → Roma, 10–20 abr 2027. Los vuelos México → Madrid salen el 10
// y llegan el 11, pero el hotel de Madrid se cotizaba 10–14 (una noche pagada en el avión; en Booking, no llegar la
// primera noche puede cancelar toda la estancia). Ahora el primer hotel empieza cuando LLEGA el vuelo.
import { describe, expect, it } from "vitest";
import { fechasEnlaceBooking, nochesEnVuelo, primeraCiudadDesdeLlegada } from "../../supabase/functions/logistics-plan/llegada";
import { cityStays, nochesEnVueloDelViaje } from "../../supabase/functions/_shared/booking/tripRoute";

describe("servidor (logistics-plan/llegada.ts)", () => {
  it("cuenta las noches en el avión con la fecha de llegada local del vuelo", () => {
    expect(nochesEnVuelo("2027-04-10", "2027-04-11 12:35")).toBe(1);
    expect(nochesEnVuelo("2027-04-10", "2027-04-10 23:50")).toBe(0);
    expect(nochesEnVuelo("2027-04-10", "2027-04-12 06:10")).toBe(2);
    expect(nochesEnVuelo("2027-04-10", "2027-04-20 10:00")).toBe(0); // dato raro: se ignora
    expect(nochesEnVuelo("2027-04-10", null)).toBe(0);
    expect(nochesEnVuelo(null, "2027-04-11 12:35")).toBe(0);
  });

  it("la primera ciudad empieza el día que llega y pierde esa noche; la salida y el enlace de Booking se ajustan", () => {
    const madrid = {
      city: "Madrid", checkin: "2027-04-10", checkout: "2027-04-14", nights: 4,
      hospedaje: [
        { nombre: "Hotel Uno", booking_url: "https://www.booking.com/searchresults.html?ss=Hotel+Uno+Madrid&checkin=2027-04-10&checkout=2027-04-14&group_adults=2&no_rooms=1" },
        { nombre: "Sin enlace" },
        { nombre: "Otro sitio", booking_url: "https://www.google.com/travel/hotels?checkin=2027-04-10" },
      ],
    };
    const r = primeraCiudadDesdeLlegada(madrid, 1);
    expect(r).toMatchObject({ checkin: "2027-04-11", checkout: "2027-04-14", nights: 3, noches_en_vuelo: 1 });
    const u = new URL(String(r.hospedaje![0] && (r.hospedaje![0] as { booking_url: string }).booking_url));
    expect([u.searchParams.get("checkin"), u.searchParams.get("checkout"), u.searchParams.get("ss")]).toEqual(["2027-04-11", "2027-04-14", "Hotel Uno Madrid"]);
    expect(r.hospedaje![1]).toEqual({ nombre: "Sin enlace" });
    expect((r.hospedaje![2] as { booking_url: string }).booking_url).toBe("https://www.google.com/travel/hotels?checkin=2027-04-10");
  });

  it("nunca deja una ciudad sin noches: con 1 noche no se toca; con 2 y dos noches en el avión queda 1", () => {
    const una = { city: "Lisboa", checkin: "2027-04-10", checkout: "2027-04-11", nights: 1, hospedaje: [] };
    expect(primeraCiudadDesdeLlegada(una, 1)).toBe(una);
    expect(primeraCiudadDesdeLlegada({ city: "Tokio", checkin: "2027-04-10", checkout: "2027-04-12", nights: 2 }, 2))
      .toMatchObject({ checkin: "2027-04-11", nights: 1, noches_en_vuelo: 1 });
    const sin = { city: "Cancún", checkin: "2027-04-10", checkout: "2027-04-14", nights: 4 };
    expect(primeraCiudadDesdeLlegada(sin, 0)).toBe(sin);
  });

  it("solo cambia enlaces de Booking que ya traen fechas", () => {
    expect(fechasEnlaceBooking("https://www.booking.com/hotel/es/x.html", "2027-04-11", "2027-04-14")).toBe("https://www.booking.com/hotel/es/x.html");
    expect(fechasEnlaceBooking(null, "2027-04-11", "2027-04-14")).toBeNull();
    expect(fechasEnlaceBooking("https://evil.example/?checkin=1&x=booking.com", "a", "b")).toBe("https://evil.example/?checkin=1&x=booking.com");
  });
});

const VIAJE = {
  destino: "Madrid → París → Roma", ciudad_origen: "Ciudad de México", fecha_salida: "2027-04-10", fecha_regreso: "2027-04-20", num_viajeros: 2,
};

describe("pantalla de compra (cityStays)", () => {
  it("plan NUEVO (con noches_en_vuelo): respeta las fechas del plan", () => {
    const trip = { ...VIAJE, itinerario_json: { logistics: { per_destination: [
      { city: "Madrid", checkin: "2027-04-11", checkout: "2027-04-14", nights: 3, noches_en_vuelo: 1 },
      { city: "París", checkin: "2027-04-14", checkout: "2027-04-17", nights: 3 },
      { city: "Roma", checkin: "2027-04-17", checkout: "2027-04-20", nights: 3 },
    ] } } };
    expect(cityStays(trip).map((s) => [s.city, s.checkin, s.checkout, s.nights])).toEqual([
      ["Madrid", "2027-04-11", "2027-04-14", 3], ["París", "2027-04-14", "2027-04-17", 3], ["Roma", "2027-04-17", "2027-04-20", 3],
    ]);
  });

  it("viaje YA GUARDADO con la noche en el avión: se corrige con la llegada del vuelo cotizado", () => {
    const trip = { ...VIAJE,
      vuelos_json: [{ aerolinea: "Aeroméxico", salida: "2027-04-10 17:50", llegada: "2027-04-11 12:35" }, { aerolinea: "Iberia", llegada: "2027-04-11 13:05" }],
      itinerario_json: { logistics: { per_destination: [
        { city: "Madrid", checkin: "2027-04-10", checkout: "2027-04-14", nights: 4 },
        { city: "París", checkin: "2027-04-14", checkout: "2027-04-17", nights: 3 },
        { city: "Roma", checkin: "2027-04-17", checkout: "2027-04-20", nights: 3 },
      ] } } };
    const s = cityStays(trip);
    expect(s[0]).toEqual({ city: "Madrid", checkin: "2027-04-11", checkout: "2027-04-14", nights: 3 });
    expect(s[1]).toEqual({ city: "París", checkin: "2027-04-14", checkout: "2027-04-17", nights: 3 });
  });

  it("si algún vuelo llega el mismo día, no se mueve nada (no se adivina cuál eligió)", () => {
    const trip = { ...VIAJE, vuelos_json: [{ llegada: "2027-04-11 12:35" }, { llegada: "2027-04-10 22:40" }] };
    expect(nochesEnVueloDelViaje(trip, "2027-04-10")).toBe(0);
    expect(cityStays(trip)[0].checkin).toBe("2027-04-10");
  });

  it("sin plan guardado (reparto parejo) también se corrige", () => {
    const trip = { ...VIAJE, vuelos_json: [{ llegada: "2027-04-11 09:00" }] };
    const s = cityStays(trip);
    expect(s[0]).toMatchObject({ city: "Madrid", checkin: "2027-04-11", nights: 3 });
    expect(s[2].checkout).toBe("2027-04-20");
  });
});
