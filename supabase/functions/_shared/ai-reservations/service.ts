// Orquestación de Reservas IA (sin Deno): la usan las tres edge functions y el Booking Bridge.
// Todas las dependencias (base de datos, correo, Claude, red) se inyectan, así que cada flujo se
// prueba de punta a punta con dobles en src/test/aiReservationsService.test.ts.
//
// API para Concierge 2.0 y el Booking Bridge: ver docs/iatos/IATOS_RESERVAS_IA.md §API.
import {
  type AiReservationRow, type AiReservationStatus, bareAddress, confirmPrompt, cronDecision, DEFAULT_FROM_ADDRESS,
  DEFAULT_LIMITS, DEFAULT_REPLY_DOMAIN, domainOf, extractReplyToken, formatLocal, htmlToText, isLocalDateTime, type Limits,
  replyAddress, senderAuthentication, type SenderVerdict, statusLabel, stripQuotedReply, toBridgeState,
} from "./core.ts";
import { ClassifierUnavailable, classifyReply, decideReply, type ModelCall, type ReplyDecision } from "./classifier.ts";
import { ambiguousReasonEs, quotedRequestLinked } from "./evidence.ts";
import { type ContactDeps, discoverVenueContact } from "./contact.ts";
import { signLink, verifyLink, verifySvixSignature } from "./signature.ts";
import {
  type Mail, reservationIcs, userConfirmedEmail, userUpdateEmail, venueAlternativeEmail, venueCancellationEmail,
  venueReminderEmail, venueRequestEmail,
} from "./templates.ts";

type RpcResult<T> = { data: T | null; error: { message: string } | null };
export type Db = {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>>;
};
export type OutgoingMail = { to: string | string[]; subject: string; html: string; text: string; from?: string; replyTo?: string };
/** Lo que usamos de GET /emails/receiving/{id} de Resend (forma documentada, consultada 2026-10-22). */
export type ReceivedEmail = {
  id?: string;
  from?: string;
  to?: unknown[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  created_at?: string;
  /** Calculados por el servidor que recibe ('pass' | 'fail' | 'gray' | 'processing_failed' | 'unknown'); null en correos viejos. */
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  message_id?: string | null;
  reply_to?: unknown;
  headers?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  raw?: { download_url?: string; expires_at?: string } | null;
};

/**
 * A2-RES-07 · Encabezados From del correo descargado, sin importar la forma en que lleguen: objeto
 * ({from}, {From}, {FROM}…) o lista ([{name, value}]). Devuelve la lista de valores From encontrados
 * (puede tener 0, 1 o varios), o null si `headers` existe pero no se puede leer.
 */
export function headerFromValues(headers: unknown): string[] | null {
  if (headers === undefined || headers === null) return [];
  const vals: unknown[] = [];
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || typeof h !== "object" || Array.isArray(h)) return null;
      const o = h as Record<string, unknown>;
      const name = o.name ?? o.key;
      if (typeof name !== "string") return null;
      if (name.trim().toLowerCase() === "from") vals.push(o.value);
    }
  } else if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.trim().toLowerCase() === "from") vals.push(v);
    }
  } else {
    return null;
  }
  const out: string[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) { for (const x of v) { if (typeof x !== "string") return null; out.push(x); } }
    else if (typeof v === "string") out.push(v);
    else return null;
  }
  return out;
}

/**
 * AUD-02 · Veredicto del remitente con lo que dio el proveedor. Además de la regla de
 * senderAuthentication(), el From del webhook, el del correo descargado y el encabezado From crudo
 * deben ser la MISMA dirección: si discrepan, no se puede saber quién escribió → no verificado.
 * A2-RES-07: si el correo trae encabezados, debe haber exactamente UN From legible (sin importar
 * mayúsculas ni si llegan como lista); si no, no se verifica.
 * A2-RES-01: venueWebsite (el sitio oficial guardado en la reserva) decide si el dominio es del lugar.
 */
export function inboundSenderVerdict(webhookFrom: unknown, content: ReceivedEmail, venueEmail: string | null, venueWebsite?: string | null): SenderVerdict {
  const v = senderAuthentication(content.from ?? webhookFrom, venueEmail, content.authentication, venueWebsite);
  const reasons = [...v.reasons];
  if (webhookFrom != null && String(webhookFrom).trim() && bareAddress(webhookFrom) !== v.from_address) reasons.push("webhook_from_mismatch");
  if (content.headers !== undefined && content.headers !== null) {
    const froms = headerFromValues(content.headers);
    if (froms === null) reasons.push("header_from_unreadable");
    else if (froms.length !== 1) reasons.push(froms.length === 0 ? "header_from_missing" : "header_from_multiple");
    else if (bareAddress(froms[0]) !== v.from_address) reasons.push("header_from_mismatch");
  }
  if (reasons.length === v.reasons.length) return v;
  return { ...v, verified: false, basis: null, reasons };
}

