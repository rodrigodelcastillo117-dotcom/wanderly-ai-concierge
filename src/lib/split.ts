/**
 * Gastos compartidos del viaje (estilo Splitwise). Mismas reglas que src/lib/fx.ts: nunca se suman
 * monedas distintas como si fueran una. Los saldos y "cómo saldar" se calculan POR MONEDA (quien pagó
 * €50 recibe euros, no pesos convertidos 1:1). El total convertido a MXN es solo informativo y lleva
 * fuente y fecha del tipo de cambio.
 *
 * Todo se calcula en centavos para que la suma de partes sea exactamente el total y la suma de saldos
 * sea exactamente 0. La base (migración 20261027020000_gastos_split.sql) revisa lo mismo al guardar.
 */

export type SplitPerson = { id: string; name: string };
export type SplitShare = { person_id: string; amount: number; percent?: number | null };
export type SplitExpense = {
  id?: string;
  payer_id: string;
  amount: number;
  currency?: string | null;
  /** Entre quiénes y cuánto. Sin partes (datos viejos): partes iguales entre todas las personas. */
  shares?: SplitShare[] | null;
};
export type SplitPayment = { id?: string; from_person: string; to_person: string; amount: number; currency?: string | null };

export type Settlement = { from: string; to: string; amount: number; currency: string };
/** Igual que Settlement pero con ids de persona (para "Liquidar"). */
export type Transfer = { from: string; to: string; amount: number; currency: string };

export type SplitResult = {
  /** moneda → persona → saldo (positivo = le deben; negativo = debe). */
  balances: Record<string, Record<string, number>>;
  /** Transferencias mínimas para quedar a mano, con nombres. */
  settlements: Settlement[];
  /** Las mismas, con ids de persona. */
  transfers: Transfer[];
  /** moneda → total gastado (sin contar pagos de liquidación). */
  totals: Record<string, number>;
};

export type SplitMode = "equal" | "exact" | "percent";

const cur = (c?: string | null) => String(c || "MXN").toUpperCase();
export const toCents = (n: number) => Math.round((Number(n) || 0) * 100);
const fromCents = (c: number) => c / 100;

/** Monto válido para un gasto compartido: número > 0 con máximo 2 decimales. null si no. */
export function parseSplitAmount(raw: string): number | null {
  const n = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Partes iguales en centavos; los centavos que sobran van a los primeros (la suma es el total). */
export function splitEqualCents(totalCents: number, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ids.length || totalCents <= 0) return out;
  const base = Math.floor(totalCents / ids.length);
  let rest = totalCents - base * ids.length;
  for (const id of ids) {
    out[id] = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
  }
  return out;
}

export type SharePlan =
  | { ok: true; shares: SplitShare[] }
  | { ok: false; error: string; /** Lo que falta (positivo) o sobra (negativo), en la unidad del modo. */ remaining?: number };

/**
 * Partes de un gasto según el modo:
 *  - equal: partes iguales entre `ids` (al centavo).
 *  - exact: montos de `inputs`; deben sumar exactamente el total.
 *  - percent: porcentajes de `inputs`; deben sumar 100. Los montos se redondean al centavo con el
 *    método del mayor residuo, así la suma es exactamente el total.
 * Quien queda en 0 no lleva parte.
 */
