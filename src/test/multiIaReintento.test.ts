// Praga → Viena → Budapest (11-nov-2026): 2 de 4 llamadas al modelo se colgaron hasta los 123 s y el plan falló (503) o salió con
// ciudades vacías. Cada llamada tiene tope de 45 s y se repite una vez si falla y queda tiempo.
import { describe, expect, it } from "vitest";
import { AI_CALL_CAP_MS, callAIRetry } from "../../supabase/functions/logistics-plan/aiRetry";

describe("plan de varias ciudades: el modelo no se lleva todo el tiempo", () => {
  it("tope de 45 s por llamada y un reintento si falla", async () => {
    const tops: number[] = [];
    let n = 0;
    const r = await callAIRetry(async (ms) => { tops.push(ms); n++; if (n === 1) throw new Error("timeout"); return "ok"; }, () => 110_000);
    expect(r).toBe("ok");
    expect(tops).toEqual([AI_CALL_CAP_MS, AI_CALL_CAP_MS]);
  });
  it("sin tiempo para reintentar, avisa el error (el plan usa lo que tenga)", async () => {
    await expect(callAIRetry(async () => { throw new Error("timeout"); }, () => 9_000)).rejects.toThrow("timeout");
  });
  it("con menos de 45 s restantes, el tope es lo que queda", async () => {
    const tops: number[] = [];
    await callAIRetry(async (ms) => { tops.push(ms); return 1; }, () => 30_000);
    expect(tops).toEqual([30_000]);
  });
  it("si tarda más de lo normal, lanza otra llamada en paralelo y gana la primera que conteste", async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let n = 0; let reintentos = 0;
    const t0 = Date.now();
    const r = await callAIRetry(async () => { n++; if (n === 1) { await wait(400); return "lenta"; } await wait(20); return "rápida"; }, () => 110_000, () => reintentos++, 50);
    expect(r).toBe("rápida");
    expect(n).toBe(2);
    expect(reintentos).toBe(1);
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it("si la segunda falla, espera a la primera", async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let n = 0;
    const r = await callAIRetry(async () => { n++; if (n === 1) { await wait(150); return "primera"; } throw new Error("x"); }, () => 110_000, undefined, 30);
    expect(r).toBe("primera");
  });
  it("una llamada normal no lanza una segunda", async () => {
    let n = 0;
    await callAIRetry(async () => { n++; return 1; }, () => 110_000);
    expect(n).toBe(1);
  });
});
