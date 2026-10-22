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
// - Reembolsos y disputas (charge.refunded, charge.dispute.created, charge.dispute.closed) los
//   decide payments.ts: revocar el acceso pagado salvo otro derecho, registrar, avisar; nunca dan PRO.
// - Una cuenta eliminada (deletion_requests) no recibe escrituras por eventos tardíos.
// - AUD-05: 2xx solo cuando TODOS los efectos obligatorios quedaron aplicados (suscripción, periodo
//   pagado, decisión de reembolso/disputa + antigüedad, aviso a administradores cuando es el efecto).
//   Cada paso es idempotente, así que el reintento de Stripe converge al mismo estado final.

import { handlePaymentEvent, PAYMENT_EVENTS, type PaymentDeps } from "./payments.ts";
import { alertDelivered } from "./alerts.ts";
import {
  invoiceNeedsRetrieve,
  paidPeriodFromInvoice,
  recordArgs,
  type RecordPaidPeriodArgs,
  type StripePaidInvoiceLike,
} from "../_shared/prive-tenure.ts";

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
  /** Tarjeta guardada (Checkout la deja aquí). Id o el objeto expandido. */
  default_payment_method?: string | { id: string; card?: { fingerprint?: string | null } | null } | null;
};

export type StripeInvoiceLike = {
  id: string;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  lines?: { data?: Array<{ subscription?: string | { id: string } | null; parent?: { subscription_item_details?: { subscription?: string | null } | null } | null }> } | null;
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

export interface WebhookDeps extends Partial<Omit<PaymentDeps, "retrieveSubscription" | "retrieveInvoice" | "applySubscription">> {
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  retrieveInvoice(id: string): Promise<StripeInvoiceLike>;
  applySubscription(args: ApplyArgs): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** IATOS Privé: guarda el periodo PAGADO de la factura (antigüedad). Opcional: sin ella no se registra. */
  recordPaidPeriod?(args: RecordPaidPeriodArgs): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** D-P2-2: huella de la tarjeta guardada en la suscripción (payment_method.card.fingerprint). */
  cardFingerprint?(sub: StripeSubscriptionLike): Promise<string | null>;
  /** D-P2-2: claim_trial_fingerprint (¿es la primera prueba de esa tarjeta?). */
  claimTrialFingerprint?(args: ClaimTrialArgs): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** D-P2-2: termina la prueba YA en Stripe (trial_end='now'): Stripe cobra el primer mes en ese momento. */
  endTrialNow?(subscriptionId: string): Promise<void>;
  // Reembolsos y disputas (payments.ts): si falta alguna dependencia y llega uno de esos eventos,
  // se responde 500 (Stripe reintenta) en lugar de ignorarlo.
}

export type WebhookOutcome = { status: number; body: Record<string, unknown> };

export type ClaimTrialArgs = { _fingerprint: string; _subscription_id: string; _customer_id: string | null };

/** Marca que stripe-checkout pone en subscription_data.metadata cuando da la prueba de 30 días con tarjeta. */
export const CARD_TRIAL_METADATA = { key: "iatos_trial", value: "card" } as const;

/**
 * D-P2-2 · una prueba de 30 días por tarjeta. La tarjeta no se conoce al crear la Checkout Session,
 * así que se revisa aquí, en cuanto Stripe la guarda: si su huella ya tuvo prueba en otra suscripción
 * (otra cuenta, otro cliente), la prueba termina YA (Stripe cobra el primer mes) y se escribe el estado
 * real. Sin huella todavía (el evento llegó antes de que Stripe guardara la tarjeta) se deja como está:
 * el siguiente evento de la misma suscripción vuelve a revisar. Un error al reclamar → 500 y reintento.
 */
async function enforceCardTrialOnce(
  deps: WebhookDeps,
  sub: StripeSubscriptionLike,
  eventId: string,
): Promise<{ sub: StripeSubscriptionLike; trial: string | null }> {
  if (sub.status !== "trialing" || sub.metadata?.[CARD_TRIAL_METADATA.key] !== CARD_TRIAL_METADATA.value) {
    return { sub, trial: null };
  }
  if (!deps.cardFingerprint || !deps.claimTrialFingerprint || !deps.endTrialNow) {
    throw new Error(`prueba con tarjeta sin revisión de huella configurada (${eventId})`);
  }
  const fingerprint = await deps.cardFingerprint(sub);
  if (!fingerprint) {
    console.warn("webhook: prueba con tarjeta sin huella todavía", eventId, sub.id);
    return { sub, trial: "sin_huella_todavia" };
  }
  const { data, error } = await deps.claimTrialFingerprint({
    _fingerprint: fingerprint,
    _subscription_id: sub.id,
    _customer_id: idOf(sub.customer),
  });
  if (error) throw new Error(`claim_trial_fingerprint falló (${eventId}): ${error.message}`);
  if ((data as { first?: boolean } | null)?.first === true) return { sub, trial: "primera_prueba_de_la_tarjeta" };
  await deps.endTrialNow(sub.id);
  console.warn("webhook: tarjeta que ya tuvo prueba; se terminó la prueba", eventId, sub.id);
  return { sub: await deps.retrieveSubscription(sub.id), trial: "tarjeta_ya_tuvo_prueba_cobro_inmediato" };
}

/** Huella de la tarjeta de la suscripción (o la predeterminada del cliente). Sin dependencias del SDK. */
export async function cardFingerprintFrom(
  sub: StripeSubscriptionLike,
  stripe: {
    retrievePaymentMethod(id: string): Promise<{ card?: { fingerprint?: string | null } | null }>;
    retrieveCustomerDefaultPaymentMethod(customerId: string): Promise<string | null>;
  },
): Promise<string | null> {
  const ref = sub.default_payment_method ?? null;
  if (ref && typeof ref === "object" && ref.card?.fingerprint) return ref.card.fingerprint;
  let pmId = typeof ref === "string" ? ref : ref?.id ?? null;
  const customer = idOf(sub.customer);
  if (!pmId && customer) pmId = await stripe.retrieveCustomerDefaultPaymentMethod(customer);
  if (!pmId) return null;
  return (await stripe.retrievePaymentMethod(pmId)).card?.fingerprint ?? null;
}

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

// Estados en que una suscripción de Stripe cobra (o cobrará).
const CHARGING = new Set(["active", "trialing", "past_due"]);

/**
 * AUD-05: la base ignora (con razón) una SEGUNDA suscripción viva de la misma cuenta
 * ('other_live_subscription', p. ej. dos checkouts pagados en dos pestañas). Pero Stripe la sigue
 * cobrando: antes era un cobro doble invisible. Ahora se avisa a administradores una sola vez por
 * suscripción (solo ids de Stripe). Si la campana no se guarda, 500 para que Stripe reintente.
 */
async function alertDuplicate(deps: WebhookDeps, r: ApplyResult, sub: StripeSubscriptionLike, eventId: string): Promise<void> {
  if (!CHARGING.has(sub.status) || !deps.alertAdmins) return;
  const customer = idOf(sub.customer) ?? "?";
  let alert: { key: string; title: string; body: string } | null = null;
  if (r.reason === "other_live_subscription") {
    alert = {
      key: `stripe:dup_sub:${sub.id}`,
      title: "Posible cobro doble: segunda suscripción PRO viva",
      body: `La cuenta ya tiene otra suscripción PRO viva. La suscripción ${sub.id} (cliente ${customer}) ` +
        "no se aplicó en IATOS pero Stripe la sigue cobrando. Revisa en Stripe: cancela y reembolsa la duplicada (no la original).",
    };
  } else if (r.reason === "unknown_user") {
    // Mejora (cierre): alguien paga y el webhook no sabe de qué cuenta es (suscripción creada fuera
    // del checkout, sin metadata y con un cliente que IATOS no conoce): paga sin recibir PRO.
    alert = {
      key: `stripe:unknown_user:${sub.id}`,
      title: "Pago de PRO sin cuenta de IATOS",
      body: `La suscripción ${sub.id} (cliente ${customer}) cobra en Stripe pero no corresponde a ninguna cuenta de IATOS ` +
        "(sin metadata supabase_user_id y cliente desconocido). Liga la cuenta o cancela y reembolsa en Stripe.",
    };
  }
  if (!alert) return;
  const status = await deps.alertAdmins(alert);
  if (!alertDelivered(status)) throw new Error(`aviso a administradores no entregado: ${status} (${eventId})`);
}

const ok = (r: ApplyResult): WebhookOutcome => ({
  status: 200,
  body: { received: true, applied: r.applied, reason: r.reason },
});

const withTrial = (o: WebhookOutcome, trial: string | null): WebhookOutcome =>
  trial ? { ...o, body: { ...o.body, trial } } : o;

export async function handleStripeEvent(event: StripeEventLike, deps: WebhookDeps): Promise<WebhookOutcome> {
  try {
    // Evento tardío de una cuenta eliminada: no se recrean filas ni se da acceso.
    if (!PAYMENT_EVENTS.has(event.type) && deps.isDeletedCustomer) {
      const customer = eventCustomerId(event);
      if (customer && await deps.isDeletedCustomer(customer)) {
        return { status: 200, body: { received: true, ignored: "cuenta_eliminada" } };
      }
    }
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
        const { sub, trial } = await enforceCardTrialOnce(deps, await deps.retrieveSubscription(subId), event.id);
        const r = await apply(deps, subscriptionArgs(sub, event.created, userId), event.id);
        await alertDuplicate(deps, r, sub, event.id);
        return withTrial(ok(r), trial);
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const payload = event.data.object as StripeSubscriptionLike;
        const { sub, trial } = await enforceCardTrialOnce(deps, await deps.retrieveSubscription(payload.id), event.id);
        const r = await apply(deps, subscriptionArgs(sub, event.created), event.id);
        await alertDuplicate(deps, r, sub, event.id);
        return withTrial(ok(r), trial);
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
        await alertDuplicate(deps, r, sub, event.id);
        if (deps.recordPaidPeriod && event.type !== "invoice.payment_failed") {
          // Antigüedad de Privé: después de escribir la suscripción (así la base ya sabe de quién es).
          const tenure = await recordTenure(deps, payload as StripePaidInvoiceLike, sub, event.id);
          return { status: 200, body: { ...ok(r).body, tenure } };
        }
        return ok(r);
      }
      case "charge.refunded":
      case "charge.dispute.created":
      case "charge.dispute.closed":
        return await handlePaymentEvent(event, requirePaymentDeps(deps));
      default:
        return { status: 200, body: { received: true, ignored: event.type } };
    }
  } catch (e) {
    console.error("webhook handler error:", event.type, event.id, (e as Error).message);
    return { status: 500, body: { error: "handler_failed" } };
  }
}

