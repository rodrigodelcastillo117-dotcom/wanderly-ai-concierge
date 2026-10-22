// D-P2-2 (segunda auditoría, ronda r2): una prueba de 30 días por TARJETA, no por cuenta.
// La tarjeta no se conoce al crear la Checkout Session; el webhook revisa su huella en cuanto Stripe la
// guarda y, si ya tuvo prueba en otra suscripción, termina la prueba (Stripe cobra el primer mes).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CARD_TRIAL_METADATA,
  cardFingerprintFrom,
  handleStripeEvent,
  type ClaimTrialArgs,
  type StripeSubscriptionLike,
  type WebhookDeps,
} from "../../supabase/functions/stripe-webhook/handler";
import { CARD_TRIAL_METADATA as CHECKOUT_MARK, checkoutSessionParams, planCheckout } from "../../supabase/functions/stripe-checkout/logic";

const T = 1_800_000_000;
const ev = (id: string, type: string, object: unknown) => ({ id, type, created: T, data: { object } });

/** Stripe simulado: suscripciones por id, tarjeta por suscripción y una tabla de huellas como la de la base. */
function world() {
  const subs = new Map<string, StripeSubscriptionLike>();
  const cardOf = new Map<string, string | null>();
  const claimed = new Map<string, string>(); // huella → suscripción (claim_trial_fingerprint)
  const applied: Array<Record<string, unknown>> = [];
  const ended: string[] = [];
  const trialSub = (id: string, user: string, customer: string): StripeSubscriptionLike => ({
    id, status: "trialing", customer, trial_end: T + 30 * 86400, current_period_end: T + 30 * 86400, currency: "mxn",
    metadata: { supabase_user_id: user, [CARD_TRIAL_METADATA.key]: CARD_TRIAL_METADATA.value },
    items: { data: [{ price: { id: "price_pro_mxn" } }] },
    default_payment_method: `pm_${id}`,
  });
  const deps: WebhookDeps = {
    retrieveSubscription: vi.fn(async (id: string) => ({ ...subs.get(id)! })),
    retrieveInvoice: vi.fn(async (id: string) => ({ id })),
    applySubscription: vi.fn(async (a) => { applied.push(a); return { data: { applied: true, reason: "applied" }, error: null }; }),
    cardFingerprint: vi.fn(async (s: StripeSubscriptionLike) => cardOf.get(s.id) ?? null),
    claimTrialFingerprint: vi.fn(async (a: ClaimTrialArgs) => {
      const prev = claimed.get(a._fingerprint);
      if (!prev) { claimed.set(a._fingerprint, a._subscription_id); return { data: { first: true, reason: "new_card" }, error: null }; }
      return { data: { first: prev === a._subscription_id, reason: prev === a._subscription_id ? "same_subscription" : "card_already_had_trial" }, error: null };
    }),
    endTrialNow: vi.fn(async (id: string) => {
      ended.push(id);
      // Stripe cobra el primer mes en ese momento: la suscripción queda activa y sin prueba.
      subs.set(id, { ...subs.get(id)!, status: "active", trial_end: T });
    }),
  };
  return { subs, cardOf, claimed, applied, ended, deps, trialSub };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D-P2-2 · checkout: con prueba se pide tarjeta y se marca la suscripción", () => {
  const base = { customerId: "cus_1", userId: "u-1", priceId: "price_pro_mxn", origin: "https://traveliatos.life" };

  it("con prueba de 30 días: siempre se pide tarjeta, solo tarjeta, y la marca iatos_trial=card", () => {
    const p = checkoutSessionParams({ ...base, trialDays: 30 }) as Record<string, any>;
    expect(p.payment_method_collection).toBe("always");
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.subscription_data.trial_period_days).toBe(30);
    expect(p.subscription_data.metadata).toEqual({ supabase_user_id: "u-1", iatos_trial: "card" });
    // La marca que escribe el checkout es la que lee el webhook.
    expect(CHECKOUT_MARK).toEqual(CARD_TRIAL_METADATA);
  });

  it("sin prueba: no se restringe el medio de pago ni se marca", () => {
    const p = checkoutSessionParams({ ...base, trialDays: null }) as Record<string, any>;
    expect(p.payment_method_collection).toBeUndefined();
    expect(p.payment_method_types).toBeUndefined();
    expect(p.subscription_data.metadata).toEqual({ supabase_user_id: "u-1" });
  });
});

