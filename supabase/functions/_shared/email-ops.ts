// Correos internos para el equipo de operaciones (solicitudes del concierge, reservas Privé,
// Members Only, alertas de salud y de cobros), sobre el mismo sistema de _shared/email-kit.ts pero
// compactos y fáciles de escanear. Funciones puras, probadas en src/test/emailSystem.test.ts.
//
// Antes: "Tipo: prive_request", "Detalle: {json crudo}" y "concierge_requests.id = <uuid>".
// Ahora: tipo en español, lugar con ciudad y fuente, fecha en hora del lugar y de CDMX, personas,
// cliente con su contacto, preferencias, viaje, estado honesto (todavía no es una reserva), folio
// corto (el mismo que ve el cliente en la app) y una marca [PRUEBA] para solicitudes sintéticas.
// Nunca se vuelca JSON.
import {
  button, callout, type Email, EK, eyebrow, gap, hairline, headline, joinText, kvTable, LNUM, masthead, normalizeSite, para,
  SANS, SERIF, shell, textFooter,
} from "./email-kit.ts";
import { CDMX_TZ, escapeHtml, formatDateMx, formatDateRange, formatDateTime, oneLine, safeUrl } from "./email-format.ts";

export const OPS_TYPE_LABEL: Record<string, string> = {
  prive_request: "Reserva Privé",
  members_nightlife_reservation: "Reserva Members Only",
  reservation: "Reserva de mesa",
  pickup: "Recolección de equipaje",
  transport: "Transporte",
  jet: "Jet privado",
  alert: "Alerta del concierge",
  fixer: "Solicitud al Fixer",
};

export const opsTypeLabel = (type: string) =>
  OPS_TYPE_LABEL[type] ?? (oneLine(type.replace(/_/g, " "), 40).replace(/^./, (c) => c.toUpperCase()) || "Solicitud");

/** Folio corto: las primeras 8 letras/números del id, en mayúsculas (igual que el folio de la app). */
export const folioOf = (id: string | null | undefined) => String(id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "—";

const TEST_DOMAINS = /@(mailinator\.com|example\.(com|org|net)|[a-z0-9.-]+\.(test|invalid|example|localhost))$/i;

/** ¿Es una solicitud de prueba? ("PRUEBA" en los textos o correo de prueba/e2e). */
export function isTestRequest(o: { email?: string | null; texts?: Array<unknown> }): boolean {
  const email = String(o.email ?? "").trim().toLowerCase();
  if (email && (TEST_DOMAINS.test(email) || /(^|[+._-])e2e([+._-]|@)/.test(email) || /^(test|qa)[+._-]/.test(email))) return true;
  return (o.texts ?? []).some((t) => typeof t === "string" && /\bPRUEBA\b/i.test(t));
}

const CONTACT_LABEL: Record<string, string> = { app: "En la app (bandeja de IATOS)", email: "Correo", telefono: "Teléfono", whatsapp: "WhatsApp" };

// ───────────────────────────── fechas en la zona del lugar y en CDMX ─────────────────────────────

function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - instant;
}

/** Instante de una hora "de pared" (lo que escribió la persona) en una zona horaria IANA. */
export function wallClockToInstant(wall: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  try {
    const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    let t = guess - tzOffsetMs(guess, timeZone);
    t = guess - tzOffsetMs(t, timeZone); // segunda pasada: cambios de horario
    return new Date(t);
  } catch {
    return null;
  }
}

