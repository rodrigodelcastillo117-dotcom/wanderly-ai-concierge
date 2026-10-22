import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  convert, convertedTotal, fetchFxTable, FX_FALLBACK_TABLE, fxLabel, formatMoney, parseLocalDate, subtotalsByCurrency, summarizeSpend, type FxTable,
} from "@/lib/fx";
import { getUsdMxnRateInfo, getUsdMxnRate, __resetFxCache, FX_FALLBACK } from "../../supabase/functions/_shared/fx";

const live: FxTable = { rates: { USD: 1, MXN: 18, EUR: 0.9 }, source: "open.er-api.com", asOf: "2026-10-22T00:02:31Z", isFallback: false, kind: "live" };

describe("convert / totales: nunca 1:1 a ciegas", () => {
  it("convierte entre monedas con tasa", () => {
    expect(convert(100, "USD", "MXN", live)).toBe(1800);
    expect(convert(90, "EUR", "USD", live)).toBeCloseTo(100);
    expect(convert(50, "mxn", "MXN", live)).toBe(50);
  });
  it("moneda sin tasa → null (antes 10,000 JPY = 10,000 USD)", () => {
    expect(convert(10000, "JPY", "USD", live)).toBeNull();
    expect(convert(1000, "COP", "MXN", FX_FALLBACK_TABLE)).toBeNull();
  });
  it("subtotales por moneda y total convertido con lo no convertible aparte", () => {
    const items = [{ amount: 1000, currency: "MXN" }, { amount: 1000, currency: "USD" }, { amount: 900, currency: "EUR" }, { amount: 5000, currency: "JPY" }];
    expect(subtotalsByCurrency(items)).toEqual({ MXN: 1000, USD: 1000, EUR: 900, JPY: 5000 });
    const t = convertedTotal(items, "MXN", live);
    expect(t.total).toBeCloseTo(1000 + 18000 + 18000);
    expect(t.unconverted).toEqual({ JPY: 5000 });
    expect(t.unconvertedCount).toBe(1);
  });
  it("formatea con la moneda", () => {
    expect(formatMoney(1200, "MXN")).toBe("$1,200 MXN");
    expect(formatMoney(300, "USD")).toBe("US$300");
    expect(formatMoney(80, "EUR")).toBe("€80");
    expect(formatMoney(5, "JPY")).toBe("5 JPY");
  });
});

describe("fechas de gastos como fecha local (no un día antes)", () => {
  const tz = process.env.TZ;
  beforeEach(() => { process.env.TZ = "America/Mexico_City"; });
  afterEach(() => { process.env.TZ = tz; });
  it("2026-10-01 cae en octubre y se muestra como 1 de octubre", () => {
    const d = parseLocalDate("2026-10-01")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 1]);
    const s = summarizeSpend(
      [{ amount: 100, currency: "MXN", category: "Otros", expense_date: "2026-10-01" }, { amount: 50, currency: "MXN", category: "Otros", expense_date: "2026-09-30" }],
      "MXN", live, new Date(2026, 9, 22),
    );
    expect(s.thisMonth).toBe(100);
    expect(s.lastMonth).toBe(50);
  });
  it("Smart Spend convierte a MXN y cuenta aparte lo que no tiene tasa", () => {
    const s = summarizeSpend([
      { amount: 1000, currency: "MXN", category: "Transporte", expense_date: "2026-10-05" },
      { amount: 100, currency: "USD", category: "Transporte", expense_date: "2026-10-06" },
      { amount: 3000, currency: "JPY", category: "Otros", expense_date: "2026-10-06" },
    ], "MXN", live, new Date(2026, 9, 22));
    expect(s.thisMonth).toBe(2800);
    expect(s.byCat).toEqual({ Transporte: 2800 });
    expect(s.unconvertedCount).toBe(1);
    expect(s.unconvertedCurrencies).toEqual(["JPY"]);
  });
});

describe("fetchFxTable: fuente y fecha siempre visibles", () => {
  beforeEach(() => localStorage.clear());
  it("en vivo: usa la hora de actualización del proveedor", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "success", time_last_update_utc: "Thu, 22 Oct 2026 00:02:31 +0000", rates: { USD: 1, MXN: 18.3 } })));
    const t = await fetchFxTable(f as unknown as typeof fetch);
    expect(t).toMatchObject({ kind: "live", isFallback: false, source: "open.er-api.com", asOf: "2026-10-22T00:02:31.000Z" });
    expect(fxLabel(t)).toBe("Tipo de cambio de open.er-api.com (actualizado 22 oct 2026)");
  });
  it("si falla, usa el último en vivo guardado con su fecha; si no hay, la tabla de respaldo (nunca 1:1)", async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "success", time_last_update_utc: "Wed, 21 Oct 2026 00:02:31 +0000", rates: { USD: 1, MXN: 18.3 } })));
    await fetchFxTable(ok as unknown as typeof fetch);
    const down = vi.fn().mockRejectedValue(new Error("offline"));
    const cached = await fetchFxTable(down as unknown as typeof fetch);
    expect(cached).toMatchObject({ kind: "cached", isFallback: true, rates: { MXN: 18.3 } });
    expect(fxLabel(cached)).toBe("Tipo de cambio de respaldo: último en vivo de open.er-api.com (21 oct 2026)");
    localStorage.clear();
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "error" })));
    const fallback = await fetchFxTable(bad as unknown as typeof fetch);
    expect(fallback.kind).toBe("static");
    expect(fxLabel(fallback)).toMatch(/^Tipo de cambio de respaldo aproximado \(22 oct 2026\)/);
    expect(fallback.rates.MXN).toBe(20.5);
  });
});

describe("_shared/fx (servidor): la tasa dice de dónde salió y de cuándo", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { __resetFxCache(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => vi.unstubAllGlobals());
  it("200 válido → frankfurter con la fecha publicada", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ date: "2026-10-21", rates: { MXN: 18.42 } })));
    expect(await getUsdMxnRateInfo()).toEqual({ rate: 18.42, source: "frankfurter", fetched_at: "2026-10-21T00:00:00Z", is_fallback: false });
  });
  it("500 o valor fuera de rango → respaldo marcado como tal", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    expect(await getUsdMxnRateInfo()).toMatchObject({ rate: FX_FALLBACK.USD, source: "fallback", is_fallback: true });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rates: { MXN: 2 } })));
    expect(await getUsdMxnRate()).toBe(20.5);
  });
});
