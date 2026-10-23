// Promoción de referidos: paso diario en prive-cron y el saldo a favor de Stripe (APAGADO por flag).
import { describe, expect, it, vi } from "vitest";
import {
  applyReferralStripeRewards, balanceTransactionRequest, REFERRAL_CREDIT, stripeCreditWith, type ReferralStripeDeps,
} from "../../supabase/functions/_shared/referral-rewards";
import { runPriveCron, type PriveCronDeps } from "../../supabase/functions/prive-cron/run";
import { proStatusLabel } from "@/lib/proStatus";

const reward = { id: "11111111-2222-3333-4444-555555555555", customer_id: "cus_123", days: 30 };

function deps(enabled: boolean, over: Partial<ReferralStripeDeps> = {}) {
  const marks: unknown[][] = [];
  const credit = vi.fn(async () => ({ ok: true as const, id: "cbtxn_1" }));
  const d: ReferralStripeDeps = {
    claim: async () => ({ data: { enabled, rewards: enabled ? [reward] : [] }, error: null }),
    credit,
    mark: async (...a) => { marks.push(a); return { data: true, error: null }; },
    ...over,
  };
  return { d, marks, credit };
}

describe("premio en Stripe (flag referral_stripe_apply_enabled)", () => {
  it("APAGADO: no llama a Stripe ni marca nada", async () => {
    const { d, marks, credit } = deps(false);
    expect(await applyReferralStripeRewards(d)).toEqual({ enabled: false, claimed: 0, applied: 0, failed: 0, mark_errors: 0 });
    expect(credit).not.toHaveBeenCalled();
    expect(marks).toEqual([]);
  });

  it("apagado aunque la base devolviera filas: doble candado, Stripe no se toca", async () => {
    const { d, credit } = deps(false, { claim: async () => ({ data: { enabled: false, rewards: [reward] }, error: null }) });
    await applyReferralStripeRewards(d);
    expect(credit).not.toHaveBeenCalled();
  });

  it("PRENDIDO: un saldo a favor por premio y se confirma con su referencia", async () => {
    const { d, marks, credit } = deps(true);
    expect(await applyReferralStripeRewards(d)).toEqual({ enabled: true, claimed: 1, applied: 1, failed: 0, mark_errors: 0 });
    expect(credit).toHaveBeenCalledWith(reward);
    expect(marks).toEqual([[reward.id, true, "cbtxn_1", null]]);
  });

  it("si Stripe falla, se marca con el error (vuelve a pendiente en la base)", async () => {
    const { d, marks } = deps(true, { credit: async () => { throw new Error("red caída"); } });
    expect((await applyReferralStripeRewards(d)).failed).toBe(1);
    expect(marks).toEqual([[reward.id, false, null, "red caída"]]);
  });

  it("migración pendiente: se omite sin error", async () => {
    const { d } = deps(true, { claim: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.referral_claim_stripe_rewards(_limit) in the schema cache" } }) });
    expect((await applyReferralStripeRewards(d)).enabled).toBe(false);
  });

  it("la petición: saldo a favor de un mes en MXN, con llave de idempotencia por premio, sin cupón ni cambio de suscripción", () => {
    const { url, init } = balanceTransactionRequest(reward, "sk_test_x");
    expect(url).toBe("https://api.stripe.com/v1/customers/cus_123/balance_transactions");
    const body = new URLSearchParams(String(init.body));
    expect(REFERRAL_CREDIT).toEqual({ amount: 9900, currency: "mxn" });
    expect(body.get("amount")).toBe("-9900");
    expect(body.get("currency")).toBe("mxn");
    expect(body.get("metadata[iatos_referral_reward_id]")).toBe(reward.id);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`iatos-referral-reward-${reward.id}`);
    expect(url).not.toMatch(/subscriptions|coupons|invoices/);
  });

  it("stripeCreditWith traduce la respuesta de Stripe", async () => {
    const ok = stripeCreditWith("sk", (async () => new Response(JSON.stringify({ id: "cbtxn_9" }), { status: 200 })) as typeof fetch);
    expect(await ok(reward)).toEqual({ ok: true, id: "cbtxn_9" });
    const bad = stripeCreditWith("sk", (async () => new Response(JSON.stringify({ error: { code: "resource_missing" } }), { status: 404 })) as typeof fetch);
    expect(await bad(reward)).toEqual({ ok: false, error: "stripe 404: resource_missing" });
  });
});

describe("prive-cron: paso de referidos", () => {
  const base = (over: Partial<PriveCronDeps> = {}): PriveCronDeps => ({
    evaluate: async () => ({ data: [], error: null }),
    sender: null,
    sweep: async () => ({ data: {}, error: null }),
    ...over,
  });

  it("corre el barrido y, con el flag apagado, Stripe queda sin tocar", async () => {
    const { d, credit } = deps(false);
    const r = await runPriveCron(base({ referralSweep: async () => ({ data: { applied: 1, expired: 0, new_rewards: 0 }, error: null }), referralStripe: d }));
    expect(r.status).toBe(200);
    expect(r.body.referrals).toEqual({ sweep: { applied: 1, expired: 0, new_rewards: 0 }, stripe: { enabled: false, claimed: 0, applied: 0, failed: 0, mark_errors: 0 } });
    expect(credit).not.toHaveBeenCalled();
  });

  it("migración de referidos pendiente: no es error (200) y no intenta Stripe", async () => {
    const { d, credit } = deps(true);
    const r = await runPriveCron(base({
      referralSweep: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.referral_rewards_sweep(_limit) in the schema cache" } }),
      referralStripe: d,
    }));
    expect(r.status).toBe(200);
    expect(r.body.referrals?.sweep).toBe("migration_pending");
    expect(credit).not.toHaveBeenCalled();
  });

  it("un error del barrido se reporta (500) sin frenar lo demás", async () => {
    const r = await runPriveCron(base({ referralSweep: async () => ({ data: null, error: { message: "timeout" } }) }));
    expect(r.status).toBe(500);
    expect(r.body.errors).toEqual(["referidos: timeout"]);
  });
});

describe("estado de PRO con cortesía de referidos", () => {
  it("muestra hasta cuándo dura (y la de siempre sigue siendo permanente)", () => {
    const sub = { status: "comped", stripe_customer_id: null, current_period_end: null, comped_until: "2026-11-19T18:00:00Z" };
    expect(proStatusLabel({ isComped: true, isTrialing: false, trialDaysLeft: null, cancelAtPeriodEnd: false, subscription: sub }))
      .toBe("PRO de cortesía hasta el 19 de noviembre de 2026 · premio por invitar a tus amigos");
    expect(proStatusLabel({ isComped: true, isTrialing: false, trialDaysLeft: null, cancelAtPeriodEnd: false, subscription: { ...sub, comped_until: null } }))
      .toBe("PRO de cortesía · acceso permanente");
  });
});
