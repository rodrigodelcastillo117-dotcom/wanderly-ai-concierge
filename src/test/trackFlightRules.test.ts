import { describe, it, expect } from "vitest";
import { trackError, normalizeFlight } from "../../supabase/functions/track-flight/rules";
import { localISODate, localISODatePlus } from "@/lib/localDate";

describe("track-flight rules", () => {
  const today = "2026-10-22";

  it("accepts a valid flight today or in the coming months", () => {
    expect(trackError({ flight: "AM 401", flight_date: today }, today)).toBeNull();
    expect(trackError({ flight: "y4123", flight_date: "2027-08-01" }, today)).toBeNull();
  });

  it("requires a date (sin fecha, la fila se duplicaba y se consultaba para siempre)", () => {
    expect(trackError({ flight: "AM401" }, today)).toMatch(/fecha/i);
    expect(trackError({ flight: "AM401", flight_date: "22/10/2026" }, today)).toMatch(/fecha/i);
  });

  it("rejects past flights but allows yesterday's overnight flight", () => {
    expect(trackError({ flight: "AM401", flight_date: "2026-10-21" }, today)).toBeNull();
    expect(trackError({ flight: "AM401", flight_date: "2026-10-01" }, today)).toMatch(/pasó/);
  });

  it("rejects dates beyond ~11 months and malformed flight numbers", () => {
    expect(trackError({ flight: "AM401", flight_date: "2028-01-01" }, today)).toMatch(/11 meses/);
    expect(trackError({ flight: "hola mundo", flight_date: today }, today)).toMatch(/vuelo/);
  });

  it("normalizes flight codes", () => {
    expect(normalizeFlight(" am 401 ")).toBe("AM401");
  });
});

describe("localISODate", () => {
  it("uses the device time zone, not UTC", () => {
    const evening = new Date(2026, 9, 22, 23, 30); // 23:30 hora local
    expect(localISODate(evening)).toBe("2026-10-22");
    expect(localISODatePlus(1, evening)).toBe("2026-10-23");
    expect(localISODatePlus(10, new Date(2026, 11, 28))).toBe("2027-01-07");
  });
});
