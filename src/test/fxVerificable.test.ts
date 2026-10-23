// Tipos de cambio: solo con fuente y fecha (BCE vía frankfurter). Antes concierge-chat tenía GBP 26,
// JPY 0.135 y AED 5.6 fijos; y las referencias de precios de México se usaban para cualquier destino.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getRateToMxnInfo, __resetFxCache } from "../../supabase/functions/_shared/fx";
import { convert, DEFAULT_FX } from "../../supabase/functions/_shared/priveKey";

const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("tipo de cambio verificable", () => {
  afterEach(() => __resetFxCache());

  it("JPY: tasa en vivo con fuente y fecha del proveedor", async () => {
    const info = await getRateToMxnInfo("JPY", async () => res({ date: "2026-10-22", rates: { MXN: 0.1291 } }));
    expect(info).toEqual({ rate: 0.1291, source: "frankfurter", fetched_at: "2026-10-22T00:00:00Z", is_fallback: false });
  });

  it("moneda que el BCE no publica (AED) o API caída → null, sin valor inventado", async () => {
    expect(await getRateToMxnInfo("AED", async () => res({ message: "not found" }, 404))).toBeNull();
    __resetFxCache();
    expect(await getRateToMxnInfo("GBP", async () => { throw new Error("offline"); })).toBeNull();
    expect(await getRateToMxnInfo("xx1", async () => res({}))).toBeNull();
  });

  it("sin tasa no se convierte (no hay 1:1 ni tabla fija)", () => {
    expect(DEFAULT_FX).toEqual({ MXN: 1 });
    expect(convert(100, "AED", "MXN", DEFAULT_FX)).toBeNull();
    expect(convert(100, "GBP", "MXN", { MXN: 1 })).toBeNull();
    expect(convert(100, "MXN", "MXN", DEFAULT_FX)).toBe(100);
  });

  it("concierge-chat ya no trae tasas fijas", () => {
    const src = readFileSync("supabase/functions/concierge-chat/index.ts", "utf8");
    expect(src).not.toMatch(/GBP:\s*\d|JPY:\s*0\.\d|AED:\s*\d/);
    expect(src).toMatch(/getRateToMxnInfo/);
  });

  it("analizar-viaje: los rangos de México no se aplican a destinos internacionales", () => {
    const src = readFileSync("supabase/functions/analizar-viaje/index.ts", "utf8");
    expect(src).toMatch(/SOLO PARA DESTINOS EN MÉXICO/);
    expect(src).toMatch(/si el destino NO está en México, IGNORA esta regla/);
  });
});
