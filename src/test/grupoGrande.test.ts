// Despedida en Tulum, 10 amigas (recorrido 11-nov-2026): los vuelos salían estimados porque Google Flights solo busca hasta
// 9 pasajeros por reserva. Ahora se busca con 9 y el precio por persona se multiplica por el grupo.
import { describe, expect, it } from "vitest";
import { gfSearchAdults, googleFlightResult, searchFlights } from "../../supabase/functions/_shared/flight-search";

const f = { price: 2700, total_duration: 130, flights: [{ airline: "Volaris", departure_airport: { id: "MEX", time: "2027-03-05 07:00" }, arrival_airport: { id: "CUN", time: "2027-03-05 10:10" } }] };

describe("grupo de 10+: Google Flights hasta 9 pasajeros", () => {
  it("busca con 9 y multiplica por persona", () => {
    expect(gfSearchAdults(10)).toBe(9);
    expect(gfSearchAdults(4)).toBe(4);
    const r = googleFlightResult(f, 10, true, "https://x", { origin: "MEX", destination: "CUN", depart: "2027-03-05", ret: "2027-03-08" });
    expect(r.price_per_person_usd).toBe(300);
    expect(r.price_usd).toBe(3000);
    expect(r.price_note).toMatch(/hasta 9 pasajeros.*× 10 viajeros.*2 grupos/);
    const r4 = googleFlightResult(f, 4, true, "https://x");
    expect(r4.price_per_person_usd).toBe(675);
    expect(r4.price_usd).toBe(2700);
  });
  it("a SerpApi le pide adults=9 para un grupo de 10", async () => {
    let asked = "";
    const res = await searchFlights({ origin: "MEX", destination: "CUN", depart: "2027-03-05", return_date: "2027-03-08", travelers: 10, type: "round" }, {
      serpKey: "K", serpFetch: (async (url: string) => { asked = url; return new Response(JSON.stringify({ best_flights: [f] }), { status: 200 }); }) as any,
    } as any);
    expect(new URL(asked).searchParams.get("adults")).toBe("9");
    expect((res.body as any).results[0].price_per_person_usd).toBe(300);
  });
});
