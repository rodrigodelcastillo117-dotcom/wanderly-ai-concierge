import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStripeEvent, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";
import * as fx from "./fixtures/stripeEvents";

// Mundo en memoria: "Stripe" (suscripciones, facturas, cargos) y "base" (subscriptions) con las
// mismas reglas que las funciones SQL (apply_stripe_subscription: cortesía intocable y eventos
// viejos ignorados; revoke_paid_access: solo quita, nunca crea ni da PRO). Las funciones SQL
// reales se prueban en supabase/tests/security/round_b.sql.
type Row = { user_id: string; status: string; sub: string | null; cus: string | null; period_end: number | null; event_created: number | null };
let stripe: { subs: Map<string, any>; invoices: Map<string, any>; charges: Map<string, any> };
let db: { rows: Map<string, Row>; grants: Set<string>; deletedCustomers: Set<string>; users: Set<string>; events: Map<string, any> };
let calls: { cancel: string[]; alerts: string[] };
const NOW = fx.T0 + 1000;
const isPro = (uid: string) => {
  const r = db.rows.get(uid);
  return !!r && (r.status === "comped" || (["active", "trialing"].includes(r.status) && (r.period_end ?? 0) > NOW));
};
const snap = (uid: string) => { const r = db.rows.get(uid); return r ? { is_pro: isPro(uid), status: r.status } : null; };
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function deps(): WebhookDeps {
  return {
    retrieveSubscription: async (id) => ({ ...stripe.subs.get(id) }),
    retrieveInvoice: async (id) => ({ ...stripe.invoices.get(id) }),
    retrieveCharge: async (id) => ({ ...stripe.charges.get(id) }),
    invoiceForPaymentIntent: async (pi) => [...stripe.invoices.values()].find((i) => i.payment_intent === pi)?.id ?? null,
    cancelSubscriptionNow: async (id) => { calls.cancel.push(id); const s = stripe.subs.get(id); if (s) s.status = "canceled"; },
    applySubscription: async (a) => {
      const uid = a._user_id ?? [...db.rows.values()].find((r) => r.cus === a._customer_id)?.user_id ?? null;
      if (!uid) return { data: { applied: false, reason: "unknown_user" }, error: null };
      if (!db.users.has(uid)) return { data: { applied: false, reason: "user_not_found" }, error: null };
      const row = db.rows.get(uid);
      const ev = sec(a._event_created);
      if (row?.status === "comped") return { data: { applied: false, reason: "comped", user_id: uid }, error: null };
      if (row && row.sub === a._subscription_id && row.event_created && ev < row.event_created)
        return { data: { applied: false, reason: "stale_event", user_id: uid }, error: null };
      db.rows.set(uid, { user_id: uid, status: a._status, sub: a._subscription_id, cus: a._customer_id, period_end: a._current_period_end ? sec(a._current_period_end) : null, event_created: Math.max(ev, row?.event_created ?? 0) });
      return { data: { applied: true, reason: "applied", user_id: uid }, error: null };
    },
    revokePaidAccess: async (a) => {
      const row = [...db.rows.values()].find((r) => r.sub === a._subscription_id);
      if (!row) {
        const other = [...db.rows.values()].find((r) => r.cus === a._customer_id);
        return { data: other ? { applied: false, reason: "other_entitlement", user_id: other.user_id } : { applied: false, reason: "no_row" }, error: null };
      }
      const before = snap(row.user_id);
      if (row.status === "comped") return { data: { applied: false, reason: "comped", user_id: row.user_id, before, after: before }, error: null };
      const ev = sec(a._event_created);
      if (db.grants.has(row.user_id)) row.status = "comped"; else { row.status = "canceled"; row.period_end = NOW - 1; }
      row.event_created = Math.max(row.event_created ?? 0, ev);
      return { data: { applied: true, reason: row.status === "comped" ? "kept_comped_grant" : "revoked", user_id: row.user_id, before, after: snap(row.user_id) }, error: null };
    },
    accessSnapshot: async (uid) => ({ data: snap(uid), error: null }),
    findPaymentEvent: async (id) => ({ data: db.events.get(id) ?? null, error: null }),
    logPaymentEvent: async (row) => { if (!db.events.has(row.event_id)) db.events.set(row.event_id, row); return { error: null }; },
    isDeletedCustomer: async (c) => db.deletedCustomers.has(c),
    alertAdmins: async (a) => { calls.alerts.push(a.key); return "campana"; },
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  stripe = { subs: new Map([["sub_1QTest", fx.subscription()]]), invoices: new Map([["in_1QLatest", fx.invoice()]]), charges: new Map([["ch_3QTest", fx.charge()]]) };
  db = {
    rows: new Map([["u-pago", { user_id: "u-pago", status: "active", sub: "sub_1QTest", cus: "cus_RTest", period_end: fx.T0 + 29 * 86400, event_created: fx.T0 }]]),
    grants: new Set(), deletedCustomers: new Set(), users: new Set(["u-pago"]), events: new Map(),
  };
  calls = { cancel: [], alerts: [] };
});

