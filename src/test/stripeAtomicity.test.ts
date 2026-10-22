// AUD-05 · Atomicidad e idempotencia del webhook de Stripe (auditoría de cierre 2026-10-22).
//
// Mundo en memoria: "Stripe" (suscripciones, facturas, cargos) y "base" (subscriptions,
// pro_paid_periods, stripe_payment_events, avisos) con las MISMAS reglas que las funciones SQL
// (apply_stripe_subscription, revoke_paid_access, prive_record_paid_period, prive_mark_paid_period
// y stripe_commit_payment_event de 20261024051500_aud_pagos_payment_event_atomic.sql). Las funciones
// SQL reales se prueban en supabase/tests/payments/stripe_events.sql (+ concurrencia en run.sh).
//
// Cada dependencia puede fallar a propósito (red de Stripe → excepción; base → { error }) para
// comprobar: (1) la respuesta es 500 mientras falte un efecto obligatorio, (2) el reintento de Stripe
// converge al MISMO estado final que una corrida limpia, (3) nunca hay efectos dobles (cancelaciones,
// avisos, periodos pagados, filas del registro).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStripeEvent, type StripeEventLike, type WebhookDeps } from "../../supabase/functions/stripe-webhook/handler";

const DAY = 86400;
const T = 1_800_000_000; // segundos
const USER = "u-aud";
const CUS = "cus_aud";
const SUB = "sub_aud";
const INV1 = "in_aud_1";
const CH1 = "ch_aud_1";

type SubRow = { user_id: string; status: string; sub: string | null; cus: string | null; period_end: number | null; cancel_at_period_end: boolean; event_created: number | null };
type Period = { invoice: string; user_id: string; start: number; end: number; status: string; prior: string | null; amount_refunded: number };
type LogRow = Record<string, any>;

let now: number;
let stripe: { subs: Map<string, any>; invoices: Map<string, any>; charges: Map<string, any> };
let db: { rows: Map<string, SubRow>; users: Set<string>; grants: Set<string>; deleted: Set<string>; periods: Map<string, Period>; events: Map<string, LogRow>; bells: Set<string> };
let calls: { cancel: string[]; alertAttempts: string[] };
let fail: Record<string, number>;
let hooks: { beforeFinalize?: () => Promise<void> };

const sec = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
const isLive = (r: SubRow | undefined) =>
  !!r && !!r.sub && (r.status === "past_due" || (["active", "trialing"].includes(r.status) && (r.period_end == null || r.period_end > now)));
