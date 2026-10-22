// D-P3-1 / N-06 (segunda auditoría, ronda r2): con el cobro pausado desde el panel de Stripe
// (pause_collection) la suscripción sigue 'active' pero no cobra; el webhook la escribe como 'paused'
// y is_pro no la cuenta. El precio y la moneda los revisa is_pro en SQL (X01 en
// supabase/tests/payments/aud2_pagos_adversarial.sql y RC20–RC23 en r2_cuentas.sql).
import { describe, expect, it, vi } from "vitest";
import { effectiveStatus, handleStripeEvent, subscriptionArgs, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";

const T = 1_800_000_000;

describe("D-P3-1 · pause_collection", () => {
  it("(caso del auditor) customer.subscription.updated con pause_collection no se escribe como 'active'", async () => {
    const applied: Array<Record<string, unknown>> = [];
    const deps: WebhookDeps = {
      retrieveSubscription: async (id) => ({
        id, status: "active", customer: "cus_1", current_period_end: T + 30 * 86400,
        metadata: { supabase_user_id: "u-1" }, pause_collection: { behavior: "void", resumes_at: null },
      }),
      retrieveInvoice: async (id) => ({ id }),
      applySubscription: async (a) => { applied.push(a); return { data: { applied: true, reason: "applied" }, error: null }; },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleStripeEvent({ id: "evt_pause", type: "customer.subscription.updated", created: T, data: { object: { id: "sub_1" } } }, deps);
    expect(applied[0]._status).toBe("paused");
  });

  it.each([
    [{ status: "active", pause_collection: { behavior: "keep_as_draft" } }, "paused"],
    [{ status: "trialing", pause_collection: { behavior: "mark_uncollectible" } }, "paused"],
    [{ status: "active", pause_collection: null }, "active"],
    [{ status: "canceled", pause_collection: { behavior: "void" } }, "canceled"],
    [{ status: "past_due", pause_collection: { behavior: "void" } }, "past_due"],
  ])("%o → %s", (sub, expected) => {
    expect(effectiveStatus(sub as never)).toBe(expected);
    expect(subscriptionArgs({ id: "sub_1", customer: "cus_1", ...sub } as never, T)._status).toBe(expected);
  });
});
