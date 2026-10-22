// D-P3-4 (segunda auditoría, ronda r2): si no se puede ubicar la factura de un cargo reembolsado
// (Stripe responde HTTP no-OK), el webhook responde 500 para que Stripe reintente; antes respondía
// 200 "reembolso_total_sin_suscripcion", sin revocar y con el evento registrado como hecho.
import { describe, expect, it, vi } from "vitest";
import { invoiceForPaymentIntentWith } from "../../supabase/functions/stripe-webhook/lookups";
import { handleStripeEvent, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("D-P3-4 · invoiceForPaymentIntentWith", () => {
  it("acacia: la factura viene en el PaymentIntent (no se consulta invoice_payments)", async () => {
    const fetchInvoicePayments = vi.fn();
    expect(await invoiceForPaymentIntentWith("pi_1", { retrievePaymentIntent: async () => ({ invoice: "in_1" }), fetchInvoicePayments })).toBe("in_1");
    expect(fetchInvoicePayments).not.toHaveBeenCalled();
  });

  it("basil+: la busca en invoice_payments", async () => {
    const fetchInvoicePayments = vi.fn(async (_q: string) => res(200, { data: [{ invoice: { id: "in_2" } }] }));
    expect(await invoiceForPaymentIntentWith("pi_2", { retrievePaymentIntent: async () => ({ invoice: null }), fetchInvoicePayments })).toBe("in_2");
    expect(String(fetchInvoicePayments.mock.calls[0][0])).toContain("payment%5Bpayment_intent%5D=pi_2");
  });

  it("200 sin facturas: null (el cargo de verdad no tiene factura)", async () => {
    expect(await invoiceForPaymentIntentWith("pi_3", { retrievePaymentIntent: async () => ({}), fetchInvoicePayments: async () => res(200, { data: [] }) })).toBeNull();
  });

  it.each([401, 404, 429, 500, 503])("HTTP %i: lanza (no es 'sin factura')", async (status) => {
    await expect(invoiceForPaymentIntentWith("pi_4", { retrievePaymentIntent: async () => ({}), fetchInvoicePayments: async () => res(status, { error: {} }) }))
      .rejects.toThrow(/HTTP/);
  });
});

describe("D-P3-4 · reembolso total con la factura no localizable", () => {
  it("si la búsqueda de la factura falla, 500: ni se revoca ni se registra como hecho (Stripe reintenta)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const revokePaidAccess = vi.fn(async () => ({ data: { applied: true, reason: "revoked" }, error: null }));
    const commitPaymentEvent = vi.fn(async () => ({ data: { logged: true }, error: null }));
    const deps: WebhookDeps = {
      retrieveSubscription: async (id) => ({ id, status: "active", customer: "cus_1", latest_invoice: "in_1" }),
      retrieveInvoice: async (id) => ({ id, subscription: "sub_1" }),
      applySubscription: async () => ({ data: { applied: true, reason: "applied" }, error: null }),
      retrieveCharge: async (id) => ({ id }),
      invoiceForPaymentIntent: (pi) => invoiceForPaymentIntentWith(pi, { retrievePaymentIntent: async () => ({}), fetchInvoicePayments: async () => res(500, {}) }),
      cancelSubscriptionNow: async () => {},
      revokePaidAccess,
      accessSnapshot: async () => ({ data: null, error: null }),
      findPaymentEvent: async () => ({ data: null, error: null }),
      logPaymentEvent: async () => ({ error: null }),
      commitPaymentEvent,
      isDeletedCustomer: async () => false,
      alertAdmins: async () => "campana",
    };
    const charge = { id: "ch_1", amount: 9900, amount_refunded: 9900, refunded: true, customer: "cus_1", payment_intent: "pi_1" };
    const out = await handleStripeEvent({ id: "evt_ref", type: "charge.refunded", created: 1_800_000_000, data: { object: charge } }, deps);
    expect({ status: out.status, revoked: revokePaidAccess.mock.calls.length, logged: commitPaymentEvent.mock.calls.length })
      .toEqual({ status: 500, revoked: 0, logged: 0 });
  });
});