export function buildShares(total: number, mode: SplitMode, ids: string[], inputs: Record<string, number | string | null | undefined> = {}): SharePlan {
  const totalCents = toCents(total);
  if (!(totalCents > 0)) return { ok: false, error: "El monto debe ser mayor a 0" };
  const people = [...new Set(ids)];
  if (!people.length) return { ok: false, error: "Elige al menos una persona" };
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  if (mode === "equal") {
    const c = splitEqualCents(totalCents, people);
    return { ok: true, shares: people.filter((id) => c[id] > 0).map((id) => ({ person_id: id, amount: fromCents(c[id]) })) };
  }

  if (mode === "exact") {
    const cents: Record<string, number> = {};
    for (const id of people) {
      const v = inputs[id] === "" || inputs[id] == null ? 0 : num(inputs[id]);
      if (!Number.isFinite(v) || v < 0) return { ok: false, error: "Los montos no pueden ser negativos" };
      cents[id] = toCents(v);
    }
    const sum = Object.values(cents).reduce((a, b) => a + b, 0);
    if (sum !== totalCents) {
      const diff = totalCents - sum;
      return { ok: false, error: diff > 0 ? "Faltan por repartir" : "Se pasa del total", remaining: fromCents(diff) };
    }
    return { ok: true, shares: people.filter((id) => cents[id] > 0).map((id) => ({ person_id: id, amount: fromCents(cents[id]) })) };
  }

  // percent
  const pct: Record<string, number> = {};
  for (const id of people) {
    const v = inputs[id] === "" || inputs[id] == null ? 0 : num(inputs[id]);
    if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: "Cada porcentaje va de 0 a 100" };
    pct[id] = Math.round(v * 10000) / 10000;
  }
  const sumPct = Object.values(pct).reduce((a, b) => a + b, 0);
  if (Math.abs(sumPct - 100) > 0.0001) {
    const diff = Math.round((100 - sumPct) * 10000) / 10000;
    return { ok: false, error: diff > 0 ? "Faltan por repartir" : "Se pasa del 100 %", remaining: diff };
  }
  const raw = people.map((id) => ({ id, exact: (totalCents * pct[id]) / 100 }));
  const cents: Record<string, number> = Object.fromEntries(raw.map((r) => [r.id, Math.floor(r.exact + 1e-9)]));
  let rest = totalCents - Object.values(cents).reduce((a, b) => a + b, 0);
  const frac = (r: { id: string; exact: number }) => r.exact - cents[r.id];
  const order = [...raw].sort((a, b) => frac(b) - frac(a) || people.indexOf(a.id) - people.indexOf(b.id));
  for (const r of order) {
    if (rest <= 0) break;
    if (pct[r.id] <= 0) continue;
    cents[r.id] += 1;
    rest -= 1;
  }
  return {
    ok: true,
    shares: people.filter((id) => cents[id] > 0).map((id) => ({ person_id: id, amount: fromCents(cents[id]), percent: pct[id] })),
  };
}

/**
 * Transferencias mínimas para que todos queden a mano (saldos en centavos, suma 0).
 * Con hasta 15 personas con saldo se busca el mínimo exacto: el número mínimo de transferencias es
 * (personas con saldo) − (máximo de grupos que se saldan entre sí), y dentro de cada grupo basta con
 * que el que más debe le pague al que más le deben. Con más personas, ese mismo reparto sin agrupar.
 */
export function simplifyDebts(balances: Record<string, number>): { from: string; to: string; cents: number }[] {
  const ids = Object.keys(balances).filter((id) => balances[id] !== 0).sort();
  const out: { from: string; to: string; cents: number }[] = [];
  const settleGroup = (group: string[]) => {
    const debtors = group.filter((id) => balances[id] < 0).map((id) => ({ id, b: -balances[id] })).sort((a, b) => b.b - a.b || a.id.localeCompare(b.id));
    const creditors = group.filter((id) => balances[id] > 0).map((id) => ({ id, b: balances[id] })).sort((a, b) => b.b - a.b || a.id.localeCompare(b.id));
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].b, creditors[j].b);
      if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, cents: amt });
      debtors[i].b -= amt; creditors[j].b -= amt;
      if (debtors[i].b === 0) i++;
      if (creditors[j].b === 0) j++;
    }
  };
  const n = ids.length;
  if (n === 0) return out;
  if (n > 15) { settleGroup(ids); return out; }
  const full = (1 << n) - 1;
  const sum = new Array<number>(full + 1).fill(0);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + balances[ids[31 - Math.clz32(low)]];
  }
  const dp = new Array<number>(full + 1).fill(0);
  const pick = new Array<number>(full + 1).fill(-1);
  for (let m = 1; m <= full; m++) {
    let best = -1, bi = -1;
    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const v = dp[m ^ (1 << i)];
      if (v > best) { best = v; bi = i; }
    }
    dp[m] = best + (sum[m] === 0 ? 1 : 0);
    pick[m] = bi;
  }
  // Reconstrucción: quitando un elemento a la vez, cada vez que el resto suma 0 se cierra un grupo.
  let m = full;
  let group: string[] = [];
  while (m) {
    const i = pick[m];
    group.push(ids[i]);
    m ^= 1 << i;
    if (sum[m] === 0) { settleGroup(group); group = []; }
  }
  if (group.length) settleGroup(group);
  return out;
}