const validTz = (tz: unknown): string | null => {
  if (typeof tz !== "string" || !tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
};

/**
 * Fecha y hora pedidas, en la hora del lugar y en la de CDMX. Si el valor no trae zona (como lo
 * manda la app: "2026-11-14T20:00:00"), es la hora que la persona escribió para el lugar.
 */
export function requestedTimes(value: unknown, venueTz?: string | null): { venue: string | null; cdmx: string | null; note: string | null } {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return { venue: null, cdmx: null, note: null };
  const tz = validTz(venueTz);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (hasZone) {
    const t = new Date(s);
    if (!Number.isFinite(t.getTime())) return { venue: null, cdmx: null, note: null };
    return { venue: tz ? formatDateTime(t, tz) : null, cdmx: formatDateTime(t, CDMX_TZ), note: tz ? null : "sin zona horaria del lugar" };
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!m) return { venue: formatDateMx(s), cdmx: null, note: null };
  const venue = `${formatDateMx(m[1])}, ${m[2]}:${m[3]} h`;
  if (!tz) return { venue, cdmx: null, note: "hora escrita por el cliente; falta la zona horaria del lugar para convertirla" };
  const t = wallClockToInstant(s, tz);
  return { venue, cdmx: t ? formatDateTime(t, CDMX_TZ) : null, note: null };
}

// ───────────────────────────── detalle sin JSON ──────────────────────────────────────────────────

const DETAIL_LABEL: Record<string, string> = {
  subtitle: "Detalle", meta: "Datos", body: "Mensaje", from: "Desde", to: "Hacia", route: "Ruta", fbo: "FBO",
  venue_name: "Lugar", ciudad: "Ciudad", categoria: "Categoría", dress_code: "Código de vestimenta",
  precio_estimado: "Precio de referencia (catálogo)", address: "Dirección", website: "Sitio web", por_que: "Por qué lo eligió",
  fecha: "Fecha", hora: "Hora", personas: "Personas", notas: "Notas",
};
// Lo que ya se muestra en su propio renglón o son ids internos.
const SKIP = new Set(["experience_id", "requested_for", "party_size", "preferences", "contact_method", "plan_group", "venue_id", "trip_id", "user_id", "user_email", "email"]);

function scalar(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? new Intl.NumberFormat("es-MX").format(v) : null;
  if (typeof v === "string") return oneLine(v, 300) || null;
  return null;
}

/** Renglones legibles del detalle de una solicitud: etiquetas en español, enlaces https, nunca JSON. */
export function detailRows(payload: Record<string, unknown> | null | undefined): Array<{ k: string; v: string; text: string }> {
  const out: Array<{ k: string; v: string; text: string }> = [];
  for (const [key, raw] of Object.entries(payload ?? {}).slice(0, 20)) {
    if (SKIP.has(key) || /_id$/.test(key)) continue;
    const label = DETAIL_LABEL[key] ?? oneLine(key.replace(/_/g, " "), 40).replace(/^./, (c) => c.toUpperCase());
    let text: string | null = null;
    if (Array.isArray(raw)) text = raw.map(scalar).filter(Boolean).slice(0, 10).join(", ") || null;
    else if (raw && typeof raw === "object") {
      text = Object.entries(raw as Record<string, unknown>).slice(0, 8)
        .map(([k, v]) => (scalar(v) ? `${k.replace(/_/g, " ")}: ${scalar(v)}` : null)).filter(Boolean).join(" · ") || null;
    } else text = scalar(raw);
    if (!text) continue;
    const url = /^https:\/\//i.test(text) ? safeUrl(text) : null;
    out.push({
      k: label,
      v: url ? `<a href="${escapeHtml(url)}" style="color:${EK.gold};text-decoration:none;word-break:break-all;">${escapeHtml(oneLine(text, 80))}</a>` : escapeHtml(text),
      text,
    });
  }
  return out;
}

// ───────────────────────────── solicitud del concierge / Privé ───────────────────────────────────

export type OpsRequestInput = {
  requestId: string;
  type: string;
  title: string;
  createdAt?: string | null;
  client: { name?: string | null; email?: string | null; phone?: string | null; contactMethod?: string | null };
  trip?: { title?: string | null; destination?: string | null; dateFrom?: string | null; dateTo?: string | null } | null;
  experience?: { name: string; city?: string | null; country?: string | null; sourceUrl?: string | null; timezone?: string | null } | null;
  requestedFor?: string | null;
  partySize?: number | null;
  preferences?: string | null;
  payload?: Record<string, unknown> | null;
  /** Panel de administración para abrir la solicitud, si existe. */
  adminUrl?: string | null;
  /** Texto de tiempo de respuesta sugerido. */
  sla?: string | null;
  siteUrl?: string | null;
  supportEmail?: string | null;
};

export const DEFAULT_SLA = "Sugerido: confirma disponibilidad y escribe al cliente en menos de 2 horas.";

export function conciergeRequestOpsEmail(i: OpsRequestInput): Email {
  const site = normalizeSite(i.siteUrl);
  const type = opsTypeLabel(i.type);
  const folio = folioOf(i.requestId);
  const title = oneLine(i.title, 200) || type;
  const clientName = oneLine(i.client.name, 120) || null;
  const email = oneLine(i.client.email, 200) || null;
  const details = detailRows(i.payload);
  const test = isTestRequest({ email, texts: [i.title, i.preferences, ...details.map((d) => d.text)] });
  const times = requestedTimes(i.requestedFor, i.experience?.timezone ?? null);
  const party = Number(i.partySize) > 0 ? Math.round(Number(i.partySize)) : null;
  const place = i.experience?.name ? oneLine(i.experience.name, 120) : null;
  const city = [i.experience?.city, i.experience?.country].map((x) => oneLine(x, 60)).filter(Boolean).join(", ") || null;
  const source = safeUrl(i.experience?.sourceUrl);
  const tripText = i.trip
    ? [oneLine(i.trip.title ?? i.trip.destination, 120) || "Viaje sin nombre", formatDateRange(i.trip.dateFrom, i.trip.dateTo)].filter(Boolean).join(" · ")
    : "Sin viaje";
  const contact = i.client.contactMethod ? CONTACT_LABEL[i.client.contactMethod] ?? oneLine(i.client.contactMethod, 30) : null;
  const created = formatDateTime(i.createdAt ?? new Date().toISOString());

  const subjectBits = [
    type,
    place ?? title,
    times.venue ? times.venue.replace(/ de 20\d\d/, "") : null,
    party ? `${party} pers.` : null,
    clientName ?? (email ? email.replace(/@.*/, "@…") : null),
    `Folio ${folio}`,
  ].filter(Boolean);
  const subject = oneLine(`${test ? "[PRUEBA] " : ""}[IATOS Concierge] ${subjectBits.join(" · ")}`, 180);
  const preheader = `Pendiente de confirmar · ${[place ?? title, times.venue, party ? `${party} personas` : null].filter(Boolean).join(" · ")}`;

  const status = `<span style="display:inline-block;padding:6px 12px;border:1px solid ${EK.warn};font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${EK.warn};">◌&nbsp;Pendiente de confirmar</span>`;
  const testBadge = test ? `&nbsp;<span style="display:inline-block;padding:6px 12px;border:1px solid ${EK.bad};font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${EK.bad};">Prueba</span>` : "";

  const whenHtml = times.venue
    ? `${escapeHtml(times.venue)} <span style="color:${EK.muted};">(hora del lugar)</span>${times.cdmx ? `<br>${escapeHtml(times.cdmx)} <span style="color:${EK.muted};">(hora CDMX)</span>` : ""}${times.note ? `<br><span style="color:${EK.muted};font-size:12px;">${escapeHtml(times.note)}</span>` : ""}`
    : "";

  const body = [
    masthead(`Operaciones · Folio ${folio}`),
    gap(36),
    eyebrow(type),
    gap(12),
    headline(escapeHtml(place ?? title), { size: 30 }),
    city ? gap(6) + para(escapeHtml(city), { color: EK.body, size: 14 }) : "",
    gap(18),
    `<tr><td class="ek-pad" style="padding:0 56px;">${status}${testBadge}</td></tr>`,
    gap(10),
    para(`El cliente ve «solicitud recibida», no «reserva». ${escapeHtml(i.sla ?? DEFAULT_SLA)}`, { size: 13, color: EK.muted }),
    gap(26),
    kvTable([
      whenHtml ? { k: "Fecha y hora", v: whenHtml } : null,
      party ? { k: "Personas", v: `<span style="${LNUM}">${party}</span>` } : null,
      { k: "Cliente", v: escapeHtml(clientName ?? "Sin nombre en el perfil") },
      email ? { k: "Correo", v: `<a href="mailto:${escapeHtml(encodeURIComponent(email))}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(email)}</a>` } : null,
      i.client.phone ? { k: "Teléfono", v: escapeHtml(oneLine(i.client.phone, 40)) } : null,
      contact ? { k: "Prefiere", v: escapeHtml(contact) } : null,
      i.preferences ? { k: "Preferencias", v: escapeHtml(oneLine(i.preferences, 1000)) } : null,
      { k: "Viaje", v: escapeHtml(tripText) },
      place && title !== place ? { k: "Título", v: escapeHtml(title) } : null,
      ...details.map((d) => ({ k: d.k, v: d.v })),
      source ? { k: "Fuente del lugar", v: `<a href="${escapeHtml(source)}" style="color:${EK.gold};text-decoration:none;word-break:break-all;">${escapeHtml(source.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a>` } : null,
      { k: "Recibida", v: escapeHtml(`${created ?? ""} (hora CDMX)`) },
      { k: "Folio", v: `<span style="font-family:${SERIF};font-size:17px;letter-spacing:0.12em;${LNUM}">${escapeHtml(folio)}</span>` },
    ]),
    gap(26),
    callout(escapeHtml(email
      ? "Responder a este correo le escribe directo al cliente. Confirma disponibilidad y precio reales con el lugar antes de decir que está reservado."
      : "Confirma disponibilidad y precio reales con el lugar antes de decir que está reservado.")),
    i.adminUrl && safeUrl(i.adminUrl) ? gap(28) + button(i.adminUrl, "Abrir la solicitud") : (source ? gap(28) + button(source, "Ver el lugar") : ""),
    gap(18),
    para(`Para encontrarla en la base: concierge_requests con id que empieza con ${escapeHtml(folio.toLowerCase())}.`, { align: "center", size: 11, color: EK.faint }),
  ];
  const reason = "Correo interno de operaciones de IATOS: llega al buzón del equipo cuando un cliente pide algo a un humano.";
  const html = shell({ title: subject, preheader, body, reason, siteUrl: site, supportEmail: i.supportEmail, compact: true });
  const text = joinText([
    `${test ? "[PRUEBA] " : ""}${type.toUpperCase()} · Folio ${folio}`,
    place ?? title,
    city,
    "",
    "Estado: Pendiente de confirmar — el cliente ve «solicitud recibida», no «reserva».",
    i.sla ?? DEFAULT_SLA,
    "",
    times.venue ? `Fecha y hora: ${times.venue} (hora del lugar)${times.cdmx ? ` · ${times.cdmx} (hora CDMX)` : ""}${times.note ? ` · ${times.note}` : ""}` : null,
    party ? `Personas: ${party}` : null,
    `Cliente: ${clientName ?? "Sin nombre en el perfil"}`,
    email ? `Correo: ${email}` : null,
    i.client.phone ? `Teléfono: ${oneLine(i.client.phone, 40)}` : null,
    contact ? `Prefiere: ${contact}` : null,
    i.preferences ? `Preferencias: ${oneLine(i.preferences, 1000)}` : null,
    `Viaje: ${tripText}`,
    place && title !== place ? `Título: ${title}` : null,
    ...details.map((d) => `${d.k}: ${d.text}`),
    source ? `Fuente del lugar: ${source}` : null,
    `Recibida: ${created ?? ""} (hora CDMX)`,
    "",
    email ? "Responder a este correo le escribe directo al cliente." : null,
    "Confirma disponibilidad y precio reales con el lugar antes de decir que está reservado.",
    "",
    ...textFooter({ reason, siteUrl: site, internal: true }),
  ]);
  return { subject, preheader, html, text };
}

// ───────────────────────────── aviso interno genérico (salud, cobros) ────────────────────────────

/**
 * Aviso interno corto: título, filas opcionales y un cuerpo HTML ya escapado (o texto plano).
 * Lo usan health-check y stripe-webhook vía layout() de _shared/email.ts.
 */
export function opsNoticeEmail(o: {
  title: string;
  /** HTML ya escapado del cuerpo. */
  html: string;
  eyebrow?: string;
  tone?: "alert" | "info";
  preheader?: string;
  siteUrl?: string | null;
}): string {
  const body = [
    masthead("Operaciones"),
    gap(36),
    eyebrow(o.eyebrow ?? (o.tone === "info" ? "Aviso interno" : "Atención")),
    gap(12),
    `<tr><td class="ek-pad ek-h1" style="padding:0 56px;font-family:${SERIF};font-size:28px;line-height:35px;color:${EK.ivory};">${o.title}</td></tr>`,
    gap(18),
    hairline(),
    gap(18),
    `<tr><td class="ek-pad ek-ops" style="padding:0 56px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:300;color:${EK.body};">${o.html}</td></tr>`,
  ];
  const plain = decodeBasic(o.title.replace(/<[^>]*>/g, ""));
  return shell({
    title: plain,
    preheader: o.preheader ?? plain,
    body,
    reason: "Correo interno de operaciones de IATOS para administradores.",
    siteUrl: o.siteUrl,
    compact: true,
  });
}

/** Deshace el escape básico (para volver a escaparlo una sola vez en <title> y el preencabezado). */
function decodeBasic(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" } as Record<string, string>)[e]);
}
