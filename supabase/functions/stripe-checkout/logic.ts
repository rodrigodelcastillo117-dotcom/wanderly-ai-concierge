// Reglas de stripe-checkout sin dependencias de Deno ni del SDK (se prueban con Vitest).
import { EXPECTED_PRICE } from "../_shared/stripe-offer.ts";

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

/** D-P2-2: misma marca que lee stripe-webhook (handler.ts, CARD_TRIAL_METADATA). */
export const CARD_TRIAL_METADATA = { key: "iatos_trial", value: "card" } as const;

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
  // trialDays: prueba de Stripe (solo primera vez). trialEndUnix: fin de una prueba sin tarjeta en
  // curso, para que Stripe no cobre antes de que termine. Nunca vienen los dos.
  | { kind: "create"; trialDays: number | null; trialEndUnix?: number | null };

// Stripe exige que trial_end de una Checkout Session esté al menos 48 h en el futuro.
const STRIPE_MIN_TRIAL_MS = 48 * 3600 * 1000;
const SAFETY_MS = 3600 * 1000;

/**
 * Prueba sin tarjeta (DEC-02) en curso: fila 'trialing' sin suscripción de Stripe y con trial_end
 * futuro. Devuelve hasta cuándo Stripe NO debe cobrar. Si faltan menos de 48 h se usa el mínimo de
 * Stripe (la persona gana horas de más, nunca se le cobra antes de que termine su prueba).
 */
export function noCardTrialEnd(stored: StoredSubscription, now = Date.now()): number | null {
  if (!stored || stored.status !== "trialing" || stored.stripe_subscription_id || !stored.trial_end) return null;
  const end = Date.parse(stored.trial_end);
  if (Number.isNaN(end) || end <= now) return null;
  return Math.ceil(Math.max(end, now + STRIPE_MIN_TRIAL_MS + SAFETY_MS) / 1000);
}

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

  // Una prueba sin tarjeta cuenta como "ya tuvo prueba" (trial_end guardado): no hay prueba extra de
  // Stripe; si sigue vigente, el primer cobro espera a que termine; si ya venció, se cobra desde el día 1.
  const trialEndUnix = noCardTrialEnd(stored, now);
  if (trialEndUnix) return { kind: "create", trialDays: null, trialEndUnix };
  return { kind: "create", trialDays: trialEligible(stored, history) ? TRIAL_DAYS : null, trialEndUnix: null };
}

// ── AUD-08: lo que se cobra debe ser exactamente lo que se publica ─────────────────────────────
// La regla vive en _shared/stripe-offer.ts (la usa también health-check?action=stripe_config).
export { EXPECTED_PRICE, priceProblems, type StripePriceLike } from "../_shared/stripe-offer.ts";

/** Parámetros de stripe.checkout.sessions.create (puro, para probarlo sin Stripe). */
export function checkoutSessionParams(o: {
  customerId: string;
  userId: string;
  priceId: string;
  origin: string;
  trialDays: number | null;
  trialEndUnix?: number | null;
}) {
  const cardTrial = Boolean(o.trialDays);
  return {
    mode: "subscription" as const,
    customer: o.customerId,
    client_reference_id: o.userId,
    line_items: [{ price: o.priceId, quantity: 1 }],
    // D-P2-2: con prueba de 30 días se pide SIEMPRE una tarjeta (aunque hoy no se cobre) y solo tarjeta,
    // para que el webhook lea su huella (card.fingerprint) y no regale otra prueba a la misma tarjeta.
    ...(cardTrial ? { payment_method_collection: "always" as const, payment_method_types: ["card" as const] } : {}),
    // Siempre en pesos: Adaptive Pricing (si el panel lo tiene encendido) convertía a USD.
    currency: EXPECTED_PRICE.currency,
    adaptive_pricing: { enabled: false },
    subscription_data: {
      ...(o.trialDays ? { trial_period_days: o.trialDays } : {}),
      // Durante una prueba sin tarjeta: sin cobro hasta que termine (noCardTrialEnd).
      ...(o.trialEndUnix ? { trial_end: o.trialEndUnix } : {}),
      metadata: {
        supabase_user_id: o.userId,
        ...(cardTrial ? { [CARD_TRIAL_METADATA.key]: CARD_TRIAL_METADATA.value } : {}),
      },
    },
    // Con un precio "inclusive", Stripe Tax desglosa el IVA dentro de los $99 (no lo suma).
    automatic_tax: { enabled: true },
    customer_update: { address: "auto" as const },
    allow_promotion_codes: true,
    success_url: `${o.origin}/dashboard/pro?checkout=success`,
    cancel_url: `${o.origin}/dashboard/pro?checkout=cancel`,
    metadata: { supabase_user_id: o.userId },
  };
}

/**
 * Antes de abrir un checkout nuevo se expiran los que el cliente dejó abiertos (otra pestaña, doble
 * clic): pagar los dos creaba DOS suscripciones y cobraba doble. Nunca bloquea el pago: si Stripe
 * falla aquí, el webhook avisa a administradores de una segunda suscripción viva.
 */
export async function expireOpenSessions(
  customerId: string,
  listOpen: (customerId: string) => Promise<Array<{ id: string }>>,
  expire: (sessionId: string) => Promise<unknown>,
): Promise<{ expired: number; failed: number }> {
  let open: Array<{ id: string }>;
  try {
    open = await listOpen(customerId);
  } catch {
    return { expired: 0, failed: 1 };
  }
  let expired = 0;
  let failed = 0;
  for (const s of open) {
    try {
      await expire(s.id);
      expired++;
    } catch {
      failed++; // ya se pagó o expiró mientras tanto
    }
  }
  return { expired, failed };
}
