import { describe, it, expect } from "vitest";
import { decide, formatMxn } from "../../supabase/functions/price-watch-cron/rules";
import { primaryPlace } from "../../supabase/functions/price-watch/place";

const base = { baselinePrice: 20000, baselineApproximate: false, baselineSource: "travelpayouts", lastAlertPrice: null, lastAlertAt: null };
const now = new Date("2026-10-17T12:00:00Z");

describe("price watch alert rules", () => {
  it("alerts on a real drop of at least 5% and $500 MXN", () => {
    expect(decide(base, { price: 18000, approximate: false, source: "travelpayouts" }, now)).toEqual({
      kind: "alert", dropMxn: 2000, dropPct: 0.1,
    });
  });

  it("ignores small wobbles below the thresholds", () => {
    expect(decide(base, { price: 19600, approximate: false, source: "travelpayouts" }, now)).toMatchObject({ kind: "skip", reason: "no_drop" });
    expect(decide({ ...base, baselinePrice: 6000 }, { price: 5600, approximate: false, source: "travelpayouts" }, now))
      .toMatchObject({ kind: "skip", reason: "no_drop" });
  });

  it("never alerts on a month-level fallback price (different date)", () => {
    expect(decide(base, { price: 10000, approximate: true, source: "travelpayouts" }, now)).toMatchObject({ kind: "skip", reason: "approximate" });
  });

  it("replaces an approximate baseline with the first exact-date price without alerting", () => {
    expect(decide({ ...base, baselineApproximate: true }, { price: 10000, approximate: false, source: "travelpayouts" }, now))
      .toEqual({ kind: "rebaseline" });
  });

  it("only re-alerts on a new low, not the same drop again", () => {
    const alerted = { ...base, lastAlertPrice: 18000, lastAlertAt: "2026-10-15T12:00:00Z" };
    expect(decide(alerted, { price: 17900, approximate: false, source: "travelpayouts" }, now)).toMatchObject({ kind: "skip", reason: "not_new_low" });
    expect(decide(alerted, { price: 17000, approximate: false, source: "travelpayouts" }, now)).toMatchObject({ kind: "alert", dropMxn: 3000 });
  });

  it("waits at least 20h between alerts", () => {
    const recent = { ...base, lastAlertPrice: 18000, lastAlertAt: "2026-10-17T02:00:00Z" };
    expect(decide(recent, { price: 15000, approximate: false, source: "travelpayouts" }, now)).toMatchObject({ kind: "skip", reason: "too_soon" });
  });

  it("never treats a gap between providers as a price drop", () => {
    expect(decide(base, { price: 12000, approximate: false, source: "google_flights" }, now))
      .toMatchObject({ kind: "skip", reason: "source_mismatch" });
  });

  it("formats MXN amounts", () => {
    expect(formatMxn(8400.4)).toBe("$8,400 MXN");
  });
});

describe("primaryPlace", () => {
  it("keeps the first city of free-text trip places", () => {
    expect(primaryPlace("Tokio, Japón")).toBe("Tokio");
    expect(primaryPlace("Roma → Florencia → Venecia")).toBe("Roma");
    expect(primaryPlace("MEX")).toBe("MEX");
    expect(primaryPlace(null)).toBe("");
  });
});
