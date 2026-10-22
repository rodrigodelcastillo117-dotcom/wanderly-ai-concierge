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

export type StripeSubscriptionLike = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  currency?: string | null;
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
      default:
        return { status: 200, body: { received: true, ignored: event.type } };
    }
  } catch (e) {
    console.error("webhook handler error:", event.type, event.id, (e as Error).message);
    return { status: 500, body: { error: "handler_failed" } };
  }
}
