// Reglas de stripe-checkout sin dependencias de Deno ni del SDK (se prueban con Vitest).

export type StoredSubscription = {
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_end: string | null;
  current_period_end: string | null;
} | null;

export type StripeSubSummary = {
  id: string;
  status: string;
  trial_start?: number | null;
  trial_end?: number | null;
};

export type CheckoutBlock = { status: 409; reason: string; message: string; portal: boolean };

export const TRIAL_DAYS = 30;

// Estados de Stripe en los que la suscripción sigue cobrando (o cobrará): contratar otra duplicaría el cargo.
const LIVE_STRIPE = new Set(["active", "trialing", "past_due", "unpaid"]);
// Suscripciones que nunca arrancaron (el primer pago no pasó): no cuentan como "ya tuvo prueba".
const NEVER_STARTED = new Set(["incomplete", "incomplete_expired"]);

const msgFor = (status: string): CheckoutBlock => {
  if (status === "comped") {
    return {
      status: 409,
      reason: "comped",
      portal: false,
      message: "Ya tienes IATOS PRO de cortesía, sin costo. No necesitas pagar nada.",
    };
  }
  if (status === "past_due" || status === "unpaid") {
    return {
      status: 409,
      reason: "past_due",
      portal: true,
      message:
        "Tu suscripción a IATOS PRO tiene un pago pendiente. Actualiza tu tarjeta en «Gestionar suscripción» " +
        "para no perder el acceso; no hace falta contratar de nuevo.",
    };
  }
  return {
    status: 409,
    reason: "already_subscribed",
    portal: true,
    message:
      "Ya tienes IATOS PRO activo. Para cambiar tu tarjeta o cancelar, entra a «Gestionar suscripción».",
  };
};

/** ¿La fila guardada ya da (o cobra) PRO? Entonces no se abre otro checkout. */
export function blockFromStored(stored: StoredSubscription, now = Date.now()): CheckoutBlock | null {
  if (!stored?.status) return null;
  if (stored.status === "comped") return msgFor("comped");
  if (stored.status === "past_due" || stored.status === "unpaid") return msgFor(stored.status);
  if (stored.status === "active" || stored.status === "trialing") {
    // Solo si de verdad está vigente (una fila vieja con periodo vencido no bloquea).
    const end = stored.current_period_end ? Date.parse(stored.current_period_end) : NaN;
    if (stored.stripe_subscription_id && (Number.isNaN(end) || end > now)) return msgFor(stored.status);
  }
  return null;
}

/** Fuente de verdad de Stripe: alguna suscripción del customer sigue viva → no se duplica. */
export function blockFromStripe(history: StripeSubSummary[]): CheckoutBlock | null {
  const live = history.find((s) => LIVE_STRIPE.has(s.status));
  return live ? msgFor(live.status) : null;
}

/**
 * La prueba de 30 días es solo para quien nunca tuvo suscripción ni prueba.
 * Antes cada checkout regalaba 30 días nuevos: suscribirse, cancelar y volver a empezar.
 */
export function trialEligible(stored: StoredSubscription, history: StripeSubSummary[]): boolean {
  if (stored?.trial_end) return false;
  if (stored?.stripe_subscription_id && !NEVER_STARTED.has(stored.status ?? "")) return false;
  return !history.some((s) => !NEVER_STARTED.has(s.status) || Boolean(s.trial_start || s.trial_end));
}

export type CheckoutPlan =
  | { kind: "blocked"; block: CheckoutBlock }
  | { kind: "create"; trialDays: number | null };

/**
 * Decide si se crea la sesión y con cuántos días de prueba.
 * listSubscriptions consulta Stripe (inyectada para poder probar sin llamar a Stripe).
 */
export async function planCheckout(
  stored: StoredSubscription,
  listSubscriptions: (customerId: string) => Promise<StripeSubSummary[]>,
  now = Date.now(),
): Promise<CheckoutPlan> {
  const storedBlock = blockFromStored(stored, now);
  if (storedBlock) return { kind: "blocked", block: storedBlock };

  const history = stored?.stripe_customer_id ? await listSubscriptions(stored.stripe_customer_id) : [];
  const stripeBlock = blockFromStripe(history);
  if (stripeBlock) return { kind: "blocked", block: stripeBlock };

  return { kind: "create", trialDays: trialEligible(stored, history) ? TRIAL_DAYS : null };
}
