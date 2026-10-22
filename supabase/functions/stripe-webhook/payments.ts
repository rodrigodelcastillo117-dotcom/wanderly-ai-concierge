// Reembolsos y disputas de Stripe (decisión del dueño, ronda sec2-b). Sin Deno ni SDK: Stripe y la
// base se inyectan (index.ts) y todo se prueba con Vitest (src/test/stripePayments.test.ts).
//
// Política:
//   charge.refunded total      → se revoca el acceso que pagó ese cargo (si es la factura vigente
//                                de la suscripción), salvo otro derecho válido: cortesía, otra
//                                suscripción viva o prueba vigente. La suscripción se cancela YA en
//                                Stripe para que no vuelva a cobrar sin dar acceso.
//   charge.refunded parcial    → se conserva el acceso; queda registrado para revisión.
//   charge.dispute.created     → se registra y se avisa a los administradores; no se cancela.
//   charge.dispute.closed lost → igual que un reembolso total (y aviso a administradores).
//   charge.dispute.closed won  → se vuelve a leer la suscripción en Stripe y se escribe su estado real.
// Garantías:
//   * Idempotencia: si el event_id ya está en stripe_payment_events, no se hace nada otra vez. El
//     registro se escribe AL FINAL y en la misma transacción que la antigüedad (AUD-05): un 500
//     nunca deja el evento "hecho" con efectos pendientes, y el reintento repite pasos idempotentes.
//   * Fuera de orden: la decisión usa el estado VIVO de Stripe (factura vigente de la suscripción) y
//     revoke_paid_access sube stripe_event_created, así un invoice.paid viejo que llegue después del
//     reembolso se ignora ('stale_event'); además la suscripción ya está cancelada en Stripe.
//   * Cuenta borrada: si el cliente de Stripe es de una cuenta eliminada, no se escribe ni se otorga
//     nada (solo se cancela en Stripe lo que siguiera vivo, para no cobrar sin cuenta).
//   * Nunca da PRO: las únicas escrituras son revoke_paid_access (solo quita) y, en una disputa
//     ganada, apply_stripe_subscription con el estado real de Stripe.
//   * Trazabilidad sin datos personales: ids de Stripe, montos, decisión y estado antes/después.

import type { ApplyArgs, StripeEventLike, StripeInvoiceLike, StripeSubscriptionLike, WebhookOutcome } from "./handler.ts";
import { tenureEventFor, type TenureEvent } from "../_shared/prive-tenure.ts";
import { alertDelivered } from "./alerts.ts";

export type StripeChargeLike = {
  id: string;
  amount?: number | null;
  amount_refunded?: number | null;
  refunded?: boolean | null;
  currency?: string | null;
  customer?: string | { id: string } | null;
  invoice?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
};

export type StripeDisputeLike = {
  id: string;
  charge?: string | { id: string } | null;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
  status?: string | null;
};

/** Fila de public.stripe_payment_events (sin datos personales). */
export type PaymentEventRow = {
  event_id: string;
  type: string;
  charge_id: string | null;
  invoice_id: string | null;
  subscription_id: string | null;
  customer_id: string | null;
  dispute_id: string | null;
  account_id: string | null;
  amount: number | null;
  amount_refunded: number | null;
  currency: string | null;
  dispute_reason: string | null;
  dispute_status: string | null;
  action: string;
  before_state: unknown;
  after_state: unknown;
  alert_status: string | null;
  event_created: string;
};

export type RevokeArgs = { _subscription_id: string; _customer_id: string | null; _event_created: string; _reason: string };
export type RevokeResult = { applied: boolean; reason: string; user_id?: string; before?: unknown; after?: unknown };
type DbResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type AdminAlert = { key: string; title: string; body: string };

