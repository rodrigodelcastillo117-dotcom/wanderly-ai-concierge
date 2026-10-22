// Respaldo de antigüedad de IATOS Privé para cuentas viejas: lee de Stripe las facturas PAGADAS de
// los clientes que ya están en subscriptions y guarda sus periodos en pro_paid_periods
// (source='backfill'). Puro (probado en src/test/priveTenure.test.ts); index.ts conecta Stripe y la base.
//
// Seguridad y costo:
//   * dry_run = true por defecto: solo cuenta lo que haría; no escribe nada.
//   * Idempotente: la llave es el id de la factura; re-correrlo no duplica días.
//   * Por lotes (limit clientes por llamada, next_offset para la siguiente); solo lectura en Stripe.
import { paidPeriodFromInvoice, recordArgs, type RecordPaidPeriodArgs, type StripePaidInvoiceLike } from "../_shared/prive-tenure.ts";

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export type BackfillCustomer = { user_id: string; stripe_customer_id: string };

export interface BackfillDeps {
  listCustomers(offset: number, limit: number): DbResult<BackfillCustomer[]>;
  listPaidInvoices(customerId: string, startingAfter: string | null): Promise<{ data: StripePaidInvoiceLike[]; has_more: boolean }>;
  record(args: RecordPaidPeriodArgs): DbResult<{ recorded?: boolean; reason?: string; inserted?: boolean }>;
}

export type BackfillOptions = { dryRun?: boolean; offset?: number; limit?: number; maxInvoicesPerCustomer?: number };

export type BackfillSummary = {
  dry_run: boolean;
  customers: number;
  invoices_seen: number;
  paid_periods: number;
  recorded: number;
  inserted: number;
  skipped: Record<string, number>;
  errors: number;
  next_offset: number | null;
};

export function parseBackfillBody(body: unknown): BackfillOptions {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const int = (v: unknown, def: number, min: number, max: number) =>
    Number.isInteger(v) ? Math.min(Math.max(v as number, min), max) : def;
  return {
    // Solo un false explícito escribe.
    dryRun: b.dry_run !== false,
    offset: int(b.offset, 0, 0, 1_000_000),
    limit: int(b.limit, 25, 1, 100),
    maxInvoicesPerCustomer: int(b.max_invoices_per_customer, 200, 1, 1000),
  };
}

export async function runBackfill(opts: BackfillOptions, deps: BackfillDeps): Promise<BackfillSummary> {
  const dryRun = opts.dryRun !== false;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 25;
  const maxInv = opts.maxInvoicesPerCustomer ?? 200;
  const s: BackfillSummary = { dry_run: dryRun, customers: 0, invoices_seen: 0, paid_periods: 0, recorded: 0, inserted: 0, skipped: {}, errors: 0, next_offset: null };
  const skip = (k: string) => { s.skipped[k] = (s.skipped[k] ?? 0) + 1; };

  const { data: customers, error } = await deps.listCustomers(offset, limit);
  if (error) throw new Error(`lista de clientes falló: ${error.message}`);
  for (const c of customers ?? []) {
    s.customers++;
    let after: string | null = null;
    let seen = 0;
    try {
      for (;;) {
        const page = await deps.listPaidInvoices(c.stripe_customer_id, after);
        for (const inv of page.data) {
          seen++;
          s.invoices_seen++;
          const p = paidPeriodFromInvoice(inv);
          if ("reason" in p) { skip(p.reason); continue; }
          s.paid_periods++;
          if (dryRun) continue;
          const r = await deps.record(recordArgs(p.period, c.user_id, "backfill"));
          if (r.error) { s.errors++; continue; }
          if (r.data?.recorded) { s.recorded++; if (r.data.inserted) s.inserted++; } else skip(r.data?.reason ?? "not_recorded");
        }
        if (!page.has_more || !page.data.length || seen >= maxInv) break;
        after = page.data[page.data.length - 1].id;
      }
    } catch {
      s.errors++;
    }
  }
  s.next_offset = (customers?.length ?? 0) === limit ? offset + limit : null;
  return s;
}
