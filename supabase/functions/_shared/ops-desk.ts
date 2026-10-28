// Mesa de operaciones: correos (aviso al dueño y respuesta del equipo al usuario) sobre las funciones
// de la migración 20261028180000_mesa_operaciones. Sin Deno: la base (rpc) y el envío llegan por
// parámetro, así lo prueban src/test/opsDesk*.test.ts y lo usan concierge-action, ops-desk y health-check.
//
// Sin duplicados: antes de enviar se RECLAMA el correo en la base (ops_owner_alert_claim /
// team_reply_email_claim; un envío en curso no lo toma nadie más durante 10 min y lo enviado no se
// repite) y al terminar se cierra con el resultado (…_finish). Si el envío falló queda "fallido" con su
// error y health-check lo reintenta (ops_owner_alerts_due / team_reply_emails_due).
import {
  button, callout, type Email, EK, eyebrow, gap, headline, joinText, kvTable, masthead, normalizeSite, para, SERIF, shell, signature,
  textFooter,
} from "./email-kit.ts";
import { escapeHtml, firstNameOf, oneLine, safeUrl } from "./email-format.ts";
import { conciergeRequestOpsEmail, type OpsRequestInput, requestedTimes } from "./email-ops.ts";
import { folioOf, opsTypeLabel, userStageText } from "./ops-labels.ts";

/** Lo que devuelven _ops_request_json / _ops_ai_json (SQL). */
export type OpsItem = {
  source: "concierge_request" | "ai_reservation";
  id: string;
  type: string;
  title: string;
  status: string;
  stage: string;
  created_at?: string | null;
  requested_for?: string | null;
  party_size?: number | null;
  place?: string | null;
  experience?: { name?: string | null; city?: string | null; country?: string | null; timezone?: string | null; source_url?: string | null } | null;
  preferences?: string | null;
  contact_method?: string | null;
  payload?: Record<string, unknown> | null;
  trip?: { id?: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null } | null;
  user?: { id?: string; name?: string | null; email?: string | null } | null;
  ref_code?: string | null;
};

/** Dirección de la mesa para una solicitud (el enlace del correo al dueño). */
export const opsDeskUrl = (siteUrl: string | null | undefined, id?: string | null) =>
  `${normalizeSite(siteUrl)}/admin/operaciones${id ? `?id=${encodeURIComponent(id)}` : ""}`;

// Lo que ya va en su propio renglón del correo (fecha, personas, lugar) o no aporta (tipo y título repetidos).
const SHOWN = new Set(["fecha", "hora", "personas", "lugar", "tipo", "titulo", "party_size", "requested_for"]);