export interface PaymentDeps {
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  retrieveInvoice(id: string): Promise<StripeInvoiceLike>;
  retrieveCharge(id: string): Promise<StripeChargeLike>;
  /** Factura de un PaymentIntent (versiones de API donde el cargo ya no trae `invoice`). */
  invoiceForPaymentIntent?(paymentIntentId: string): Promise<string | null>;
  /** Cancela YA la suscripción en Stripe; "ya cancelada / no existe" no es error. */
  cancelSubscriptionNow(id: string): Promise<void>;
  applySubscription(args: ApplyArgs): DbResult;
  revokePaidAccess(args: RevokeArgs): DbResult;
  accessSnapshot(userId: string): DbResult;
  findPaymentEvent(eventId: string): PromiseLike<{ data: { action?: string } | null; error: { message: string } | null }>;
  logPaymentEvent(row: PaymentEventRow): PromiseLike<{ error: { message: string } | null }>;
  isDeletedCustomer(customerId: string): Promise<boolean>;
  /** Campana de administradores + correo si está configurado. Nunca lanza. */
  alertAdmins(alert: AdminAlert): Promise<string>;
  /** IATOS Privé: el periodo de esa factura deja de contar (o vuelve a contar) para la antigüedad. Opcional. */
  markPaidPeriod?(args: { _invoice_id: string; _event: TenureEvent; _amount_refunded: number | null }): DbResult;
  /**
   * AUD-05: último paso en UNA transacción (stripe_commit_payment_event): guarda la decisión con
   * event_id como llave y ajusta la antigüedad de la factura. Si existe, sustituye a
   * markPaidPeriod + logPaymentEvent (que quedan para compatibilidad).
   */
  commitPaymentEvent?(row: PaymentEventRow, tenureEvent: TenureEvent | null, amountRefunded: number | null): DbResult;
}

/** Resultado de stripe_commit_payment_event. */
export type CommitResult = { logged?: boolean; duplicate?: boolean; action?: string | null; tenure?: { applied?: boolean; reason?: string; after?: string } | null };

export const PAYMENT_EVENTS = new Set(["charge.refunded", "charge.dispute.created", "charge.dispute.closed"]);

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

function subscriptionIdOfInvoice(inv: StripeInvoiceLike): string | null {
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription) ??
    inv.lines?.data?.map((l) => idOf(l.subscription) ?? l.parent?.subscription_item_details?.subscription ?? null)
      .find(Boolean) ?? null;
}

type PaymentContext = {
  charge: StripeChargeLike;
  invoiceId: string | null;
  subscriptionId: string | null;
  subscription: StripeSubscriptionLike | null;
  customerId: string | null;
  /** ¿El cargo pagó la factura VIGENTE de la suscripción (según Stripe ahora)? */
  isLatestInvoice: boolean;
};

async function resolveContext(deps: PaymentDeps, charge: StripeChargeLike): Promise<PaymentContext> {
  let invoiceId = idOf(charge.invoice);
  const pi = idOf(charge.payment_intent);
  if (!invoiceId && pi && deps.invoiceForPaymentIntent) invoiceId = await deps.invoiceForPaymentIntent(pi);
  const subscriptionId = invoiceId ? subscriptionIdOfInvoice(await deps.retrieveInvoice(invoiceId)) : null;
  const subscription = subscriptionId ? await deps.retrieveSubscription(subscriptionId) : null;
  return {
    charge,
    invoiceId,
    subscriptionId,
    subscription,
    customerId: idOf(charge.customer) ?? idOf(subscription?.customer ?? null),
    isLatestInvoice: !!invoiceId && idOf(subscription?.latest_invoice ?? null) === invoiceId,
  };
}

const iso = (s: number) => new Date(s * 1000).toISOString();

type Decision = { action: string; accountId: string | null; before: unknown; after: unknown };

/** Revoca el acceso pagado por el cargo (reembolso total o disputa perdida). */
async function revokeForPayment(deps: PaymentDeps, ctx: PaymentContext, event: StripeEventLike, prefix: string): Promise<Decision> {
  if (!ctx.subscriptionId || !ctx.subscription) return { action: `${prefix}_sin_suscripcion`, accountId: null, before: null, after: null };
  if (!ctx.isLatestInvoice) {
    // El cargo pagó un periodo anterior: el acceso de hoy lo pagó otra factura. Se registra.
    return { action: `${prefix}_factura_anterior_revision`, accountId: null, before: null, after: null };
  }
  if (LIVE.has(ctx.subscription.status)) await deps.cancelSubscriptionNow(ctx.subscriptionId);
  const { data, error } = await deps.revokePaidAccess({
    _subscription_id: ctx.subscriptionId,
    _customer_id: ctx.customerId,
    _event_created: iso(event.created),
    _reason: event.type,
  });
  if (error) throw new Error(`revoke_paid_access falló (${event.id}): ${error.message}`);
  const r = (data ?? { applied: false, reason: "sin_respuesta" }) as RevokeResult;
  const action =
    r.applied && r.reason === "revoked" ? `${prefix}_revocado`
    : r.reason === "kept_comped_grant" || r.reason === "comped" ? `${prefix}_conserva_cortesia`
    : r.reason === "other_entitlement" ? `${prefix}_conserva_otro_derecho`
    : `${prefix}_sin_fila`;
  return { action, accountId: r.user_id ?? null, before: r.before ?? null, after: r.after ?? null };
}

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  return typeof amount === "number" ? `${(amount / 100).toFixed(2)} ${(currency ?? "").toUpperCase()}` : "monto desconocido";
}