describe("D-P2-2 · webhook: una prueba por tarjeta", () => {
  it("(caso del auditor) una cuenta NUEVA con la misma tarjeta no recibe otra prueba de 30 días: se cobra ya", async () => {
    const w = world();
    // Cuenta A: primera vez con la tarjeta X.
    w.subs.set("sub_A", w.trialSub("sub_A", "u-A", "cus_A"));
    w.cardOf.set("sub_A", "fp_tarjeta_X");
    const a = await handleStripeEvent(ev("evt_a", "checkout.session.completed", { client_reference_id: "u-A", subscription: "sub_A" }), w.deps);
    expect(a.body.trial).toBe("primera_prueba_de_la_tarjeta");
    expect(w.applied.at(-1)).toMatchObject({ _subscription_id: "sub_A", _status: "trialing" });

    // Cuenta B (otro correo, otro cliente de Stripe). planCheckout no puede saber de la tarjeta y le
    // ofrece la prueba; el webhook la detecta por la huella.
    expect(await planCheckout(null, async () => [])).toMatchObject({ kind: "create", trialDays: 30 });
    w.subs.set("sub_B", w.trialSub("sub_B", "u-B", "cus_B"));
    w.cardOf.set("sub_B", "fp_tarjeta_X");
    const b = await handleStripeEvent(ev("evt_b", "checkout.session.completed", { client_reference_id: "u-B", subscription: "sub_B" }), w.deps);
    expect(b.status).toBe(200);
    expect(b.body.trial).toBe("tarjeta_ya_tuvo_prueba_cobro_inmediato");
    expect(w.ended).toEqual(["sub_B"]);
    // Se escribe el estado REAL tras terminar la prueba (active, cobrado), no 'trialing'.
    expect(w.applied.at(-1)).toMatchObject({ _subscription_id: "sub_B", _status: "active", _user_id: "u-B" });
  });

  it("customer.subscription.created también la revisa (el orden de eventos de Stripe no está garantizado)", async () => {
    const w = world();
    w.claimed.set("fp_tarjeta_Y", "sub_vieja");
    w.subs.set("sub_C", w.trialSub("sub_C", "u-C", "cus_C"));
    w.cardOf.set("sub_C", "fp_tarjeta_Y");
    const out = await handleStripeEvent(ev("evt_c", "customer.subscription.created", { id: "sub_C" }), w.deps);
    expect(w.ended).toEqual(["sub_C"]);
    expect(out.body.trial).toBe("tarjeta_ya_tuvo_prueba_cobro_inmediato");
    expect(w.applied.at(-1)).toMatchObject({ _status: "active" });
  });

  it("el reintento del mismo evento (misma suscripción) no termina la prueba legítima", async () => {
    const w = world();
    w.subs.set("sub_A", w.trialSub("sub_A", "u-A", "cus_A"));
    w.cardOf.set("sub_A", "fp_tarjeta_X");
    await handleStripeEvent(ev("evt_a", "customer.subscription.created", { id: "sub_A" }), w.deps);
    const again = await handleStripeEvent(ev("evt_a2", "checkout.session.completed", { subscription: "sub_A" }), w.deps);
    expect(w.ended).toEqual([]);
    expect(again.body.trial).toBe("primera_prueba_de_la_tarjeta");
  });

  it("sin huella todavía (Stripe aún no guardó la tarjeta): no se toca y el siguiente evento revisa", async () => {
    const w = world();
    w.subs.set("sub_D", w.trialSub("sub_D", "u-D", "cus_D"));
    const out = await handleStripeEvent(ev("evt_d", "customer.subscription.created", { id: "sub_D" }), w.deps);
    expect(out.body.trial).toBe("sin_huella_todavia");
    expect(w.deps.claimTrialFingerprint).not.toHaveBeenCalled();
    expect(w.ended).toEqual([]);
  });

  it("si la base no responde al reclamar la huella: 500 (Stripe reintenta) y no se escribe nada", async () => {
    const w = world();
    w.subs.set("sub_E", w.trialSub("sub_E", "u-E", "cus_E"));
    w.cardOf.set("sub_E", "fp_tarjeta_Z");
    w.deps.claimTrialFingerprint = vi.fn(async () => ({ data: null, error: { message: "timeout" } }));
    const out = await handleStripeEvent(ev("evt_e", "customer.subscription.created", { id: "sub_E" }), w.deps);
    expect(out.status).toBe(500);
    expect(w.applied).toEqual([]);
  });

  it("una prueba marcada sin la revisión de huella configurada falla cerrado (500)", async () => {
    const w = world();
    w.subs.set("sub_F", w.trialSub("sub_F", "u-F", "cus_F"));
    const { cardFingerprint: _c, claimTrialFingerprint: _k, endTrialNow: _e, ...sinHuella } = w.deps;
    const out = await handleStripeEvent(ev("evt_f", "customer.subscription.created", { id: "sub_F" }), sinHuella as WebhookDeps);
    expect(out.status).toBe(500);
  });

  it("suscripciones sin la marca (activas, o pruebas anteriores a este cambio) no se revisan", async () => {
    const w = world();
    w.subs.set("sub_G", { ...w.trialSub("sub_G", "u-G", "cus_G"), metadata: { supabase_user_id: "u-G" } });
    w.subs.set("sub_H", { ...w.trialSub("sub_H", "u-H", "cus_H"), status: "active" });
    await handleStripeEvent(ev("evt_g", "customer.subscription.updated", { id: "sub_G" }), w.deps);
    await handleStripeEvent(ev("evt_h", "customer.subscription.updated", { id: "sub_H" }), w.deps);
    expect(w.deps.cardFingerprint).not.toHaveBeenCalled();
    expect(w.applied.map((a) => a._status)).toEqual(["trialing", "active"]);
  });
});

