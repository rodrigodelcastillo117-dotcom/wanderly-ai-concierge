// Tipo de cambio USD→MXN en vivo (frankfurter.app) con cache de 6h y fallback seguro.
// NUNCA hardcodear un tipo de cambio en edge functions: importar getUsdMxnRate() de aquí.

const FX_TTL_MS = 6 * 60 * 60 * 1000;
const USD_MXN_FALLBACK = 20.5;

let fxCache: { rate: number; fetchedAt: number } | null = null;

export async function getUsdMxnRate(): Promise<number> {
  const now = Date.now();
  if (fxCache && now - fxCache.fetchedAt < FX_TTL_MS) return fxCache.rate;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=MXN");
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = await r.json();
    const rate = Number(j?.rates?.MXN);
    if (!Number.isFinite(rate) || rate < 10 || rate > 40) {
      console.warn("fx rate out of range or invalid:", rate);
      return USD_MXN_FALLBACK;
    }
    fxCache = { rate, fetchedAt: now };
    return rate;
  } catch (e) {
    console.warn("fx fetch failed, using fallback:", (e as Error).message);
    return USD_MXN_FALLBACK;
  }
}

// EUR→MXN derivado vía USD (frankfurter EUR->MXN directo, mismo cache pattern).
let eurCache: { rate: number; fetchedAt: number } | null = null;

export async function getEurMxnRate(): Promise<number> {
  const now = Date.now();
  if (eurCache && now - eurCache.fetchedAt < FX_TTL_MS) return eurCache.rate;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=MXN");
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = await r.json();
    const rate = Number(j?.rates?.MXN);
    if (!Number.isFinite(rate) || rate < 12 || rate > 45) return 22;
    eurCache = { rate, fetchedAt: now };
    return rate;
  } catch {
    return 22;
  }
}
