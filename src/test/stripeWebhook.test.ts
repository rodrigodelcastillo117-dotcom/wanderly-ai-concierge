import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStripeEvent, subscriptionArgs, invoiceSubscriptionId, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";

const CREATED = 1_790_000_000; // segundos
const sub = (o: Record<string, unknown> = {}) => ({
  id: "sub_A", status: "active", customer: "cus_1", trial_end: null, cancel_at_period_end: false, currency: "mxn",
  metadata: { supabase_user_id: "user-1" },
  items: { data: [{ current_period_end: CREATED + 30 * 86400, price: { id: "price_pro" } }] },
  ...o,
});
const ev = (type: string, object: unknown) => ({ id: "evt_1", type, created: CREATED, data: { object } });

let deps: WebhookDeps & { [k: string]: any };
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deps = {
    retrieveSubscription: vi.fn(async (id: string) => sub({ id })),
    retrieveInvoice: vi.fn(async () => ({ id: "in_1", subscription: null })),
    applySubscription: vi.fn(async () => ({ data: { applied: true, reason: "applied" }, error: null })),
  };
});

describe("stripe-webhook (A-06): errores de base → 500 para que Stripe reintente", () => {
  it("si apply_stripe_subscription devuelve error, responde 500 y lo registra", async () => {
    deps.applySubscription = vi.fn(async () => ({ data: null, error: { message: "violates foreign key" } }));
    const out = await handleStripeEvent(ev("customer.subscription.updated", sub()), deps);
    expect(out.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });

  it("si Stripe no responde al consultar la suscripción, 500 (reintento)", async () => {
    deps.retrieveSubscription = vi.fn(async () => { throw new Error("timeout"); });
    expect((await handleStripeEvent(ev("invoice.paid", { id: "in_1", subscription: "sub_A" }), deps)).status).toBe(500);
  });

  it("un evento que la base decide no aplicar (viejo, comped, otra suscripción viva) es 200", async () => {
    deps.applySubscription = vi.fn(async () => ({ data: { applied: false, reason: "stale_event" }, error: null }));
    const out = await handleStripeEvent(ev("customer.subscription.updated", sub()), deps);
    expect(out).toEqual({ status: 200, body: { received: true, applied: false, reason: "stale_event" } });
  });
});

describe("stripe-webhook (A-07): estado real de Stripe, fecha del evento y invoice.paid", () => {
  it("subscription.updated usa el estado ACTUAL de Stripe, no el del payload viejo", async () => {
    deps.retrieveSubscription = vi.fn(async () => sub({ status: "canceled" }));
    await handleStripeEvent(ev("customer.subscription.updated", sub({ status: "active" })), deps);
    expect(deps.applySubscription).toHaveBeenCalledWith(expect.objectContaining({
      _subscription_id: "sub_A", _status: "canceled", _event_created: new Date(CREATED * 1000).toISOString(),
    }));
  });

  it("payment_failed ya no pone past_due a ciegas: escribe lo que diga Stripe", async () => {
    await handleStripeEvent(ev("invoice.payment_failed", { id: "in_1", customer: "cus_1", subscription: "sub_A" }), deps);
    expect(deps.retrieveSubscription).toHaveBeenCalledWith("sub_A");
    expect(deps.applySubscription).toHaveBeenCalledWith(expect.objectContaining({ _status: "active" }));
  });

  it("invoice.paid (formato nuevo con parent) recupera a quien estaba en past_due", async () => {
    await handleStripeEvent(ev("invoice.paid", { id: "in_1", parent: { subscription_details: { subscription: "sub_A" } } }), deps);
    expect(deps.applySubscription).toHaveBeenCalledWith(expect.objectContaining({ _subscription_id: "sub_A", _status: "active" }));
  });

  it("si la factura no trae la suscripción, la consulta; si no tiene, se ignora", async () => {
    deps.retrieveInvoice = vi.fn(async () => ({ id: "in_1", subscription: "sub_A" }));
    await handleStripeEvent(ev("invoice.paid", { id: "in_1" }), deps);
    expect(deps.retrieveInvoice).toHaveBeenCalledWith("in_1");
    expect(deps.applySubscription).toHaveBeenCalledTimes(1);

    deps.retrieveInvoice = vi.fn(async () => ({ id: "in_2" }));
    const out = await handleStripeEvent(ev("invoice.paid", { id: "in_2" }), deps);
    expect(out.body).toMatchObject({ ignored: "factura_sin_suscripcion" });
    expect(deps.applySubscription).toHaveBeenCalledTimes(1);
  });

  it("subscription.deleted marca canceled con el id de ESA suscripción (la base decide si aplica)", async () => {
    await handleStripeEvent(ev("customer.subscription.deleted", sub({ id: "sub_OLD", status: "active" })), deps);
    expect(deps.retrieveSubscription).not.toHaveBeenCalled();
    expect(deps.applySubscription).toHaveBeenCalledWith(expect.objectContaining({ _subscription_id: "sub_OLD", _status: "canceled" }));
  });

  it("checkout.session.completed usa client_reference_id si la suscripción no trae metadata", async () => {
    deps.retrieveSubscription = vi.fn(async () => sub({ metadata: {} }));
    await handleStripeEvent(ev("checkout.session.completed", { client_reference_id: "user-9", subscription: "sub_A" }), deps);
    expect(deps.applySubscription).toHaveBeenCalledWith(expect.objectContaining({ _user_id: "user-9" }));
  });

  it("eventos no manejados se aceptan sin tocar la base", async () => {
    const out = await handleStripeEvent(ev("customer.created", {}), deps);
    expect(out.status).toBe(200);
    expect(deps.applySubscription).not.toHaveBeenCalled();
  });
});

describe("mapeo de la suscripción", () => {
  it("toma el periodo del item (API 2025+) y normaliza moneda", () => {
    const a = subscriptionArgs(sub({ metadata: null }) as any, CREATED, "fallback");
    expect(a).toMatchObject({
      _user_id: "fallback", _customer_id: "cus_1", _currency: "MXN", _price_id: "price_pro",
      _current_period_end: new Date((CREATED + 30 * 86400) * 1000).toISOString(),
    });
  });
  it("encuentra la suscripción de una factura en los tres formatos", () => {
    expect(invoiceSubscriptionId({ id: "i", subscription: "s1" })).toBe("s1");
    expect(invoiceSubscriptionId({ id: "i", parent: { subscription_details: { subscription: "s2" } } })).toBe("s2");
    expect(invoiceSubscriptionId({ id: "i", lines: { data: [{ parent: { subscription_item_details: { subscription: "s3" } } }] } })).toBe("s3");
    expect(invoiceSubscriptionId({ id: "i" })).toBeNull();
  });
});

describe("stripe-webhook (A-14): reembolsos y disputas", () => {
  const refundDeps = (subOverrides: Record<string, unknown> = {}) => {
    const d = {
      ...deps,
      retrieveInvoice: vi.fn(async () => ({ id: "in_last", subscription: "sub_A" })),
      retrieveSubscription: vi.fn(async (id: string) => sub({ id, latest_invoice: "in_last", ...subOverrides })),
      updateSubscription: vi.fn(async (id: string) => sub({ id, cancel_at_period_end: true })),
      markCancelAtPeriodEnd: vi.fn(async () => ({ data: { applied: true }, error: null })),
      logPaymentEvent: vi.fn(async () => ({ error: null })),
    };
    return d;
  };
  const charge = (o: Record<string, unknown> = {}) => ({
    id: "ch_1", amount: 9900, amount_refunded: 9900, refunded: true, currency: "mxn", customer: "cus_1", invoice: "in_last", ...o,
  });

  it("reembolso total de la última factura: no renovar en Stripe y en la fila, sin dar PRO", async () => {
    const d = refundDeps();
    const out = await handleStripeEvent(ev("charge.refunded", charge()), d);
    expect(out).toEqual({ status: 200, body: { received: true, action: "cancel_at_period_end" } });
    expect(d.updateSubscription).toHaveBeenCalledWith("sub_A", { cancel_at_period_end: true });
    expect(d.markCancelAtPeriodEnd).toHaveBeenCalledWith("sub_A");
    expect(d.applySubscription).not.toHaveBeenCalled();
    expect(d.logPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_id: "evt_1", type: "charge.refunded", charge_id: "ch_1", invoice_id: "in_last", subscription_id: "sub_A",
      amount: 9900, amount_refunded: 9900, action: "cancel_at_period_end",
    }));
  });

  it("si Stripe ya la tenía sin renovar o cancelada, no la vuelve a tocar en Stripe", async () => {
    const d = refundDeps({ status: "canceled" });
    await handleStripeEvent(ev("charge.refunded", charge()), d);
    expect(d.updateSubscription).not.toHaveBeenCalled();
    expect(d.applySubscription).not.toHaveBeenCalled();
  });

  it("reembolso parcial: solo se registra", async () => {
    const d = refundDeps();
    const out = await handleStripeEvent(ev("charge.refunded", charge({ amount_refunded: 3000, refunded: false })), d);
    expect(out.body.action).toBe("refund_partial_logged");
    expect(d.updateSubscription).not.toHaveBeenCalled();
    expect(d.markCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it("reembolso total de una factura ANTERIOR: no cancela la renovación vigente", async () => {
    const d = refundDeps({ latest_invoice: "in_nueva" });
    const out = await handleStripeEvent(ev("charge.refunded", charge()), d);
    expect(out.body.action).toBe("refund_full_factura_anterior");
    expect(d.updateSubscription).not.toHaveBeenCalled();
  });

  it("disputa: se registra, no cambia el acceso ni da PRO", async () => {
    const d = refundDeps();
    const out = await handleStripeEvent(ev("charge.dispute.created", {
      id: "dp_1", charge: "ch_1", amount: 9900, currency: "mxn", reason: "fraudulent", status: "needs_response",
    }), d);
    expect(out).toEqual({ status: 200, body: { received: true, action: "dispute_logged" } });
    expect(d.logPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "charge.dispute.created", charge_id: "ch_1", dispute_reason: "fraudulent", action: "dispute_logged",
    }));
    expect(d.applySubscription).not.toHaveBeenCalled();
    expect(d.updateSubscription).not.toHaveBeenCalled();
  });

  it("si no se puede registrar o marcar, 500 para que Stripe reintente", async () => {
    const d = refundDeps();
    d.markCancelAtPeriodEnd = vi.fn(async () => ({ data: null, error: { message: "db down" } }));
    expect((await handleStripeEvent(ev("charge.refunded", charge()), d)).status).toBe(500);
    const d2 = refundDeps();
    d2.logPaymentEvent = vi.fn(async () => ({ error: { message: "db down" } }));
    expect((await handleStripeEvent(ev("charge.dispute.created", { id: "dp_1", charge: "ch_1" }), d2)).status).toBe(500);
  });
});
