// AUD-08 · El checkout solo cobra lo que la página promete: $99 MXN al mes, IVA incluido.
// Antes, stripe-checkout mandaba a Stripe el STRIPE_PRICE_ID que hubiera en los secretos sin
// revisarlo: un precio en USD, con IVA "por fuera" (Stripe Tax lo sumaba: $114.84) o anual se
// cobraba igual; y con Adaptive Pricing encendido en el panel Stripe convertía a USD (visto en la
// prueba del dueño: "hoy el precio adaptativo cobró en USD", IATOS_ESTADO_FINAL.md §5).
import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRICE,
  checkoutSessionParams,
  expireOpenSessions,
  priceProblems,
} from "../../supabase/functions/stripe-checkout/logic";
import { PRO_PRICE_MXN } from "@/lib/planCopy";

const goodPrice = {
  id: "price_pro_mxn", active: true, currency: "mxn", unit_amount: 9900, tax_behavior: "inclusive",
  type: "recurring", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};

describe("AUD-08 · el precio de Stripe debe coincidir con la oferta publicada", () => {
  it("la oferta esperada es la del texto comercial (planCopy)", () => {
    expect(EXPECTED_PRICE.unit_amount).toBe(PRO_PRICE_MXN * 100);
    expect(EXPECTED_PRICE).toMatchObject({ currency: "mxn", tax_behavior: "inclusive", interval: "month", interval_count: 1 });
  });

  it("un precio correcto no tiene problemas", () => {
    expect(priceProblems(goodPrice)).toEqual([]);
  });

  it.each([
    ["moneda USD", { currency: "usd" }, "currency"],
    ["monto distinto", { unit_amount: 14900 }, "unit_amount"],
    ["IVA por fuera (Stripe Tax lo sumaría)", { tax_behavior: "exclusive" }, "tax_behavior"],
    ["IVA sin especificar", { tax_behavior: "unspecified" }, "tax_behavior"],
    ["anual", { recurring: { interval: "year", interval_count: 1 } }, "interval"],
    ["cada 3 meses", { recurring: { interval: "month", interval_count: 3 } }, "interval"],
    ["pago único", { type: "one_time", recurring: null }, "recurring"],
    ["precio archivado", { active: false }, "active"],
    ["por uso (metered)", { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } }, "usage_type"],
  ])("%s → se rechaza", (_label, patch, field) => {
    const problems = priceProblems({ ...goodPrice, ...patch } as never);
    expect(problems.some((p) => p.startsWith(field))).toBe(true);
  });

  it("sin precio (id equivocado) → problema", () => {
    expect(priceProblems(null)).toEqual(["price: no existe"]);
  });
});

describe("AUD-08 · parámetros de la sesión de Checkout", () => {
  const base = { customerId: "cus_1", userId: "u-1", priceId: "price_pro_mxn", origin: "https://traveliatos.life", trialDays: 30, trialEndUnix: null };

  it("apaga Adaptive Pricing (siempre MXN), IVA automático y metadata de la cuenta", () => {
    const p = checkoutSessionParams(base);
    expect(p.adaptive_pricing).toEqual({ enabled: false });
    expect(p.currency).toBe("mxn");
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect(p.mode).toBe("subscription");
    expect(p.client_reference_id).toBe("u-1");
    expect(p.subscription_data.metadata).toEqual({ supabase_user_id: "u-1" });
    expect(p.subscription_data.trial_period_days).toBe(30);
    expect(p.line_items).toEqual([{ price: "price_pro_mxn", quantity: 1 }]);
    expect(p.success_url).toBe("https://traveliatos.life/dashboard/pro?checkout=success");
  });

  it("prueba sin tarjeta en curso: trial_end y nunca trial_period_days", () => {
    const p = checkoutSessionParams({ ...base, trialDays: null, trialEndUnix: 1_900_000_000 });
    expect(p.subscription_data.trial_end).toBe(1_900_000_000);
    expect(p.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("sin prueba: ni trial_end ni trial_period_days", () => {
    const p = checkoutSessionParams({ ...base, trialDays: null });
    expect(p.subscription_data).not.toHaveProperty("trial_period_days");
    expect(p.subscription_data).not.toHaveProperty("trial_end");
  });
});

describe("AUD-08 · dos pestañas, dos checkouts: se cierran las sesiones abiertas anteriores", () => {
  it("expira cada sesión abierta del cliente antes de crear la nueva", async () => {
    const list = vi.fn(async () => [{ id: "cs_1" }, { id: "cs_2" }]);
    const expire = vi.fn(async () => {});
    const r = await expireOpenSessions("cus_1", list, expire);
    expect(list).toHaveBeenCalledWith("cus_1");
    expect(expire.mock.calls.map((c) => c[0])).toEqual(["cs_1", "cs_2"]);
    expect(r).toEqual({ expired: 2, failed: 0 });
  });

  it("si una ya se pagó o expiró mientras tanto, no truena (se cuenta como fallida y se sigue)", async () => {
    const expire = vi.fn(async (id: string) => { if (id === "cs_1") throw new Error("session is not open"); });
    const r = await expireOpenSessions("cus_1", async () => [{ id: "cs_1" }, { id: "cs_2" }], expire);
    expect(r).toEqual({ expired: 1, failed: 1 });
  });

  it("si Stripe no deja listar, no bloquea el pago (el webhook avisa de un duplicado)", async () => {
    const r = await expireOpenSessions("cus_1", async () => { throw new Error("timeout"); }, vi.fn());
    expect(r).toEqual({ expired: 0, failed: 1 });
  });
});
