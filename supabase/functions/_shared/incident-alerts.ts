// Incidentes: avisos al EQUIPO HUMANO (correo + push web + canales que estén prendidos) y el vigilante.
// Puro: la base (rpc), el correo/canales y el push llegan por parámetro (se prueba con Vitest).
//
// Sin duplicados ni pérdidas: la base encola cada aviso (incident_alerts, clave única por motivo); aquí se
// RECLAMA (incident_alerts_claim: un aviso en curso no lo toma otro reparto 5 min), se envía y se cierra
// con el resultado (incident_alert_finish, que lo anota en la bitácora). Si nada salió, queda "fallido" y el
// vigilante lo reintenta (hasta 5). Si el correo falla, se intenta por otro canal prendido (push, WhatsApp…).
import {
  button, callout, EK, eyebrow, gap, headline, joinText, kvTable, masthead, normalizeSite, para, SERIF, shell, textFooter, type Email,
} from "./email-kit.ts";
import { escapeHtml, firstNameOf, formatDateTime, oneLine } from "./email-format.ts";
import { opsDeskUrl } from "./ops-desk.ts";
import {
  categoryLabel, COMPLAINT_SUBTYPE_LABEL, EXPECTATION_LABEL, INCIDENT_SEVERITY_LABEL, isComplaintSubtype, isExpectation, isSentiment,
  isSeverity, localClock, SENTIMENT_LABEL,
} from "./incident-labels.ts";
import type { IncidentDb } from "./incidents.ts";
import { watchIncidents } from "./incidents.ts";
import type { ChannelId, ChannelSendResult } from "./channels/types.ts";
import type { ChannelRegistry } from "./channels/registry.ts";

// ───────────────────────────── tipos (lo que devuelve incident_alerts_claim) ─────────────────────────────

export type IncidentInfo = {
  category?: string; category_label?: string; severity?: string; origin?: string; assignee?: string; escalation_level?: number;
  needs_human?: boolean; needs_human_reason?: string | null; received_at?: string; first_response_at?: string | null;
  first_human_response_at?: string | null; taken_at?: string | null; next_step?: string | null; next_step_due_at?: string | null;
  minutes_unattended?: number | null; semaforo?: string; resolution_state?: string | null; reopen_count?: number; take_minutes?: number;
  unanswered_user_message?: boolean;
};

export type AlertItem = {
  id: string;
  type: string;
  title: string;
  stage?: string;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
  trip?: { id?: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null } | null;
  user?: { id?: string; name?: string | null; email?: string | null } | null;
  owner?: { id?: string; name?: string | null; email?: string | null } | null;
  incident?: IncidentInfo | null;
};

export type AlertRecipient = {
  email: string; name?: string | null; role?: "primario" | "respaldo" | string; timezone?: string | null; phone?: string | null;
  telegram_chat_id?: string | null; channels?: string[]; user_id?: string | null; on_duty?: boolean; fallback?: boolean;
};

export type AlertReason =
  | "nuevo" | "sin_avance" | "sin_tomar" | "necesita_humano" | "manual" | "mensaje_sin_respuesta" | "promesa_vencida" | "operador_caido"
  | "reabierto" | "confirmacion_pendiente" | "canal_fallido";

export type AlertClaim = {
  alert: { id: string; level: number; reason: AlertReason; note?: string | null; created_at?: string; attempt?: number };
  item: AlertItem;
  recipients: AlertRecipient[];
};

export const ALERT_REASON_TEXT: Record<AlertReason, string> = {
  nuevo: "Nuevo incidente",
  sin_avance: "Sin avance a tiempo",
  sin_tomar: "ESCALADO: nadie lo ha tomado",
  necesita_humano: "El operador pide a una persona",
  manual: "Escalado desde la mesa",
  mensaje_sin_respuesta: "El viajero escribió y nadie le ha respondido",
  promesa_vencida: "Venció la hora que le prometimos al viajero",
  operador_caido: "El operador IA no responde",
  reabierto: "El viajero dice que NO quedó resuelto",
  confirmacion_pendiente: "Falta cerrarlo: el viajero no ha confirmado",
  canal_fallido: "Un canal falló",
};

const SEV_TAG: Record<string, string> = { critica: "[CRÍTICA]", alta: "[ALTA]", media: "[MEDIA]", baja: "[BAJA]" };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ───────────────────────────── contenido del aviso ─────────────────────────────

