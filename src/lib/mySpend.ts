/**
 * "Lo que gasté": mis gastos + mi parte de los gastos compartidos de mis viajes. Una sola fuente para
 * Gastos (lista y Resumen) e Inicio («Tus gastos»), para que las dos pantallas nunca digan cifras
 * distintas (R2: Inicio decía «$112.50 USD · Restaurantes 80%» y Gastos › Resumen «$2,668 MXN ·
 * Restaurantes 84%»: Inicio convertía a dólares y no contaba la parte compartida).
 */
import { categoryBreakdown } from "@/lib/expenseCategories";
import { summarizeSpend, type FxTable } from "@/lib/fx";
import { loadMySharedParts } from "@/lib/tripExpensesApi";

type Client = any;

export type MySpendItem = {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  expense_date: string;
  receipt_url: string | null;
  trip_id?: string | null;
  /** Mi parte de un gasto compartido del viaje (se edita en Gastos del viaje, no en Gastos). */
  shared?: { total: number; payerName: string; paidByMe: boolean };
};

type SharedPartRow = Awaited<ReturnType<typeof loadMySharedParts>>[number];

/** Mi parte de un gasto compartido, con la forma de un gasto propio. */
export function sharedPartToItem(r: SharedPartRow): MySpendItem {
  return {
    id: `share-${r.share_id}`, amount: r.amount, currency: r.currency, category: r.category, description: r.description,
    expense_date: r.expense_date, receipt_url: null, trip_id: r.trip_id,
    shared: { total: r.total, payerName: r.payer_name, paidByMe: r.paid_by_me },
  };
}

/** Mis gastos + mi parte de lo compartido, del más reciente al más viejo. */
export function mergeMySpend<T extends { expense_date: string }>(own: T[], shared: T[]): T[] {
  return [...own, ...shared].sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
}

/** Carga lo mismo que suma Gastos: mis gastos y mi parte de lo compartido. */
export async function loadMySpend(client: Client, userId: string): Promise<{ own: MySpendItem[]; shared: MySpendItem[] }> {
  const [{ data }, parts] = await Promise.all([
    client.from("expenses").select("*").eq("user_id", userId).order("expense_date", { ascending: false }),
    loadMySharedParts(client),
  ]);
  return { own: ((data as MySpendItem[]) ?? []), shared: parts.map(sharedPartToItem) };
}

export type HomeSpendCard = {
  /** Este mes, en pesos (lo mismo que «Este mes» de Gastos › Resumen). */
  thisMonth: number;
  /** % contra el mes anterior (null sin gastos el mes pasado). */
  deltaPct: number | null;
  /** Las mismas categorías y porcentajes que «Por categoría» de Gastos › Resumen (máx. 5). */
  cats: { label: string; pct: number; color: string }[];
  unconvertedCurrencies: string[];
  hasAny: boolean;
};

/** La tarjeta «Tus gastos» de Inicio: el mismo cálculo (summarizeSpend en MXN) que Gastos › Resumen. */
export function homeSpendCard(items: { amount: number; currency: string; category: string; expense_date: string }[], fx: FxTable, now: Date = new Date()): HomeSpendCard {
  const s = summarizeSpend(items, "MXN", fx, now);
  const cats = categoryBreakdown(s.byCat).slice(0, 5).map((c) => ({ label: c.name, pct: Math.round(c.pct), color: c.color }));
  return {
    thisMonth: s.thisMonth,
    deltaPct: s.lastMonth > 0 ? Math.round(((s.thisMonth - s.lastMonth) / s.lastMonth) * 100) : null,
    cats,
    unconvertedCurrencies: s.unconvertedCurrencies,
    hasAny: items.length > 0,
  };
}