export async function handlePaymentEvent(event: StripeEventLike, deps: PaymentDeps): Promise<WebhookOutcome> {
  // Idempotencia: un reintento o reenvío de Stripe no repite cancelaciones, avisos ni registros.
  const prev = await deps.findPaymentEvent(event.id);
  if (prev.error) throw new Error(`lectura de stripe_payment_events falló: ${prev.error.message}`);
  if (prev.data) return { status: 200, body: { received: true, duplicate: true, action: prev.data.action ?? null } };

  const isDispute = event.type.startsWith("charge.dispute.");
  const dispute = isDispute ? (event.data.object as StripeDisputeLike) : null;
  const charge = isDispute
    ? await deps.retrieveCharge(idOf(dispute!.charge) ?? "")
    : (event.data.object as StripeChargeLike);
  const ctx = await resolveContext(deps, charge);

  let decision: Decision = { action: "registrado", accountId: null, before: null, after: null };
  const fullRefund = event.type === "charge.refunded" && (charge.refunded === true ||
    (typeof charge.amount === "number" && charge.amount > 0 && typeof charge.amount_refunded === "number" && charge.amount_refunded >= charge.amount));
  let deletedCustomer = false;
  let alertStatus: string | null = null;

  if (ctx.customerId && await deps.isDeletedCustomer(ctx.customerId)) {
    deletedCustomer = true;
    // Cuenta eliminada: no se escribe ni se otorga nada. Solo se corta un cobro que siguiera vivo.
    if (ctx.subscription && ctx.subscriptionId && LIVE.has(ctx.subscription.status)) {
      await deps.cancelSubscriptionNow(ctx.subscriptionId);
    }
    decision = { action: "cuenta_eliminada_sin_cambios", accountId: null, before: null, after: null };
  } else if (event.type === "charge.refunded") {
    decision = fullRefund
      ? await revokeForPayment(deps, ctx, event, "reembolso_total")
      : { action: "reembolso_parcial_conserva_revision", accountId: null, before: null, after: null };
  } else if (event.type === "charge.dispute.created") {
    decision = { action: "disputa_abierta_aviso", accountId: null, before: null, after: null };
    alertStatus = await deps.alertAdmins({
      key: `stripe:${event.id}`,
      title: "Disputa abierta en Stripe",
      body: `Disputa ${dispute!.id} por ${money(dispute!.amount, dispute!.currency)} (motivo: ${dispute!.reason ?? "n/d"}). ` +
        "Revisa la evidencia en Stripe; el acceso no se canceló.",
    });
  } else if (event.type === "charge.dispute.closed") {
    const status = dispute!.status ?? "";
    if (status === "lost") {
      decision = await revokeForPayment(deps, ctx, event, "disputa_perdida");
      alertStatus = await deps.alertAdmins({
        key: `stripe:${event.id}`,
        title: "Disputa perdida en Stripe",
        body: `Disputa ${dispute!.id} perdida (${money(dispute!.amount, dispute!.currency)}). Decisión: ${decision.action}.`,
      });
    } else if (status === "won" && ctx.subscription) {
      // Se re-lee la suscripción (estado real) y se escribe por la vía normal, con su candado y orden.
      const sub = await deps.retrieveSubscription(ctx.subscription.id);
      const { data, error } = await deps.applySubscription(subscriptionArgsFor(sub, event.created));
      if (error) throw new Error(`apply_stripe_subscription falló (${event.id}): ${error.message}`);
      const r = (data ?? {}) as { applied?: boolean; reason?: string; user_id?: string };
      let after: unknown = null;
      if (r.user_id) after = (await deps.accessSnapshot(r.user_id)).data ?? null;
      decision = { action: `disputa_ganada_${r.applied ? "estado_stripe" : r.reason ?? "sin_cambio"}`, accountId: r.user_id ?? null, before: null, after };
    } else {
      decision = { action: `disputa_cerrada_${status || "sin_estado"}_registrada`, accountId: null, before: null, after: null };
    }
  }

  // AUD-05: en una disputa el aviso a administradores ES el efecto obligatorio (hay plazo para
  // responder en Stripe). Si la campana no se pudo guardar, no se marca el evento como hecho: 500 y
  // Stripe reintenta (el aviso lleva llave por evento, así que el reintento no lo duplica).
  // D-P3-3: "sin_destinatarios" (no hay administradores ni correo de alerta) tampoco es un aviso.
  if (isDispute && alertStatus !== null && !alertDelivered(alertStatus)) {
    throw new Error(`aviso a administradores falló (${event.id}); se reintentará`);
  }

  // Antigüedad de Privé: el periodo pagado por ESA factura deja de contar (reembolso total, disputa
  // abierta o perdida) o vuelve a contar (disputa ganada), aunque no sea la factura vigente.
  let tenure: string | null = null;
  const tenureEvent = tenureEventFor(event.type, { fullRefund, disputeStatus: dispute?.status ?? null });
  const row: PaymentEventRow = {
    event_id: event.id,
    type: event.type,
    charge_id: charge.id ?? null,
    invoice_id: ctx.invoiceId,
    subscription_id: ctx.subscriptionId,
    customer_id: ctx.customerId,
    dispute_id: dispute?.id ?? null,
    account_id: decision.accountId,
    amount: isDispute ? dispute!.amount ?? null : charge.amount ?? null,
    amount_refunded: charge.amount_refunded ?? null,
    currency: (isDispute ? dispute!.currency : charge.currency) ?? null,
    dispute_reason: dispute?.reason ?? null,
    dispute_status: dispute?.status ?? null,
    action: decision.action,
    before_state: decision.before,
    after_state: decision.after,
    alert_status: alertStatus,
    event_created: iso(event.created),
  };
  const tenureFor = deletedCustomer ? null : tenureEvent;

  if (deps.commitPaymentEvent) {
    // Registro + antigüedad en una sola transacción, con candado por factura: un invoice.paid que se
    // registre al mismo tiempo, antes o después, siempre ve la decisión (ver la migración 20261024051500).
    const { data, error } = await deps.commitPaymentEvent(row, tenureFor, charge.amount_refunded ?? null);
    if (error) throw new Error(`stripe_commit_payment_event falló (${event.id}): ${error.message}`);
    const r = (data ?? {}) as CommitResult;
    if (r.duplicate) return { status: 200, body: { received: true, duplicate: true, action: r.action ?? null } };
    if (tenureFor && ctx.invoiceId && r.tenure) {
      tenure = r.tenure.after ? `${tenureFor}:${r.tenure.after}` : (r.tenure.reason ?? tenureFor);
    }
  } else {
    if (deps.markPaidPeriod && ctx.invoiceId && tenureFor) {
      const m = await deps.markPaidPeriod({ _invoice_id: ctx.invoiceId, _event: tenureFor, _amount_refunded: charge.amount_refunded ?? null });
      if (m.error) throw new Error(`prive_mark_paid_period falló (${event.id}): ${m.error.message}`);
      const r = (m.data ?? {}) as { applied?: boolean; reason?: string; after?: string };
      tenure = r.after ? `${tenureFor}:${r.after}` : (r.reason ?? tenureFor);
    }
    const { error } = await deps.logPaymentEvent(row);
    if (error) throw new Error(`stripe_payment_events falló (${event.id}): ${error.message}`);
  }
  // Sin datos personales: ids de Stripe y la decisión.
  console.warn("webhook: pago", event.type, event.id, charge.id, decision.action);
  return { status: 200, body: { received: true, action: decision.action, ...(tenure ? { tenure } : {}) } };
}

// Copia local de subscriptionArgs (evita un import circular con handler.ts).
function subscriptionArgsFor(sub: StripeSubscriptionLike, eventCreated: number): ApplyArgs {
  const item = sub.items?.data?.[0];
  const ts = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null);
  return {
    _user_id: sub.metadata?.supabase_user_id || null,
    _customer_id: idOf(sub.customer),
    _subscription_id: sub.id,
    _status: sub.status,
    _trial_end: ts(sub.trial_end),
    _current_period_end: ts(sub.current_period_end ?? item?.current_period_end),
    _cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    _price_id: item?.price?.id ?? null,
    _currency: (sub.currency ?? "mxn").toUpperCase(),
    _event_created: iso(eventCreated),
  };
}
