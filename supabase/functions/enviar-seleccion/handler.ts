// enviar-seleccion: lógica sin Deno (probada en src/test/selectionEmail.test.ts con dependencias
// simuladas; ninguna prueba manda un correo real). index.ts la conecta con Supabase y Resend.
//
// Acciones:
//   * "members": lista de personas del viaje (dueño y colaboradores aceptados) con su nombre, para
//     marcar a quién más mandarlo. Nunca devuelve correos.
//   * "send" (por defecto): valida la selección contra el viaje (validateSelectionRequest), aplica el
//     límite por persona y por viaje, y manda el correo a la persona que lo pide o, si lo eligió
//     explícitamente, a los miembros del viaje que marcó (un correo por persona: nadie ve el correo de
//     otro). Sin selección no se manda nada.
import type { Email } from "../_shared/email-kit.ts";
import type { RateLimitVerdict } from "../_shared/rate-limit-core.ts";
import { type SelectionMarks, selectionEmail, type ValidationError, type ValidationOk, tripSendQuota, validateSelectionRequest } from "../_shared/selection-email.ts";
import type { HitFn } from "../_shared/rate-limit-core.ts";

export type Member = { id: string; name: string | null };

export type SelectionDeps = {
  user: { id: string; email: string | null } | null;
  /** Límite por persona (enforceRateLimit). */
  rateLimitUser: () => Promise<RateLimitVerdict>;
  /** check_rate_limit para el límite por viaje. */
  hit: HitFn;
  loadTrip: (tripId: string) => Promise<any | null>;
  /** Dueño y colaboradores aceptados del viaje. */
  members: (trip: any) => Promise<Member[]>;
  emailOf: (userId: string) => Promise<string | null>;
  /** Marcas "Ya lo compré" del viaje (trip_purchase_marks y bookings). */
  marks: (tripId: string) => Promise<SelectionMarks>;
  send: (opts: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  siteUrl?: string | null;
  now?: Date;
};

export type HandlerResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MEMBER_RECIPIENTS = 10;

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): HandlerResult =>
  ({ status, body: { ok: false, code, message, ...extra } });

export async function handleSelectionEmail(raw: unknown, deps: SelectionDeps): Promise<HandlerResult> {
  if (!deps.user) return fail(401, "sin_sesion", "Inicia sesión para enviarte tu selección.");
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const tripId = String(body.trip_id ?? "");
  if (!UUID.test(tripId)) return fail(400, "viaje_invalido", "Viaje no válido.");

  const trip = await deps.loadTrip(tripId);
  if (!trip) return fail(404, "viaje_no_encontrado", "No encontramos este viaje.");
  const members = await deps.members(trip);
  const me = members.find((m) => m.id === deps.user!.id);
  // Solo quien es del viaje (dueño o colaborador aceptado) puede pedirlo.
  if (!me) return fail(403, "sin_acceso", "No tienes acceso a este viaje.");

  if (body.action === "members") {
    return { status: 200, body: { ok: true, members: members.map((m) => ({ id: m.id, name: m.name, you: m.id === deps.user!.id })) } };
  }

  const verdict = await deps.rateLimitUser();
  if (!verdict.allowed) {
    return fail(verdict.scope === "unavailable" ? 503 : 429, verdict.scope === "unavailable" ? "no_disponible" : "limite",
      verdict.scope === "unavailable" ? "El envío no está disponible en este momento. Intenta en unos minutos." : "Ya enviaste varios correos en poco tiempo. Espera un momento.",
      { retry_after: verdict.retryAfter });
  }

  const checked = validateSelectionRequest(body, { trip, marks: await deps.marks(tripId), now: deps.now });
  // (el tsconfig de la app no es strict y no estrecha la unión por `ok`)
  if (!checked.ok) { const e = checked as ValidationError; return fail(e.status, e.code, e.message); }
  const input = (checked as ValidationOk).input;

  // Destinatarios: la persona autenticada, o (si lo eligió) los miembros del viaje que marcó.
  const to = body.to === "members" ? "members" : "me";
  let recipients: Member[];
  if (to === "me") {
    recipients = [me];
  } else {
    const ids: string[] = Array.isArray(body.member_ids) ? [...new Set(body.member_ids.map(String))] : [];
    if (!ids.length) return fail(400, "sin_destinatarios", "Marca a quién se lo mandamos.");
    if (ids.length > MAX_MEMBER_RECIPIENTS) return fail(400, "demasiados_destinatarios", `Máximo ${MAX_MEMBER_RECIPIENTS} personas por envío.`);
    const byId = new Map(members.map((m) => [m.id, m]));
    if (ids.some((id) => !byId.has(id))) return fail(403, "destinatario_invalido", "Solo se puede mandar a personas de este viaje.");
    recipients = ids.map((id) => byId.get(id)!);
  }

  const quota = await tripSendQuota(deps.hit, tripId);
  if (!quota.allowed) {
    return fail(quota.unavailable ? 503 : 429, quota.unavailable ? "no_disponible" : "limite_viaje",
      quota.unavailable ? "El envío no está disponible en este momento. Intenta en unos minutos." : "Este viaje ya mandó varios resúmenes en la última hora. Intenta más tarde.",
      { retry_after: quota.retryAfter });
  }

  let sent = 0;
  const failed: string[] = [];
  for (const r of recipients) {
    const address = r.id === deps.user.id ? (deps.user.email ?? (await deps.emailOf(r.id))) : await deps.emailOf(r.id);
    if (!address) { failed.push(r.id); continue; }
    const mail: Email = selectionEmail({
      ...input,
      firstName: r.name,
      senderName: r.id === deps.user.id ? null : me.name ?? "Alguien del viaje",
      siteUrl: deps.siteUrl ?? null,
    });
    const res = await deps.send({ to: address, subject: mail.subject, html: mail.html, text: mail.text });
    if (res.ok) sent++; else failed.push(r.id);
  }
  if (!sent) return fail(502, "no_enviado", "No pudimos enviar el correo. Intenta de nuevo en unos minutos.");
  return { status: 200, body: { ok: true, sent, failed: failed.length } };
}
