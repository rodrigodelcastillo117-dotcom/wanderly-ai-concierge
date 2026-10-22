import { describe, it, expect } from "vitest";
import { slimToolResult, toolArgs, todayLine } from "../../supabase/functions/concierge-chat/tools";

describe("concierge tool arguments", () => {
  it("maps search_flights to what flights-search reads", () => {
    expect(toolArgs("search_flights", {
      origin: "CDMX", destination: "Madrid", departure_date: "2027-02-10", return_date: "2027-02-20", adults: 2,
    })).toEqual({ origin: "CDMX", destination: "Madrid", depart: "2027-02-10", return_date: "2027-02-20", travelers: 2, type: "round" });
  });

  it("treats a flight without return date as one way", () => {
    expect(toolArgs("search_flights", { origin: "MEX", destination: "CUN", departure_date: "2026-12-01" }))
      .toMatchObject({ depart: "2026-12-01", travelers: 1, type: "oneway", return_date: undefined });
  });

  it("passes other tools through unchanged", () => {
    const a = { city: "París", checkin: "2027-05-14", checkout: "2027-05-20", adults: 2 };
    expect(toolArgs("search_hotels", a)).toBe(a);
  });

  it("states today's date in Spanish", () => {
    expect(todayLine("2026-10-22")).toMatch(/22 de octubre de 2026 \(2026-10-22\)/);
  });
});

describe("slimToolResult", () => {
  const flight = (i: number) => ({
    airline: "Aeroméxico", flight_number: `AM ${400 + i}`, price: 9000 + i * 100, currency: "MXN",
    departure: "2027-02-10T08:00", arrival: "2027-02-11T06:00", stops: 1, duration_min: 720,
    buy_url: `https://www.aviasales.com/search/MEX1002MAD1?marker=533299&n=${i}`, source: "google_flights",
  });

  it("keeps valid JSON when a flight search is larger than the limit (antes: error de parseo)", () => {
    const big = { source: "google_flights", flights: Array.from({ length: 30 }, (_, i) => flight(i)) };
    expect(JSON.stringify(big).length).toBeGreaterThan(6000);
    const out = slimToolResult(big) as { flights: unknown[]; truncated?: boolean; error?: string };
    expect(out.error).toBeUndefined();
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(6000);
    expect(out.flights.length).toBeGreaterThan(5);
    expect(out.flights[0]).toEqual(flight(0)); // conserva los primeros (los mejores) intactos
    expect(out.truncated).toBe(true);
  });

  it("returns small results unchanged", () => {
    const small = { source: "google_flights", flights: [flight(0)] };
    expect(slimToolResult(small)).toEqual(small);
  });

  it("shortens very long strings", () => {
    const out = slimToolResult({ description: "x".repeat(5000) }) as { description: string };
    expect(out.description.length).toBeLessThanOrEqual(401);
  });
});
