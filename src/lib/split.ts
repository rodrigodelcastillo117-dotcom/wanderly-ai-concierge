/**
 * Gastos compartidos (TripSplit, D-18). Mismas reglas que src/lib/fx.ts: nunca se suman monedas
 * distintas como si fueran una. Los saldos y "cómo saldar" se calculan POR MONEDA (quien pagó
 * €50 recibe euros, no pesos convertidos 1:1). El total convertido a MXN es solo informativo y
 * lleva fuente y fecha del tipo de cambio.
 *
 * Todo se calcula en centavos para que la suma de saldos sea exactamente 0.
 */

export type SplitPerson = { id: string; name: string };
export type SplitExpense = { id?: string; payer_id: string; amount: number; currency?: string | null };

export type Settlement = { from: string; to: string; amount: number; currency: string };

export type SplitResult = {
  /** moneda → persona → saldo (positivo = le deben; negativo = debe). */
  balances: Record<string, Record<string, number>>;
  settlements: Settlement[];
  /** moneda → total gastado. */
  totals: Record<string, number>;
};

const cur = (c?: string | null) => (String(c || "MXN").toUpperCase());

/** Monto válido para un gasto compartido: número > 0 con máximo 2 decimales. null si no. */
export function parseSplitAmount(raw: string): number | null {
  const n = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function computeSplit(people: SplitPerson[], expenses: SplitExpense[]): SplitResult {
  const out: SplitResult = { balances: {}, settlements: [], totals: {} };
  if (!people.length) return out;
  const ids = people.map((p) => p.id);
  const byCur = new Map<string, SplitExpense[]>();
  for (const e of expenses) {
    if (!(Number(e.amount) > 0)) continue;
    const c = cur(e.currency);
    byCur.set(c, [...(byCur.get(c) ?? []), e]);
  }
  for (const [c, list] of byCur) {
    const paid: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    let total = 0;
    for (const e of list) {
      const cents = Math.round(Number(e.amount) * 100);
      total += cents;
      if (e.payer_id in paid) paid[e.payer_id] += cents;
    }
    // Reparto en partes iguales; los centavos que sobran se asignan a los primeros, así la suma
    // de las partes es exactamente el total.
    const base = Math.floor(total / ids.length);
    let rest = total - base * ids.length;
    const bal: Record<string, number> = {};
    for (const id of ids) {
      const share = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      bal[id] = paid[id] - share;
    }
    out.totals[c] = total / 100;
    out.balances[c] = Object.fromEntries(ids.map((id) => [id, bal[id] / 100]));

    const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
    const debtors = ids.filter((id) => bal[id] < 0).map((id) => ({ id, b: -bal[id] })).sort((a, b) => b.b - a.b);
    const creditors = ids.filter((id) => bal[id] > 0).map((id) => ({ id, b: bal[id] })).sort((a, b) => b.b - a.b);
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].b, creditors[j].b);
      if (amt > 0) out.settlements.push({ from: name(debtors[i].id), to: name(creditors[j].id), amount: amt / 100, currency: c });
      debtors[i].b -= amt; creditors[j].b -= amt;
      if (debtors[i].b === 0) i++;
      if (creditors[j].b === 0) j++;
    }
  }
  return out;
}

/** true si la persona tiene pagos registrados (la base no deja quitarla). */
export const hasPayments = (personId: string, expenses: SplitExpense[]) => expenses.some((e) => e.payer_id === personId);