const isPro = (uid = USER) => {
  const r = db.rows.get(uid);
  return !!r && (r.status === "comped" || (r.status === "active" && (r.period_end == null || r.period_end > now)) ||
    (r.status === "trialing" && r.period_end != null && r.period_end > now));
};
const snap = (uid: string) => { const r = db.rows.get(uid); return r ? { is_pro: isPro(uid), status: r.status } : null; };
const tenureDays = (uid = USER) => {
  // Unión de periodos que cuentan (paid / partially_refunded), recortados a "ahora".
  const ranges = [...db.periods.values()].filter((p) => p.user_id === uid && ["paid", "partially_refunded"].includes(p.status))
    .map((p) => [p.start, Math.min(p.end, now)] as [number, number]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur: [number, number] | null = null;
  for (const r of ranges) {
    if (!cur || r[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [...r]; } else cur[1] = Math.max(cur[1], r[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.floor(total / DAY);
};

// ---------------------------------------------------------------- fallas inyectadas
const DB_ERR = { message: "db down (inyectado)" };
function gate(name: string): boolean {
  if ((fail[name] ?? 0) > 0) { fail[name]--; return true; }
  return false;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- base (mismas reglas que el SQL)
function markPeriod(invoice: string, event: string, amountRefunded: number | null) {
  const p = db.periods.get(invoice);
  if (!p) return { applied: false, reason: "no_period" };
  const before = p.status;
  let after = p.status; let prior = p.prior;
  if (event === "refund_full") { after = "refunded"; prior = null; }
  else if (event === "refund_partial") { if (["paid", "partially_refunded"].includes(p.status)) after = "partially_refunded"; else if (p.status === "disputed") prior = "partially_refunded"; }
  else if (event === "dispute_opened") { if (["paid", "partially_refunded"].includes(p.status)) { prior = p.status; after = "disputed"; } }
  else if (event === "dispute_lost") { if (p.status !== "refunded") { after = "dispute_lost"; prior = null; } }
  else if (event === "dispute_won") { if (p.status === "disputed") { after = p.prior ?? "paid"; prior = null; } }
  p.status = after; p.prior = prior; p.amount_refunded = Math.max(p.amount_refunded, amountRefunded ?? 0);
  return { applied: before !== after, before, after };
}
function tenureEventOfLog(e: LogRow): string | null {
  if (e.type === "charge.refunded") return String(e.action).startsWith("reembolso_total") ? "refund_full" : "refund_partial";
  if (e.type === "charge.dispute.created") return "dispute_opened";
  if (e.type === "charge.dispute.closed") return e.dispute_status === "lost" ? "dispute_lost" : ["won", "warning_closed"].includes(e.dispute_status) ? "dispute_won" : null;
  return null;
}
const disputeClosedLogged = (disputeId: string | null) =>
  !!disputeId && [...db.events.values()].some((e) => e.type === "charge.dispute.closed" && e.dispute_id === disputeId);

function deps(): WebhookDeps {
  const stripeCall = <T>(name: string, f: () => T) => async () => { await tick(); if (gate(name)) throw new Error(`${name}: red caída (inyectado)`); return f(); };
  return {
    retrieveSubscription: (id) => stripeCall("retrieveSubscription", () => structuredClone(stripe.subs.get(id)))(),
    retrieveInvoice: (id) => stripeCall("retrieveInvoice", () => structuredClone(stripe.invoices.get(id)))(),
    retrieveCharge: (id) => stripeCall("retrieveCharge", () => structuredClone(stripe.charges.get(id)))(),
    cancelSubscriptionNow: (id) => stripeCall("cancelSubscriptionNow", () => {
      calls.cancel.push(id);
      const s = stripe.subs.get(id); if (s) s.status = "canceled"; // "ya cancelada" no es error
    })(),
    applySubscription: async (a) => {
      await tick();
      if (gate("applySubscription")) return { data: null, error: DB_ERR };
      const uid = a._user_id ?? [...db.rows.values()].find((r) => r.cus === a._customer_id)?.user_id ?? null;
      if (!uid) return { data: { applied: false, reason: "unknown_user" }, error: null };
      if (!db.users.has(uid)) return { data: { applied: false, reason: "user_not_found" }, error: null };
      const row = db.rows.get(uid);
      const ev = sec(a._event_created)!;
      const end = sec(a._current_period_end);
      let status = a._status;
      const incomingLive = !!a._subscription_id && (status === "past_due" || (["active", "trialing"].includes(status) && (end == null || end > now)));
      if (!incomingLive && db.grants.has(uid)) status = "comped";
      if (row?.status === "comped") return { data: { applied: false, reason: "comped", user_id: uid }, error: null };
      if (row && row.sub !== a._subscription_id && isLive(row)) return { data: { applied: false, reason: "other_live_subscription", user_id: uid }, error: null };
      if (row && row.sub === a._subscription_id && row.event_created != null && ev < row.event_created)
        return { data: { applied: false, reason: "stale_event", user_id: uid }, error: null };
      db.rows.set(uid, {
        user_id: uid, status, sub: a._subscription_id, cus: a._customer_id ?? row?.cus ?? null,
        period_end: status === "comped" ? null : end, cancel_at_period_end: a._cancel_at_period_end,
        event_created: row && row.sub === a._subscription_id ? Math.max(row.event_created ?? 0, ev) : ev,
      });
      return { data: { applied: true, reason: "applied", user_id: uid, status }, error: null };
    },
    revokePaidAccess: async (a) => {
      await tick();
      if (gate("revokePaidAccess")) return { data: null, error: DB_ERR };
      const row = [...db.rows.values()].find((r) => r.sub === a._subscription_id);
      if (!row) {
        const other = [...db.rows.values()].find((r) => r.cus === a._customer_id);
        return { data: other ? { applied: false, reason: "other_entitlement", user_id: other.user_id } : { applied: false, reason: "no_row" }, error: null };
      }
      const before = snap(row.user_id);
      if (row.status === "comped") return { data: { applied: false, reason: "comped", user_id: row.user_id, before, after: before }, error: null };
      if (db.grants.has(row.user_id)) { row.status = "comped"; row.period_end = null; }
      else { row.status = "canceled"; row.period_end = Math.min(row.period_end ?? now, now); }
      row.cancel_at_period_end = false;
      row.event_created = Math.max(row.event_created ?? 0, sec(a._event_created)!);
      return { data: { applied: true, reason: row.status === "comped" ? "kept_comped_grant" : "revoked", user_id: row.user_id, before, after: snap(row.user_id) }, error: null };
    },
    accessSnapshot: async (uid) => ({ data: snap(uid), error: null }),
    recordPaidPeriod: async (a) => {
      await tick();
      if (gate("recordPaidPeriod")) return { data: null, error: DB_ERR };
      let uid: string | null = a._user && db.users.has(a._user) ? a._user : null;
      uid ??= [...db.rows.values()].find((r) => r.sub === a._subscription_id)?.user_id ?? null;
      uid ??= [...db.rows.values()].find((r) => r.cus === a._customer_id)?.user_id ?? null;
      if (!uid || !db.users.has(uid)) return { data: { recorded: false, reason: "unknown_user" }, error: null };
      const existing = db.periods.get(a._invoice_id);
      if (existing && existing.user_id !== uid) return { data: { recorded: false, reason: "invoice_belongs_to_other_account" }, error: null };
      if (existing) { existing.start = sec(a._period_start)!; existing.end = sec(a._period_end)!; return { data: { recorded: true, inserted: false }, error: null }; }
      db.periods.set(a._invoice_id, { invoice: a._invoice_id, user_id: uid, start: sec(a._period_start)!, end: sec(a._period_end)!, status: "paid", prior: null, amount_refunded: 0 });
      // Al insertar, se reaplican los reembolsos/disputas YA registrados de esa factura (orden de Stripe).
      const logged = [...db.events.values()].filter((e) => e.invoice_id === a._invoice_id && !String(e.action).startsWith("cuenta_eliminada"))
        .sort((x, y) => Date.parse(x.event_created) - Date.parse(y.event_created));
      for (const e of logged) {
        const te = tenureEventOfLog(e);
        if (!te || (te === "dispute_opened" && disputeClosedLogged(e.dispute_id))) continue;
        markPeriod(a._invoice_id, te, e.amount_refunded ?? null);
      }
      return { data: { recorded: true, inserted: true }, error: null };
    },
    markPaidPeriod: async (a) => {
      await tick();
      if (gate("tenure")) return { data: null, error: DB_ERR };
      return { data: markPeriod(a._invoice_id, a._event, a._amount_refunded), error: null };
    },
    findPaymentEvent: async (id) => {
      await tick();
      if (gate("findPaymentEvent")) return { data: null, error: DB_ERR };
      return { data: db.events.get(id) ?? null, error: null };
    },
    logPaymentEvent: async (row) => {
      if (hooks.beforeFinalize) { const h = hooks.beforeFinalize; hooks.beforeFinalize = undefined; await h(); }
      await tick();
      if (gate("ledger")) return { error: DB_ERR };
      if (!db.events.has(row.event_id)) db.events.set(row.event_id, { ...row });
      return { error: null };
    },
    // Registro + antigüedad en UNA transacción con llave = event_id (stripe_commit_payment_event).
    commitPaymentEvent: async (row: LogRow, tenureEvent: string | null, amountRefunded: number | null) => {
      if (hooks.beforeFinalize) { const h = hooks.beforeFinalize; hooks.beforeFinalize = undefined; await h(); }
      await tick();
      // Una sola transacción: si falla el registro o la antigüedad, no queda ninguno de los dos.
      if (gate("tenure") || gate("ledger")) return { data: null, error: DB_ERR };
      const prev = db.events.get(row.event_id);
      if (prev) return { data: { logged: false, duplicate: true, action: prev.action }, error: null };
      db.events.set(row.event_id, { ...row });
      let tenure: unknown = null;
      if (tenureEvent && row.invoice_id) {
        tenure = tenureEvent === "dispute_opened" && disputeClosedLogged(row.dispute_id)
          ? { applied: false, reason: "dispute_already_closed" }
          : markPeriod(row.invoice_id, tenureEvent, amountRefunded);
      }
      return { data: { logged: true, duplicate: false, tenure }, error: null };
    },
    isDeletedCustomer: async (c) => { await tick(); if (gate("isDeletedCustomer")) throw new Error("db down (inyectado)"); return db.deleted.has(c); },
    alertAdmins: async (a) => {
      await tick();
      calls.alertAttempts.push(a.key);
      if (gate("alertAdmins")) return "fallido"; // la campana no se pudo guardar
      if (db.bells.has(a.key)) return "campana_ya_enviada";
      db.bells.add(a.key);
      return "campana";
    },
  } as WebhookDeps;
}

// ---------------------------------------------------------------- Stripe y eventos
const subObj = (o: Record<string, unknown> = {}) => ({
  id: SUB, status: "active", customer: CUS, currency: "mxn", cancel_at_period_end: false, trial_end: null,
  current_period_end: T + 30 * DAY, latest_invoice: INV1, metadata: { supabase_user_id: USER },
  items: { data: [{ current_period_end: T + 30 * DAY, price: { id: "price_pro_mxn" } }] }, ...o,
});
const invObj = (id = INV1, start = T, end = T + 30 * DAY, sub = SUB, amount = 9900) => ({
  id, status: "paid", amount_paid: amount, currency: "mxn", customer: CUS, subscription: sub,
  lines: { data: [{ amount, type: "subscription", subscription: sub, period: { start, end } }], has_more: false },
});
const chargeObj = (o: Record<string, unknown> = {}) => ({
  id: CH1, amount: 9900, amount_refunded: 9900, refunded: true, currency: "mxn", customer: CUS, invoice: INV1, payment_intent: "pi_aud_1", ...o,
});
const disputeObj = (status: string, o: Record<string, unknown> = {}) => ({ id: "dp_aud", charge: CH1, amount: 9900, currency: "mxn", reason: "fraudulent", status, ...o });
const ev = (id: string, type: string, created: number, object: unknown): StripeEventLike => ({ id, type, created, data: { object } });

const E = {
  checkout: (created = T + 1, id = "evt_checkout") => ev(id, "checkout.session.completed", created, { client_reference_id: USER, subscription: SUB, customer: CUS }),
  created: (created = T, id = "evt_sub_created") => ev(id, "customer.subscription.created", created, subObj({ status: "incomplete" })),
  updated: (created = T + 2, id = "evt_sub_updated") => ev(id, "customer.subscription.updated", created, subObj()),
  deleted: (created = T + 40 * DAY, id = "evt_sub_deleted") => ev(id, "customer.subscription.deleted", created, subObj({ status: "canceled" })),
  invoicePaid: (created = T + 3, id = "evt_inv_paid", inv = invObj()) => ev(id, "invoice.paid", created, inv),
  paymentSucceeded: (created = T + 3, id = "evt_inv_succeeded") => ev(id, "invoice.payment_succeeded", created, invObj()),
  refund: (created = T + 5 * DAY, id = "evt_refund", o: Record<string, unknown> = {}) => ev(id, "charge.refunded", created, chargeObj(o)),
  disputeOpen: (created = T + 6 * DAY, id = "evt_dp_open") => ev(id, "charge.dispute.created", created, disputeObj("needs_response")),
  disputeClosed: (status: string, created = T + 20 * DAY, id = `evt_dp_${status}`) => ev(id, "charge.dispute.closed", created, disputeObj(status)),
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  now = T + DAY;
  stripe = { subs: new Map([[SUB, subObj()]]), invoices: new Map([[INV1, invObj()]]), charges: new Map([[CH1, chargeObj({ amount_refunded: 0, refunded: false })]]) };
  // Fila que crea stripe-checkout antes de mandar a pagar (customer guardado, estado incompleto).
  db = { rows: new Map([[USER, { user_id: USER, status: "incomplete", sub: null, cus: CUS, period_end: null, cancel_at_period_end: false, event_created: null }]]),
    users: new Set([USER]), grants: new Set(), deleted: new Set(), periods: new Map(), events: new Map(), bells: new Set() };
  calls = { cancel: [], alertAttempts: [] };
  fail = {};
  hooks = {};
});

const run = (e: StripeEventLike) => handleStripeEvent(e, deps());
/** Entrega como Stripe: si responde algo que no es 2xx, reintenta (hasta 5 veces). */
async function deliver(e: StripeEventLike) {
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    const out = await run(e);
    statuses.push(out.status);
    if (out.status < 300) return { out, statuses };
  }
  throw new Error(`Stripe se rindió: ${statuses.join(",")}`);
}
const refundStripeSide = () => stripe.charges.set(CH1, chargeObj());
const state = () => ({
  row: db.rows.get(USER) && { ...db.rows.get(USER)!, event_created: undefined },
  pro: isPro(), periods: [...db.periods.values()].map((p) => `${p.invoice}:${p.status}`).sort(),
  events: [...db.events.values()].map((e) => `${e.event_id}:${e.action}`).sort(),
  bells: [...db.bells].sort(), stripeSub: stripe.subs.get(SUB)?.status,
});

// ================================================================ A. evento repetido / doble entrega
describe("AUD-05 A · evento repetido y doble entrega", () => {
  it("invoice.paid entregado dos veces: una fila, un periodo pagado, mismo estado", async () => {
    await run(E.invoicePaid());
    const first = state();
    const again = await run(E.invoicePaid());
    expect(again.status).toBe(200);
    expect(state()).toEqual(first);
    expect(db.periods.size).toBe(1);
    expect(isPro()).toBe(true);
  });

  it("invoice.paid + invoice.payment_succeeded de la MISMA factura: un solo periodo", async () => {
    await run(E.invoicePaid());
    await run(E.paymentSucceeded());
    expect([...db.periods.keys()]).toEqual([INV1]);
    expect(tenureDays()).toBe(1);
  });

  it("charge.refunded repetido: la segunda entrega es duplicado y no repite cancelación ni registro", async () => {
    await run(E.invoicePaid()); refundStripeSide();
    await run(E.refund());
    const first = state();
    const second = await run(E.refund());
    expect(second.body).toMatchObject({ duplicate: true });
    expect(state()).toEqual(first);
    expect(calls.cancel).toEqual([SUB]);
    expect(db.events.size).toBe(1);
  });

  it("disputa perdida repetida: un solo aviso y una sola revocación", async () => {
    await run(E.invoicePaid());
    await run(E.disputeClosed("lost"));
    await run(E.disputeClosed("lost"));
    expect([...db.bells]).toEqual(["stripe:evt_dp_lost"]);
    expect(calls.cancel).toEqual([SUB]);
    expect(isPro()).toBe(false);
  });
});

// ================================================================ B. entregas duplicadas simultáneas
describe("AUD-05 B · dos entregas del mismo evento al mismo tiempo", () => {
  it("invoice.paid × 2 en paralelo: una fila, un periodo", async () => {
    const [a, b] = await Promise.all([run(E.invoicePaid()), run(E.invoicePaid())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.rows.size).toBe(1);
    expect(db.periods.size).toBe(1);
    expect(isPro()).toBe(true);
  });

  it("charge.refunded × 2 en paralelo: un registro, periodo reembolsado, sin PRO; cancelar dos veces en Stripe es inocuo", async () => {
    await run(E.invoicePaid()); refundStripeSide();
    const [a, b] = await Promise.all([run(E.refund()), run(E.refund())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.events.size).toBe(1);
    expect(db.periods.get(INV1)!.status).toBe("refunded");
    expect(isPro()).toBe(false);
    expect(stripe.subs.get(SUB).status).toBe("canceled");
  });

  it("charge.dispute.created × 2 en paralelo: un aviso (llave por evento), periodo en disputa", async () => {
    await run(E.invoicePaid());
    await Promise.all([run(E.disputeOpen()), run(E.disputeOpen())]);
    expect([...db.bells]).toEqual(["stripe:evt_dp_open"]);
    expect(db.events.size).toBe(1);
    expect(db.periods.get(INV1)!.status).toBe("disputed");
    expect(isPro()).toBe(true); // una disputa abierta no cancela
  });
});

// ================================================================ C. eventos fuera de orden
describe("AUD-05 C · fuera de orden", () => {
  it("subscription.updated (nuevo) antes que subscription.created (viejo): queda el estado vivo", async () => {
    await run(E.updated());
    const late = await run(E.created());
    expect(late.status).toBe(200);
    expect(db.rows.get(USER)!.status).toBe("active");
    expect(isPro()).toBe(true);
  });

  it("invoice.paid antes que checkout.session.completed: PRO desde el invoice.paid, el checkout no duplica", async () => {
    await run(E.invoicePaid(T + 1));
    expect(isPro()).toBe(true);
    await run(E.checkout(T + 2));
    expect(db.rows.size).toBe(1);
    expect(db.periods.size).toBe(1);
    expect(isPro()).toBe(true);
  });

  it("suscripción sin metadata (creada fuera del checkout): se encuentra a la persona por su customer", async () => {
    stripe.subs.set(SUB, subObj({ metadata: {} }));
    await run(E.invoicePaid());
    expect(db.rows.get(USER)).toMatchObject({ status: "active", sub: SUB });
    expect(db.periods.get(INV1)?.user_id).toBe(USER);
  });

  it("invoice.paid viejo que llega DESPUÉS del reembolso: no regresa el PRO ni el periodo", async () => {
    await run(E.invoicePaid()); refundStripeSide();
    await run(E.refund());
    stripe.subs.get(SUB).status = "canceled";
    await run(E.invoicePaid(T + 3, "evt_inv_paid_reenviado"));
    expect(isPro()).toBe(false);
    expect(db.periods.get(INV1)!.status).toBe("refunded");
  });

  it("reembolso procesado ANTES de que se registre el periodo pagado: al registrarse nace 'refunded'", async () => {
    // (La regla vive en la base: prive_record_paid_period reaplica lo registrado; ver stripe_events.sql AP07.)
    await run(E.updated()); refundStripeSide();
    await run(E.refund());
    await run(E.invoicePaid());
    expect(db.periods.get(INV1)!.status).toBe("refunded");
    expect(tenureDays()).toBe(0);
  });

  it("carrera: el invoice.paid termina mientras el reembolso va entre sus efectos y su registro → el periodo queda 'refunded'", async () => {
    await run(E.updated()); refundStripeSide();
    hooks.beforeFinalize = async () => { await run(E.invoicePaid()); };
    const out = await run(E.refund());
    expect(out.status).toBe(200);
    expect(db.periods.get(INV1)!.status).toBe("refunded"); // antes: 'paid' (el reembolso contaba para Privé)
    expect(tenureDays()).toBe(0);
  });

  it("disputa cerrada (ganada) ANTES que su charge.dispute.created: el periodo no queda 'en disputa' para siempre", async () => {
    await run(E.invoicePaid());
    await run(E.disputeClosed("won"));
    const late = await run(E.disputeOpen());
    expect(late.status).toBe(200);
    expect(db.periods.get(INV1)!.status).toBe("paid"); // antes: 'disputed' y Privé perdía esos días
  });
});

// ================================================================ D. fallas parciales y reintento
describe("AUD-05 D · falla en cada paso → 500, y el reintento converge al estado de una corrida limpia", () => {
  async function cleanRun(prepare: () => Promise<void>, e: () => StripeEventLike) {
    await prepare();
    await run(e());
    return { state: state(), cancel: [...calls.cancel] };
  }
  async function reset() {
    now = T + DAY;
    stripe = { subs: new Map([[SUB, subObj()]]), invoices: new Map([[INV1, invObj()]]), charges: new Map([[CH1, chargeObj({ amount_refunded: 0, refunded: false })]]) };
    db = { rows: new Map([[USER, { user_id: USER, status: "incomplete", sub: null, cus: CUS, period_end: null, cancel_at_period_end: false, event_created: null }]]),
      users: new Set([USER]), grants: new Set(), deleted: new Set(), periods: new Map(), events: new Map(), bells: new Set() };
    calls = { cancel: [], alertAttempts: [] }; fail = {};
  }

  const invoiceSteps = ["retrieveSubscription", "applySubscription", "recordPaidPeriod"];
  it.each(invoiceSteps)("invoice.paid falla en %s", async (step) => {
    const clean = await cleanRun(async () => {}, () => E.invoicePaid());
    await reset();
    fail[step] = 1;
    const { statuses } = await deliver(E.invoicePaid());
    expect(statuses).toEqual([500, 200]);
    expect(state()).toEqual(clean.state);
    expect(db.periods.size).toBe(1);
  });

  it("invoice.paid sin renglones en el payload: si falla la lectura de la factura, 500 y luego converge", async () => {
    const thin = () => E.invoicePaid(T + 3, "evt_inv_thin", { id: INV1, subscription: SUB, customer: CUS } as any);
    const clean = await cleanRun(async () => {}, thin);
    await reset();
    fail.retrieveInvoice = 1;
    const { statuses } = await deliver(thin());
    expect(statuses).toEqual([500, 200]);
    expect(state()).toEqual(clean.state);
  });

  const refundSteps = ["findPaymentEvent", "retrieveInvoice", "retrieveSubscription", "isDeletedCustomer", "cancelSubscriptionNow",
    "revokePaidAccess", "tenure", "ledger"];
  it.each(refundSteps)("charge.refunded falla en %s", async (step) => {
    const prep = async () => { await run(E.invoicePaid()); refundStripeSide(); };
    const clean = await cleanRun(prep, () => E.refund());
    await reset(); await prep();
    fail[step] = 1;
    const { statuses } = await deliver(E.refund());
    expect(statuses).toEqual([500, 200]);
    expect(state()).toEqual(clean.state);
    expect(calls.cancel).toEqual([SUB]); // nunca dos cancelaciones (la 2a ve la suscripción ya cancelada)
    expect(db.events.size).toBe(1);
  });

  it("disputa perdida: si la campana de administradores no se guarda, 500 (Stripe reintenta) y luego un solo aviso", async () => {
    await run(E.invoicePaid());
    fail.alertAdmins = 1;
    const { statuses } = await deliver(E.disputeClosed("lost"));
    expect(statuses).toEqual([500, 200]); // antes: 200 y la disputa quedaba "registrada" sin aviso
    expect([...db.bells]).toEqual(["stripe:evt_dp_lost"]);
    expect(db.events.get("evt_dp_lost")).toMatchObject({ alert_status: "campana" });
    expect(isPro()).toBe(false);
  });

  it("disputa abierta: la campana fallida tampoco se marca como completa", async () => {
    await run(E.invoicePaid());
    fail.alertAdmins = 1;
    const first = await run(E.disputeOpen());
    expect(first.status).toBe(500);
    expect(db.events.has("evt_dp_open")).toBe(false);
    expect((await run(E.disputeOpen())).status).toBe(200);
    expect(db.periods.get(INV1)!.status).toBe("disputed");
  });

  it("un 500 nunca deja el evento registrado como hecho; un 200 siempre lo deja", async () => {
    await run(E.invoicePaid()); refundStripeSide();
    for (const step of refundSteps) {
      fail = { [step]: 1 };
      db.events.delete("evt_refund");
      const out = await run(E.refund());
      expect(out.status, step).toBe(500);
      expect(db.events.has("evt_refund"), step).toBe(false);
    }
    fail = {};
    expect((await run(E.refund())).status).toBe(200);
    expect(db.events.has("evt_refund")).toBe(true);
  });
});

// ================================================================ E. ciclo de vida
describe("AUD-05 E · cancelación programada, vencimiento, reactivación, suscripción duplicada", () => {
  it("cancel_at_period_end: conserva PRO hasta el fin del periodo; al borrarse la suscripción, sin PRO", async () => {
    await run(E.invoicePaid());
    stripe.subs.set(SUB, subObj({ cancel_at_period_end: true }));
    await run(E.updated(T + 2 * DAY, "evt_cancel_programada"));
    expect(db.rows.get(USER)).toMatchObject({ cancel_at_period_end: true, status: "active" });
    expect(isPro()).toBe(true);
    now = T + 31 * DAY;
    stripe.subs.set(SUB, subObj({ status: "canceled", cancel_at_period_end: true }));
    await run(E.deleted(T + 30 * DAY + 60));
    expect(isPro()).toBe(false);
    expect(tenureDays()).toBe(30); // el periodo pagado sí cuenta para Privé
  });

  it("periodo vencido sin renovación (Stripe no avisó): deja de ser PRO", async () => {
    await run(E.invoicePaid());
    now = T + 30 * DAY + 1;
    expect(isPro()).toBe(false);
  });

  it("reactivación (quitar la cancelación programada desde el portal): sigue PRO y sin la marca", async () => {
    await run(E.invoicePaid());
    stripe.subs.set(SUB, subObj({ cancel_at_period_end: true }));
    await run(E.updated(T + 2 * DAY, "evt_cancel_programada"));
    stripe.subs.set(SUB, subObj({ cancel_at_period_end: false }));
    await run(E.updated(T + 3 * DAY, "evt_reactivada"));
    expect(db.rows.get(USER)).toMatchObject({ cancel_at_period_end: false, status: "active" });
    expect(isPro()).toBe(true);
  });

  it("nueva suscripción tras una cancelada: se aplica (no es 'otra suscripción viva')", async () => {
    await run(E.invoicePaid());
    now = T + 31 * DAY;
    stripe.subs.set(SUB, subObj({ status: "canceled" }));
    await run(E.deleted(T + 30 * DAY + 60));
    stripe.subs.set("sub_aud_2", subObj({ id: "sub_aud_2", current_period_end: T + 61 * DAY, items: { data: [{ current_period_end: T + 61 * DAY }] } }));
    await run(ev("evt_checkout_2", "checkout.session.completed", T + 31 * DAY, { client_reference_id: USER, subscription: "sub_aud_2", customer: CUS }));
    expect(db.rows.get(USER)).toMatchObject({ sub: "sub_aud_2", status: "active" });
    expect(isPro()).toBe(true);
  });

  it("segunda suscripción pagada mientras la primera vive (dos checkouts): no se ignora en silencio, se avisa a administradores una vez", async () => {
    await run(E.invoicePaid());
    stripe.subs.set("sub_aud_dup", subObj({ id: "sub_aud_dup" }));
    const dupEvent = ev("evt_checkout_dup", "checkout.session.completed", T + 4, { client_reference_id: USER, subscription: "sub_aud_dup", customer: CUS });
    const out = await run(dupEvent);
    expect(out.status).toBe(200);
    expect(db.rows.get(USER)!.sub).toBe(SUB); // la fila sigue con la suscripción original
    expect([...db.bells]).toEqual(["stripe:dup_sub:sub_aud_dup"]); // antes: ningún aviso (cobro doble invisible)
    await run(ev("evt_dup_updated", "customer.subscription.updated", T + 5, subObj({ id: "sub_aud_dup" })));
    expect(db.bells.size).toBe(1);
  });

  it("mejora: una suscripción que cobra sin cuenta de IATOS (sin metadata ni cliente conocido) avisa a administradores", async () => {
    db.rows.clear();
    stripe.subs.set("sub_huerfana", subObj({ id: "sub_huerfana", customer: "cus_desconocido", metadata: {} }));
    const out = await run(ev("evt_huerfana", "customer.subscription.created", T, subObj({ id: "sub_huerfana" })));
    expect(out.body).toMatchObject({ applied: false, reason: "unknown_user" });
    expect([...db.bells]).toEqual(["stripe:unknown_user:sub_huerfana"]);
    // Una suscripción ya cancelada sin cuenta no cobra: no hay aviso.
    stripe.subs.set("sub_huerfana_2", subObj({ id: "sub_huerfana_2", customer: "cus_desconocido", metadata: {}, status: "canceled" }));
    await run(ev("evt_huerfana_2", "customer.subscription.updated", T, subObj({ id: "sub_huerfana_2" })));
    expect(db.bells.size).toBe(1);
  });
});
