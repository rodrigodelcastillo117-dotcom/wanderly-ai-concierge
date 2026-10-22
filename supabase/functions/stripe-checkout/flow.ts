// Flujo de stripe-checkout sin Deno ni SDK (se prueba con Vitest: src/test/stripeCheckoutFlow.test.ts).
// index.ts autentica, revisa los secrets y le pasa las dependencias reales (Stripe y la base).
// AUD-08 (M3b): el 503 por un precio que no es la oferta publicada vive aquí para que una prueba
// detecte si alguien lo quita; antes estaba solo en index.ts y ninguna prueba lo cubría.
import {
  checkoutSessionParams,
  expireOpenSessions,
  planCheckout,
  priceProblems,
  type StoredSubscription,
  type StripePriceLike,
  type StripeSubSummary,
} from "./logic.ts";

export interface CheckoutDeps {
  /** Fila de subscriptions de la cuenta (o null). Lanza si la lectura falla. */
  readSubscription(userId: string): Promise<StoredSubscription>;
  listSubscriptions(customerId: string): Promise<StripeSubSummary[]>;
  /** Precio configurado en Stripe; null si no se pudo leer. */
  retrievePrice(priceId: string): Promise<StripePriceLike | null>;
  createCustomer(email: string | null, userId: string): Promise<string>;
  /** Guarda el customer en subscriptions. Lanza si falla. */
  saveCustomer(row: { user_id: string; stripe_customer_id: string; status: string; plan: "pro"; currency: "MXN" }): Promise<void>;
  listOpenSessions(customerId: string): Promise<Array<{ id: string }>>;
  expireSession(sessionId: string): Promise<unknown>;
  createSession(params: ReturnType<typeof checkoutSessionParams>): Promise<{ url: string | null }>;
  log?: (...a: unknown[]) => void;
}

export type CheckoutOutcome = { status: number; body: Record<string, unknown> };

export const PRICE_MISMATCH_BODY = {
  error: "price_mismatch",
  message: "No pudimos abrir el pago en este momento. Intenta de nuevo más tarde; no se hizo ningún cargo.",
} as const;

export async function runCheckout(
  o: { userId: string; email: string | null; priceId: string; origin: string },
  deps: CheckoutDeps,
): Promise<CheckoutOutcome> {
  const existing = await deps.readSubscription(o.userId);

  // No abrir un segundo checkout a quien ya tiene PRO (activo, en prueba, con pago pendiente o de
  // cortesía): duplicaba cobros y el webhook de la suscripción vieja le quitaba PRO a la nueva.
  // Tampoco regalar otra prueba de 30 días a quien ya tuvo una (logic.ts).
  const plan = await planCheckout(existing, deps.listSubscriptions);
  if (plan.kind === "blocked") {
    return {
      status: plan.block.status,
      body: { error: "already_subscribed", reason: plan.block.reason, message: plan.block.message, portal: plan.block.portal },
    };
  }

  // AUD-08: el precio de Stripe debe ser la oferta publicada ($99 MXN al mes, IVA incluido). Se revisa
  // ANTES de crear nada en Stripe; si no coincide, no se abre el pago (falla cerrado).
  const problems = priceProblems((await deps.retrievePrice(o.priceId).catch(() => null)) as StripePriceLike);
  if (problems.length) {
    deps.log?.("stripe-checkout: el precio configurado no coincide con la oferta publicada:", o.priceId, problems.join("; "));
    return { status: 503, body: { ...PRICE_MISMATCH_BODY } };
  }

  let customerId = existing?.stripe_customer_id ?? null;
  if (!customerId) {
    customerId = await deps.createCustomer(o.email, o.userId);
    await deps.saveCustomer({
      user_id: o.userId, stripe_customer_id: customerId, status: existing?.status ?? "incomplete", plan: "pro", currency: "MXN",
    });
  }

  // Dos pestañas = dos checkouts = dos suscripciones cobradas: se cierran las sesiones abiertas.
  const ex = await expireOpenSessions(customerId, deps.listOpenSessions, deps.expireSession);
  if (ex.failed) deps.log?.("stripe-checkout: no se pudieron expirar sesiones abiertas", ex);

  const session = await deps.createSession(checkoutSessionParams({
    customerId, userId: o.userId, priceId: o.priceId, origin: o.origin,
    trialDays: plan.trialDays, trialEndUnix: plan.trialEndUnix ?? null,
  }));
  return { status: 200, body: { url: session.url, trial_days: plan.trialDays ?? 0 } };
}
