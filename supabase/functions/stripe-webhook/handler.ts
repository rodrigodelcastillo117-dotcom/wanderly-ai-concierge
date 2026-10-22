// Lógica del webhook de Stripe sin dependencias de Deno ni del SDK (se prueba con Vitest).
// index.ts verifica la firma y le pasa el evento junto con las dependencias reales.
//
// Reglas:
// - El estado se toma SIEMPRE de Stripe en el momento (subscriptions.retrieve), no del payload del
//   evento: un evento viejo o reenviado no puede "regresar" una suscripción a un estado pasado.
// - La escritura la hace la función SQL apply_stripe_subscription con candado de fila: ignora eventos
//   más viejos que el último aplicado, nunca toca una fila 'comped' y no deja que una suscripción
//   vieja pise a otra viva.
// - Si la escritura en la base falla, se responde 500 para que Stripe REINTENTE (antes se respondía
//   200 y el cambio se perdía en silencio: alguien pagaba y seguía sin PRO).
// - charge.refunded / charge.dispute.created (A-14) se registran en stripe_payment_events y jamás
//   dan PRO; un reembolso total de la última factura deja la suscripción sin renovar.

export type StripeSubscriptionLike = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  currency?: string | null;
  latest_invoice?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ current_period_end?: number | null; price?: { id?: string | null } | null }> } | null;
};

export type StripeInvoiceLike = {
  id: string;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  lines?: { data?: Array<{ subscription?: string | { id: string } | null; parent?: { subscription_item_details?: { subscription?: string | null } | null } | null }> } | null;
};

export type StripeChargeLike = {
  id: string;
  amount?: number | null;
  amount_refunded?: number | null;
  refunded?: boolean | null;
  currency?: string | null;
  customer?: string | { id: string } | null;
  invoice?: string | { id: string } | null;
};

export type StripeDisputeLike = {
  id: string;
  charge?: string | { id: string } | null;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
  status?: string | null;
};

/** Fila de public.stripe_payment_events (sin datos personales: ids de Stripe y montos). */
export type PaymentEventRow = {
  event_id: string;
  type: string;
  charge_id: string | null;
  invoice_id: string | null;
  subscription_id: string | null;
  customer_id: string | null;
  amount: number | null;
  amount_refunded: number | null;
  currency: string | null;
  dispute_reason: string | null;
  dispute_status: string | null;
  action: string;
  event_created: string;
};

export type StripeEventLike = {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
};

export type ApplyArgs = {
  _user_id: string | null;
  _customer_id: string | null;
  _subscription_id: string;
  _status: string;
  _trial_end: string | null;
  _current_period_end: string | null;
  _cancel_at_period_end: boolean;
  _price_id: string | null;
  _currency: string;
  _event_created: string;
};

export type ApplyResult = { applied: boolean; reason: string; user_id?: string; status?: string };

export interface WebhookDeps {
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  retrieveInvoice(id: string): Promise<StripeInvoiceLike>;
  applySubscription(args: ApplyArgs): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // Reembolsos y disputas (A-14). Opcionales para no romper a quien solo maneja suscripciones; si
  // falta alguna y llega uno de esos eventos, se responde 500 (Stripe reintenta).
  /** Pide a Stripe que la suscripción no se renueve (cancel_at_period_end=true). */
  updateSubscription?(id: string, params: { cancel_at_period_end: true }): Promise<StripeSubscriptionLike>;
  /** RPC mark_subscription_cancel_at_period_end: solo marca la fila; nunca cambia status ni da PRO. */
  markCancelAtPeriodEnd?(subscriptionId: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** Inserta en stripe_payment_events (idempotente por event_id). */
  logPaymentEvent?(row: PaymentEventRow): PromiseLike<{ error: { message: string } | null }>;
}

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

export function tsToIso(v: number | null | undefined): string | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;
}

