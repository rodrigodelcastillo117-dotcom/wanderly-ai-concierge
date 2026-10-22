// AUD-08 M3b (segunda auditoría, ronda r2): el 503 de stripe-checkout cuando el precio de Stripe no es
// la oferta publicada. Antes vivía solo en index.ts y quitar el `if` no hacía fallar ninguna prueba;
// ahora el flujo está en flow.ts y estas pruebas lo cubren (incluido "no se crea nada en Stripe").
import { describe, expect, it, vi } from "vitest";
import { PRICE_MISMATCH_BODY, runCheckout, type CheckoutDeps } from "../../supabase/functions/stripe-checkout/flow";

const goodPrice = {
  id: "price_pro_mxn", active: true, currency: "mxn", unit_amount: 9900, tax_behavior: "inclusive",
  type: "recurring", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};

function deps(over: Partial<CheckoutDeps> = {}) {
  const d: CheckoutDeps = {
    readSubscription: vi.fn(async () => null),
    listSubscriptions: vi.fn(async () => []),
    retrievePrice: vi.fn(async () => goodPrice),
    createCustomer: vi.fn(async () => "cus_nuevo"),
    saveCustomer: vi.fn(async () => {}),
    listOpenSessions: vi.fn(async () => []),
    expireSession: vi.fn(async () => ({})),
    createSession: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
    log: vi.fn(),
    ...over,
  };
  return d;
}
const input = { userId: "u-1", email: "u1@example.test", priceId: "price_pro_mxn", origin: "https://traveliatos.life" };

describe("AUD-08 M3b · stripe-checkout no abre el pago si el precio no es la oferta publicada", () => {
  it.each([
    ["en USD", { ...goodPrice, currency: "usd" }],
    ["con IVA por fuera (exclusive)", { ...goodPrice, tax_behavior: "exclusive" }],
    ["sin comportamiento de impuestos (unspecified, como en producción hoy)", { ...goodPrice, tax_behavior: "unspecified" }],
    ["de otro monto", { ...goodPrice, unit_amount: 100 }],
    ["anual", { ...goodPrice, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }],
    ["archivado", { ...goodPrice, active: false }],
  ])("precio %s → 503 price_mismatch y no se crea cliente ni sesión en Stripe", async (_n, price) => {
    const d = deps({ retrievePrice: vi.fn(async () => price) });
    const out = await runCheckout(input, d);
    expect(out).toEqual({ status: 503, body: PRICE_MISMATCH_BODY });
    expect(d.createCustomer).not.toHaveBeenCalled();
    expect(d.saveCustomer).not.toHaveBeenCalled();
    expect(d.createSession).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalled();
  });

  it("si no se puede leer el precio (no existe o Stripe falla) también es 503 (falla cerrado)", async () => {
    for (const retrievePrice of [vi.fn(async () => null), vi.fn(async () => { throw new Error("No such price"); })]) {
      const d = deps({ retrievePrice });
      expect((await runCheckout(input, d)).status).toBe(503);
      expect(d.createSession).not.toHaveBeenCalled();
    }
  });

  it("con el precio correcto se abre el pago en MXN, sin Adaptive Pricing", async () => {
    const d = deps();
    const out = await runCheckout(input, d);
    expect(out).toEqual({ status: 200, body: { url: "https://checkout.stripe.com/c/pay/cs_test_1", trial_days: 30 } });
    expect(d.createCustomer).toHaveBeenCalledWith("u1@example.test", "u-1");
    expect(d.saveCustomer).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u-1", stripe_customer_id: "cus_nuevo", currency: "MXN" }));
    expect(d.createSession).toHaveBeenCalledWith(expect.objectContaining({
      currency: "mxn", adaptive_pricing: { enabled: false }, customer: "cus_nuevo", line_items: [{ price: "price_pro_mxn", quantity: 1 }],
    }));
  });

  it("quien ya tiene PRO recibe 409 antes de mirar el precio (no se duplica el cobro)", async () => {
    const d = deps({ readSubscription: vi.fn(async () => ({ status: "comped", stripe_customer_id: null, stripe_subscription_id: null, trial_end: null, current_period_end: null })) });
    const out = await runCheckout(input, d);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ error: "already_subscribed", reason: "comped" });
    expect(d.retrievePrice).not.toHaveBeenCalled();
  });

  it("si la lectura de la suscripción falla, el error sube (index.ts responde 500)", async () => {
    const d = deps({ readSubscription: vi.fn(async () => { throw new Error("lectura de suscripción: timeout"); }) });
    await expect(runCheckout(input, d)).rejects.toThrow(/lectura de suscripción/);
  });
});

describe("stripe-checkout · index.ts delega en flow.ts", () => {
  it("index.ts usa runCheckout y ya no decide el precio por su cuenta", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "..", "supabase/functions/stripe-checkout/index.ts"), "utf8");
    expect(src).toMatch(/runCheckout\(/);
    expect(src).not.toMatch(/priceProblems\(/);
  });
});
