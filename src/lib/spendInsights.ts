/**
 * "Resumen" de Gastos: en qué se te va el dinero, útil aunque haya pocos datos. Todo convertido a
 * pesos con el tipo de cambio indicado; lo que no tiene tasa se cuenta aparte (nunca 1:1).
 *  - total por viaje (y lo que no está ligado a un viaje);
 *  - la categoría donde más gastas;
 *  - con un viaje en curso: gasto por día contra el presupuesto por día del viaje.
 */
import { convert, type FxTable } from "@/lib/fx";
import { canonicalCategory } from "@/lib/expenseCategories";
import { parseLocalDate } from "@/lib/localDate";

export type InsightExpense = { amount: number; currency: string; category: string; expense_date: string; trip_id?: string | null };
export type InsightTrip = {
  id: string; destino: string; fecha_salida?: string | null; fecha_regreso?: string | null;
  total_estimado?: number | null; moneda?: string | null;
};

export type TripTotal = { tripId: string | null; label: string; total: number; count: number; unconverted: number };

export type ActiveTripInsight = {
  tripId: string;
  label: string;
  total: number;
  /** Días del viaje (salida a regreso, ambos incluidos); null sin fechas. */
  diasViaje: number | null;
  /** Días transcurridos del viaje (0 si aún no sale). */
  diasTranscurridos: number;
  /** Gasto promedio por día transcurrido; null si aún no sale. */
  promedioDiario: number | null;
  presupuesto: number | null;
  presupuestoDiario: number | null;
  /** Gastado / presupuesto (0..n); null sin presupuesto. */
  usoPresupuesto: number | null;
};

export type SpendInsights = {
  total: number;
  count: number;
  unconvertedCount: number;
  perTrip: TripTotal[];
  topCategory: { name: string; total: number; pct: number } | null;
  active: ActiveTripInsight | null;
};

const DAY = 86_400_000;

export function spendInsights(
  items: InsightExpense[],
  trips: InsightTrip[],
  fx: FxTable,
  opts: { activeTripId?: string | null; now?: Date } = {},
): SpendInsights {
  const now = opts.now ?? new Date();
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const per = new Map<string | null, TripTotal>();
  const byCat: Record<string, number> = {};
  let total = 0;
  let count = 0;
  let unconvertedCount = 0;

  for (const x of items) {
    const tid = x.trip_id && tripById.has(x.trip_id) ? x.trip_id : null;
    const row = per.get(tid) ?? { tripId: tid, label: tid ? tripById.get(tid)!.destino : "Sin viaje", total: 0, count: 0, unconverted: 0 };
    row.count += 1;
    const v = convert(Number(x.amount) || 0, x.currency || "MXN", "MXN", fx);
    if (v == null) {
      row.unconverted += 1;
      unconvertedCount += 1;
    } else {
      row.total += v;
      total += v;
      const cat = canonicalCategory(x.category);
      byCat[cat] = (byCat[cat] ?? 0) + v;
    }
    count += 1;
    per.set(tid, row);
  }

  // Viajes primero (de mayor a menor gasto); "Sin viaje" al final.
  const perTrip = [...per.values()].sort((a, b) => (a.tripId === null ? 1 : 0) - (b.tripId === null ? 1 : 0) || b.total - a.total);

  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const topCategory = top && total > 0 ? { name: top[0], total: top[1], pct: (top[1] / total) * 100 } : null;

  let active: ActiveTripInsight | null = null;
  const at = opts.activeTripId ? tripById.get(opts.activeTripId) : undefined;
  if (at) {
    const spent = per.get(at.id)?.total ?? 0;
    const start = parseLocalDate(at.fecha_salida);
    const end = parseLocalDate(at.fecha_regreso);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const diasViaje = start && end && end >= start ? Math.round((end.getTime() - start.getTime()) / DAY) + 1 : null;
    let diasTranscurridos = 0;
    if (start && today >= start) {
      diasTranscurridos = Math.round((today.getTime() - start.getTime()) / DAY) + 1;
      if (diasViaje) diasTranscurridos = Math.min(diasTranscurridos, diasViaje);
    }
    const moneda = String(at.moneda || "MXN").toUpperCase();
    const presupuestoOrig = Number(at.total_estimado) || 0;
    const presupuesto = presupuestoOrig > 0 ? convert(presupuestoOrig, moneda, "MXN", fx) : null;
    active = {
      tripId: at.id,
      label: at.destino,
      total: spent,
      diasViaje,
      diasTranscurridos,
      promedioDiario: diasTranscurridos > 0 ? spent / diasTranscurridos : null,
      presupuesto,
      presupuestoDiario: presupuesto != null && diasViaje ? presupuesto / diasViaje : null,
      usoPresupuesto: presupuesto ? spent / presupuesto : null,
    };
  }

  return { total, count, unconvertedCount, perTrip, topCategory, active };
}