export type AlertFacts = {
  folio: string; severity: string; severityLabel: string; category: string; who: string; email: string | null; where: string | null;
  mapUrl: string | null; travelerClock: string | null; tz: string | null; what: string; refs: string | null; trip: string | null;
  done: string[]; complaint: string | null; unattended: string | null; nextStep: string | null; holder: string; reason: string;
  deskUrl: string; level: number;
};

/** Lo que el equipo necesita para actuar: quién, dónde, hora local del viajero, qué pasó, qué ya se hizo. */
export function alertFacts(c: AlertClaim, siteUrl?: string | null, now: Date = new Date()): AlertFacts {
  const it = c.item;
  const p = (it.payload ?? {}) as Record<string, unknown>;
  const inc = it.incident ?? {};
  const u = (p.ubicacion ?? {}) as Record<string, unknown>;
  const r = (p.refs ?? {}) as Record<string, unknown>;
  const sev = isSeverity(inc.severity) ? inc.severity : isSeverity(p.severidad) ? (p.severidad as string) : "media";
  const tz = str(u.zona_horaria);
  const lat = typeof u.lat === "number" ? u.lat : null;
  const lng = typeof u.lng === "number" ? u.lng : null;
  const own = localClock(tz, now);
  const cdmx = localClock("America/Mexico_City", now);
  const where = [str(u.direccion), str(u.ciudad), str(u.pais)].filter(Boolean).join(", ") || null;
  const acciones = Array.isArray(p.acciones_tomadas) ? (p.acciones_tomadas as unknown[]).map(str).filter((x): x is string => !!x) : [];
  const done = [...acciones];
  if (inc.first_response_at && !done.some((d) => /gu[ií]a/i.test(d))) done.push("Iato le dio la guía inmediata (qué hacer ahora)");
  const q = (p.queja ?? null) as Record<string, unknown> | null;
  const complaint = q || p.sentimiento || p.expectativa ? [
    q && isComplaintSubtype(q.subtipo) ? `Queja: ${COMPLAINT_SUBTYPE_LABEL[q.subtipo]}` : null,
    isSentiment(p.sentimiento) ? `Ánimo: ${SENTIMENT_LABEL[p.sentimiento]}` : null,
    isExpectation(p.expectativa) ? `Espera: ${EXPECTATION_LABEL[p.expectativa]}` : null,
  ].filter(Boolean).join(" · ") || null : null;
  const mins = typeof inc.minutes_unattended === "number" ? inc.minutes_unattended : null;
  const due = inc.next_step_due_at ? new Date(inc.next_step_due_at) : null;
  const dueText = due && Number.isFinite(due.getTime())
    ? `${localClock(tz, due) ? `${localClock(tz, due)} hora del viajero · ` : ""}${localClock("America/Mexico_City", due)} CDMX` : null;
  const holder = it.owner?.name || it.owner?.email ? `Lo tiene ${it.owner?.name ?? it.owner?.email}`
    : inc.assignee === "iato_ops" ? "Operador IA (iato_ops)" : "Nadie del equipo lo ha tomado";
  const folio = String(it.id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
  return {
    folio,
    severity: sev,
    severityLabel: INCIDENT_SEVERITY_LABEL[sev as keyof typeof INCIDENT_SEVERITY_LABEL] ?? sev,
    category: categoryLabel(str(inc.category) ?? str(p.categoria)),
    who: oneLine(it.user?.name, 120) || oneLine(it.user?.email, 200) || "Usuario sin nombre",
    email: oneLine(it.user?.email, 200) || null,
    where,
    mapUrl: lat !== null && lng !== null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null,
    travelerClock: own ? `${own} (${tz})` : cdmx ? `Sin zona horaria del viajero · ${cdmx} en CDMX` : null,
    tz,
    what: oneLine(String(p.descripcion ?? it.title ?? "").replace(/\s*\n\s*/g, " ¶ "), 2000).replace(/ ¶ /g, "\n"),
    refs: [str(r.vuelo) ? `Vuelo ${r.vuelo}` : null, str(r.fecha_vuelo), str(r.pnr) ? `PNR ${r.pnr}` : null,
      str(r.proveedor) ? `Proveedor: ${r.proveedor}` : null, str(r.reserva) ? `Reserva: ${r.reserva}` : null].filter(Boolean).join(" · ") || null,
    trip: it.trip?.destino ? [it.trip.destino, [it.trip.fecha_salida, it.trip.fecha_regreso].filter(Boolean).join(" → ")].filter(Boolean).join(" · ") : null,
    done,
    complaint,
    unattended: mins !== null ? (mins < 60 ? `${mins} min sin que una persona lo tome` : `${Math.floor(mins / 60)} h ${mins % 60} min sin que una persona lo tome`) : null,
    nextStep: inc.next_step ? `${inc.next_step}${dueText ? ` · prometido para las ${dueText}` : ""}` : null,
    holder,
    reason: `${ALERT_REASON_TEXT[c.alert.reason] ?? c.alert.reason}${c.alert.note ? ` · ${c.alert.note}` : ""}`,
    deskUrl: opsDeskUrl(siteUrl, it.id),
    level: Number(c.alert.level ?? 1),
  };
}

const LEVEL_TEXT = (lvl: number) => (lvl <= 0 ? "Aviso (lo atiende el operador IA)" : lvl === 1 ? "Nivel 1 · primario de guardia" : `Nivel ${lvl} · primario y respaldo`);

/** Correo al equipo: accionable en 10 segundos. */
export function incidentTeamAlertEmail(c: AlertClaim, siteUrl?: string | null, now: Date = new Date()): Email {
  const site = normalizeSite(siteUrl);
  const f = alertFacts(c, site, now);
  const short = c.alert.reason === "nuevo" ? "Nuevo" : (ALERT_REASON_TEXT[c.alert.reason] ?? "Aviso").replace(/^ESCALADO: /, "Escalado: ");
  const subject = oneLine(`${SEV_TAG[f.severity] ?? ""} ${short} · ${f.category} · ${f.who}${f.where ? ` · ${f.where}` : ""} · Folio ${f.folio}`, 190);
  const preheader = oneLine(`${f.travelerClock ? `${f.travelerClock.split(" (")[0]} hora del viajero · ` : ""}${f.what}`, 140);
  const html = shell({
    title: subject, preheader, siteUrl: site, compact: true,
    reason: "Correo interno de IATOS: aviso de incidente para el equipo de guardia.",
    body: [
      masthead(`Incidente · Folio ${f.folio}`),
      gap(28),
      eyebrow(`${f.severityLabel.toUpperCase()} · ${f.reason}`, { color: f.severity === "critica" ? "#ff8a80" : EK.gold }),
      gap(12),
      headline(escapeHtml(`${f.category}: ${f.who}`), { size: 28 }),
      gap(16),
      `<tr><td class="ek-pad" style="padding:0 56px;font-family:${SERIF};font-size:19px;line-height:29px;color:${EK.ivory};white-space:pre-line;">${escapeHtml(f.what)}</td></tr>`,
      gap(22),
      kvTable([
        { k: "Aviso", v: escapeHtml(`${f.reason} · ${LEVEL_TEXT(f.level)}`) },
        { k: "Quién", v: escapeHtml(f.who) + (f.email ? ` · <a href="mailto:${escapeHtml(f.email)}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(f.email)}</a>` : "") },
        f.where || f.mapUrl ? { k: "Dónde", v: escapeHtml(f.where ?? "Ubicación compartida") + (f.mapUrl ? ` · <a href="${escapeHtml(f.mapUrl)}" style="color:${EK.gold};text-decoration:none;">mapa</a>` : "") } : null,
        f.travelerClock ? { k: "Hora del viajero", v: escapeHtml(f.travelerClock) } : null,
        f.refs ? { k: "Referencias", v: escapeHtml(f.refs) } : null,
        f.trip ? { k: "Viaje", v: escapeHtml(f.trip) } : null,
        { k: "Ya hizo Iato", v: escapeHtml(f.done.length ? f.done.join(" · ") : "Nada todavía") },
        f.complaint ? { k: "Queja", v: escapeHtml(f.complaint) } : null,
        f.unattended ? { k: "Sin atender", v: escapeHtml(f.unattended) } : null,
        f.nextStep ? { k: "Siguiente paso", v: escapeHtml(f.nextStep) } : null,
        { k: "Quién lo tiene", v: escapeHtml(f.holder) },
        { k: "Recibido", v: escapeHtml(`${formatDateTime(c.item.created_at ?? now.toISOString()) ?? ""} (CDMX)`) },
        { k: "Folio", v: escapeHtml(f.folio) },
      ]),
      gap(22),
      callout(escapeHtml("Ábrelo en la mesa: Tomar → Responder al viajero (app y correo) → Marcar resuelto con nota. Si no puedes, Escalar avisa al respaldo.")),
      gap(24),
      button(f.deskUrl, "Abrir en la mesa"),
      gap(12),
      para("Si nadie lo toma a tiempo, el sistema vuelve a avisar y escala al siguiente responsable.", { align: "center", size: 12, color: EK.muted }),
    ],
  });
  const text = joinText([
    `${SEV_TAG[f.severity] ?? ""} INCIDENTE · ${f.category} · Folio ${f.folio}`,
    `Aviso: ${f.reason} · ${LEVEL_TEXT(f.level)}`,
    "",
    f.what,
    "",
    `Quién: ${f.who}${f.email ? ` · ${f.email}` : ""}`,
    f.where ? `Dónde: ${f.where}` : null,
    f.mapUrl ? `Mapa: ${f.mapUrl}` : null,
    f.travelerClock ? `Hora del viajero: ${f.travelerClock}` : null,
    f.refs ? `Referencias: ${f.refs}` : null,
    f.trip ? `Viaje: ${f.trip}` : null,
    `Ya hizo Iato: ${f.done.length ? f.done.join(" · ") : "Nada todavía"}`,
    f.complaint ? `Queja: ${f.complaint}` : null,
    f.unattended ? `Sin atender: ${f.unattended}` : null,
    f.nextStep ? `Siguiente paso: ${f.nextStep}` : null,
    `Quién lo tiene: ${f.holder}`,
    "",
    `Abrir en la mesa: ${f.deskUrl}`,
    "",
    ...textFooter({ reason: "Correo interno de IATOS: aviso de incidente para el equipo de guardia.", siteUrl: site, internal: true }),
  ]);
  return { subject, preheader, html, text };
}

/** Push web al equipo (y texto corto para WhatsApp/SMS/Telegram). */
export function incidentTeamPush(c: AlertClaim, siteUrl?: string | null, now: Date = new Date()): { title: string; body: string; url: string } {
  const f = alertFacts(c, siteUrl, now);
  const first = firstNameOf(c.item.user?.name) ?? f.who;
  return {
    title: oneLine(`${SEV_TAG[f.severity] ?? ""} ${f.category} · ${first}`, 90),
    body: oneLine([f.where, f.travelerClock ? f.travelerClock.split(" (")[0] + " su hora" : null, f.what].filter(Boolean).join(" · "), 180),
    url: `/admin/operaciones?id=${encodeURIComponent(c.item.id)}`,
  };
}

export function incidentTeamShortText(c: AlertClaim, siteUrl?: string | null, now: Date = new Date()): string {
  const f = alertFacts(c, siteUrl, now);
  return [
    `IATOS ${SEV_TAG[f.severity] ?? ""} ${f.category} · Folio ${f.folio}`,
    f.reason,
    `${f.who}${f.where ? ` · ${f.where}` : ""}${f.travelerClock ? ` · ${f.travelerClock.split(" (")[0]} su hora` : ""}`,
    oneLine(f.what, 300),
    f.deskUrl,
  ].join("\n");
}

// ───────────────────────────── reparto ─────────────────────────────

export interface IncidentAlertDeps {
  rpc: IncidentDb["rpc"];
  channels: ChannelRegistry;
  /** Push web a un usuario (pushToUser de _shared/push.ts). Sin VAPID devuelve 0. */
  push?: ((userId: string, payload: { title: string; body: string; url: string }) => Promise<number>) | null;
  siteUrl?: string | null;
  /** FIXER_EMAIL (teamEmails()): guardia por defecto si incident_oncall está vacía. */
  fallbackEmails: string[];
  emailFrom?: string;
  now?: () => Date;
  warn?: (...a: unknown[]) => void;
}

export type AlertDelivery = {
  alertId: string;
  ok: boolean;
  email: { to: string; ok: boolean; id?: string | null; error?: string | null }[];
  push: { users: number; sent: number };
  otros: ChannelSendResult[];
  apagados: ChannelId[];
};

const EXTRA_CHANNELS: ChannelId[] = ["whatsapp", "telegram", "sms", "voz"];

async function deliverOne(d: IncidentAlertDeps, c: AlertClaim): Promise<AlertDelivery> {
  const now = d.now?.() ?? new Date();
  const recipients = (Array.isArray(c.recipients) && c.recipients.length ? c.recipients
    : d.fallbackEmails.slice(0, 1).map((email) => ({ email, role: "primario", channels: ["email", "push"] } as AlertRecipient)));
  const mail = incidentTeamAlertEmail(c, d.siteUrl, now);
  const pushPayload = incidentTeamPush(c, d.siteUrl, now);
  const short = incidentTeamShortText(c, d.siteUrl, now);
  const sev = c.item.incident?.severity ?? (c.item.payload as Record<string, unknown> | null)?.severidad;
  const out: AlertDelivery = { alertId: c.alert.id, ok: false, email: [], push: { users: 0, sent: 0 }, otros: [], apagados: [] };
  const ctx = { incidentId: c.item.id, purpose: "alerta_equipo" as const };

  for (const r of recipients) {
    const chans = new Set(r.channels ?? ["email", "push"]);
    // 1) correo
    const em = await d.channels.send("email", r.email, { subject: mail.subject, text: mail.text, html: mail.html, from: d.emailFrom ?? null }, ctx);
    out.email.push({ to: r.email, ok: em.ok, id: em.providerMessageId ?? null, error: em.ok ? null : em.error ?? em.code ?? null });
    // 2) push web si tiene cuenta con suscripción
    let pushed = 0;
    if (d.push && r.user_id && chans.has("push")) {
      out.push.users++;
      try { pushed = await d.push(r.user_id, pushPayload); } catch (e) { d.warn?.("incidentes: push falló", e instanceof Error ? e.message : e); }
      out.push.sent += pushed;
    }
    // 3) canales extra: en críticos siempre; en los demás solo si el correo falló (respaldo).
    const extra = EXTRA_CHANNELS.filter((ch) => chans.has(ch));
    if (extra.length && (sev === "critica" || !em.ok)) {
      for (const ch of extra) {
        const to = ch === "telegram" ? r.telegram_chat_id : r.phone;
        if (!to) continue;
        if (!d.channels.isEnabled(ch)) { if (!out.apagados.includes(ch)) out.apagados.push(ch); continue; }
        const res = await d.channels.send(ch, to, { subject: mail.subject, text: short }, ctx);
        out.otros.push(res);
        if (res.ok && sev !== "critica") break;
      }
    }
  }
  out.ok = out.email.some((e) => e.ok) || out.push.sent > 0 || out.otros.some((o) => o.ok);
  return out;
}

/**
 * Reparte los avisos pendientes (o los de un incidente). Lo llaman: la función incidente (justo después de
 * crear el caso), ops-desk (al escalar desde la mesa) y el vigilante (cada 2 min: reintentos y escalamientos).
 */
export async function deliverIncidentAlerts(d: IncidentAlertDeps, opts: { requestId?: string | null; limit?: number } = {}):
  Promise<{ claimed: number; sent: number; failed: number; deliveries: AlertDelivery[]; error?: string }> {
  const { data, error } = await d.rpc("incident_alerts_claim", {
    _fallback: d.fallbackEmails, _limit: opts.limit ?? 20, _request_id: opts.requestId ?? null,
  });
  if (error) return { claimed: 0, sent: 0, failed: 0, deliveries: [], error: oneLine(error.message, 200) };
  const claims = (Array.isArray(data) ? data : []) as AlertClaim[];
  const deliveries: AlertDelivery[] = [];
  let sent = 0, failed = 0;
  for (const c of claims) {
    let r: AlertDelivery;
    try {
      r = await deliverOne(d, c);
    } catch (e) {
      r = { alertId: c.alert.id, ok: false, email: [], push: { users: 0, sent: 0 }, otros: [], apagados: [] };
      d.warn?.("incidentes: reparto falló", e instanceof Error ? e.message : e);
    }
    deliveries.push(r);
    if (r.ok) sent++; else failed++;
    const errText = r.ok ? null : oneLine(r.email.map((e) => e.error).filter(Boolean).join("; ") || "ningún canal entregó", 300);
    await d.rpc("incident_alert_finish", {
      _alert_id: c.alert.id, _ok: r.ok, _error: errText,
      _result: { email: r.email.map((e) => ({ to: e.to, ok: e.ok })), push: r.push, otros: r.otros.map((o) => ({ channel: o.channel, ok: o.ok, code: o.code ?? null })),
        apagados: r.apagados },
    });
  }
  return { claimed: claims.length, sent, failed, deliveries };
}

/** Vigilante: revisa casos (escala lo que toca) y reparte los avisos pendientes. */
export async function runIncidentWatch(d: IncidentAlertDeps & { admin: IncidentDb }) {
  const watch = await watchIncidents(d.admin);
  const delivered = await deliverIncidentAlerts(d, { limit: 50 });
  const channels = d.channels.status().map((s) => ({ id: s.id, state: s.state, missing: s.missing }));
  return { ok: watch.ok && !delivered.error, watch, delivered: { claimed: delivered.claimed, sent: delivered.sent, failed: delivered.failed, error: delivered.error }, channels };
}
