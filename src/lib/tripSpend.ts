/**
 * Pestaña "Gastos" del viaje: lo que YO llevo gastado en este viaje, en pesos.
 *
 * Cuenta dos cosas, y lo dice:
 *  - mis gastos personales del viaje (public.expenses, solo los veo yo);
 *  - MI PARTE de cada gasto compartido (no lo que pagué por otros: eso es un préstamo y aparece en
 *    "Gastos compartidos" como "te deben").
 * Todo se convierte a MXN con el tipo de cambio de la app (src/lib/fx.ts, con fuente y fecha); lo que
 * no tiene tasa se cuenta aparte, nunca 1:1. El presupuesto del viaje (si existe) es del viaje entero:
 * se compara contra la parte por persona.
 */
import { convert, type FxTable } from "@/lib/fx";
import { canonicalCategory, categoryBreakdown } from "@/lib/expenseCategories";

export type TripSpendItem = {
  id: string;
  kind: "personal" | "compartido";
  amount: number;
  currency: string;
  category: string | null;
  date: string | null;
  city?: string | null;
  description?: string | null;
  /** Solo compartido: total del gasto y quién pagó. */
  total?: number | null;
  payerName?: string | null;
  paidByMe?: boolean;
};

export type TripBudget = { total: number; travelers: number; perPerson: number; source: "presupuesto" | "cotizacion" };

export type TripSpendSummary = {
  /** Total convertido a MXN (lo que sí tiene tasa). */
  totalMxn: number;
  personalMxn: number;
  sharedMxn: number;
  /** Moneda → monto sin tasa disponible (no se suma). */
  unconverted: Record<string, number>;
  /** Moneda → subtotal tal cual (sin convertir). */
  byCurrency: Record<string, number>;
  byCategory: { name: string; value: number; pct: number; color: string }[];
  /** Días con gasto, del más reciente al más viejo. */
  byDay: { date: string; mxn: number; count: number }[];
  budget: (TripBudget & { used: number; remaining: number }) | null;
  count: number;
};

type BudgetTrip = { presupuesto_objetivo?: number | null; total_estimado?: number | null; moneda?: string | null; num_viajeros?: number | null };

/** Presupuesto del viaje en MXN: el que puso la persona y, si no hay, la cotización del viaje. */
export function tripBudget(trip: BudgetTrip | null | undefined, fx: FxTable): TripBudget | null {
  if (!trip) return null;
  const travelers = Math.max(1, Math.round(Number(trip.num_viajeros) || 1));
  const objetivo = Number(trip.presupuesto_objetivo) || 0;
  if (objetivo > 0) return { total: objetivo, travelers, perPerson: objetivo / travelers, source: "presupuesto" };
  const est = Number(trip.total_estimado) || 0;
  if (est > 0) {
    const mxn = convert(est, String(trip.moneda || "MXN"), "MXN", fx);
    if (mxn != null && mxn > 0) return { total: mxn, travelers, perPerson: mxn / travelers, source: "cotizacion" };
  }
  return null;
}

export function tripSpendSummary(items: TripSpendItem[], fx: FxTable, trip?: BudgetTrip | null): TripSpendSummary {
  const out: TripSpendSummary = {
    totalMxn: 0, personalMxn: 0, sharedMxn: 0, unconverted: {}, byCurrency: {}, byCategory: [], byDay: [], budget: null, count: 0,
  };
  const byCat: Record<string, number> = {};
  const days = new Map<string, { mxn: number; count: number }>();
  for (const it of items) {
    const amount = Number(it.amount) || 0;
    if (!(amount > 0)) continue;
    out.count += 1;
    const c = String(it.currency || "MXN").toUpperCase();
    out.byCurrency[c] = Math.round(((out.byCurrency[c] ?? 0) + amount) * 100) / 100;
    const v = convert(amount, c, "MXN", fx);
    if (v == null) {
      out.unconverted[c] = Math.round(((out.unconverted[c] ?? 0) + amount) * 100) / 100;
      continue;
    }
    out.totalMxn += v;
    if (it.kind === "personal") out.personalMxn += v; else out.sharedMxn += v;
    const cat = canonicalCategory(it.category);
    byCat[cat] = (byCat[cat] ?? 0) + v;
    const d = it.date ? String(it.date).slice(0, 10) : "sin-fecha";
    const row = days.get(d) ?? { mxn: 0, count: 0 };
    row.mxn += v; row.count += 1;
    days.set(d, row);
  }
  out.byCategory = categoryBreakdown(byCat);
  out.byDay = [...days.entries()]
    .map(([date, r]) => ({ date, ...r }))
    .sort((a, b) => (a.date === "sin-fecha" ? 1 : b.date === "sin-fecha" ? -1 : b.date.localeCompare(a.date)));
  const b = tripBudget(trip, fx);
  if (b) out.budget = { ...b, used: b.perPerson > 0 ? out.totalMxn / b.perPerson : 0, remaining: b.perPerson - out.totalMxn };
  return out;
}
