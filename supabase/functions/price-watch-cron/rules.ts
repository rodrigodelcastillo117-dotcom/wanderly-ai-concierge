// Pure alert decision for price watches; kept free of Deno APIs so it is unit-tested.
// Los precios se comparan en la moneda original del proveedor (USD hoy): si solo cambió el tipo de
// cambio, la tarifa no bajó y no se avisa. Los pesos solo se usan para mostrar y para el mínimo
// de ahorro en MXN.

export const MIN_DROP_PCT = 0.05;
export const MIN_DROP_MXN = 500;
// A follow-up alert must beat the last alerted price by this much, so a price
// that wobbles a few pesos doesn't re-notify.
export const MIN_FURTHER_DROP_PCT = 0.03;
export const MIN_ALERT_GAP_HOURS = 20;

export type WatchState = {
  /** Monto base en la moneda del proveedor; null en vigilancias creadas antes de guardarlo. */
  baselineAmount: number | null;
  baselineCurrency: string | null;
  baselineApproximate: boolean;
  baselineSource: string;
  /** Último monto avisado, en la moneda original. */
  lastAlertAmount: number | null;
  lastAlertAt: string | null;
};

export type Check = {
  /** Monto en la moneda del proveedor. */
  amount: number;
  currency: string;
  approximate: boolean;
  source: string;
  /** Tipo de cambio de hoy, de `currency` a MXN; solo para el mínimo de ahorro y lo que se muestra. */
  fxToMxn: number;
};

export type Decision =
  | { kind: "skip"; reason: "approximate" | "source_mismatch" | "currency_mismatch" | "no_drop" | "too_soon" | "not_new_low" }
  | { kind: "rebaseline"; reason: "approximate_baseline" | "legacy_baseline" }
  | { kind: "alert"; dropOriginal: number; dropMxn: number; dropPct: number };

export function decide(watch: WatchState, check: Check, now: Date): Decision {
  // Never compare prices for different dates: only exact-date fares can alert.
  if (check.approximate) return { kind: "skip", reason: "approximate" };
  if (watch.baselineApproximate) return { kind: "rebaseline", reason: "approximate_baseline" };
  // Different providers aren't comparable; a gap between them is not a price drop.
  if (check.source !== watch.baselineSource) return { kind: "skip", reason: "source_mismatch" };
  // Sin monto original no hay contra qué comparar sin adivinar el tipo de cambio de entonces:
  // esta tarifa exacta pasa a ser la base, sin avisar.
  if (watch.baselineAmount == null || !(watch.baselineAmount > 0) || !watch.baselineCurrency) {
    return { kind: "rebaseline", reason: "legacy_baseline" };
  }
  if (watch.baselineCurrency.toUpperCase() !== check.currency.toUpperCase()) return { kind: "skip", reason: "currency_mismatch" };

  const dropOriginal = watch.baselineAmount - check.amount;
  const dropPct = dropOriginal / watch.baselineAmount;
  const dropMxn = dropOriginal * check.fxToMxn;
  if (dropOriginal <= 0 || dropMxn < MIN_DROP_MXN || dropPct < MIN_DROP_PCT) return { kind: "skip", reason: "no_drop" };

  if (watch.lastAlertAmount != null && watch.lastAlertAmount > 0) {
    const further = (watch.lastAlertAmount - check.amount) / watch.lastAlertAmount;
    if (further < MIN_FURTHER_DROP_PCT) return { kind: "skip", reason: "not_new_low" };
  }
  if (watch.lastAlertAt) {
    const hours = (now.getTime() - new Date(watch.lastAlertAt).getTime()) / 3_600_000;
    if (hours < MIN_ALERT_GAP_HOURS) return { kind: "skip", reason: "too_soon" };
  }
  return { kind: "alert", dropOriginal, dropMxn: Math.round(dropMxn), dropPct };
}

export function formatMxn(n: number): string {
  return `$${Math.round(n).toLocaleString("es-MX")} MXN`;
}

/** Llave única del aviso: la misma baja (misma base y mismo monto) nunca se avisa dos veces. */
export const priceDedupKey = (watchId: string, baselineAmount: number, amount: number, currency: string) =>
  `price:${watchId}:${baselineAmount}:${amount}:${currency.toUpperCase()}`;
