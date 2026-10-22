// D-P3-3 (segunda auditoría, ronda r2): una disputa sin administradores no se da por avisada.
// Antes notify_admins devolvía 0 sin administradores (igual que "ya enviado"), index.ts lo traducía a
// "campana_ya_enviada" y el webhook respondía 200 sin que nadie se enterara.
import { describe, expect, it, vi } from "vitest";
import { alertDelivered, deliverAdminAlert, type AlertDeps } from "../../supabase/functions/stripe-webhook/alerts";
import { handleStripeEvent, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";

const alert = { key: "stripe:evt_dp", title: "Disputa abierta en Stripe", body: "Disputa dp_1" };
const deps = (n: unknown, over: Partial<AlertDeps> = {}): AlertDeps => ({
  notifyAdmins: vi.fn(async () => ({ data: n, error: null })),
  emailConfigured: false,
  fixedRecipients: [],
  adminEmails: vi.fn(async () => []),
  sendEmail: vi.fn(async () => true),
  logError: vi.fn(),
  ...over,
});

describe("D-P3-3 · deliverAdminAlert", () => {
  it("sin administradores (notify_admins = -1) y sin correo de alerta: sin_destinatarios (NO enviado)", async () => {
    const s = await deliverAdminAlert(alert, deps(-1));
    expect(s).toBe("sin_destinatarios");
    expect(alertDelivered(s)).toBe(false);
  });

  it("sin administradores pero con HEALTH_ALERT_EMAIL: el correo cuenta como aviso", async () => {
    const d = deps(-1, { emailConfigured: true, fixedRecipients: ["ops@example.test"] });
    const s = await deliverAdminAlert(alert, d);
    expect(s).toBe("correo_sin_campana");
    expect(alertDelivered(s)).toBe(true);
    expect(d.sendEmail).toHaveBeenCalledWith("ops@example.test", alert);
  });

  it("sin administradores y el correo falla: sin_destinatarios", async () => {
    const s = await deliverAdminAlert(alert, deps(-1, { emailConfigured: true, fixedRecipients: ["ops@example.test"], sendEmail: vi.fn(async () => false) }));
    expect(s).toBe("sin_destinatarios");
  });

  it("0 = ya se había avisado de este evento (reintento): entregado, sin correo repetido", async () => {
    const d = deps(0, { emailConfigured: true, fixedRecipients: ["ops@example.test"] });
    expect(await deliverAdminAlert(alert, d)).toBe("campana_ya_enviada");
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it("campana nueva, con y sin correo", async () => {
    expect(await deliverAdminAlert(alert, deps(2))).toBe("campana");
    expect(await deliverAdminAlert(alert, deps(1, { emailConfigured: true, adminEmails: vi.fn(async () => ["a@x.test", "b@x.test"]) }))).toBe("campana_y_correo");
  });

  it("error de la base o respuesta rara: fallido (nunca lanza)", async () => {
    expect(await deliverAdminAlert(alert, deps(null, { notifyAdmins: vi.fn(async () => ({ data: null, error: { message: "timeout" } })) }))).toBe("fallido");
    expect(await deliverAdminAlert(alert, deps("x"))).toBe("fallido");
  });
});

describe("D-P3-3 · el webhook no responde 200 si la disputa no se avisó", () => {
  const T = 1_800_000_000;
  const base = (alertAdmins: WebhookDeps["alertAdmins"]): WebhookDeps => ({
    retrieveSubscription: async (id) => ({ id, status: "active", customer: "cus_1", latest_invoice: "in_1", metadata: { supabase_user_id: "u-1" } }),
    retrieveInvoice: async (id) => ({ id, subscription: "sub_1" }),
    applySubscription: async () => ({ data: { applied: true, reason: "applied" }, error: null }),
    retrieveCharge: async (id) => ({ id, amount: 9900, customer: "cus_1", invoice: "in_1" }),
    cancelSubscriptionNow: async () => {},
    revokePaidAccess: async () => ({ data: { applied: true, reason: "revoked", user_id: "u-1" }, error: null }),
    accessSnapshot: async () => ({ data: null, error: null }),
    findPaymentEvent: async () => ({ data: null, error: null }),
    logPaymentEvent: async () => ({ error: null }),
    commitPaymentEvent: vi.fn(async () => ({ data: { logged: true, duplicate: false, tenure: null }, error: null })),
    isDeletedCustomer: async () => false,
    alertAdmins,
  });
  const dispute = { id: "evt_dp", type: "charge.dispute.created", created: T,
    data: { object: { id: "dp_1", charge: "ch_1", amount: 9900, currency: "mxn", status: "needs_response" } } };

  it("disputa abierta con sin_destinatarios → 500 y el evento no queda registrado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = base(async () => "sin_destinatarios");
    const out = await handleStripeEvent(dispute, d);
    expect(out.status).toBe(500);
    expect(d.commitPaymentEvent).not.toHaveBeenCalled();
  });

  it("disputa abierta con correo_sin_campana (llegó el correo de alerta) → 200", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await handleStripeEvent(dispute, base(async () => "correo_sin_campana"));
    expect(out.status).toBe(200);
  });

  it("cobro doble (segunda suscripción viva) sin destinatarios → 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = base(async () => "sin_destinatarios");
    d.applySubscription = async () => ({ data: { applied: false, reason: "other_live_subscription" }, error: null });
    const out = await handleStripeEvent({ id: "evt_sub", type: "customer.subscription.updated", created: T, data: { object: { id: "sub_2" } } }, d);
    expect(out.status).toBe(500);
  });
});
