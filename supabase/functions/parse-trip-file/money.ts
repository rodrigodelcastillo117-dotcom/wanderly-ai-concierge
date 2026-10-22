// Montos de un archivo de viaje (D-08). Sin Deno, para probarlo con Vitest.
//
// Antes el prompt le decía al modelo "USD≈18 MXN, EUR≈20 MXN" y la conversión la hacía la IA, sin
// guardar la moneda original. Ahora el modelo copia el monto TAL CUAL con su moneda y aquí se
// convierte con el tipo de cambio de _shared/fx.ts (fuente y fecha). Una moneda sin tasa nunca se
// toma 1:1: queda "sin convertir" con su monto original.

export type FxInfoLike = { rate: number; source: string; fetched_at: string; is_fallback: boolean };
export type MxnRates = Partial<Record<"USD" | "EUR", FxInfoLike>>;

export type Money = {
  /** Monto en MXN, o null si no hay tasa para esa moneda. */
  mxn: number | null;
  original: { monto: number; moneda: string } | null;
  tipo_cambio: (FxInfoLike & { de: string }) | null;
  sin_convertir: boolean;
};

const NONE: Money = { mxn: null, original: null, tipo_cambio: null, sin_convertir: false };

const ALIASES: Record<string, string> = {
  "$": "MXN", "MN": "MXN", "M.N.": "MXN", "PESOS": "MXN", "MXP": "MXN",
  "US$": "USD", "USD$": "USD", "DOLARES": "USD", "DÓLARES": "USD", "€": "EUR", "EUROS": "EUR",
};

export function normalizeCurrency(raw: unknown, fallback: string | null = "MXN"): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return fallback;
  if (ALIASES[s]) return ALIASES[s];
  return /^[A-Z]{3}$/.test(s) ? s : fallback;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Convierte un monto a MXN. MXN pasa directo; USD/EUR con su tasa; otra moneda: sin convertir. */
export function toMxn(amount: unknown, currency: unknown, rates: MxnRates): Money {
  const n = num(amount);
  if (n === null) return NONE;
  const c = normalizeCurrency(currency) ?? "MXN";
  const original = { monto: n, moneda: c };
  if (c === "MXN") return { mxn: Math.round(n), original, tipo_cambio: null, sin_convertir: false };
  const fx = (rates as Record<string, FxInfoLike | undefined>)[c];
  if (!fx || !(fx.rate > 0)) return { mxn: null, original, tipo_cambio: null, sin_convertir: true };
  return { mxn: Math.round(n * fx.rate), original, tipo_cambio: { ...fx, de: c }, sin_convertir: false };
}

/**
 * Lee un monto de un elemento del modelo: el campo nuevo (`campo` + `moneda`) o, si el modelo usó
 * el formato viejo (`campo_mxn`), ese ya en MXN.
 */
export function readMoney(item: any, field: string, defaultCurrency: string | null, rates: MxnRates): Money {
  if (!item || typeof item !== "object") return NONE;
  if (item[field] !== undefined && item[field] !== null) {
    return toMxn(item[field], item.moneda ?? defaultCurrency, rates);
  }
  const legacy = item[`${field}_mxn`];
  return legacy !== undefined && legacy !== null ? toMxn(legacy, "MXN", rates) : NONE;
}

/** Monedas distintas de MXN que aparecen en el resultado (para pedir solo las tasas necesarias). */
export function currenciesUsed(parsed: any): string[] {
  const out = new Set<string>();
  const def = normalizeCurrency(parsed?.moneda_original);
  const add = (c: unknown) => { const n = normalizeCurrency(c, def); if (n && n !== "MXN") out.add(n); };
  add(parsed?.moneda_original);
  for (const key of ["vuelos", "hoteles", "cruceros", "transfers"]) {
    for (const it of Array.isArray(parsed?.[key]) ? parsed[key] : []) add(it?.moneda);
  }
  return [...out];
}

/** Datos para el cliente: precio en MXN y, aparte, el original y el tipo de cambio usado. */
export const moneyMeta = (m: Money) =>
  m.original ? { precio_original: m.original, tipo_cambio: m.tipo_cambio, sin_convertir: m.sin_convertir || undefined } : {};
