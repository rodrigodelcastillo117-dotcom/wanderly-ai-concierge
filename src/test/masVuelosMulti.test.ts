// «Más vuelos» también en varias ciudades (dueño, 11-nov-2026): el vuelo internacional open-jaw trae, además de los 3
// niveles, hasta 5 resultados reales más de la misma búsqueda de Google Flights, sin precios desproporcionados.
import { describe, expect, it } from "vitest";
import { openJawTiers, planOpenJaw } from "../../supabase/functions/logistics-plan/openJaw";
import { realFlightOptions } from "@/lib/purchasePlan";
import { multiDestTripRows } from "@/lib/multiDestTrip";

const plan = planOpenJaw({ origin: "Ciudad de México", destinations: ["Roma", "Florencia"], fecha_salida: "2027-03-10", fecha_regreso: "2027-03-16", num_viajeros: 2 });
const r = (airline: string, total: number, dep: string, min = 800, stops = 1) => ({
  airline, airlines: [airline], price_total: total, currency: "MXN", duration_minutes: min, duration: `${Math.floor(min / 60)}h`, stops,
  departure: { id: "MEX", time: `2027-03-10 ${dep}` }, arrival: { id: "FCO", time: "2027-03-11 14:00" },
  buy_url: `https://www.google.com/travel/flights?tfs=${airline}${total}`,
});
const resp = {
  ok: true, source: "serpapi", currency: "MXN",
  results: [
    r("Iberia", 30000, "18:00"), r("Lufthansa", 32000, "19:30"), r("Air France", 34000, "21:00"), r("KLM", 35000, "20:10"),
    r("Aeroméxico", 38000, "21:30", 700, 0), r("Iberia", 30000, "11:00"), r("United", 41000, "07:00"), r("Turkish", 39000, "06:00"),
    r("Emirates", 140000, "23:00"),
  ],
};

describe("varias ciudades: «Ver más vuelos»", () => {
  it("3 niveles + hasta 5 alternativas reales, sin repetir y sin el de $140,000", () => {
    const q = openJawTiers(resp, plan, { fx: 18.5, now: Date.parse("2027-01-10T00:00:00Z") });
    if (!q.live) throw new Error("sin vivo");
    const tiers = q.flights.filter((f) => f.tier !== "alternativa");
    const alts = q.flights.filter((f) => f.tier === "alternativa");
    expect(tiers.map((f) => f.tier)).toEqual(["ahorro", "equilibrio", "premium"]);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.length).toBeLessThanOrEqual(5);
    expect(alts.some((f) => f.airline_suggested === "Emirates")).toBe(false);
    const sigs = q.flights.map((f) => `${f.airline_suggested}|${f.price_total_mxn}|${f.salida}`);
    expect(new Set(sigs).size).toBe(sigs.length);
    // Iberia a la misma tarifa pero otra hora sí es otra opción.
    expect(q.flights.filter((f) => f.airline_suggested === "Iberia").length).toBe(2);
    expect(alts.every((f) => f.fuente_precio === "en_vivo" && f.booking_link.startsWith("https://www.google.com/travel/flights"))).toBe(true);
  });

  it("en el viaje guardado: los 3 niveles primero y las alternativas al final (para «Ver más vuelos»)", () => {
    const q = openJawTiers(resp, plan, { fx: 18.5, now: Date.parse("2027-01-10T00:00:00Z") });
    if (!q.live) throw new Error("sin vivo");
    const logistics = { fx_usd_mxn: 18.5, travelers: 2, flights: q.flights, per_destination: [] };
    const { vuelos_json } = multiDestTripRows(logistics, ["Roma", "Florencia"], "Ciudad de México");
    const trip = { vuelos_json, num_viajeros: 2, ciudad_origen: "Ciudad de México", destino: "Roma → Florencia" };
    const opts = realFlightOptions(trip as any, 20);
    expect(opts.length).toBe(q.flights.length);
    expect(opts.slice(0, 3).map((i) => vuelos_json[i].tier)).toEqual(["ahorro", "equilibrio", "premium"]);
    expect(opts.slice(3).every((i) => vuelos_json[i].tier === "alternativa")).toBe(true);
  });
});