/** Datos de la solicitud (SQL) → entrada del correo al dueño, con el enlace directo a la mesa. */
export function ownerAlertInput(a: OpsItem, siteUrl?: string | null): OpsRequestInput {
  const p = (a.payload && typeof a.payload === "object" ? a.payload : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  let experience: OpsRequestInput["experience"] = null;
  if (a.experience?.name) {
    experience = { name: a.experience.name, city: a.experience.city ?? null, country: a.experience.country ?? null,
      sourceUrl: a.experience.source_url ?? null, timezone: a.experience.timezone ?? null };
  } else if (a.type === "members_nightlife_reservation" && str(p.venue_name)) {
    experience = { name: str(p.venue_name)!, city: str(p.ciudad), sourceUrl: str(p.website) };
  } else if (str(a.place)) {
    experience = { name: str(a.place)! };
  }
  const payload = Object.fromEntries(Object.entries(p).filter(([k]) =>
    !SHOWN.has(k) && !(a.type === "members_nightlife_reservation" && ["venue_name", "ciudad", "website"].includes(k)))
    .map(([k, v]) => [k, k === "origen" && v === "iato" ? "Iato (chat del concierge)" : v]));
  return {
    requestId: a.id,
    type: a.type,
    title: a.title,
    createdAt: a.created_at ?? null,
    client: { name: a.user?.name ?? null, email: a.user?.email ?? null, contactMethod: a.contact_method ?? null },
    trip: a.trip ? { destination: a.trip.destino ?? null, dateFrom: a.trip.fecha_salida ?? null, dateTo: a.trip.fecha_regreso ?? null } : null,
    experience,
    requestedFor: a.requested_for ?? null,
    partySize: Number(a.party_size) > 0 ? Number(a.party_size) : null,
    preferences: a.preferences ?? null,
    payload,
    adminUrl: opsDeskUrl(siteUrl, a.id),
    siteUrl: siteUrl ?? null,
  };
}

/** Correo al dueño (FIXER_EMAIL) para una solicitud nueva. */
export const ownerAlertEmail = (a: OpsItem, siteUrl?: string | null): Email => conciergeRequestOpsEmail(ownerAlertInput(a, siteUrl));

// ───────────────────────────── respuesta del equipo al usuario ─────────────────────────────

export type ReplyClaim = {
  reply: { id: string; kind: "respuesta" | "resuelta" | "no_se_pudo"; body: string; evidence?: string | null; source: string; source_id: string };
  to: string;
  name?: string | null;
  item: OpsItem;
};

const KIND_TITLE: Record<string, string> = {
  respuesta: "Te respondió el equipo IATOS",
  resuelta: "Tu solicitud quedó resuelta",
  no_se_pudo: "No pudimos completar tu solicitud",
};

/** Dónde ve el usuario sus solicitudes en la app. */
export const myRequestsUrl = (siteUrl?: string | null) => `${normalizeSite(siteUrl)}/dashboard/concierge?tab=solicitudes`;

/**
 * Correo al usuario con la respuesta de una persona del equipo. Dice qué pidió (lugar, fecha,
 * personas), el mensaje tal cual lo escribió el equipo, el estado real (nunca "reservado" si no lo
 * está) y dónde verlo en la app. No promete tiempos.
 */
export function teamReplyEmail(c: ReplyClaim, siteUrl?: string | null, supportEmail?: string | null): Email {
  const site = normalizeSite(siteUrl);
  const it = c.item;
  const name = firstNameOf(c.name);
  const type = opsTypeLabel(it.type);
  const place = oneLine(it.place ?? it.experience?.name, 120) || null;
  const what = place ? `${type} · ${place}` : (oneLine(it.title, 160) || type);
  const times = requestedTimes(it.requested_for, it.experience?.timezone ?? null);
  const party = Number(it.party_size) > 0 ? Math.round(Number(it.party_size)) : null;
  const folio = it.ref_code || folioOf(it.id);
  const stage = userStageText(it.stage, it.type);
  const open = it.stage === "nueva" || it.stage === "en_proceso";
  const body = oneLine(c.reply.body.replace(/\s*\n\s*/g, " ¶ "), 2000).replace(/ ¶ /g, "\n");
  const evidence = oneLine(c.reply.evidence, 500) || null;
  const evidenceUrl = evidence && /^https:\/\//i.test(evidence) ? safeUrl(evidence) : null;
  const title = KIND_TITLE[c.reply.kind] ?? KIND_TITLE.respuesta;
  const subject = oneLine(`${title}: ${what}`, 150);
  const preheader = oneLine(body, 120);
  const url = myRequestsUrl(site);

  const html = shell({
    title: subject, preheader, siteUrl: site, supportEmail,
    reason: "Recibes este correo porque le pediste a Iato algo que atiende una persona del equipo IATOS.",
    body: [
      masthead(`Folio ${folio}`),
      gap(40),
      eyebrow(type),
      gap(12),
      headline(escapeHtml(title)),
      gap(18),
      name ? para(`${escapeHtml(name)},`, { serif: true, color: EK.gold, size: 17 }) + gap(10) : "",
      `<tr><td class="ek-pad" style="padding:0 56px;font-family:${SERIF};font-size:19px;line-height:29px;color:${EK.ivory};white-space:pre-line;">${escapeHtml(body)}</td></tr>`,
      gap(26),
      kvTable([
        { k: "Tu solicitud", v: escapeHtml(what) },
        times.venue ? { k: "Fecha y hora", v: escapeHtml(times.venue) } : null,
        party ? { k: "Personas", v: String(party) } : null,
        { k: "Estado", v: escapeHtml(stage + (open ? " · aún no es una reserva" : "")) },
        evidence ? { k: "Comprobante", v: evidenceUrl
          ? `<a href="${escapeHtml(evidenceUrl)}" style="color:${EK.gold};text-decoration:none;word-break:break-all;">${escapeHtml(oneLine(evidence, 80))}</a>`
          : escapeHtml(evidence) } : null,
        { k: "Folio", v: escapeHtml(folio) },
      ]),
      gap(26),
      callout(escapeHtml("Lo escribió una persona del equipo IATOS. También lo ves en la app, en Concierge › Mis solicitudes. Si respondes a este correo, nos llega a nosotros.")),
      gap(30),
      button(url, "Ver mis solicitudes"),
      gap(44),
      signature(),
    ],
  });
  const text = joinText([
    `IATOS · ${type} · Folio ${folio}`,
    "",
    name ? `${name},` : null,
    title,
    "",
    body,
    "",
    `Tu solicitud: ${what}`,
    times.venue ? `Fecha y hora: ${times.venue}` : null,
    party ? `Personas: ${party}` : null,
    `Estado: ${stage}${open ? " · aún no es una reserva" : ""}`,
    evidence ? `Comprobante: ${evidence}` : null,
    "",
    "Lo escribió una persona del equipo IATOS. También lo ves en la app, en Concierge › Mis solicitudes.",
    `Ver mis solicitudes: ${url}`,
    "",
    ...textFooter({ reason: "Recibes este correo porque le pediste a Iato algo que atiende una persona del equipo IATOS.", siteUrl: site, supportEmail }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── envío con marca (sin duplicados) ─────────────────────────────

type RpcResult = { data: unknown; error: { message: string } | null };
export interface OpsMailDeps {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  send: (m: { to: string; subject: string; html: string; text: string; replyTo?: string; from?: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  siteUrl?: string | null;
  ownerEmail: string;
  ownerFrom?: string;
  replyFrom?: string;
  replyTo?: string;
  supportEmail?: string | null;
  warn?: (...a: unknown[]) => void;
}

const errText = (e: unknown) => oneLine(e instanceof Error ? e.message : String(e ?? "error"), 300) || "error";

/**
 * Aviso al dueño de UNA solicitud (lo llama concierge-action justo después de crearla). Si la base
 * todavía no tiene la migración de la mesa (la función de reclamo no existe), el aviso se manda igual
 * con `fallback` (lo que concierge-action ya tiene a mano), sin marca: nunca se pierde por el orden
 * de despliegue.
 */
export async function sendOwnerAlert(
  d: OpsMailDeps, requestId: string, opts: { replyTo?: string | null; fallback?: OpsItem | null } = {},
): Promise<{ notified: boolean; code?: string }> {
  const { data, error } = await d.rpc("ops_owner_alert_claim", { _id: requestId });
  const claim = data as { ok?: boolean; code?: string; alert?: OpsItem } | null;
  if (error) {
    d.warn?.("ops: no se pudo reclamar el aviso", oneLine(error.message, 200));
    if (!opts.fallback) return { notified: false, code: "CLAIM_FAILED" };
    return await deliverOwnerAlert(d, opts.fallback, opts.replyTo ?? null, false);
  }
  if (!claim?.ok || !claim.alert) return { notified: claim?.code === "ALREADY_SENT", code: claim?.code ?? "NOT_CLAIMED" };
  return await deliverOwnerAlert(d, claim.alert, opts.replyTo ?? claim.alert.user?.email ?? null, true);
}

async function deliverOwnerAlert(d: OpsMailDeps, a: OpsItem, replyTo: string | null, mark: boolean): Promise<{ notified: boolean; code?: string }> {
  let ok = false, id: string | undefined, err: string | undefined;
  try {
    const m = ownerAlertEmail(a, d.siteUrl);
    const r = await d.send({ to: d.ownerEmail, from: d.ownerFrom, subject: m.subject, html: m.html, text: m.text, ...(replyTo ? { replyTo } : {}) });
    ok = !!r.ok; id = r.id; err = r.error;
  } catch (e) {
    err = errText(e);
  }
  if (mark) await d.rpc("ops_owner_alert_finish", { _id: a.id, _ok: ok, _email_id: id ?? null, _error: ok ? null : (err ?? "send_failed") });
  return { notified: ok, code: ok ? undefined : "SEND_FAILED" };
}

/** Correo al usuario con UNA respuesta del equipo (lo llama ops-desk justo después de la acción). */
export async function sendTeamReply(d: OpsMailDeps, replyId: string): Promise<{ email_status: string; code?: string }> {
  const { data, error } = await d.rpc("team_reply_email_claim", { _reply_id: replyId });
  if (error) return { email_status: "pendiente", code: "CLAIM_FAILED" };
  const c = data as ({ ok?: boolean; code?: string; email_status?: string } & Partial<ReplyClaim>) | null;
  if (!c?.ok || !c.reply || !c.to || !c.item) {
    return { email_status: c?.email_status ?? (c?.code === "IN_FLIGHT" ? "pendiente" : "fallido"), code: c?.code ?? "NOT_CLAIMED" };
  }
  return await deliverReply(d, c as ReplyClaim);
}

async function deliverReply(d: OpsMailDeps, c: ReplyClaim): Promise<{ email_status: string; code?: string }> {
  let ok = false, id: string | undefined, err: string | undefined;
  try {
    const m = teamReplyEmail(c, d.siteUrl, d.supportEmail);
    const r = await d.send({ to: c.to, from: d.replyFrom, subject: m.subject, html: m.html, text: m.text, ...(d.replyTo ? { replyTo: d.replyTo } : {}) });
    ok = !!r.ok; id = r.id; err = r.error;
  } catch (e) {
    err = errText(e);
  }
  await d.rpc("team_reply_email_finish", { _reply_id: c.reply.id, _ok: ok, _email_id: id ?? null, _error: ok ? null : (err ?? "send_failed") });
  return { email_status: ok ? "enviado" : "fallido", code: ok ? undefined : "SEND_FAILED" };
}

/** Reintento (health-check): avisos al dueño y respuestas a usuarios que no salieron. */
export async function retryOpsEmails(d: OpsMailDeps, limit = 20): Promise<{ owner: { sent: number; failed: number }; replies: { sent: number; failed: number }; errors: string[] }> {
  const out = { owner: { sent: 0, failed: 0 }, replies: { sent: 0, failed: 0 }, errors: [] as string[] };
  const due = await d.rpc("ops_owner_alerts_due", { _limit: limit });
  if (due.error) out.errors.push(`ops_owner_alerts_due: ${oneLine(due.error.message, 120)}`);
  for (const a of (Array.isArray(due.data) ? due.data : []) as OpsItem[]) {
    const r = await deliverOwnerAlert(d, a, a.user?.email ?? null, true);
    if (r.notified) out.owner.sent++; else out.owner.failed++;
  }
  const replies = await d.rpc("team_reply_emails_due", { _limit: limit });
  if (replies.error) out.errors.push(`team_reply_emails_due: ${oneLine(replies.error.message, 120)}`);
  for (const c of (Array.isArray(replies.data) ? replies.data : []) as ReplyClaim[]) {
    const r = await deliverReply(d, c);
    if (r.email_status === "enviado") out.replies.sent++; else out.replies.failed++;
  }
  return out;
}