describe("reembolsos y disputas (política sec2-b)", () => {
  it("fixtures con la forma de la versión de API del endpoint", () => {
    expect(fx.chargeRefunded().api_version).toBe("2024-12-18.acacia");
    expect(fx.chargeRefunded().data.object).toMatchObject({ object: "charge", refunded: true, invoice: "in_1QLatest" });
    expect(fx.disputeClosed("lost").data.object).toMatchObject({ object: "dispute", status: "lost", charge: "ch_3QTest" });
  });

  it("reembolso total sin otro derecho: cancela YA en Stripe y queda sin acceso", async () => {
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(out).toEqual({ status: 200, body: { received: true, action: "reembolso_total_revocado" } });
    expect(calls.cancel).toEqual(["sub_1QTest"]);
    expect(isPro("u-pago")).toBe(false);
    expect(db.events.get("evt_refund_1")).toMatchObject({
      type: "charge.refunded", charge_id: "ch_3QTest", invoice_id: "in_1QLatest", subscription_id: "sub_1QTest",
      account_id: "u-pago", before_state: { is_pro: true }, after_state: { is_pro: false }, action: "reembolso_total_revocado",
    });
    expect(JSON.stringify(db.events.get("evt_refund_1"))).not.toMatch(/@/);
  });

  it("reembolso total con cortesía autorizada: conserva el acceso (y Stripe ya no cobra)", async () => {
    db.grants.add("u-pago");
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(out.body.action).toBe("reembolso_total_conserva_cortesia");
    expect(isPro("u-pago")).toBe(true);
    expect(calls.cancel).toEqual(["sub_1QTest"]);
  });

  it("reembolso total de otra suscripción mientras vive de otra (o de una prueba): conserva", async () => {
    db.rows.set("u-pago", { ...db.rows.get("u-pago")!, sub: "sub_OTRA" });
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(out.body.action).toBe("reembolso_total_conserva_otro_derecho");
    expect(isPro("u-pago")).toBe(true);
  });

  it("reembolso parcial: conserva el acceso y queda para revisión", async () => {
    stripe.charges.set("ch_3QTest", fx.charge({ amount_refunded: 3000, refunded: false }));
    const out = await handleStripeEvent(fx.chargeRefunded({ amount_refunded: 3000, refunded: false }), deps());
    expect(out.body.action).toBe("reembolso_parcial_conserva_revision");
    expect(calls.cancel).toEqual([]);
    expect(isPro("u-pago")).toBe(true);
  });

  it("reembolso total de una factura anterior: no revoca el periodo vigente", async () => {
    stripe.subs.set("sub_1QTest", fx.subscription({ latest_invoice: "in_NUEVA" }));
    const out = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(out.body.action).toBe("reembolso_total_factura_anterior_revision");
    expect(isPro("u-pago")).toBe(true);
  });

  it("cargo sin invoice (API basil): se encuentra la factura por payment_intent", async () => {
    const out = await handleStripeEvent(fx.chargeRefunded({ invoice: null }), deps());
    expect(out.body.action).toBe("reembolso_total_revocado");
  });

  it("disputa abierta: registra y avisa a administradores, sin cancelar", async () => {
    const out = await handleStripeEvent(fx.disputeCreated(), deps());
    expect(out.body.action).toBe("disputa_abierta_aviso");
    expect(calls.alerts).toEqual(["stripe:evt_dispute_open"]);
    expect(calls.cancel).toEqual([]);
    expect(isPro("u-pago")).toBe(true);
    expect(db.events.get("evt_dispute_open")).toMatchObject({ dispute_id: "dp_1QTest", dispute_reason: "fraudulent", alert_status: "campana" });
  });

  it("disputa perdida: revoca salvo otro derecho y avisa", async () => {
    const out = await handleStripeEvent(fx.disputeClosed("lost"), deps());
    expect(out.body.action).toBe("disputa_perdida_revocado");
    expect(isPro("u-pago")).toBe(false);
    expect(calls.alerts).toEqual(["stripe:evt_dispute_lost"]);
  });

  it("disputa ganada: re-lee la suscripción en Stripe y escribe su estado real", async () => {
    db.rows.get("u-pago")!.status = "past_due";
    const out = await handleStripeEvent(fx.disputeClosed("won"), deps());
    expect(out.body.action).toBe("disputa_ganada_estado_stripe");
    expect(db.rows.get("u-pago")!.status).toBe("active");
    expect(calls.cancel).toEqual([]);
  });

  it("evento duplicado: la segunda entrega no repite nada", async () => {
    const d = deps();
    await handleStripeEvent(fx.disputeClosed("lost"), d);
    const second = await handleStripeEvent(fx.disputeClosed("lost"), d);
    expect(second.body).toMatchObject({ duplicate: true, action: "disputa_perdida_revocado" });
    expect(calls.cancel).toHaveLength(1);
    expect(calls.alerts).toHaveLength(1);
  });

  it("fuera de orden: el reembolso llega antes que el invoice.paid viejo; no regresa el PRO", async () => {
    await handleStripeEvent(fx.chargeRefunded(), deps());
    const late = await handleStripeEvent(fx.invoicePaid("evt_invoice_paid_tarde", fx.T0), deps());
    expect(late.status).toBe(200);
    expect(isPro("u-pago")).toBe(false);
    // Aunque Stripe mandara después un subscription.updated, el estado vivo ya es 'canceled'.
    await handleStripeEvent(fx.subscriptionUpdated(), deps());
    expect(isPro("u-pago")).toBe(false);
  });

  it("webhook tardío tras borrar la cuenta: no recrea filas ni da acceso", async () => {
    db.rows.clear(); db.users.clear(); db.deletedCustomers.add("cus_RTest");
    const refund = await handleStripeEvent(fx.chargeRefunded(), deps());
    expect(refund.body.action).toBe("cuenta_eliminada_sin_cambios");
    expect(calls.cancel).toEqual(["sub_1QTest"]); // un cobro vivo se corta; nada más
    const upd = await handleStripeEvent(fx.subscriptionUpdated("evt_tarde_2"), deps());
    expect(upd.body).toEqual({ received: true, ignored: "cuenta_eliminada" });
    const paid = await handleStripeEvent(fx.invoicePaid("evt_tarde_3", fx.T0 + 500), deps());
    expect(paid.body).toEqual({ received: true, ignored: "cuenta_eliminada" });
    expect(db.rows.size).toBe(0);
  });

  it("si falta una dependencia o la base falla, 500 para que Stripe reintente", async () => {
    const d = deps();
    delete (d as any).revokePaidAccess;
    expect((await handleStripeEvent(fx.chargeRefunded(), d)).status).toBe(500);
    const d2 = deps();
    d2.logPaymentEvent = async () => ({ error: { message: "db down" } });
    expect((await handleStripeEvent(fx.disputeCreated(), d2)).status).toBe(500);
  });
});