describe("D-P2-2 · huella de la tarjeta (cardFingerprintFrom)", () => {
  const stripe = (pm: Record<string, string | null>, customerDefault: string | null = null) => ({
    retrievePaymentMethod: vi.fn(async (id: string) => ({ card: pm[id] === undefined ? null : { fingerprint: pm[id] } })),
    retrieveCustomerDefaultPaymentMethod: vi.fn(async () => customerDefault),
  });
  const s = (o: Partial<StripeSubscriptionLike>): StripeSubscriptionLike => ({ id: "sub_1", status: "trialing", customer: "cus_1", ...o });

  it("del objeto expandido, del id de la suscripción o de la tarjeta predeterminada del cliente", async () => {
    expect(await cardFingerprintFrom(s({ default_payment_method: { id: "pm_1", card: { fingerprint: "fp_exp" } } }), stripe({}))).toBe("fp_exp");
    expect(await cardFingerprintFrom(s({ default_payment_method: "pm_2" }), stripe({ pm_2: "fp_id" }))).toBe("fp_id");
    const st = stripe({ pm_3: "fp_cliente" }, "pm_3");
    expect(await cardFingerprintFrom(s({ default_payment_method: null }), st)).toBe("fp_cliente");
    expect(st.retrieveCustomerDefaultPaymentMethod).toHaveBeenCalledWith("cus_1");
  });

  it("sin tarjeta guardada: null", async () => {
    expect(await cardFingerprintFrom(s({ default_payment_method: null }), stripe({}))).toBeNull();
  });
});