/** Traduce una suscripción de Stripe a los argumentos de apply_stripe_subscription. */
export function subscriptionArgs(
  sub: StripeSubscriptionLike,
  eventCreated: number,
  fallbackUserId: string | null = null,
): ApplyArgs {
  const item = sub.items?.data?.[0];
  return {
    _user_id: sub.metadata?.supabase_user_id || fallbackUserId || null,
    _customer_id: idOf(sub.customer),
    _subscription_id: sub.id,
    _status: sub.status,
    _trial_end: tsToIso(sub.trial_end),
    // Desde la API 2025-03-31 el periodo vive en cada item, no en la suscripción.
    _current_period_end: tsToIso(sub.current_period_end ?? item?.current_period_end),
    _cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    _price_id: item?.price?.id ?? null,
    _currency: (sub.currency ?? "mxn").toUpperCase(),
    _event_created: new Date(eventCreated * 1000).toISOString(),
  };
}

/** Id de la suscripción de una factura, en el formato viejo (invoice.subscription) o el nuevo (parent). */
export function invoiceSubscriptionId(inv: StripeInvoiceLike): string | null {
  return (
    idOf(inv.subscription) ??
    idOf(inv.parent?.subscription_details?.subscription) ??
    inv.lines?.data?.map((l) => idOf(l.subscription) ?? l.parent?.subscription_item_details?.subscription ?? null)
      .find(Boolean) ??
    null
  );
}

async function apply(deps: WebhookDeps, args: ApplyArgs, eventId: string): Promise<ApplyResult> {
  const { data, error } = await deps.applySubscription(args);
  if (error) {
    // Se propaga: el handler responde 500 y Stripe reintenta.
    throw new Error(`apply_stripe_subscription falló (${eventId}): ${error.message}`);
  }
  const r = (data ?? { applied: false, reason: "sin_respuesta" }) as ApplyResult;
  if (!r.applied) console.warn("webhook: evento no aplicado", eventId, args._subscription_id, r.reason);
  return r;
}

const ok = (r: ApplyResult): WebhookOutcome => ({
  status: 200,
  body: { received: true, applied: r.applied, reason: r.reason },
});

export async function handleStripeEvent(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookOutcome> {
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          client_reference_id?: string | null;
          metadata?: Record<string, string> | null;
          subscription?: string | { id: string } | null;
        };
        const userId = session.client_reference_id || session.metadata?.supabase_user_id || null;
        const subId = idOf(session.subscription);
        if (!subId) return { status: 200, body: { received: true, ignored: "sin_suscripcion" } };
        const sub = await deps.retrieveSubscription(subId);
        const r = await apply(deps, subscriptionArgs(sub, event.created, userId), event.id);
        return ok(r);
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const payload = event.data.object as StripeSubscriptionLike;
        const sub = await deps.retrieveSubscription(payload.id);
        const r = await apply(deps, subscriptionArgs(sub, event.created), event.id);
        return ok(r);
      }
      case "customer.subscription.deleted": {
        // Terminal: el payload basta (y la suscripción ya no cambiará).
        const sub = { ...(event.data.object as StripeSubscriptionLike), status: "canceled" };
        const r = await apply(deps, subscriptionArgs(sub, event.created), event.id);
        return ok(r);
      }
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        // Antes payment_failed ponía past_due a ciegas a toda fila del customer (aunque ya hubiera
        // pagado) y no había invoice.paid para salir de past_due. Ahora se escribe el estado real.
        const payload = event.data.object as StripeInvoiceLike;
        let subId = invoiceSubscriptionId(payload);
        if (!subId) subId = invoiceSubscriptionId(await deps.retrieveInvoice(payload.id));
        if (!subId) return { status: 200, body: { received: true, ignored: "factura_sin_suscripcion" } };
        const sub = await deps.retrieveSubscription(subId);
        const r = await apply(deps, subscriptionArgs(sub, event.created), event.id);
        return ok(r);
      }
      case "charge.refunded":
        return await handleRefund(event, deps);
      case "charge.dispute.created":
        return await handleDispute(event, deps);
      default:
        return { status: 200, body: { received: true, ignored: event.type } };
    }
  } catch (e) {
    console.error("webhook handler error:", event.type, event.id, (e as Error).message);
    return { status: 500, body: { error: "handler_failed" } };
  }
}

