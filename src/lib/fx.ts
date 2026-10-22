/**
 * Tipo de cambio en el cliente (gastos, Smart Spend, calculadora de viaje).
 *
 * Fuente en vivo: open.er-api.com (gratis, sin llave; la misma que usa el conversor), que publica
 * la hora de su última actualización. Si no responde se usa, en este orden, el último tipo de
 * cambio en vivo guardado en este dispositivo (con su fecha) o la tabla de respaldo de abajo.
 * Siempre se muestra de dónde salió la tasa y de cuándo es. Una moneda sin tasa NUNCA se toma
 * 1:1: se reporta "sin convertir".
 */

export type FxTable = {
  /** Unidades de cada moneda por 1 USD. */
  rates: Record<string, number>;
  /** Quién publica la tasa. */
  source: string;
  /** Fecha/hora de la tasa (ISO). */
  asOf: string;
  /** true si no es la tasa en vivo de este momento. */
  isFallback: boolean;
  /** "live" | "cached" (último en vivo guardado) | "static" (tabla fija). */
  kind: "live" | "cached" | "static";
};

export const FX_LIVE_URL = "https://open.er-api.com/v6/latest/USD";
const STORAGE_KEY = "iatos_fx_last_live_v1";

/**
 * Tabla de respaldo, alineada con las edge functions (_shared/fx.ts: 1 USD = 20.5 MXN,
 * 1 EUR = 22 MXN). Es aproximada: solo se usa si no hay tasa en vivo y siempre se etiqueta.
 */
export const FX_FALLBACK_TABLE: FxTable = {
  rates: { USD: 1, MXN: 20.5, EUR: 20.5 / 22, GBP: 1 / 1.27 },
  source: "tabla de respaldo de IATOS",
  asOf: "2026-10-22T00:00:00Z",
  isFallback: true,
  kind: "static",
};

const validRates = (r: unknown): r is Record<string, number> =>
  !!r && typeof r === "object" && Object.values(r as Record<string, unknown>).some((v) => typeof v === "number" && v > 0);

/** Convierte `amount` de `from` a `to`. null si falta la tasa de alguna (nunca 1:1 a ciegas). */
export function convert(amount: number, from: string, to: string, table: FxTable): number | null {
  const f = String(from || "").toUpperCase();
  const t = String(to || "").toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (f === t) return n;
  const rf = table.rates[f];
  const rt = table.rates[t];
  if (!(rf > 0) || !(rt > 0)) return null;
  return (n / rf) * rt;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "fecha desconocida";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Texto para mostrar junto a un monto convertido: fuente + fecha, y si es de respaldo. */
export function fxLabel(table: FxTable): string {
  if (table.kind === "live") return `Tipo de cambio de ${table.source} (actualizado ${shortDate(table.asOf)})`;
  if (table.kind === "cached") return `Tipo de cambio de respaldo: último en vivo de ${table.source} (${shortDate(table.asOf)})`;
  return `Tipo de cambio de respaldo aproximado (${shortDate(table.asOf)}); sin conexión a la tasa en vivo`;
}

/** Fecha de la tasa que publica open.er-api.com (time_last_update_utc). null si no viene. */
export function providerUpdatedAt(json: unknown): Date | null {
  const raw = (json as { time_last_update_utc?: unknown; time_last_update_unix?: unknown } | null) ?? null;
  if (typeof raw?.time_last_update_unix === "number") {
    const d = new Date(raw.time_last_update_unix * 1000);
    if (Number.isFinite(d.getTime())) return d;
  }
  if (typeof raw?.time_last_update_utc === "string") {
    const d = new Date(raw.time_last_update_utc);
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

/** Texto del conversor: fuente + fecha del proveedor, y si es el último guardado (sin conexión). */
export function converterRateLabel(source: string, asOf: Date | null, cached: boolean): string {
  const when = asOf ? shortDate(asOf.toISOString()) : "fecha desconocida";
  return cached
    ? `Tipo de cambio de respaldo: último de ${source} guardado en este dispositivo (${when})`
    : `Tipo de cambio de ${source} (actualizado ${when})`;
}

function readCached(): FxTable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!validRates(t?.rates) || typeof t?.asOf !== "string") return null;
    return { rates: t.rates, source: String(t.source ?? "open.er-api.com"), asOf: t.asOf, isFallback: true, kind: "cached" };
  } catch {
    return null;
  }
}

