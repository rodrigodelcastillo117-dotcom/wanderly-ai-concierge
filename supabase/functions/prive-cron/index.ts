// prive-cron — elegibilidad de IATOS Privé, correos de invitación y barrido de sesiones.
// verify_jwt = false: lo dispara pg_cron con el secreto de Vault (docs/ops/LEEME.md) y se valida
// con isAuthorizedCron (falla cerrada). La lógica vive en run.ts (probada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { redactSecrets } from "../_shared/redact.ts";
import type { ClaimedInvitation } from "../_shared/prive-invite-sender.ts";
import { runPriveCron } from "./run.ts";
import { stripeCreditWith } from "../_shared/referral-rewards.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const emailReady = Boolean(Deno.env.get("LOVABLE_API_KEY") && Deno.env.get("RESEND_API_KEY"));
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const result = await runPriveCron({
    evaluate: (limit) => db.rpc("prive_evaluate_eligibility", { _limit: limit }),
    sender: emailReady
      ? {
        claim: (limit, onlyUser) => db.rpc("prive_claim_invitation_emails", { _limit: limit, _only_user: onlyUser }) as unknown as PromiseLike<{ data: ClaimedInvitation[] | null; error: { message: string } | null }>,
        mark: (id, ok, providerId, error) =>
          db.rpc("prive_mark_invitation_email", { _invitation_id: id, _ok: ok, _provider_id: providerId, _error: error }),
        send: (m) => sendEmail(m),
        siteUrl: Deno.env.get("SITE_URL") ?? "https://traveliatos.life",
        supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? undefined,
        replyTo: Deno.env.get("PRIVE_REPLY_TO") ?? undefined,
        warn: (...a) => console.warn(...a),
      }
      : null,
    sweep: () => db.rpc("prive_sweep"),
    // Promoción de referidos: barrido diario y, solo con el flag referral_stripe_apply_enabled
    // encendido en app_flags, el saldo a favor en Stripe (la base no entrega nada con el flag apagado).
    referralSweep: () => db.rpc("referral_rewards_sweep", { _limit: 500 }),
    referralStripe: stripeKey
      ? {
        claim: (limit) => db.rpc("referral_claim_stripe_rewards", { _limit: limit }),
        credit: stripeCreditWith(stripeKey),
        mark: (id, ok, ref, error) =>
          db.rpc("referral_mark_stripe_reward", { _reward_id: id, _ok: ok, _stripe_ref: ref, _error: error }),
      }
      : null,
    warn: (...a) => console.warn(...a.map((x) => redactSecrets(x) ?? "")),
  });
  // Solo conteos: nunca correos, nombres ni tokens.
  console.log("prive-cron:", JSON.stringify({ invited: result.body.invited, emails: result.body.emails, referrals: result.body.referrals, ok: result.body.ok }));
  return json(result.body, result.status);
});
