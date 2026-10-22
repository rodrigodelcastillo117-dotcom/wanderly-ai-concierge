// Envío de los correos de invitación a Privé (lo usan prive-cron y prive-access › resend_invitation).
// Puro: la base y el proveedor se inyectan; se prueba en src/test/priveCron.test.ts.
//
// Garantías:
//   * Nunca duplica: prive_claim_invitation_emails reclama con FOR UPDATE SKIP LOCKED solo las que
//     están 'pending' o 'failed' con reintento vencido, y genera un token NUEVO por envío.
//   * Reintentos: si el envío falla, prive_mark_invitation_email programa 15 min, 1 h, 6 h y 24 h;
//     al quinto fallo deja de intentar (la invitación sigue en la app sin token).
//   * El token solo vive en memoria durante el envío y en el enlace (#t=…); nunca se registra.
//   * Entregabilidad: remitente "IATOS Privé" (mismo buzón y dominio), X-Entity-Ref-ID estable por
//     invitación (Gmail no encadena invitaciones distintas en un mismo hilo), Reply-To solo si hay un
//     buzón que reciba (env PRIVE_REPLY_TO) y el idioma del perfil si la base lo devuelve (`locale`).
import { PRIVE_FROM, priveEntityRefId, priveInvitationEmail, priveReplyTo } from "./prive-email.ts";

export type ClaimedInvitation = {
  invitation_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  token: string;
  attempt: number;
  basis?: "tenure" | "grant" | null;
  /** Idioma del perfil ("es", "en"…). Hoy la base no lo guarda: sin dato el correo va en español. */
  locale?: string | null;
};

export type InviteMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface InviteSenderDeps {
  claim(limit: number, onlyUser: string | null): DbResult<ClaimedInvitation[]>;
  mark(invitationId: string, ok: boolean, providerId: string | null, error: string | null): DbResult<unknown>;
  send(msg: InviteMessage): Promise<{ ok: boolean; id?: string; error?: string }>;
  siteUrl: string;
  supportEmail?: string;
  /** Buzón que recibe respuestas (env PRIVE_REPLY_TO). Sin él no se manda Reply-To. */
  replyTo?: string;
  warn?(...args: unknown[]): void;
}

export type InviteSendSummary = { claimed: number; sent: number; failed: number; mark_errors: number };

export async function sendDueInvitations(deps: InviteSenderDeps, limit: number, onlyUser: string | null = null): Promise<InviteSendSummary> {
  const summary: InviteSendSummary = { claimed: 0, sent: 0, failed: 0, mark_errors: 0 };
  const { data, error } = await deps.claim(limit, onlyUser);
  if (error) throw new Error(`prive_claim_invitation_emails falló: ${error.message}`);
  for (const inv of data ?? []) {
    summary.claimed++;
    let ok = false;
    let providerId: string | null = null;
    let err: string | null = null;
    try {
      const basis = inv.basis === "grant" ? "grant" : "tenure";
      const replyTo = priveReplyTo(deps.replyTo);
      const mail = priveInvitationEmail({
        firstName: inv.first_name, token: inv.token, siteUrl: deps.siteUrl, supportEmail: deps.supportEmail, basis,
        locale: inv.locale ?? null, replyTo,
      });
      const r = await deps.send({
        to: inv.email, subject: mail.subject, html: mail.html, text: mail.text, from: PRIVE_FROM,
        ...(replyTo ? { replyTo } : {}),
        headers: { "X-Entity-Ref-ID": priveEntityRefId(inv.invitation_id) },
      });
      ok = r.ok;
      providerId = r.id ?? null;
      err = r.ok ? null : (r.error ?? "send_failed");
    } catch (e) {
      err = (e as Error).message || "send_exception";
    }
    if (ok) summary.sent++; else summary.failed++;
    const m = await deps.mark(inv.invitation_id, ok, providerId, err ? redactForLog(err) : null);
    if (m.error) {
      summary.mark_errors++;
      // Sin correo ni token en la bitácora: solo el id de la invitación.
      deps.warn?.("prive: no se pudo registrar el envío", inv.invitation_id, m.error.message);
    }
  }
  return summary;
}

/** Los mensajes de error del proveedor pueden traer direcciones o llaves: se recortan y tapan. */
export function redactForLog(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]")
    .replace(/#t=[A-Za-z0-9_-]+/g, "#t=[token]")
    .replace(/\b(re|sk|rk)_[A-Za-z0-9_]{6,}/g, "[llave]")
    .slice(0, 200);
}