/** Registra el periodo pagado de la factura (monto > 0). Un error de la base → 500 y Stripe reintenta. */
async function recordTenure(deps: WebhookDeps, payload: StripePaidInvoiceLike, sub: StripeSubscriptionLike, eventId: string): Promise<string> {
  let inv = payload;
  if (invoiceNeedsRetrieve(inv)) inv = (await deps.retrieveInvoice(payload.id)) as unknown as StripePaidInvoiceLike;
  const p = paidPeriodFromInvoice(inv);
  if ("reason" in p) return p.reason;
  const { data, error } = await deps.recordPaidPeriod!(recordArgs(p.period, sub.metadata?.supabase_user_id || null, "webhook"));
  if (error) throw new Error(`prive_record_paid_period falló (${eventId}): ${error.message}`);
  const r = (data ?? {}) as { recorded?: boolean; reason?: string };
  return r.recorded ? "recorded" : (r.reason ?? "not_recorded");
}

function requirePaymentDeps(deps: WebhookDeps): PaymentDeps {
  const need = ["retrieveCharge", "cancelSubscriptionNow", "revokePaidAccess", "accessSnapshot", "findPaymentEvent",
    "isDeletedCustomer", "alertAdmins"] as const;
  for (const k of need) if (typeof deps[k] !== "function") throw new Error(`dependencia ${k} no configurada`);
  // El registro final: stripe_commit_payment_event (AUD-05) o, si no está, el upsert anterior.
  if (typeof deps.commitPaymentEvent !== "function" && typeof deps.logPaymentEvent !== "function") {
    throw new Error("dependencia commitPaymentEvent/logPaymentEvent no configurada");
  }
  return deps as PaymentDeps;
}

/** Cliente de Stripe del payload de un evento de suscripción, factura o checkout. */
export function eventCustomerId(event: StripeEventLike): string | null {
  const o = event.data.object as { customer?: string | { id: string } | null } | null;
  return idOf(o?.customer ?? null);
}

export { PAYMENT_EVENTS };
