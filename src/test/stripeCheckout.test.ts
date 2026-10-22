import { describe, it, expect, vi } from "vitest";
import { planCheckout, trialEligible } from "../../supabase/functions/stripe-checkout/logic";
import { safeOrigin } from "../../supabase/functions/_shared/origin";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const future = "2026-11-22T12:00:00Z";
const past = "2026-09-01T12:00:00Z";
const row = (o: Partial<NonNullable<Parameters<typeof planCheckout>[0]>>) => ({
  status: null, stripe_customer_id: null, stripe_subscription_id: null, trial_end: null, current_period_end: null, ...o,
});

describe("stripe-checkout: no duplicar suscripciones (A-05/A-08)", () => {
  it.each([
    ["comped", "comped", false],
    ["active", "already_subscribed", true],
    ["trialing", "already_subscribed", true],
    ["past_due", "past_due", true],
  ])("status %s → 409 sin llamar a Stripe", async (status, reason, portal) => {
    const list = vi.fn();
    const plan = await planCheckout(row({ status, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", current_period_end: future }), list, NOW);
    expect(plan).toMatchObject({ kind: "blocked", block: { status: 409, reason, portal } });
    if (plan.kind === "blocked") expect(plan.block.message).toMatch(/IATOS PRO/);
    expect(list).not.toHaveBeenCalled();
  });

  it("past_due manda al portal con mensaje en español", async () => {
    const plan = await planCheckout(row({ status: "past_due", stripe_subscription_id: "sub_1" }), vi.fn(), NOW);
    expect(plan.kind === "blocked" && plan.block.message).toMatch(/Gestionar suscripción/);
  });

  it("si la fila dice cancelada pero Stripe tiene una viva, también bloquea", async () => {
    const list = vi.fn(async () => [{ id: "sub_2", status: "active" }]);
    const plan = await planCheckout(row({ status: "canceled", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }), list, NOW);
    expect(plan).toMatchObject({ kind: "blocked", block: { reason: "already_subscribed" } });
    expect(list).toHaveBeenCalledWith("cus_1");
  });

  it("una fila active con periodo vencido no bloquea (webhook perdido)", async () => {
    const plan = await planCheckout(row({ status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", current_period_end: past }),
      async () => [{ id: "sub_1", status: "canceled", trial_end: 1 }], NOW);
    expect(plan).toEqual({ kind: "create", trialDays: null });
  });
});

describe("stripe-checkout: prueba de 30 días solo la primera vez (A-04)", () => {
  it("primera vez, sin customer: 30 días y no consulta Stripe", async () => {
    const list = vi.fn();
    expect(await planCheckout(null, list, NOW)).toEqual({ kind: "create", trialDays: 30 });
    expect(list).not.toHaveBeenCalled();
  });

  it("customer creado en un checkout abandonado sigue teniendo su prueba", async () => {
    expect(await planCheckout(row({ status: "incomplete", stripe_customer_id: "cus_1" }), async () => [], NOW))
      .toEqual({ kind: "create", trialDays: 30 });
  });

  it("quien canceló y vuelve paga desde el día 1 (sin otra prueba)", async () => {
    const plan = await planCheckout(row({ status: "canceled", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", trial_end: past }),
      async () => [{ id: "sub_1", status: "canceled", trial_start: 1, trial_end: 2 }], NOW);
    expect(plan).toEqual({ kind: "create", trialDays: null });
  });

  it("el historial de Stripe manda aunque la fila local esté vacía", () => {
    expect(trialEligible(row({ stripe_customer_id: "cus_1" }), [{ id: "s", status: "canceled" }])).toBe(false);
    expect(trialEligible(row({ stripe_customer_id: "cus_1" }), [{ id: "s", status: "incomplete_expired" }])).toBe(true);
    expect(trialEligible(row({ stripe_customer_id: "cus_1" }), [{ id: "s", status: "incomplete_expired", trial_end: 5 }])).toBe(false);
  });
});

describe("origin de regreso", () => {
  it("acepta solo dominios propios", () => {
    expect(safeOrigin("https://traveliatos.life")).toBe("https://traveliatos.life");
    expect(safeOrigin("https://iatos-ai.lovable.app/")).toBe("https://iatos-ai.lovable.app");
    expect(safeOrigin("https://id-preview--7c80960a-e5cd-46b2-b94a-34145bb7f1f4.lovable.app"))
      .toBe("https://id-preview--7c80960a-e5cd-46b2-b94a-34145bb7f1f4.lovable.app");
    expect(safeOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    expect(safeOrigin("https://evil.lovable.app")).toBe("https://traveliatos.life");
    expect(safeOrigin("https://traveliatos.life.evil.com")).toBe("https://traveliatos.life");
    expect(safeOrigin(undefined)).toBe("https://traveliatos.life");
  });
});
