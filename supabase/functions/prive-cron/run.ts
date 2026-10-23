// Orquestación de prive-cron sin Deno ni SDK (probada en src/test/priveCron.test.ts):
//   1) prive_evaluate_eligibility: quién cumple PRO + ≥ 90 días pagados (o concesión) → membresía
//      'invited' + invitación + aviso en la app (una sola vez por persona);
//   2) correos de invitación pendientes con reintentos (sendDueInvitations);
//   3) prive_sweep: cierra sesiones de quien ya no tiene derecho, caduca invitaciones y purga.
//   4) Promoción de referidos (opcional, _shared/referral-rewards.ts): referral_rewards_sweep y, solo con
//      app_flags.referral_stripe_apply_enabled encendido, el saldo a favor en Stripe. Si la migración
//      20261027080000 aún no está aplicada, el paso se omite sin error.
// Un paso que falla no impide los demás; la respuesta lo dice y devuelve 500 para que el chequeo
// diario (health-check) lo vea.
import { type InviteSenderDeps, type InviteSendSummary, sendDueInvitations } from "../_shared/prive-invite-sender.ts";
import { isMissingFunctionError } from "../_shared/prive-tenure.ts";
import { applyReferralStripeRewards, type ReferralStripeDeps, type ReferralStripeSummary } from "../_shared/referral-rewards.ts";

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string | null } | null }>;

export interface PriveCronDeps {
  evaluate(limit: number): DbResult<Array<{ user_id: string; action: string }>>;
  /** null = el correo no está configurado (faltan LOVABLE_API_KEY o RESEND_API_KEY): no se reclama nada. */
  sender: InviteSenderDeps | null;
  sweep(): DbResult<Record<string, number>>;
  /** Promoción de referidos: barrido diario (referral_rewards_sweep). */
  referralSweep?(): DbResult<Record<string, number>>;
  /** Promoción de referidos en Stripe; null = sin STRIPE_SECRET_KEY (no se intenta). */
  referralStripe?: ReferralStripeDeps | null;
  warn?(...args: unknown[]): void;
}

export type ReferralCronSummary = {
  sweep: Record<string, number> | "migration_pending" | "error";
  stripe: ReferralStripeSummary | "not_configured" | "error";
};

export type PriveCronResult = {
  status: number;
  body: {
    ok: boolean;
    invited: number;
    already_member: number;
    emails: InviteSendSummary | "not_configured" | "error";
    sweep: Record<string, number> | "error";
    referrals?: ReferralCronSummary;
    errors: string[];
  };
};

export async function runPriveCron(deps: PriveCronDeps, opts: { evaluateLimit?: number; emailLimit?: number } = {}): Promise<PriveCronResult> {
  const errors: string[] = [];
  let invited = 0;
  let already = 0;
  const ev = await deps.evaluate(opts.evaluateLimit ?? 200);
  if (ev.error) errors.push(`evaluate: ${ev.error.message}`);
  for (const r of ev.data ?? []) {
    if (r.action === "invited") invited++;
    else already++;
  }

  let emails: PriveCronResult["body"]["emails"] = "not_configured";
  if (deps.sender) {
    try {
      emails = await sendDueInvitations(deps.sender, opts.emailLimit ?? 50);
      if (emails.mark_errors > 0) errors.push(`emails: ${emails.mark_errors} sin registrar`);
    } catch (e) {
      emails = "error";
      errors.push(`emails: ${(e as Error).message}`);
    }
  }

  let sweep: PriveCronResult["body"]["sweep"] = "error";
  const sw = await deps.sweep();
  if (sw.error) errors.push(`sweep: ${sw.error.message}`);
  else sweep = sw.data ?? {};

  let referrals: ReferralCronSummary | undefined;
  if (deps.referralSweep) {
    referrals = { sweep: "error", stripe: "not_configured" };
    const rs = await deps.referralSweep();
    if (isMissingFunctionError(rs.error, "referral_rewards_sweep")) referrals.sweep = "migration_pending";
    else if (rs.error) errors.push(`referidos: ${rs.error.message}`);
    else referrals.sweep = rs.data ?? {};
    if (deps.referralStripe && referrals.sweep !== "migration_pending") {
      try {
        referrals.stripe = await applyReferralStripeRewards(deps.referralStripe);
        if (referrals.stripe.mark_errors > 0) errors.push(`referidos stripe: ${referrals.stripe.mark_errors} sin registrar`);
      } catch (e) {
        referrals.stripe = "error";
        errors.push(`referidos stripe: ${(e as Error).message}`);
      }
    }
  }

  if (errors.length) deps.warn?.("prive-cron:", errors.join(" | "));
  const body: PriveCronResult["body"] = { ok: errors.length === 0, invited, already_member: already, emails, sweep, errors };
  if (referrals) body.referrals = referrals;
  return { status: errors.length ? 500 : 200, body };
}