/** Saldos por moneda (gastos con sus partes y pagos de liquidación) y cómo quedar a mano. */
export function computeBalances(people: SplitPerson[], expenses: SplitExpense[], payments: SplitPayment[] = []): SplitResult {
  const out: SplitResult = { balances: {}, settlements: [], transfers: [], totals: {} };
  if (!people.length) return out;
  const ids = people.map((p) => p.id);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  const bal: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  const ensure = (c: string) => (bal[c] ??= Object.fromEntries(ids.map((id) => [id, 0])));
  const add = (c: string, id: string, cents: number) => { const b = ensure(c); b[id] = (b[id] ?? 0) + cents; };

  for (const e of expenses) {
    const total = toCents(e.amount);
    if (!(total > 0)) continue;
    const c = cur(e.currency);
    ensure(c);
    totals[c] = (totals[c] ?? 0) + total;
    add(c, e.payer_id, total);
    const shares = e.shares && e.shares.length ? e.shares : null;
    if (shares) {
      for (const s of shares) add(c, s.person_id, -toCents(s.amount));
    } else {
      const eq = splitEqualCents(total, ids);
      for (const id of ids) add(c, id, -(eq[id] ?? 0));
    }
  }
  for (const p of payments) {
    const amt = toCents(p.amount);
    if (!(amt > 0) || p.from_person === p.to_person) continue;
    const c = cur(p.currency);
    add(c, p.from_person, amt);
    add(c, p.to_person, -amt);
  }

  for (const [c, b] of Object.entries(bal)) {
    out.balances[c] = Object.fromEntries(Object.entries(b).map(([id, v]) => [id, fromCents(v)]));
    for (const t of simplifyDebts(b)) {
      out.transfers.push({ from: t.from, to: t.to, amount: fromCents(t.cents), currency: c });
      out.settlements.push({ from: name(t.from), to: name(t.to), amount: fromCents(t.cents), currency: c });
    }
    if (totals[c]) out.totals[c] = fromCents(totals[c]);
  }
  return out;
}

/** Como antes de las partes: todas las personas, en partes iguales (datos viejos y pruebas D-18). */
export function computeSplit(people: SplitPerson[], expenses: SplitExpense[]): SplitResult {
  return computeBalances(people, expenses.map((e) => ({ ...e, shares: null })));
}

export type MyLine = { kind: "debes" | "te_debe"; other: string; amount: number; currency: string };

/** Lo que me toca a mí: a quién le debo y quién me debe (de las transferencias mínimas). */
export function myLines(result: SplitResult, meId: string | null | undefined): MyLine[] {
  if (!meId) return [];
  const out: MyLine[] = [];
  for (const t of result.transfers) {
    if (t.from === meId) out.push({ kind: "debes", other: t.to, amount: t.amount, currency: t.currency });
    else if (t.to === meId) out.push({ kind: "te_debe", other: t.from, amount: t.amount, currency: t.currency });
  }
  return out;
}

/** true si la persona tiene pagos registrados (la base no deja quitarla). */
export const hasPayments = (personId: string, expenses: SplitExpense[], payments: SplitPayment[] = []) =>
  expenses.some((e) => e.payer_id === personId) || payments.some((p) => p.from_person === personId || p.to_person === personId);

/** true si la persona está en la división de algún gasto que no es en partes iguales. */
export const inCustomSplit = (personId: string, expenses: (SplitExpense & { split_mode?: string | null })[]) =>
  expenses.some((e) => (e.split_mode ?? "equal") !== "equal" && (e.shares ?? []).some((s) => s.person_id === personId));
