// Promoción "Invita 5 amigos y gana 1 mes de PRO" (migración 20261027080000_referidos_promo.sql).
// Sin Deno ni SDK: lo usa prive-cron (cron diario que ya existe) y se prueba con Vitest
// (src/test/referralRewards.test.ts).
//
//   1) referral_rewards_sweep: aplica premios guardados que ya se pueden dar como cortesía, vence las
//      cortesías de referidos y reevalúa (por si un trigger falló).
//   2) Stripe — APAGADO con app_flags.referral_stripe_apply_enabled = false: referral_claim_stripe_rewards
//      devuelve { enabled: false } y aquí no se llama a Stripe. Encendido, a quien ya paga PRO se le crea
//      un saldo a favor (customer balance transaction) por el precio de un mes; Stripe lo descuenta solo
//      en el siguiente cobro. Llave de idempotencia por premio: un reintento no duplica el saldo.
//      No crea cupones, no cambia la suscripción ni el precio, no cobra nada.
import { isMissingFunctionError } from "./prive-tenure.ts";
import { EXPECTED_PRICE } from "./stripe-offer.ts";

type DbError = { message: string; code?: string | null } | null;
type DbResult<T> = PromiseLike<{ data: T | null; error: DbError }>;

/** Saldo a favor de un mes de IATOS PRO (lo mismo que se cobra: $99.00 MXN, IVA incluido). */
export const REFERRAL_CREDIT = { amount: EXPECTED_PRICE.unit_amount, currency: EXPECTED_PRICE.currency } as const;
export const REFERRAL_CREDIT_DESCRIPTION = "IATOS PRO: 1 mes gratis por invitar a 5 amigos";
const STRIPE_API_VERSION = "2024-12-18.acacia";

export type ClaimedReferralReward = { id: string; customer_id: string; days: number };
export type CreditResult = { ok: boolean; id?: string; error?: string };

export interface ReferralStripeDeps {
  claim(limit: number): DbResult<{ enabled: boolean; rewards: ClaimedReferralReward[] }>;
  credit(r: ClaimedReferralReward): Promise<CreditResult>;
  mark(id: string, ok: boolean, stripeRef: string | null, error: string | null): DbResult<boolean>;
}

export type ReferralStripeSummary = { enabled: boolean; claimed: number; applied: number; failed: number; mark_errors: number };

export async function applyReferralStripeRewards(deps: ReferralStripeDeps, limit = 20): Promise<ReferralStripeSummary> {
  const out: ReferralStripeSummary = { enabled: false, claimed: 0, applied: 0, failed: 0, mark_errors: 0 };
  const c = await deps.claim(limit);
  if (c.error) {
    if (isMissingFunctionError(c.error, "referral_claim_stripe_rewards")) return out; // migración pendiente
    throw new Error(c.error.message);
  }
  // Doble candado: aunque la base devolviera filas, con el flag apagado no se toca Stripe.
  if (!c.data?.enabled) return out;
  out.enabled = true;
  for (const r of c.data.rewards ?? []) {
    if (!r?.id || !r.customer_id) continue;
    out.claimed++;
    let res: CreditResult;
    try {
      res = await deps.credit(r);
    } catch (e) {
      res = { ok: false, error: (e as Error).message || "error" };
    }
    if (res.ok && res.id) out.applied++;
    else out.failed++;
    const ok = Boolean(res.ok && res.id);
    const m = await deps.mark(r.id, ok, ok ? res.id ?? null : null, ok ? null : (res.error || "error").slice(0, 300));
    if (m.error) out.mark_errors++;
  }
  return out;
}

/** Petición a la API de Stripe (POST /v1/customers/:id/balance_transactions). Pura, para probarla. */
export function balanceTransactionRequest(r: ClaimedReferralReward, secretKey: string): { url: string; init: RequestInit } {
  const body = new URLSearchParams({
    amount: String(-REFERRAL_CREDIT.amount), // negativo = saldo a favor del cliente
    currency: REFERRAL_CREDIT.currency,
    description: REFERRAL_CREDIT_DESCRIPTION,
    "metadata[iatos_referral_reward_id]": r.id,
  });
  return {
    url: `https://api.stripe.com/v1/customers/${encodeURIComponent(r.customer_id)}/balance_transactions`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `iatos-referral-reward-${r.id}`,
        "Stripe-Version": STRIPE_API_VERSION,
      },
      body: body.toString(),
    },
  };
}

/** credit() real: usa fetch y la llave que ya tiene el proyecto (STRIPE_SECRET_KEY). Nunca registra la llave. */
export function stripeCreditWith(secretKey: string, fetchImpl: typeof fetch = fetch) {
  return async (r: ClaimedReferralReward): Promise<CreditResult> => {
    const { url, init } = balanceTransactionRequest(r, secretKey);
    const resp = await fetchImpl(url, init);
    const json = (await resp.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: string } };
    if (resp.ok && json.id) return { ok: true, id: json.id };
    return { ok: false, error: `stripe ${resp.status}: ${json.error?.code ?? json.error?.message ?? "sin detalle"}` };
  };
}