export type ServiceDeps = {
  db: Db;
  sendEmail(m: OutgoingMail): Promise<{ ok: boolean; id?: string; error?: string }>;
  callModel: ModelCall | null;
  contact: ContactDeps;
  profile(userId: string): Promise<{ name: string | null; email: string | null }>;
  receivedEmail(emailId: string): Promise<ReceivedEmail | null>;
  /** Descarga el .eml original (raw.download_url de Resend) para guardar su SHA-256 como evidencia. Opcional. */
  fetchRaw?(url: string): Promise<ArrayBuffer | null>;
  config: {
    replyDomain?: string;
    fromAddress?: string;
    appUrl: string;
    /** URL pública de la función ai-reservations (para el enlace .ics del correo). */
    functionUrl: string | null;
    linkSecret: string | null;
    inboundSecret?: string;
  };
  now?: () => Date;
  warn?: (...a: unknown[]) => void;
};

export type ApiResult = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): ApiResult => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, code: string, extra: Record<string, unknown> = {}): ApiResult => ({ status, body: { ok: false, code, ...extra } });

// Mensaje claro (es-MX) por código de error, para Iato y la pantalla.
export const ERROR_MESSAGES: Record<string, string> = {
  FEATURE_DISABLED: "Las reservas por correo con IA todavía no están activas.",
  VENUE_REQUIRED: "Falta el nombre del lugar.",
  VENUE_ID_REQUIRED: "Necesitamos el lugar de Google Maps o del catálogo Privé para encontrar su contacto oficial.",
  VENUE_NOT_FOUND: "No encontramos ese lugar.",
  VENUE_CLOSED: "Google indica que el lugar cerró. No le escribimos.",
  TIMEZONE_REQUIRED: "No pudimos saber la zona horaria del lugar.",
  DATETIME_INVALID: "La fecha u hora no es válida.",
  DATE_TOO_SOON: "Falta muy poco para esa hora: mejor llama al lugar.",
  DATE_TOO_FAR: "Esa fecha está demasiado lejos para pedirla por correo.",
  PARTY_SIZE_INVALID: "El número de personas debe ser de 1 a 20.",
  CUSTOMER_NAME_REQUIRED: "Falta el nombre a quien va la reserva.",
  TRIP_NOT_FOUND: "No encontramos ese viaje.",
  TOO_MANY_ACTIVE: "Ya tienes varias solicitudes abiertas. Espera respuesta o cancela alguna.",
  NOT_FOUND: "No encontramos esa solicitud.",
  ALREADY_SENT: "Ya le escribimos al restaurante.",
  NOT_SENDABLE: "Esta solicitud ya no se puede enviar.",
  NO_CONTACT: "No tenemos un correo de reservas verificado de este lugar.",
  CONSENT_REQUIRED: "Necesitamos tu confirmación para escribir en tu nombre.",
  IN_PROGRESS: "Ya estamos enviando esta solicitud.",
  USER_DAILY_LIMIT: "Llegaste al límite de solicitudes por correo de hoy.",
  VENUE_THROTTLED: "Ya le escribimos varias veces hoy a este lugar. Inténtalo mañana o llama.",
  GLOBAL_DAILY_LIMIT: "Hoy ya se enviaron muchas solicitudes. Inténtalo más tarde.",
  NO_ALTERNATIVES: "No hay horarios alternos para elegir.",
  BAD_INDEX: "Ese horario no está en la lista.",
  NOT_ALLOWED: "Esa acción no está permitida.",
  ILLEGAL_TRANSITION: "Esa acción no aplica en el estado actual.",
  SEND_FAILED: "No pudimos enviar el correo. No se envió nada; inténtalo de nuevo.",
  BAD_REQUEST: "Solicitud incompleta.",
};
const withMessage = (r: ApiResult): ApiResult =>
  r.body.ok === false && typeof r.body.code === "string" && !r.body.message ? { ...r, body: { ...r.body, message: ERROR_MESSAGES[r.body.code as string] ?? "No se pudo completar." } } : r;

