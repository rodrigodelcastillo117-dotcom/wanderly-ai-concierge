// Orquestación de prive-cron sin Deno ni SDK (probada en src/test/priveCron.test.ts):
//   1) prive_evaluate_eligibility: quién cumple PRO + ≥ 90 días pagados (o concesión) → membresía
//      'invited' + invitación + aviso en la app (una sola vez por persona);
//   2) correos de invitación pendientes con reintentos (sendDueInvitations);
//   3) prive_sweep: cierra sesiones de quien ya no tiene derecho, caduca invitaciones y purga.
// Un paso que falla no impide los demás; la respuesta lo dice y devuelve 500 para que el chequeo
// diario (health-check) lo vea.
import { type InviteSenderDeps, type InviteSendSummary, sendDueInvitations } from "../_shared/prive-invite-sender.ts";

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface PriveCronDeps {
  evaluate(limit: number): DbResult<Array<{ user_id: string; action: string }>>;
  /** null = el correo no está configurado (faltan LOVABLE_API_KEY o RESEND_API_KEY): no se reclama nada. */
  sender: InviteSenderDeps | null;
  sweep(): DbResult<Record<string, number>>;
  warn?(...args: unknown[]): void;
}

export type PriveCronResult = {
  status: number;
  body: {
    ok: boolean;
    invited: number;
    already_member: number;
    emails: InviteSendSummary | "not_configured" | "error";
    sweep: Record<string, number> | "error";
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

  if (errors.length) deps.warn?.("prive-cron:", errors.join(" | "));
  return { status: errors.length ? 500 : 200, body: { ok: errors.length === 0, invited, already_member: already, emails, sweep, errors } };
}
