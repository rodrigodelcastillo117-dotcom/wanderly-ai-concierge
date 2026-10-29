// R2 viajes (parcial de ronda 1): seguían 3 tarjetas casi iguales por tramo en Destinos: «Trenitalia
// (Frecciarossa) / Italo» (la que suma), «Trenitalia / Frecciarossa» e «Italo Treno», a $1,025 / $1,025 / $894.
import { describe, it, expect } from "vitest";
import { groundOptionsForCity } from "@/lib/multiDestTrip";

const trip = (arrival: any[], internal: any[] = []) => ({
  destino: "Roma → Florencia", ciudad_origen: "Ciudad de México",
  itinerario_json: { multi: true, destinations: ["Roma", "Florencia"], logistics: {
    fx_usd_mxn: 18, internal_transport: internal,
    per_destination: [{ city: "Roma", arrival_options: [] }, { city: "Florencia", arrival_options: arrival }],
  } },
});

describe("trenes: una tarjeta por operador", () => {
  it("caso Italia de producción: la cotizada (modo 'train') y dos alternativas 'tren' de los mismos operadores", () => {
    const t = trip(
      [
        { mode: "tren", provider: "Trenitalia / Frecciarossa", duration: "1h 35m", price_per_person_usd: 56.9, from: "Roma" },
        { mode: "Tren", provider: "Italo Treno", duration: "1h 36m", price_per_person_usd: 49.7, from: "Roma" },
        { mode: "coche", provider: "Traslado privado", duration: "3h 15m", price_per_person_usd: 248, from: "Roma" },
      ],
      [{ mode: "train", provider: "Trenitalia (Frecciarossa) / Italo", duration: "1h 36m", price_per_person_usd: 56.95, from: "Roma (Roma Termini)", to: "Florencia" }],
    );
    expect(groundOptionsForCity(t, "Florencia").map((o) => o.aerolinea)).toEqual(["Trenitalia (Frecciarossa) / Italo", "Traslado privado"]);
  });

  it("otro operador sí es otra opción; el mismo operador desde otra ciudad, también", () => {
    const t = trip([
      { mode: "tren", provider: "Trenitalia", price_per_person_usd: 40, from: "Roma" },
      { mode: "tren", provider: "Italo", price_per_person_usd: 35, from: "Roma" },
      { mode: "tren", provider: "Trenitalia", price_per_person_usd: 20, from: "Bolonia" },
    ]);
    expect(groundOptionsForCity(t, "Florencia").map((o) => `${o.aerolinea}·${o.from}`)).toEqual(["Trenitalia·Roma", "Italo·Roma", "Trenitalia·Bolonia"]);
  });
});
