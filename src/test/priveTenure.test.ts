import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStripeEvent, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";
import {
  invoiceNeedsRetrieve,
  missingRpcAsSkip,
  paidPeriodFromInvoice,
  recordArgs,
  tenureEventFor,
} from "../../supabase/functions/_shared/prive-tenure";
import { parseBackfillBody, runBackfill, type BackfillDeps } from "../../supabase/functions/prive-tenure-backfill/backfill";
import * as fx from "./fixtures/stripeEvents";

// Antigüedad de IATOS Privé desde Stripe: qué factura cuenta, con qué periodo, y cómo la cambian
// reembolsos y disputas. La SQL (unión de periodos, estados) se prueba en supabase/tests/prive.
const DAY = 86400;
const line = (o: Record<string, unknown> = {}) => ({
  id: "il_1", object: "line_item", type: "subscription", amount: 9900, currency: "mxn", proration: false,
  subscription: "sub_1QTest", period: { start: fx.T0, end: fx.T0 + 30 * DAY }, ...o,
});
const paidInvoice = (o: Record<string, unknown> = {}) => fx.invoice({ lines: { object: "list", data: [line()], has_more: false }, ...o });

describe("periodo pagado de una factura", () => {
  it("factura pagada: periodo del renglón de suscripción, monto y moneda", () => {
    const r = paidPeriodFromInvoice(paidInvoice());
    expect(r).toEqual({
      ok: true,
      period: { invoiceId: "in_1QLatest", subscriptionId: "sub_1QTest", customerId: "cus_RTest",
        start: new Date(fx.T0 * 1000).toISOString(), end: new Date((fx.T0 + 30 * DAY) * 1000).toISOString(), amountPaid: 9900, currency: "MXN" },
    });
  });

  it("prueba gratis o cupón del 100 %: monto 0 → nunca cuenta", () => {
    expect(paidPeriodFromInvoice(paidInvoice({ amount_paid: 0, billing_reason: "subscription_create" }))).toEqual({ ok: false, reason: "zero_amount" });
  });

  it("factura no pagada: no cuenta", () => {
    expect(paidPeriodFromInvoice(paidInvoice({ status: "open" }))).toEqual({ ok: false, reason: "not_paid" });
  });

  it("cambio de plan con prorrateo: ignora el crédito negativo y une los positivos", () => {
    const r = paidPeriodFromInvoice(paidInvoice({
      lines: { data: [
        line({ amount: -4000, proration: true, period: { start: fx.T0 - 10 * DAY, end: fx.T0 + 20 * DAY } }),
        line({ amount: 6000, proration: true, period: { start: fx.T0 + 10 * DAY, end: fx.T0 + 30 * DAY } }),
        line({ amount: 9900, period: { start: fx.T0 + 30 * DAY, end: fx.T0 + 60 * DAY } }),
      ] },
    }));
    expect(r.ok && r.period.start).toBe(new Date((fx.T0 + 10 * DAY) * 1000).toISOString());
    expect(r.ok && r.period.end).toBe(new Date((fx.T0 + 60 * DAY) * 1000).toISOString());
  });

  it("formato nuevo de Stripe (basil): la suscripción viene en parent", () => {
    const r = paidPeriodFromInvoice(paidInvoice({
      subscription: undefined,
      parent: { subscription_details: { subscription: "sub_basil" } },
      lines: { data: [line({ type: undefined, subscription: undefined, parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_basil" } } })] },
    }));
    expect(r.ok && r.period.subscriptionId).toBe("sub_basil");
  });

  it("sin renglones de suscripción con periodo: no se inventa uno", () => {
    expect(paidPeriodFromInvoice(paidInvoice({ lines: { data: [line({ type: "invoiceitem", subscription: null })] } })))
      .toEqual({ ok: false, reason: "no_period" });
    expect(paidPeriodFromInvoice(fx.invoice())).toEqual({ ok: false, reason: "no_period" });
  });

  it("payload incompleto → leer la factura completa", () => {
    expect(invoiceNeedsRetrieve(fx.invoice())).toBe(true);
    expect(invoiceNeedsRetrieve(paidInvoice())).toBe(false);
    expect(invoiceNeedsRetrieve(paidInvoice({ lines: { data: [line()], has_more: true } }))).toBe(true);
  });

  it("argumentos de prive_record_paid_period", () => {
    const r = paidPeriodFromInvoice(paidInvoice());
    if (!r.ok) throw new Error("debía tener periodo");
    expect(recordArgs(r.period, "u-1", "webhook")).toMatchObject({ _user: "u-1", _invoice_id: "in_1QLatest", _amount_paid: 9900, _source: "webhook" });
  });

  it("evento de antigüedad para cada decisión de reembolso o disputa", () => {
    expect(tenureEventFor("charge.refunded", { fullRefund: true })).toBe("refund_full");
    expect(tenureEventFor("charge.refunded", { fullRefund: false })).toBe("refund_partial");
    expect(tenureEventFor("charge.dispute.created", {})).toBe("dispute_opened");
    expect(tenureEventFor("charge.dispute.closed", { disputeStatus: "lost" })).toBe("dispute_lost");
    expect(tenureEventFor("charge.dispute.closed", { disputeStatus: "won" })).toBe("dispute_won");
    expect(tenureEventFor("charge.dispute.closed", { disputeStatus: "warning_closed" })).toBe("dispute_won");
    expect(tenureEventFor("charge.dispute.closed", { disputeStatus: "under_review" })).toBeNull();
    expect(tenureEventFor("invoice.paid", {})).toBeNull();
  });

  it("RPC aún no publicada: se omite sin que Stripe reintente para siempre", () => {
    const warn = vi.fn();
    expect(missingRpcAsSkip({ data: null, error: { code: "PGRST202", message: "Could not find the function public.prive_record_paid_period" } }, "prive_record_paid_period", warn))
      .toEqual({ data: { recorded: false, applied: false, reason: "migration_pending" }, error: null });
    expect(warn).toHaveBeenCalledOnce();
    const other = { data: null, error: { message: "connection refused" } };
    expect(missingRpcAsSkip(other, "prive_record_paid_period")).toBe(other);
  });
});

// ---------------------------------------------------------------- webhook
let invoices: Map<string, unknown>;
let charges: Map<string, unknown>;
let subs: Map<string, unknown>;
let recorded: unknown[];
let marked: unknown[];
let deleted: Set<string>;
let events: Map<string, unknown>;

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    retrieveSubscription: async (id) => ({ ...(subs.get(id) as object) }) as never,
    retrieveInvoice: async (id) => ({ ...(invoices.get(id) as object) }) as never,
    retrieveCharge: async (id) => ({ ...(charges.get(id) as object) }) as never,
    applySubscription: async () => ({ data: { applied: true, reason: "applied", user_id: "u-pago" }, error: null }),
    recordPaidPeriod: async (a) => { recorded.push(a); return { data: { recorded: true, inserted: true }, error: null }; },
    markPaidPeriod: async (a) => { marked.push(a); return { data: { applied: true, after: a._event === "refund_full" ? "refunded" : "x" }, error: null }; },
    cancelSubscriptionNow: async () => {},
    revokePaidAccess: async () => ({ data: { applied: true, reason: "revoked", user_id: "u-pago" }, error: null }),
    accessSnapshot: async () => ({ data: null, error: null }),
    findPaymentEvent: async (id) => ({ data: (events.get(id) as { action?: string }) ?? null, error: null }),
    logPaymentEvent: async (row) => { events.set(row.event_id, row); return { error: null }; },
    isDeletedCustomer: async (c) => deleted.has(c),
    alertAdmins: async () => "campana",
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  invoices = new Map([["in_1QLatest", paidInvoice()]]);
  charges = new Map([["ch_3QTest", fx.charge()]]);
  subs = new Map([["sub_1QTest", fx.subscription()]]);
  recorded = []; marked = []; deleted = new Set(); events = new Map();
});

describe("stripe-webhook guarda la antigüedad de Privé", () => {
  it("invoice.paid con monto: registra el periodo pagado (con la cuenta de la metadata)", async () => {
    const ev = { ...fx.invoicePaid(), data: { object: paidInvoice() } };
    const out = await handleStripeEvent(ev, deps());
    expect(out).toEqual({ status: 200, body: { received: true, applied: true, reason: "applied", tenure: "recorded" } });
    expect(recorded).toEqual([expect.objectContaining({ _user: "u-pago", _invoice_id: "in_1QLatest", _source: "webhook", _amount_paid: 9900 })]);
  });

  it("invoice.paid de $0 (prueba): escribe la suscripción pero no la antigüedad", async () => {
    const inv = paidInvoice({ amount_paid: 0 });
    const out = await handleStripeEvent({ ...fx.invoicePaid(), data: { object: inv } }, deps());
    expect(out.body.tenure).toBe("zero_amount");
    expect(recorded).toEqual([]);
  });

  it("payload sin renglones: lee la factura de Stripe", async () => {
    const out = await handleStripeEvent(fx.invoicePaid(), deps());
    expect(out.body.tenure).toBe("recorded");
  });

  it("invoice.payment_failed nunca registra antigüedad", async () => {
    const ev = { ...fx.invoicePaid("evt_fail"), type: "invoice.payment_failed", data: { object: paidInvoice() } };
    const out = await handleStripeEvent(ev, deps());
    expect(out.body.tenure).toBeUndefined();
    expect(recorded).toEqual([]);
  });

  it("si la base falla al guardar el periodo → 500 (Stripe reintenta)", async () => {
    const out = await handleStripeEvent({ ...fx.invoicePaid(), data: { object: paidInvoice() } },
      deps({ recordPaidPeriod: async () => ({ data: null, error: { message: "timeout" } }) }));
    expect(out.status).toBe(500);
  });

  it("sin la dependencia (versión anterior): el comportamiento no cambia", async () => {
    const d = deps();
    delete d.recordPaidPeriod;
    const out = await handleStripeEvent({ ...fx.invoicePaid(), data: { object: paidInvoice() } }, d);
    expect(out).toEqual({ status: 200, body: { received: true, applied: true, reason: "applied" } });
  });

  it("reembolso total: el periodo de esa factura deja de contar", async () => {
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(marked).toEqual([{ _invoice_id: "in_1QLatest", _event: "refund_full", _amount_refunded: 9900 }]);
    expect(out.body).toMatchObject({ action: "reembolso_total_revocado", tenure: "refund_full:refunded" });
  });

  it("reembolso total de una factura ANTERIOR: no quita PRO hoy, pero sí sus días", async () => {
    subs.set("sub_1QTest", fx.subscription({ latest_invoice: "in_NUEVA" }));
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(out.body.action).toBe("reembolso_total_factura_anterior_revision");
    expect(marked).toEqual([expect.objectContaining({ _event: "refund_full" })]);
  });

  it("reembolso parcial: el periodo sigue contando (partially_refunded)", async () => {
    charges.set("ch_3QTest", fx.charge({ amount_refunded: 3000, refunded: false }));
    await handleStripeEvent(fx.chargeRefunded({ amount_refunded: 3000, refunded: false }), deps());
    expect(marked).toEqual([{ _invoice_id: "in_1QLatest", _event: "refund_partial", _amount_refunded: 3000 }]);
  });

  it("disputa abierta → excluida; ganada → restaurada; perdida → fuera", async () => {
    await handleStripeEvent(fx.disputeCreated(), deps());
    await handleStripeEvent(fx.disputeClosed("won"), deps());
    await handleStripeEvent(fx.disputeClosed("lost", "evt_dispute_lost_2"), deps());
    expect(marked.map((m) => (m as { _event: string })._event)).toEqual(["dispute_opened", "dispute_won", "dispute_lost"]);
  });

  it("evento repetido (mismo id): no vuelve a tocar la antigüedad", async () => {
    await handleStripeEvent(fx.chargeRefunded(), deps());
    await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(marked).toHaveLength(1);
  });

  it("cuenta eliminada: no se toca nada", async () => {
    deleted.add("cus_RTest");
    await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(marked).toEqual([]);
  });

  it("si la base falla al marcar el periodo → 500 y no se registra el evento (se reintenta completo)", async () => {
    const out = await handleStripeEvent(fx.chargeRefunded(), deps({ markPaidPeriod: async () => ({ data: null, error: { message: "x" } }) }));
    expect(out.status).toBe(500);
    expect(events.size).toBe(0);
  });
});

// ---------------------------------------------------------------- respaldo
describe("prive-tenure-backfill", () => {
  const mkDeps = (pages: Record<string, Array<{ data: unknown[]; has_more: boolean }>>) => {
    const calls = { record: [] as unknown[], list: [] as Array<[string, string | null]> };
    const d: BackfillDeps = {
      listCustomers: async (offset, limit) => ({ data: [{ user_id: "u-vieja", stripe_customer_id: "cus_V" }].slice(offset, offset + limit), error: null }),
      listPaidInvoices: async (c, after) => {
        calls.list.push([c, after]);
        const ps = pages[c] ?? [];
        const i = after ? ps.findIndex((p) => (p.data as Array<{ id: string }>).some((x) => x.id === after)) + 1 : 0;
        return (ps[i] ?? { data: [], has_more: false }) as never;
      },
      record: async (a) => { calls.record.push(a); return { data: { recorded: true, inserted: calls.record.length <= 2 }, error: null }; },
    };
    return { d, calls };
  };
  const inv = (id: string, start: number, amount = 9900) => paidInvoice({ id, amount_paid: amount, lines: { data: [line({ period: { start, end: start + 31 * DAY } })] } });

  it("por defecto es simulación: cuenta pero no escribe", async () => {
    expect(parseBackfillBody({}).dryRun).toBe(true);
    expect(parseBackfillBody({ dry_run: "false" }).dryRun).toBe(true);
    expect(parseBackfillBody({ dry_run: false }).dryRun).toBe(false);
    const { d, calls } = mkDeps({ cus_V: [{ data: [inv("in_a", fx.T0), inv("in_b", fx.T0 + 31 * DAY)], has_more: false }] });
    const s = await runBackfill(parseBackfillBody({}), d);
    expect(s).toMatchObject({ dry_run: true, customers: 1, invoices_seen: 2, paid_periods: 2, recorded: 0 });
    expect(calls.record).toEqual([]);
  });

  it("con dry_run=false escribe con source=backfill, pagina y omite facturas de $0", async () => {
    const { d, calls } = mkDeps({ cus_V: [
      { data: [inv("in_a", fx.T0), inv("in_trial", fx.T0 - 30 * DAY, 0)], has_more: true },
      { data: [inv("in_b", fx.T0 + 31 * DAY)], has_more: false },
    ] });
    const s = await runBackfill({ dryRun: false }, d);
    expect(s).toMatchObject({ dry_run: false, invoices_seen: 3, paid_periods: 2, recorded: 2, skipped: { zero_amount: 1 } });
    expect(calls.list).toEqual([["cus_V", null], ["cus_V", "in_trial"]]);
    expect(calls.record.every((a) => (a as { _source: string; _user: string })._source === "backfill" && (a as { _user: string })._user === "u-vieja")).toBe(true);
  });

  it("un error de Stripe en un cliente no detiene el lote", async () => {
    const { d } = mkDeps({});
    d.listPaidInvoices = async () => { throw new Error("stripe_500"); };
    const s = await runBackfill({ dryRun: false }, d);
    expect(s.errors).toBe(1);
    expect(s.next_offset).toBeNull();
  });
});