function writeCached(t: FxTable) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rates: t.rates, source: t.source, asOf: t.asOf })); } catch { /* sin almacenamiento */ }
}

/** Tipo de cambio en vivo; si falla, el último en vivo guardado o la tabla de respaldo. */
export async function fetchFxTable(fetchImpl: typeof fetch = fetch): Promise<FxTable> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetchImpl(FX_LIVE_URL, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
    if (!r.ok) throw new Error(`fx ${r.status}`);
    const j = await r.json();
    if (j?.result !== "success" || !validRates(j?.rates)) throw new Error("respuesta sin tasas");
    const asOfRaw = j?.time_last_update_utc ? new Date(j.time_last_update_utc) : null;
    const table: FxTable = {
      rates: { ...j.rates, USD: 1 },
      source: "open.er-api.com",
      asOf: asOfRaw && Number.isFinite(asOfRaw.getTime()) ? asOfRaw.toISOString() : new Date().toISOString(),
      isFallback: false,
      kind: "live",
    };
    writeCached(table);
    return table;
  } catch {
    return readCached() ?? FX_FALLBACK_TABLE;
  }
}

/** Fecha YYYY-MM-DD como fecha LOCAL (new Date("2026-10-01") es UTC y en México cae el 30 sep). */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export type Money = { amount: number; currency: string };

const SYMBOL: Record<string, string> = { MXN: "$", USD: "US$", EUR: "€", GBP: "£" };
/** "$1,200 MXN", "US$300", "€80". */
export function formatMoney(amount: number, currency: string, maxFrac = 2): string {
  const c = String(currency || "").toUpperCase();
  const n = Number(amount).toLocaleString("es-MX", { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
  if (c === "MXN") return `$${n} MXN`;
  return SYMBOL[c] ? `${SYMBOL[c]}${n}` : `${n} ${c}`;
}

/** Suma por moneda: nunca mezcla MXN con USD o EUR. */
export function subtotalsByCurrency(items: Money[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const c = String(it.currency || "MXN").toUpperCase();
    out[c] = (out[c] ?? 0) + (Number(it.amount) || 0);
  }
  return out;
}

export type ConvertedTotal = {
  /** Suma convertida a `target` de lo que sí tiene tasa. */
  total: number;
  /** Monedas sin tasa (no se suman): moneda → monto. */
  unconverted: Record<string, number>;
  convertedCount: number;
  unconvertedCount: number;
};

export function convertedTotal(items: Money[], target: string, table: FxTable): ConvertedTotal {
  const res: ConvertedTotal = { total: 0, unconverted: {}, convertedCount: 0, unconvertedCount: 0 };
  for (const it of items) {
    const c = String(it.currency || "MXN").toUpperCase();
    const v = convert(Number(it.amount) || 0, c, target, table);
    if (v == null) {
      res.unconverted[c] = (res.unconverted[c] ?? 0) + (Number(it.amount) || 0);
      res.unconvertedCount += 1;
    } else {
      res.total += v;
      res.convertedCount += 1;
    }
  }
  return res;
}

export type SpendItem = Money & { category: string; expense_date: string };

export type SpendSummary = {
  thisMonth: number;
  lastMonth: number;
  byCat: Record<string, number>;
  total: number;
  unconvertedCount: number;
  unconvertedCurrencies: string[];
};

/**
 * Gasto del mes actual vs el anterior y por categoría, todo convertido a `target` con `table`.
 * Las fechas se leen como fecha local. Lo que no tiene tasa no se suma y se cuenta aparte.
 */
export function summarizeSpend(items: SpendItem[], target: string, table: FxTable, now: Date = new Date()): SpendSummary {
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const out: SpendSummary = { thisMonth: 0, lastMonth: 0, byCat: {}, total: 0, unconvertedCount: 0, unconvertedCurrencies: [] };
  const missing = new Set<string>();
  for (const x of items) {
    const v = convert(Number(x.amount) || 0, x.currency || "MXN", target, table);
    if (v == null) {
      out.unconvertedCount += 1;
      missing.add(String(x.currency || "").toUpperCase());
      continue;
    }
    const d = parseLocalDate(x.expense_date);
    if (d && d >= m0 && d < m2) out.thisMonth += v;
    else if (d && d >= m1 && d < m0) out.lastMonth += v;
    out.byCat[x.category] = (out.byCat[x.category] ?? 0) + v;
  }
  out.total = Object.values(out.byCat).reduce((a, b) => a + b, 0);
  out.unconvertedCurrencies = [...missing];
  return out;
}
