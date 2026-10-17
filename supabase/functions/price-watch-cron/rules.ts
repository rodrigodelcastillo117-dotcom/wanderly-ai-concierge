// Pure alert decision for price watches; kept free of Deno APIs so it is unit-tested.

export const MIN_DROP_PCT = 0.05;
export const MIN_DROP_MXN = 500;
// A follow-up alert must beat the last alerted price by this much, so a price
// that wobbles a few pesos doesn't re-notify.
export const MIN_FURTHER_DROP_PCT = 0.03;
export const MIN_ALERT_GAP_HOURS = 20;

export type WatchState = {
  baselinePrice: number;
  baselineApproximate: boolean;
  lastAlertPrice: number | null;
  lastAlertAt: string | null;
};

export type Check = { price: number; approximate: boolean };

export type Decision =
  | { kind: "skip"; reason: "approximate" | "no_drop" | "too_soon" | "not_new_low" }
  | { kind: "rebaseline" }
  | { kind: "alert"; dropMxn: number; dropPct: number };

export function decide(watch: WatchState, check: Check, now: Date): Decision {
  // Never compare prices for different dates: only exact-date fares can alert.
  if (check.approximate) return { kind: "skip", reason: "approximate" };
  if (watch.baselineApproximate) return { kind: "rebaseline" };

  const dropMxn = watch.baselinePrice - check.price;
  const dropPct = dropMxn / watch.baselinePrice;
  if (dropMxn < MIN_DROP_MXN || dropPct < MIN_DROP_PCT) return { kind: "skip", reason: "no_drop" };

  if (watch.lastAlertPrice != null) {
    const further = (watch.lastAlertPrice - check.price) / watch.lastAlertPrice;
    if (further < MIN_FURTHER_DROP_PCT) return { kind: "skip", reason: "not_new_low" };
  }
  if (watch.lastAlertAt) {
    const hours = (now.getTime() - new Date(watch.lastAlertAt).getTime()) / 3_600_000;
    if (hours < MIN_ALERT_GAP_HOURS) return { kind: "skip", reason: "too_soon" };
  }
  return { kind: "alert", dropMxn: Math.round(dropMxn), dropPct };
}

export function formatMxn(n: number): string {
  return `$${Math.round(n).toLocaleString("es-MX")} MXN`;
}
