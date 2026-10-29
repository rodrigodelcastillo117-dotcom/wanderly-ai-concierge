// Gastos registrados del usuario para Iato (ola 9.5, 29-oct-2026). Lógica pura (Vitest).
//
// Caso real: "¿Cuánto llevo gastado en mi viaje a Valle de Bravo?" → "No tengo un registro de gastos de
// este viaje… como el café de 150 MXN que aparece en tus notas", con 6 gastos registrados (1,115 MXN y
// 50 USD). Iato no leía la tabla expenses. Ahora get_trip_expenses la lee con la sesión del usuario (RLS)
// y este módulo arma el resumen: total POR MONEDA (sin convertir: no hay tasa en este turno), por
// categoría y los últimos movimientos, con su fuente.

export interface ExpenseRow {
  amount?: unknown; currency?: unknown; category?: unknown; description?: unknown; expense_date?: unknown; trip_id?: unknown;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const round2 = (v: number) => Math.round(v * 100) / 100;
const cur = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : "MXN");
const txt = (v: unknown, max = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export interface ExpenseSummary {
  ok: true;
  fuente: string;
  alcance: string;
  numero_de_gastos: number;
  total_por_moneda: { moneda: string; total: number; gastos: number }[];
  por_categoria: { categoria: string; moneda: string; total: number }[];
  ultimos: { fecha?: string; monto: number; moneda: string; categoria?: string; descripcion?: string }[];
  nota: string;
}

export function summarizeExpenses(rows: ExpenseRow[] | null | undefined, opts: { tripLabel?: string | null } = {}): ExpenseSummary {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Number.isFinite(num(r?.amount)) && num(r.amount) > 0);
  const byCur = new Map<string, { total: number; gastos: number }>();
  const byCat = new Map<string, { categoria: string; moneda: string; total: number }>();
  for (const r of list) {
    const m = cur(r.currency);
    const a = num(r.amount);
    const c = byCur.get(m) ?? { total: 0, gastos: 0 };
    c.total += a; c.gastos += 1; byCur.set(m, c);
    const cat = txt(r.category, 40) ?? "Otros";
    const k = `${cat}|${m}`;
    const x = byCat.get(k) ?? { categoria: cat, moneda: m, total: 0 };
    x.total += a; byCat.set(k, x);
  }
  const ultimos = [...list]
    .sort((a, b) => String(b.expense_date ?? "").localeCompare(String(a.expense_date ?? "")))
    .slice(0, 5)
    .map((r) => ({ fecha: txt(r.expense_date, 10), monto: round2(num(r.amount)), moneda: cur(r.currency), categoria: txt(r.category, 40), descripcion: txt(r.description, 60) }));
  return {
    ok: true,
    fuente: "Gastos registrados en IATOS (pantalla Gastos)",
    alcance: opts.tripLabel ? `viaje a ${opts.tripLabel}` : "todos tus gastos registrados",
    numero_de_gastos: list.length,
    total_por_moneda: [...byCur.entries()].map(([moneda, v]) => ({ moneda, total: round2(v.total), gastos: v.gastos })).sort((a, b) => b.gastos - a.gastos),
    por_categoria: [...byCat.values()].map((v) => ({ ...v, total: round2(v.total) })).sort((a, b) => b.total - a.total).slice(0, 5),
    ultimos,
    nota: list.length
      ? "Totales por moneda tal cual se registraron: no los sumes entre monedas ni los conviertas sin una tasa consultada."
      : "No hay gastos registrados en IATOS para este alcance.",
  };
}
