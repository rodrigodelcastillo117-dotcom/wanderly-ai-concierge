import { describe, it, expect } from "vitest";
import { toolArgs, todayLine } from "../../supabase/functions/concierge-chat/tools";

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
