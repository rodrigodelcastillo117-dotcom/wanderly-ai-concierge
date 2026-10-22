// Lo que muestra la tarjeta de alerta de precio, comparando en la moneda del proveedor (como el
// servidor, supabase/functions/price-watch-cron/rules.ts). Antes la tarjeta restaba pesos de días
// distintos: la base convertida con el tipo de cambio de cuando se activó y "hoy" con el de hoy, así
// que una tarifa en dólares idéntica aparecía como "Bajó $800" solo porque se movió el dólar.
// Ahora la base y el mínimo se muestran al tipo de cambio de hoy y la diferencia es solo la de la
// tarifa. Las alertas viejas sin monto original siguen con los pesos guardados.

export type WatchLike = {
  baseline_price_mxn: number | string;
  last_price_mxn?: number | string | null;
  lowest_price_mxn?: number | string | null;
  baseline_source?: string | null;
  baseline_currency?: string | null;
  baseline_amount_original?: number | string | null;
  last_amount_original?: number | string | null;
};

export type CheckLike = {
  price_mxn: number | string;
  approximate_dates?: boolean | null;
  source?: string | null;
  amount_original?: number | string | null;
  currency?: string | null;
};

export type PriceWatchView = {
  baselineMxn: number;
  currentMxn: number | null;
  lowestMxn: number | null;
  /** Diferencia por persona en MXN (negativa = bajó). Solo por la tarifa, no por el dólar. */
  deltaMxn: number;
  /** true si se comparó en la moneda del proveedor (y se muestra al tipo de cambio de hoy). */
  sameCurrency: boolean;
  currency: string | null;
  /** Puntos de la gráfica (moneda del proveedor si se puede; si no, MXN). */
  points: number[];
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function priceWatchView(watch: WatchLike, checks: CheckLike[]): PriceWatchView {
  const baselineMxnSaved = num(watch.baseline_price_mxn) ?? 0;
  const currentMxn = num(watch.last_price_mxn);
  const baseAmt = num(watch.baseline_amount_original);
  const lastAmt = num(watch.last_amount_original);
  const currency = watch.baseline_currency ? watch.baseline_currency.toUpperCase() : null;
  const exact = checks.filter((c) => !c.approximate_dates && c.source === watch.baseline_source);
  // Tipo de cambio de hoy = el de la última revisión comparable (pesos / monto original).
  const fxToday = currentMxn != null && lastAmt && lastAmt > 0 ? currentMxn / lastAmt : null;

  if (currency && baseAmt && baseAmt > 0 && lastAmt && lastAmt > 0 && fxToday) {
    const sameCur = exact.filter((c) => (c.currency ?? currency).toUpperCase() === currency && num(c.amount_original) != null);
    const amounts = sameCur.map((c) => num(c.amount_original)!);
    const lowestAmt = Math.min(lastAmt, baseAmt, ...amounts);
    return {
      baselineMxn: Math.round(baseAmt * fxToday),
      currentMxn: Math.round(currentMxn!),
      lowestMxn: Math.round(lowestAmt * fxToday),
      deltaMxn: Math.round((lastAmt - baseAmt) * fxToday),
      sameCurrency: true,
      currency,
      points: amounts.length >= 2 ? amounts : exact.map((c) => num(c.price_mxn) ?? 0),
    };
  }

  // Alerta anterior al monto original: pesos guardados, como antes.
  return {
    baselineMxn: baselineMxnSaved,
    currentMxn,
    lowestMxn: num(watch.lowest_price_mxn),
    deltaMxn: currentMxn == null ? 0 : currentMxn - baselineMxnSaved,
    sameCurrency: false,
    currency,
    points: exact.map((c) => num(c.price_mxn) ?? 0),
  };
}
