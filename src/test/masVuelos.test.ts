// «Ver más vuelos» (pedido del dueño, 11-nov-2026): hasta 5 vuelos reales más de la misma búsqueda de Google Flights.
import { describe, expect, it } from "vitest";
import { flightAlternatives } from "../../supabase/functions/analizar-viaje/flightAlternatives";

const f = (airline: string, usd: number, dep: string, stops = 0) => ({
  airline, price_per_person_usd: usd, stops, duration: "3h 10m", departure: { time: `2026-12-10 ${dep}` }, arrival: { time: "2026-12-10 12:00" },
  buy_url: `https://www.google.com/travel/flights?tfs=${airline}${usd}`,
});
const cotizados = [
  { aerolinea: "Aeromexico", precio_por_persona: 13000, salida: "2026-12-10 09:35", fuente_precio: "serpapi", tier: "ahorro" },
  { aerolinea: "Volaris", precio_por_persona: 15000, salida: "2026-12-10 07:00", fuente_precio: "serpapi", tier: "equilibrio" },
];

describe("más vuelos", () => {
  it("agrega vuelos reales que no repiten los cotizados, con tier alternativa y enlace de Google Flights", () => {
    const live = [f("Aeromexico", 650, "09:35"), f("Volaris", 750, "07:00"), f("Viva", 600, "06:00", 1), f("United", 900, "13:00"), f("Delta", 1000, "15:00")];
    const out = flightAlternatives(cotizados, live, { fxUsd: 20, consultedAt: "2026-11-11T00:00:00Z" });
    expect(out.map((v) => v.aerolinea)).toEqual(["Viva", "United", "Delta"]);
    expect(out[0]).toMatchObject({ precio_por_persona: 12000, escalas: "1 escala", salida: "2026-12-10 06:00", tier: "alternativa", fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" });
    expect(out.every((v) => v.booking_link.startsWith("https://www.google.com/travel/flights"))).toBe(true);
  });
  it("máximo 5; sin vuelos en vivo en la cotización o sin tipo de cambio, nada", () => {
    const live = Array.from({ length: 9 }, (_, i) => f(`Linea${i}`, 500 + i * 10, `0${i}:00`));
    expect(flightAlternatives(cotizados, live, { fxUsd: 20, consultedAt: "x" })).toHaveLength(5);
    expect(flightAlternatives([{ aerolinea: "X", fuente_precio: "estimado" }], live, { fxUsd: 20, consultedAt: "x" })).toEqual([]);
    expect(flightAlternatives(cotizados, live, { fxUsd: 0, consultedAt: "x" })).toEqual([]);
  });
});

describe("más vuelos: nada desproporcionado", () => {
  it("CDMX→Oaxaca: no ofrece «COPA $31,814» junto a Aeroméxico desde $5,710 (recorrido 11-nov-2026)", () => {
    const cot = [
      { aerolinea: "Aeroméxico", precio_por_persona: 5710, salida: "2026-11-13 07:00", fuente_precio: "serpapi", tier: "ahorro" },
      { aerolinea: "Aeroméxico", precio_por_persona: 7333, salida: "2026-11-13 10:00", fuente_precio: "serpapi", tier: "equilibrio" },
      { aerolinea: "Aeroméxico", precio_por_persona: 8378, salida: "2026-11-13 13:00", fuente_precio: "serpapi", tier: "premium" },
    ];
    const live = [f("Viva", 459, "08:00"), f("COPA", 1590.7, "09:00", 1)];
    const out = flightAlternatives(cot, live, { fxUsd: 20, consultedAt: "x" });
    expect(out.map((v) => v.aerolinea)).toEqual(["Viva"]);
  });
});

describe("Comprar: «Ver más vuelos»", () => {
  it("los 3 del nivel a la vista y las alternativas en moreOptions", async () => {
    const { realFlightOptions } = await import("@/lib/purchasePlan");
    const { buildBuyFlow } = await import("@/lib/buyFlow");
    const { tepozNuevo } = await import("./fixtures/casoTepoztlan");
    const base = await tepozNuevo();
    // Un viaje con vuelo (Cancún) armado a mano a partir del fixture: 3 niveles + 2 alternativas.
    const v = (aerolinea: string, pp: number, tier: string, h: string) => ({ aerolinea, precio_por_persona: pp, tier, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: new Date().toISOString(), escalas: "Directo", duracion: "2h 30m", salida: `2027-07-10 ${h}`, llegada: `2027-07-10 ${h}`,
      booking_link: "https://www.google.com/travel/flights?tfs=x" });
    const trip = { ...base, destino: "Cancún", pais_destino: "México", ciudad_origen: "Ciudad de México", itinerario_json: {},
      vuelos_json: [v("Viva", 4000, "ahorro", "06:00"), v("Aeroméxico", 4500, "equilibrio", "09:00"), v("Volaris", 5000, "premium", "12:00"),
        v("United", 4200, "alternativa", "07:00"), v("Delta", 6000, "alternativa", "15:00")] };
    const all = realFlightOptions(trip, 20);
    expect(all.length).toBe(5);
    const flow = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set(), selHoteles: {} } as any);
    const step: any = flow.steps.find((s) => s.kind === "vuelo");
    expect(step.options.map((i: number) => trip.vuelos_json[i].tier)).toEqual(["ahorro", "equilibrio", "premium"]);
    expect(step.moreOptions.map((i: number) => trip.vuelos_json[i].aerolinea).sort()).toEqual(["Delta", "United"]);
  });
});

describe("vuelos del mismo precio a otra hora (recorrido 11-nov-2026)", () => {
  it("Aeroméxico $3,414 a las 08:20, 12:15 y 16:15 son 3 opciones, no una", async () => {
    const { realFlightOptions } = await import("@/lib/purchasePlan");
    const { tepozNuevo } = await import("./fixtures/casoTepoztlan");
    const base = await tepozNuevo();
    const v = (aerolinea: string, pp: number, tier: string, salida: string | null) => ({ aerolinea, precio_por_persona: pp, tier, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: new Date().toISOString(), escalas: "Directo", duracion: "2h 30m", ...(salida ? { salida } : {}), booking_link: "https://www.google.com/travel/flights?tfs=x" });
    const trip = { ...base, destino: "Cancún", pais_destino: "México", ciudad_origen: "Ciudad de México", itinerario_json: {},
      vuelos_json: [v("Viva", 3321, "ahorro", "2027-02-03 12:40"), v("Aeroméxico", 3414, "equilibrio", null), v("Aeroméxico", 3414, "premium", null),
        v("Aeromexico", 3414, "alternativa", "2027-02-03 08:20"), v("Aeromexico", 3414, "alternativa", "2027-02-03 12:15"), v("Aeromexico", 3414, "alternativa", "2027-02-03 16:15")] };
    // El premium repetido (mismo vuelo sin hora) se quita; los 3 horarios cuentan.
    expect(realFlightOptions(trip, 20)).toHaveLength(5);
  });
});
