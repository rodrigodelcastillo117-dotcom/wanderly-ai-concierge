// Tipo de cambio USD→MXN y EUR→MXN en vivo (frankfurter.app, datos del Banco Central Europeo)
// con caché de 6 h y respaldo. NUNCA hardcodear un tipo de cambio en edge functions: importar de aquí.
//
// getUsdMxnRateInfo()/getEurMxnRateInfo() dicen además DE DÓNDE salió la tasa y CUÁNDO, para
// guardarlo con la cotización. Antes, si frankfurter fallaba, se usaba 20.5 sin avisar a nadie.
// getUsdMxnRate()/getEurMxnRate() conservan la firma anterior (solo el número).

const FX_TTL_MS = 6 * 60 * 60 * 1000;

/** Tasas de respaldo aproximadas (solo si la API no responde). Valores que ya usaba el código. */
export const FX_FALLBACK = {
  USD: 20.5,
  EUR: 22,
  /** Fecha en que se fijó esta tabla (se muestra junto a la tasa). */
  as_of: "2026-10-22",
} as const;

export type FxInfo = {
  rate: number;
  /** "frankfurter" (en vivo) o "fallback" (tabla fija de arriba). */
  source: "frankfurter" | "fallback";
  /** Fecha de la tasa: la que publica el proveedor, o la fecha de la tabla de respaldo. */
  fetched_at: string;
  is_fallback: boolean;
};

const RANGES: Record<"USD" | "EUR", [number, number]> = { USD: [10, 40], EUR: [12, 45] };
const caches: Partial<Record<"USD" | "EUR", { info: FxInfo; at: number }>> = {};

async function rateInfo(from: "USD" | "EUR"): Promise<FxInfo> {
  const now = Date.now();
  const cached = caches[from];
  if (cached && now - cached.at < FX_TTL_MS) return cached.info;
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=MXN`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = await r.json();
    const rate = Number(j?.rates?.MXN);
    const [min, max] = RANGES[from];
    if (!Number.isFinite(rate) || rate < min || rate > max) throw new Error(`tasa fuera de rango: ${rate}`);
    // frankfurter publica la fecha de la tasa (día hábil del BCE).
    const date = typeof j?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? `${j.date}T00:00:00Z` : new Date(now).toISOString();
    const info: FxInfo = { rate, source: "frankfurter", fetched_at: date, is_fallback: false };
    caches[from] = { info, at: now };
    return info;
  } catch (e) {
    console.warn(`fx ${from}→MXN falló, usando respaldo:`, (e as Error).message);
    return { rate: FX_FALLBACK[from], source: "fallback", fetched_at: `${FX_FALLBACK.as_of}T00:00:00Z`, is_fallback: true };
  }
}

export const getUsdMxnRateInfo = () => rateInfo("USD");
export const getEurMxnRateInfo = () => rateInfo("EUR");

export async function getUsdMxnRate(): Promise<number> {
  return (await getUsdMxnRateInfo()).rate;
}

export async function getEurMxnRate(): Promise<number> {
  return (await getEurMxnRateInfo()).rate;
}

/** Solo para pruebas: vacía la caché en memoria. */
export function __resetFxCache() {
  delete caches.USD;
  delete caches.EUR;
}
