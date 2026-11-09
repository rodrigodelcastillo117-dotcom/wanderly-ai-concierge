// La renta de auto y los tours empiezan el día que el viajero LLEGA, no el día que sale su vuelo
// (recorrido Japón, 9-nov-2026: sale el 15 de marzo y llega el 16; el auto y GetYourGuide decían 15).
import { describe, expect, it } from "vitest";
import { fechaLlegada } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { carSearchDefaults, legCarRentalDates } from "@/lib/multiDestTrip";

const japon = {
  destino: "Tokio", destinos: ["Tokio", "Kioto", "Osaka"], fecha_salida: "2027-03-15", fecha_regreso: "2027-03-26",
  vuelos_json: [{ aerolinea: "ANA", llegada: "2027-03-16 05:25" }],
  itinerario_json: { multi: true, destinations: ["Tokio", "Kioto", "Osaka"], logistics: { per_destination: [
    { checkin: "2027-03-16", checkout: "2027-03-19", noches_en_vuelo: 1 },
    { checkin: "2027-03-19", checkout: "2027-03-23" }, { checkin: "2027-03-23", checkout: "2027-03-26" },
  ] } },
};

describe("fechaLlegada", () => {
  it("multi-ciudad: la entrada a la primera ciudad", () => expect(fechaLlegada(japon as never)).toBe("2027-03-16"));
  it("un destino con vuelo que llega al día siguiente: salida + 1", () =>
    expect(fechaLlegada({ destino: "Madrid", fecha_salida: "2027-04-10", fecha_regreso: "2027-04-17", vuelos_json: [{ llegada: "2027-04-11 12:35" }] } as never)).toBe("2027-04-11"));
  it("vuelo que llega el mismo día o sin vuelos: la salida", () => {
    expect(fechaLlegada({ destino: "Cancún", fecha_salida: "2027-04-10", fecha_regreso: "2027-04-14", vuelos_json: [{ llegada: "2027-04-10 13:00" }] } as never)).toBe("2027-04-10");
    expect(fechaLlegada({ destino: "Cancún", fecha_salida: "2027-04-10", fecha_regreso: "2027-04-14" } as never)).toBe("2027-04-10");
  });
  it("sin fecha de salida: null", () => expect(fechaLlegada({ destino: "Roma" } as never)).toBeNull());
});

describe("renta de auto desde la llegada", () => {
  it("la pantalla de autos sin fechas en la URL recoge el día que llegas", () =>
    expect(carSearchDefaults({ city: "Tokio" }, japon).pickup).toBe("2027-03-16"));
  it("una fecha en la URL manda", () =>
    expect(carSearchDefaults({ city: "Tokio", pickup: "2027-03-18" }, japon).pickup).toBe("2027-03-18"));
  it("en una ciudad: su estancia", () =>
    expect(legCarRentalDates(japon, "Kioto", "Kioto")).toEqual({ pickup: "2027-03-19", dropoff: "2027-03-23" }));
});