// Suscripción que todavía da acceso o cobrará: la única que tiene sentido marcar "no renovar".
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

async function logEvent(deps: WebhookDeps, row: PaymentEventRow): Promise<void> {
  if (!deps.logPaymentEvent) throw new Error("logPaymentEvent no configurado");
  const { error } = await deps.logPaymentEvent(row);
  if (error) throw new Error(`stripe_payment_events falló (${row.event_id}): ${error.message}`);
  // Sin datos personales: ids de Stripe, montos y la decisión.
  console.warn("webhook: pago revertido", row.type, row.event_id, row.charge_id, row.action);
}

/**
 * charge.refunded (A-14). Nunca da PRO: no llama a apply_stripe_subscription.
 * - Reembolso parcial, o de una factura que no es la última: solo se registra.
 * - Reembolso TOTAL de la última factura de la suscripción: se le pide a Stripe que no renueve
 *   (si sigue viva) y se marca cancel_at_period_end en la fila. El acceso dura hasta el fin del
 *   periodo según Stripe; el customer.subscription.updated que Stripe manda después sincroniza el
 *   estado completo por la vía normal. Quitar el acceso de inmediato es decisión del dueño.
 */
async function handleRefund(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookOutcome> {
  const ch = event.data.object as StripeChargeLike;
  const amount = typeof ch.amount === "number" ? ch.amount : null;
  const refundedAmount = typeof ch.amount_refunded === "number" ? ch.amount_refunded : null;
  const full = ch.refunded === true || (amount !== null && amount > 0 && refundedAmount !== null && refundedAmount >= amount);
  const invoiceId = idOf(ch.invoice);
  let subId: string | null = null;
  let action = full ? "refund_full_logged" : "refund_partial_logged";

  if (full && invoiceId) {
    subId = invoiceSubscriptionId(await deps.retrieveInvoice(invoiceId));
    if (!subId) {
      action = "refund_full_sin_suscripcion";
    } else {
      const sub = await deps.retrieveSubscription(subId);
      if (idOf(sub.latest_invoice) !== invoiceId) {
        action = "refund_full_factura_anterior";
      } else {
        if (LIVE_STATUSES.has(sub.status) && !sub.cancel_at_period_end) {
          if (!deps.updateSubscription) throw new Error("updateSubscription no configurado");
          await deps.updateSubscription(subId, { cancel_at_period_end: true });
        }
        if (!deps.markCancelAtPeriodEnd) throw new Error("markCancelAtPeriodEnd no configurado");
        const { error } = await deps.markCancelAtPeriodEnd(subId);
        if (error) throw new Error(`mark_subscription_cancel_at_period_end falló (${event.id}): ${error.message}`);
        action = "cancel_at_period_end";
      }
    }
  }

  await logEvent(deps, {
    event_id: event.id, type: event.type, charge_id: ch.id ?? null, invoice_id: invoiceId,
    subscription_id: subId, customer_id: idOf(ch.customer), amount, amount_refunded: refundedAmount,
    currency: ch.currency ?? null, dispute_reason: null, dispute_status: null, action,
    event_created: new Date(event.created * 1000).toISOString(),
  });
  return { status: 200, body: { received: true, action } };
}

/** charge.dispute.created (A-14): se registra para que operación lo atienda; no cambia el acceso. */
async function handleDispute(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookOutcome> {
  const d = event.data.object as StripeDisputeLike;
  await logEvent(deps, {
    event_id: event.id, type: event.type, charge_id: idOf(d.charge), invoice_id: null, subscription_id: null,
    customer_id: null, amount: typeof d.amount === "number" ? d.amount : null, amount_refunded: null,
    currency: d.currency ?? null, dispute_reason: d.reason ?? null, dispute_status: d.status ?? null,
    action: "dispute_logged", event_created: new Date(event.created * 1000).toISOString(),
  });
  return { status: 200, body: { received: true, action: "dispute_logged" } };
}