const statusFor = (code: string) =>
  code === "FEATURE_DISABLED" ? 403 : code === "NOT_FOUND" || code === "VENUE_NOT_FOUND" || code === "TRIP_NOT_FOUND" ? 404
  : /LIMIT|THROTTLED|TOO_MANY/.test(code) ? 429 : code === "IN_PROGRESS" || code === "ALREADY_SENT" ? 409 : 400;

/** Lo que ve el cliente: fila pública + textos honestos + estado equivalente del Booking Bridge. */
export function presentReservation(row: Record<string, unknown>) {
  const { reply_token: _t, send_lock_at: _l, evidence: _e, claude_calls: _c, last_error: _x, ...pub } = row;
  const status = pub.status as AiReservationStatus;
  const reason = (pub.reason ?? null) as AiReservationRow["reason"];
  return {
    ...pub,
    label: statusLabel(status, reason),
    bridge_state: toBridgeState(status, reason),
    is_confirmed: status === "confirmed",
    confirm_prompt: confirmPrompt(String(pub.venue_name ?? "")),
  };
}

async function flagEnabled(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc<boolean>("app_flag", { _key: "ai_reservations_enabled" });
  return !error && data === true;
}

function fromHeader(deps: ServiceDeps, customerName: string) {
  const name = customerName.replace(/["<>\r\n]/g, "").slice(0, 60);
  return `${name} vía IATOS <${deps.config.fromAddress ?? DEFAULT_FROM_ADDRESS}>`;
}

// ───────────────────────────── create_intent ─────────────────────────────
export type CreateIntentInput = {
  venue: { name?: string; place_id?: string; experience_id?: string; city?: string; country?: string; timezone?: string; language?: string };
  datetime_local?: string;
  party_size?: number;
  customer?: { name?: string; email?: string; phone?: string };
  notes?: string;
  trip_id?: string;
  source?: "iato" | "usuario" | "booking_bridge";
  bridge_offer_id?: string;
  idempotency_key?: string;
};

export async function createIntent(deps: ServiceDeps, userId: string, input: CreateIntentInput): Promise<ApiResult> {
  // Con la bandera apagada no se gasta nada (ni Google ni Claude ni descargas).
  if (!(await flagEnabled(deps.db))) return withMessage(fail(403, "FEATURE_DISABLED"));
  const v = input?.venue ?? {};
  if (!v.name || (!v.place_id && !v.experience_id)) return withMessage(fail(400, v.name ? "VENUE_ID_REQUIRED" : "VENUE_REQUIRED"));
  if (!isLocalDateTime(input.datetime_local)) return withMessage(fail(400, "DATETIME_INVALID"));

  const profile = await deps.profile(userId).catch(() => ({ name: null, email: null }));
  const found = await discoverVenueContact({
    name: v.name, place_id: v.place_id ?? null, experience_id: v.experience_id ?? null,
    city: v.city ?? null, country: v.country ?? null, timezone: v.timezone ?? null, language: v.language ?? null,
  }, { ...deps.contact, callModel: deps.callModel }, deps.now?.() ?? new Date());
  if (found.business_status === "CLOSED_PERMANENTLY") return withMessage(fail(400, "VENUE_CLOSED"));

  const { data, error } = await deps.db.rpc<Record<string, unknown>>("ai_reservation_create_intent", {
    _user_id: userId,
    _p: {
      venue: {
        name: found.name, place_id: found.place_id, experience_id: found.experience_id, address: found.address, city: found.city,
        country: found.country, timezone: found.timezone, email: found.email, email_source: found.email_source, phone: found.phone,
        website: found.website, booking_url: found.booking_url, maps_url: found.maps_url, language: found.language,
      },
      requested_local: input.datetime_local,
      party_size: input.party_size,
      customer: {
        name: (input.customer?.name ?? profile.name ?? "").trim(),
        email: input.customer?.email ?? profile.email,
        phone: input.customer?.phone ?? null,
      },
      notes: input.notes ?? null,
      trip_id: input.trip_id ?? null,
      source: input.source ?? "iato",
      bridge_offer_id: input.bridge_offer_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
      user_options: found.user_options,
      claude_calls: found.claude_calls,
    },
  });
  if (error || !data) return withMessage(fail(500, "CREATE_FAILED"));
  if (data.ok !== true) return withMessage(fail(statusFor(String(data.code)), String(data.code)));
  const row = data.reservation as AiReservationRow;
  const preview = row.venue_email ? venueRequestEmail({ ...row, consent: { share_contact: false } }) : null;
  return ok({
    replay: data.replay === true,
    reservation: presentReservation(row as unknown as Record<string, unknown>),
    // El usuario debe ver a quién y qué escribiremos antes de confirmar.
    confirm_prompt: confirmPrompt(row.venue_name),
    preview: preview ? { to: row.venue_email, subject: preview.subject, text: preview.text } : null,
    next: row.status === "awaiting_user_ok" ? "confirm_send" : "needs_user",
  });
}

// ───────────────────────────── confirm_send ─────────────────────────────
export async function confirmSend(
  deps: ServiceDeps, userId: string,
  input: { id?: string; confirm?: boolean; confirm_text?: string; consent?: { share_contact?: boolean; cc_me?: boolean } },
): Promise<ApiResult> {
  if (!(await flagEnabled(deps.db))) return withMessage(fail(403, "FEATURE_DISABLED"));
  if (!input?.id || input.confirm !== true) return withMessage(fail(400, "CONSENT_REQUIRED"));
  const claim = await deps.db.rpc<Record<string, unknown>>("ai_reservation_claim_send", {
    _id: input.id, _user_id: userId,
    _consent: { confirmed: true, share_contact: input.consent?.share_contact === true, cc_user: input.consent?.cc_me === true,
      text: String(input.confirm_text ?? "Confirmar: escribiremos al restaurante en tu nombre").slice(0, 300) },
  });
  if (claim.error || !claim.data) return withMessage(fail(500, "SEND_FAILED"));
  if (claim.data.ok !== true) return withMessage(fail(statusFor(String(claim.data.code)), String(claim.data.code)));
  const row = claim.data.reservation as AiReservationRow;
  const mail = venueRequestEmail(row);
  const sent = await sendToVenue(deps, row, mail);
  const mark = await deps.db.rpc<Record<string, unknown>>("ai_reservation_mark_sent", {
    _id: row.id, _kind: "request", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? "send_failed",
  });
  if (!sent.ok) return withMessage(fail(502, "SEND_FAILED"));
  // Copia opcional para el usuario (por separado: así el restaurante no ve su correo si no lo compartió).
  if (row.consent?.cc_user) {
    const to = row.customer_email ?? (await deps.profile(userId).catch(() => ({ email: null }))).email;
    if (to) {
      await deps.sendEmail({ to, subject: `Copia: ${mail.subject}`, html: mail.html, text: mail.text, from: fromHeader(deps, "Iato") })
        .catch(() => ({ ok: false }));
    }
  }
  return ok({ reservation: presentReservation((mark.data?.reservation ?? row) as Record<string, unknown>) });
}

type SendResult = { ok: boolean; id?: string; error?: string };
function sendToVenue(deps: ServiceDeps, row: AiReservationRow, mail: Mail): Promise<SendResult> {
  if (!row.venue_email || !row.reply_token) return Promise.resolve({ ok: false, error: "no_contact" });
  return deps.sendEmail({
    to: row.venue_email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    from: fromHeader(deps, row.customer_name),
    replyTo: replyAddress(row.reply_token, deps.config.replyDomain ?? DEFAULT_REPLY_DOMAIN),
  }).catch((e): SendResult => ({ ok: false, error: String((e as Error)?.message ?? e) }));
}

// ───────────────────────────── choose_alternative ─────────────────────────────
export async function chooseAlternative(deps: ServiceDeps, userId: string, input: { id?: string; index?: number }): Promise<ApiResult> {
  if (!(await flagEnabled(deps.db))) return withMessage(fail(403, "FEATURE_DISABLED"));
  if (!input?.id || !Number.isInteger(input.index)) return withMessage(fail(400, "BAD_REQUEST"));
  const claim = await deps.db.rpc<Record<string, unknown>>("ai_reservation_claim_alternative", { _id: input.id, _user_id: userId, _index: input.index });
  if (claim.error || !claim.data) return withMessage(fail(500, "SEND_FAILED"));
  if (claim.data.ok !== true) return withMessage(fail(statusFor(String(claim.data.code)), String(claim.data.code)));
  const row = claim.data.reservation as AiReservationRow;
  const held = claim.data.held === true;
  const sent = await sendToVenue(deps, row, venueAlternativeEmail(row, held));
  const mark = await deps.db.rpc<Record<string, unknown>>("ai_reservation_mark_sent", {
    _id: row.id, _kind: "alternative", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? "send_failed",
  });
  if (!sent.ok) return withMessage(fail(502, "SEND_FAILED"));
  const after = (mark.data?.reservation ?? row) as AiReservationRow;
  if (after.status === "confirmed") await sendUserConfirmation(deps, after);
  return ok({ reservation: presentReservation(after as unknown as Record<string, unknown>) });
}

// ───────────────────────────── cancel ─────────────────────────────
export async function cancelReservation(deps: ServiceDeps, userId: string, input: { id?: string }): Promise<ApiResult> {
  if (!input?.id) return withMessage(fail(400, "BAD_REQUEST"));
  const t = await deps.db.rpc<Record<string, unknown>>("ai_reservation_transition", {
    _id: input.id, _to: "cancelled", _actor: "usuario", _user_id: userId, _note: "Cancelada por el usuario", _confirmation: null,
  });
  if (t.error || !t.data) return withMessage(fail(500, "CANCEL_FAILED"));
  if (t.data.ok !== true) return withMessage(fail(statusFor(String(t.data.code)), String(t.data.code)));
  const row = t.data.reservation as AiReservationRow;
  let venueNotified = false;
  // Avisarle al restaurante también es un correo: con la bandera apagada no sale (se dice en la respuesta).
  if (t.data.notify_venue === true && (await flagEnabled(deps.db))) {
    const sent = await sendToVenue(deps, row, venueCancellationEmail(row));
    await deps.db.rpc("ai_reservation_mark_sent", { _id: row.id, _kind: "cancellation", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? null });
    venueNotified = sent.ok;
  }
  return ok({
    reservation: presentReservation(row as unknown as Record<string, unknown>),
    venue_notified: venueNotified,
    message: t.data.notify_venue === true && !venueNotified
      ? "Cancelada en IATOS. No pudimos avisar al restaurante: avísales tú por teléfono o correo."
      : "Cancelada.",
  });
}

// ───────────────────────────── status ─────────────────────────────
export async function reservationStatus(deps: ServiceDeps, userId: string, input: { id?: string }): Promise<ApiResult> {
  const { data, error } = await deps.db.rpc<Record<string, unknown>[]>("ai_reservation_list_for_user", { _user_id: userId, _id: input?.id ?? null });
  if (error) return withMessage(fail(500, "STATUS_FAILED"));
  const list = (data ?? []).map(presentReservation);
  if (input?.id && list.length === 0) return withMessage(fail(404, "NOT_FOUND"));
  return ok({ enabled: await flagEnabled(deps.db), reservations: list });
}

// ───────────────────────────── Correos al usuario ─────────────────────────────
async function userEmailTarget(deps: ServiceDeps, row: AiReservationRow): Promise<string | null> {
  const p = await deps.profile(row.user_id).catch(() => ({ name: null, email: null }));
  return p.email ?? row.customer_email ?? null;
}

export async function icsUrl(deps: ServiceDeps, row: Pick<AiReservationRow, "id" | "user_id">): Promise<string | null> {
  if (!deps.config.functionUrl || !deps.config.linkSecret) return null;
  const sig = await signLink(deps.config.linkSecret, `ics:${row.id}:${row.user_id}`);
  const u = new URL(deps.config.functionUrl);
  u.searchParams.set("ics", row.id);
  u.searchParams.set("u", row.user_id);
  u.searchParams.set("sig", sig);
  return u.toString();
}

async function sendUserConfirmation(deps: ServiceDeps, row: AiReservationRow) {
  const to = await userEmailTarget(deps, row);
  const quote = String((row.confirmation as { quote?: unknown } | null)?.quote ?? "");
  if (!to || !quote) return;
  const mail = userConfirmedEmail({
    ...row, quote,
    receivedAt: formatInstantEs(row.venue_replied_at ?? row.confirmed_at ?? new Date().toISOString()),
    icsUrl: await icsUrl(deps, row),
    appUrl: deps.config.appUrl,
  });
  await deps.sendEmail({ to, ...mail, from: "IATOS Reservas <" + (deps.config.fromAddress ?? DEFAULT_FROM_ADDRESS) + ">" }).catch(() => null);
}

const formatInstantEs = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

async function sendUserUpdate(deps: ServiceDeps, row: AiReservationRow, kind: Parameters<typeof userUpdateEmail>[0], d?: Partial<ReplyDecision>) {
  const to = await userEmailTarget(deps, row);
  if (!to) return;
  const mail = userUpdateEmail(kind, {
    ...row,
    excerpt: d?.excerpt ?? row.venue_reply_excerpt,
    info: kind === "ambiguous" ? ambiguousReasonEs(d?.why) : d?.info_requested ?? null,
    alternatives: (d?.alternatives ?? row.alternatives ?? []).map((a) => formatLocal(a.local, "es")),
    appUrl: deps.config.appUrl,
  });
  await deps.sendEmail({ to, ...mail, from: "IATOS Reservas <" + (deps.config.fromAddress ?? DEFAULT_FROM_ADDRESS) + ">" }).catch(() => null);
}

// ───────────────────────────── Evidencia del correo (AUD-06) ─────────────────────────────
async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Lo que se guarda del correo recibido ANTES de clasificarlo (ai_reservation_inbound_attach): datos
 * del proveedor, no del modelo. El cuerpo se guarda como huella (SHA-256 de texto + HTML tal como
 * llegaron) y, del texto, solo lo que escribió el restaurante. El .eml no se guarda: su huella y el
 * puntero al correo en Resend permiten comprobarlo mientras Resend lo conserve.
 */
export async function inboundEvidence(
  deps: ServiceDeps, emailId: string, content: ReceivedEmail, sender: SenderVerdict, replyText: string,
  linkage: { method: string; quoted_request: boolean },
): Promise<Record<string, unknown>> {
  let rawSha: string | null = null;
  const rawUrl = content.raw?.download_url;
  if (deps.fetchRaw && typeof rawUrl === "string" && /^https:\/\//.test(rawUrl)) {
    const raw = await deps.fetchRaw(rawUrl).catch(() => null);
    if (raw && raw.byteLength > 0) rawSha = await sha256Hex(raw);
  }
  const replyTo = Array.isArray(content.reply_to) ? content.reply_to.map(String).join(", ") : content.reply_to ? String(content.reply_to) : null;
  const mid = typeof content.message_id === "string" && content.message_id.trim() ? content.message_id.trim().slice(0, 998) : null;
  return {
    provider: "resend",
    provider_email_id: emailId,
    message_id: mid,
    received_at: typeof content.created_at === "string" ? content.created_at : null,
    from_address: sender.from_address,
    reply_to: replyTo ? replyTo.slice(0, 500) : null,
    auth: sender.auth,
    reply_text: replyText.slice(0, 8000),
    body_sha256: await sha256Hex(`${content.text ?? ""}\n\u0000\n${content.html ?? ""}`),
    raw_sha256: rawSha,
    raw_pointer: `resend:emails/receiving/${emailId}`,
    linkage,
    sender: { verified: sender.verified, basis: sender.basis, reasons: sender.reasons },
  };
}

// ───────────────────────────── Webhook de correo recibido ─────────────────────────────
type InboundEvent = {
  type?: string;
  data?: { email_id?: string; from?: string; to?: unknown[]; cc?: unknown[]; received_for?: unknown[]; subject?: string };
};

export async function handleInbound(deps: ServiceDeps, headers: Headers, rawBody: string): Promise<ApiResult> {
  // 1) Firma de Resend/Svix: sin firma válida no se lee nada.
  const sig = await verifySvixSignature(headers, rawBody, deps.config.inboundSecret, deps.now?.() ?? new Date());
  if (sig.ok !== true) {
    const reason = (sig as { reason: string }).reason;
    return fail(reason === "secret_not_configured" ? 503 : 401, "INVALID_SIGNATURE", { reason });
  }
  let event: InboundEvent;
  try { event = JSON.parse(rawBody); } catch { return fail(400, "BAD_JSON"); }
  if (event?.type !== "email.received" || !event.data?.email_id) return ok({ ignored: "event_type" });
  // 2) Bandera apagada: se acusa recibo, pero no se procesa ni se gasta Claude.
  if (!(await flagEnabled(deps.db))) return ok({ ignored: "disabled" });

  const d = event.data;
  const emailId = String(d.email_id);
  const domain = deps.config.replyDomain ?? DEFAULT_REPLY_DOMAIN;
  const token = extractReplyToken([...(d.to ?? []), ...(d.received_for ?? []), ...(d.cc ?? [])], domain);
  const from = bareAddress(d.from);
  const ref = /\bR-([A-Z0-9]{6})\b/.exec(String(d.subject ?? ""))?.[0] ?? null;
  const claim = await deps.db.rpc<Record<string, unknown>>("ai_reservation_inbound_claim", {
    _event_id: sig.id, _email_id: d.email_id, _token: token, _from_domain: domainOf(from), _ref_code: token ? null : ref, _from_address: token ? null : from,
  });
  if (claim.error || !claim.data) return fail(500, "CLAIM_FAILED");
  const state = String(claim.data.state);
  if (state === "duplicate") return ok({ duplicate: true });
  if (state === "unmatched") return ok({ unmatched: true });
  const inboundId = String(claim.data.inbound_id);
  const row = claim.data.reservation as AiReservationRow | null;
  if (!row) {
    await deps.db.rpc("ai_reservation_inbound_finish", { _inbound_id: inboundId, _status: "unmatched", _outcome: "no_reservation" });
    return ok({ unmatched: true });
  }

  // 3) Contenido (el webhook solo trae metadatos).
  const content = await deps.receivedEmail(emailId).catch(() => null);
  if (!content) {
    await deps.db.rpc("ai_reservation_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "fetch_failed" });
    return fail(500, "FETCH_FAILED"); // Resend reintenta; el reintento reclama la fila 'failed'
  }
  const sender = inboundSenderVerdict(d.from, content, row.venue_email, row.venue_website);
  const fromAddr = sender.from_address;
  const verified = sender.verified;
  const hasText = !!content.text?.trim();
  const replyText = stripQuotedReply(hasText ? content.text! : htmlToText(content.html ?? ""));
  // El correo completo, con lo citado: sirve para comprobar que cita nuestra solicitud exacta (AUD-03).
  const fullText = hasText ? content.text! : htmlToText(content.html ?? "", true);
  const linkage = token ? "reply_token" as const : "ref_subject" as const;
  const receivedAt = typeof content.created_at === "string" ? content.created_at : null;

  // 3b) Evidencia del proveedor, sellada antes de gastar Claude. El mismo Message-ID (aunque llegue
  //     con otro evento de Svix y otro email_id) no se procesa dos veces.
  const evidence = await inboundEvidence(deps, emailId, content, sender, replyText, {
    method: linkage, quoted_request: quotedRequestLinked(fullText, row),
  });
  const attached = await deps.db.rpc<Record<string, unknown>>("ai_reservation_inbound_attach", { _inbound_id: inboundId, _e: evidence });
  if (attached.error || !attached.data || attached.data.ok !== true) {
    await deps.db.rpc("ai_reservation_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "evidence_failed" });
    return fail(500, "EVIDENCE_FAILED", { reason: attached.data?.code ?? null });
  }
  if (attached.data.duplicate === true) return ok({ duplicate: true, reason: "message_id" });
  const evidenceComplete = !!evidence.message_id && !!receivedAt && Number.isFinite(Date.parse(receivedAt));

  // 4) Clasificación (Claude) + decisión con reglas verificables.
  let decision: ReplyDecision;
  try {
    const cls = replyText && deps.callModel
      ? await classifyReply(deps.callModel, {
        reservation: row, replyText, subject: String(content.subject ?? d.subject ?? ""), receivedAt: receivedAt ?? new Date().toISOString(),
      })
      : null;
    decision = decideReply(row, cls, {
      replyText, fullText, verifiedSender: verified, fromDomain: domainOf(fromAddr), inboundEmailId: emailId, linkage, receivedAt,
      htmlOnly: !hasText,
    });
    if (!replyText) decision = { ...decision, outcome: "ignored", why: "empty_body", claude_calls: 0 };
    if (!deps.callModel) decision.claude_calls = 0;
    // Sin Message-ID o sin fecha de recepción del proveedor no hay evidencia suficiente: no se confirma
    // ni se aparta nada; queda para revisión (la base de datos lo exige igual).
    if (!evidenceComplete) {
      if (decision.outcome === "confirmed") {
        const { confirmation: _c, ...rest } = decision;
        decision = { ...rest, outcome: "ambiguous", why: "evidence_incomplete" };
      }
      decision.alternatives = decision.alternatives?.map((a) => ({ ...a, held: false }));
    }
    // Cada evidencia apunta al correo exacto guardado en ai_reservation_inbound.
    if (decision.confirmation) decision.confirmation = { ...decision.confirmation, inbound_id: inboundId };
    decision.alternatives = decision.alternatives?.map((a) => ({ ...a, inbound_id: inboundId }));
    decision.log = { ...(decision.log ?? {}), sender: evidence.sender, evidence_complete: evidenceComplete };
  } catch (e) {
    await deps.db.rpc("ai_reservation_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "classifier_unavailable" });
    if (e instanceof ClassifierUnavailable) return fail(500, "CLASSIFIER_UNAVAILABLE");
    throw e;
  }

  const applied = await deps.db.rpc<Record<string, unknown>>("ai_reservation_apply_reply", { _id: row.id, _inbound_id: inboundId, _d: decision });
  if (applied.error || !applied.data) {
    await deps.db.rpc("ai_reservation_inbound_finish", { _inbound_id: inboundId, _status: "failed", _outcome: "apply_failed" });
    return fail(500, "APPLY_FAILED");
  }
  if (applied.data.code === "LATE") {
    if (decision.outcome !== "ignored") await sendUserUpdate(deps, row, "late", decision);
    return ok({ late: true, outcome: decision.outcome });
  }
  const after = applied.data.reservation as AiReservationRow;
  // 5) Correo al usuario (el aviso en la app lo deja la base de datos en cada transición).
  switch (decision.outcome) {
    // Defensa en profundidad (A2-RES-02): el correo "confirmó tu reserva" sale solo si la BASE dejó la
    // reserva en confirmed (no basta con lo que decidió TypeScript).
    case "confirmed": if (after?.status === "confirmed") await sendUserConfirmation(deps, after); break;
    case "alternative_offered":
    case "declined":
    case "needs_info":
    case "payment_required":
    case "unverified":
    case "ambiguous":
      await sendUserUpdate(deps, after, decision.outcome, decision);
      break;
  }
  return ok({ outcome: decision.outcome, status: after.status, why: decision.why ?? null });
}

// ───────────────────────────── Cron ─────────────────────────────
export async function runCron(deps: ServiceDeps): Promise<ApiResult> {
  if (!(await flagEnabled(deps.db))) return ok({ disabled: true, reminded: 0, expired: 0 });
  const now = deps.now?.() ?? new Date();
  const lim = await deps.db.rpc<Partial<Limits>>("ai_reservation_limits", {});
  const limits: Limits = { ...DEFAULT_LIMITS, ...(lim.data ?? {}) };
  const due = await deps.db.rpc<AiReservationRow[]>("ai_reservation_due", { _limit: 200 });
  if (due.error) return fail(500, "DUE_FAILED", { error: due.error.message });
  let reminded = 0, expired = 0, errors = 0;
  for (const row of due.data ?? []) {
    const action = cronDecision(row, now, limits);
    if (action.kind === "remind") {
      const claimed = await deps.db.rpc<AiReservationRow | null>("ai_reservation_claim_reminder", { _id: row.id });
      if (!claimed.data) continue; // otra corrida ya lo mandó
      const sent = await sendToVenue(deps, claimed.data, venueReminderEmail(claimed.data));
      await deps.db.rpc("ai_reservation_mark_sent", { _id: row.id, _kind: "reminder", _ok: sent.ok, _provider_id: sent.id ?? null, _error: sent.ok ? null : sent.error ?? null });
      if (sent.ok) reminded++; else errors++;
    } else if (action.kind === "expire") {
      const t = await deps.db.rpc<Record<string, unknown>>("ai_reservation_transition", {
        _id: row.id, _to: "expired", _actor: "sistema", _user_id: null, _note: action.note, _confirmation: null,
      });
      if (t.data?.ok === true && t.data.noop !== true) {
        expired++;
        if (t.data.prev_status === "sent") await sendUserUpdate(deps, row, "expired");
      } else if (t.error) errors++;
    }
  }
  return { status: errors ? 500 : 200, body: { ok: errors === 0, reminded, expired, errors, checked: (due.data ?? []).length } };
}

// ───────────────────────────── .ics firmado ─────────────────────────────
export async function icsForLink(deps: ServiceDeps, id: string, userId: string, sig: string | null): Promise<{ status: number; body: string; type: string }> {
  if (!(await verifyLink(deps.config.linkSecret ?? undefined, `ics:${id}:${userId}`, sig))) return { status: 403, body: "forbidden", type: "text/plain" };
  const { data } = await deps.db.rpc<AiReservationRow[]>("ai_reservation_list_for_user", { _user_id: userId, _id: id });
  const row = data?.[0];
  // Solo una reserva confirmada por escrito tiene evento de calendario.
  if (!row || row.status !== "confirmed") return { status: 404, body: "not_found", type: "text/plain" };
  return { status: 200, body: reservationIcs(row, deps.now?.() ?? new Date()), type: "text/calendar; charset=utf-8" };
}
