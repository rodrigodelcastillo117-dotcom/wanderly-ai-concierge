import { describe, it, expect } from "vitest";
import { decide, formatMxn, priceDedupKey } from "../../supabase/functions/price-watch-cron/rules";
import { primaryPlace } from "../../supabase/functions/price-watch/place";

// Base de 1,000 USD (≈ $20,000 MXN a 20 pesos por dólar).
const base = {
  baselineAmount: 1000, baselineCurrency: "USD", baselineApproximate: false, baselineSource: "travelpayouts",
  lastAlertAmount: null, lastAlertAt: null,
};
const check = (amount: number, over: Partial<{ approximate: boolean; source: string; currency: string; fxToMxn: number }> = {}) =>
  ({ amount, currency: "USD", approximate: false, source: "travelpayouts", fxToMxn: 20, ...over });
const now = new Date("2026-10-17T12:00:00Z");

describe("price watch alert rules", () => {
  it("alerts on a real drop of at least 5% and $500 MXN", () => {
    expect(decide(base, check(900), now)).toEqual({ kind: "alert", dropOriginal: 100, dropMxn: 2000, dropPct: 0.1 });
  });

  it("ignores small wobbles below the thresholds", () => {
    expect(decide(base, check(980), now)).toMatchObject({ kind: "skip", reason: "no_drop" });
    // 6.7% pero solo $400 MXN de ahorro
    expect(decide({ ...base, baselineAmount: 300 }, check(280), now)).toMatchObject({ kind: "skip", reason: "no_drop" });
  });

  it("never alerts when only the exchange rate moved (same USD fare)", () => {
    // Auditoría C-09: 500 USD ambos días; base tomada a 20.5 (respaldo), hoy a 18.9 → antes avisaba "ahorras $800".
    expect(decide({ ...base, baselineAmount: 500 }, check(500, { fxToMxn: 18.9 }), now)).toMatchObject({ kind: "skip", reason: "no_drop" });
    // Ni con un peso mucho más fuerte, ni con uno más débil.
    expect(decide(base, check(1000, { fxToMxn: 15 }), now)).toMatchObject({ kind: "skip", reason: "no_drop" });
    expect(decide(base, check(1000, { fxToMxn: 25 }), now)).toMatchObject({ kind: "skip", reason: "no_drop" });
  });

  it("measures the saving in MXN at today's rate only to apply the $500 minimum", () => {
    expect(decide(base, check(940, { fxToMxn: 18 }), now)).toEqual({ kind: "alert", dropOriginal: 60, dropMxn: 1080, dropPct: 0.06 });
  });

  it("never alerts on a month-level fallback price (different date)", () => {
    expect(decide(base, check(500, { approximate: true }), now)).toMatchObject({ kind: "skip", reason: "approximate" });
  });

  it("replaces an approximate baseline with the first exact-date price without alerting", () => {
    expect(decide({ ...base, baselineApproximate: true }, check(500), now)).toEqual({ kind: "rebaseline", reason: "approximate_baseline" });
  });

  it("rebaselines watches created before the original amount was stored, without alerting", () => {
    expect(decide({ ...base, baselineAmount: null, baselineCurrency: null }, check(500), now))
      .toEqual({ kind: "rebaseline", reason: "legacy_baseline" });
  });

  it("only re-alerts on a new low, not the same drop again", () => {
    const alerted = { ...base, lastAlertAmount: 900, lastAlertAt: "2026-10-15T12:00:00Z" };
    expect(decide(alerted, check(895), now)).toMatchObject({ kind: "skip", reason: "not_new_low" });
    expect(decide(alerted, check(850), now)).toMatchObject({ kind: "alert", dropMxn: 3000 });
  });

  it("waits at least 20h between alerts", () => {
    const recent = { ...base, lastAlertAmount: 900, lastAlertAt: "2026-10-17T02:00:00Z" };
    expect(decide(recent, check(750), now)).toMatchObject({ kind: "skip", reason: "too_soon" });
  });

  it("never treats a gap between providers as a price drop", () => {
    expect(decide(base, check(600, { source: "google_flights" }), now)).toMatchObject({ kind: "skip", reason: "source_mismatch" });
  });

  it("never compares amounts in different currencies", () => {
    expect(decide(base, check(600, { currency: "EUR" }), now)).toMatchObject({ kind: "skip", reason: "currency_mismatch" });
  });

  it("formats MXN amounts and builds a stable dedup key per drop", () => {
    expect(formatMxn(8400.4)).toBe("$8,400 MXN");
    expect(priceDedupKey("w1", 1000, 900, "usd")).toBe("price:w1:1000:900:USD");
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
