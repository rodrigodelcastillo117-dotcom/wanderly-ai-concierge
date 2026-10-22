// Correo al Fixer humano (F-08 / IATOS-051). Lógica pura, probada en src/test/fixerEmail.test.ts.
//
// Antes: urgencia sin validar entraba al HTML y al estilo, el escape propio no escapaba comillas
// (rompía el href del mailto) y el correo del cliente y el replyTo salían del CUERPO de la
// petición, así que cualquiera podía hacerse pasar por otra persona ante el staff.
// Ahora: todo pasa por escapeHtml (_shared/email-format.ts), urgencia es un enum, los textos tienen
// tope, el asunto no admite saltos de línea y la identidad (correo, replyTo) la pone index.ts
// con el usuario autenticado.
import { clipWords, escapeHtml, formatDateRange, formatDateTime, oneLine } from "../_shared/email-format.ts";
import { callout, EK, eyebrow, gap, headline, joinText, kvTable, masthead, para, SANS, shell, textFooter } from "../_shared/email-kit.ts";
import { isTestRequest } from "../_shared/email-ops.ts";

export { oneLine };

export const URGENCIAS = ["critica", "alta", "media", "baja"] as const;
export type Urgencia = (typeof URGENCIAS)[number];

export type FixerInput = {
  userName: string;
  userPhone: string | null;
  trip: { titulo: string | null; destinos: string | null; fechaSalida: string | null; fechaRegreso: string | null } | null;
  urgencia: Urgencia;
  motivo: string;
  contexto: Array<{ role: "user" | "assistant"; content: string }>;
};

const COLOR: Record<Urgencia, string> = { critica: "#dc2626", alta: "#ea580c", media: "#ca8a04", baja: "#65a30d" };

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // deno-lint-ignore no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  return t || null;
};

export type ParseResult = { ok: true; value: FixerInput } | { ok: false; error: string };

export function parseFixerPayload(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const urgencia = typeof b.urgencia === "string" && (URGENCIAS as readonly string[]).includes(b.urgencia)
    ? (b.urgencia as Urgencia) : null;
  if (!urgencia) return { ok: false, error: "invalid_urgencia" };
  const motivo = text(b.motivo, 2000);
  if (!motivo) return { ok: false, error: "missing_motivo" };
  const phone = typeof b.user_phone === "string" && /^[0-9+()\-\s.]{5,40}$/.test(b.user_phone.trim())
    ? b.user_phone.trim() : null;
  const t = b.trip && typeof b.trip === "object" && !Array.isArray(b.trip) ? (b.trip as Record<string, unknown>) : null;
  const contexto = Array.isArray(b.contexto_chat)
    ? b.contexto_chat
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: text(m.content, 300) ?? "" }))
      .filter((m) => m.content)
      .slice(-3)
    : [];
  return {
    ok: true,
    value: {
      userName: oneLine(b.user_name, 120) || "Usuario IATOS",
      userPhone: phone,
      trip: t ? {
        titulo: text(t.titulo, 200), destinos: text(t.destinos, 200),
        fechaSalida: text(t.fecha_salida, 40), fechaRegreso: text(t.fecha_regreso, 40),
      } : null,
      urgencia,
      motivo,
      contexto,
    },
  };
}

const URGENCIA_LABEL: Record<Urgencia, string> = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja" };

/**
 * Asunto en una sola línea (sin inyección de encabezados), HTML con todo escapado sobre el sistema
 * premium compacto (_shared/email-kit.ts) y versión en texto plano. Marca [PRUEBA] si el motivo
 * dice "PRUEBA" o el correo de la cuenta es de prueba/e2e.
 */
export function buildFixerEmail(
  input: FixerInput,
  identity: { email: string | null; userId: string },
  now: Date = new Date(),
): { subject: string; html: string; text: string } {
  const color = COLOR[input.urgencia];
  const e = escapeHtml;
  const email = identity.email ?? "";
  const test = isTestRequest({ email, texts: [input.motivo, input.userName] });
  const subject = oneLine(`${test ? "[PRUEBA] " : ""}[IATOS Fixer · ${input.urgencia.toUpperCase()}] ${input.userName} — ${oneLine(input.motivo, 60)}`, 180);
  const urg = URGENCIA_LABEL[input.urgencia];
  const tripText = input.trip
    ? [input.trip.titulo ?? input.trip.destinos ?? "Viaje sin título", input.trip.destinos && input.trip.destinos !== input.trip.titulo ? input.trip.destinos : null,
      formatDateRange(input.trip.fechaSalida, input.trip.fechaRegreso) ?? [input.trip.fechaSalida, input.trip.fechaRegreso].filter(Boolean).join(" al ")].filter(Boolean).join(" · ")
    : "Sin viaje activo";
  const when = formatDateTime(now.toISOString());
  const badge = (t: string, c: string) =>
    `<span style="display:inline-block;padding:6px 12px;border:1px solid ${c};font-family:${SANS};font-size:10px;line-height:14px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${c};">${e(t)}</span>`;
  const chat = input.contexto.length
    ? input.contexto.map((t) => `<div style="padding:4px 0;"><span style="font-family:${SANS};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${EK.muted};">${t.role === "user" ? "Cliente" : "Iato"}</span><br>${e(t.content)}</div>`).join("")
    : "";
  const body = [
    masthead("Operaciones · Fixer"),
    gap(36),
    eyebrow("Solicitud al Fixer"),
    gap(12),
    headline(e(clipWords(input.motivo, 90)), { size: 28 }),
    gap(18),
    `<tr><td class="ek-pad" style="padding:0 56px;">${badge(`Urgencia ${urg}`, color)}&nbsp;${badge("Pendiente de atender", EK.warn)}${test ? `&nbsp;${badge("Prueba", EK.bad)}` : ""}</td></tr>`,
    gap(26),
    kvTable([
      { k: "Cliente", v: `${e(input.userName)} <span style="color:${EK.muted};font-size:12px;">(nombre que escribió el cliente)</span>` },
      { k: "Correo", v: email ? `<a href="mailto:${e(encodeURIComponent(email))}" style="color:${EK.gold};text-decoration:none;">${e(email)}</a>` : "sin correo" },
      input.userPhone ? { k: "Teléfono", v: e(input.userPhone) } : null,
      { k: "Viaje", v: e(tripText) },
      { k: "Recibida", v: e(`${when ?? ""} (hora CDMX)`) },
      { k: "Cuenta", v: `<span style="color:${EK.muted};font-size:12px;">${e(identity.userId)}</span>` },
    ]),
    gap(24),
    eyebrow("Motivo"),
    gap(10),
    callout(`<span style="white-space:pre-wrap;color:${EK.ivory};font-size:14px;">${e(input.motivo)}</span>`, { color }),
    chat ? gap(24) + eyebrow("Últimos mensajes con Iato") + gap(10) + callout(chat, { color: EK.line }) : "",
    gap(24),
    para(e(email ? "Responder a este correo le escribe directo al cliente." : "La cuenta no tiene correo: contesta desde el panel o por teléfono."), { size: 13, color: EK.muted }),
  ];
  const reason = "Correo interno de operaciones de IATOS: un cliente pidió ayuda humana desde el Concierge.";
  const html = shell({ title: subject, preheader: `Urgencia ${urg} · ${oneLine(input.motivo, 80)}`, body, reason, compact: true });
  const text = joinText([
    `${test ? "[PRUEBA] " : ""}SOLICITUD AL FIXER · URGENCIA ${urg.toUpperCase()}`,
    "",
    `Cliente: ${input.userName} (nombre que escribió el cliente)`,
    `Correo: ${email || "sin correo"}`,
    input.userPhone ? `Teléfono: ${input.userPhone}` : null,
    `Viaje: ${tripText}`,
    `Recibida: ${when ?? ""} (hora CDMX)`,
    `Cuenta: ${identity.userId}`,
    "",
    "MOTIVO",
    input.motivo,
    "",
    input.contexto.length ? "ÚLTIMOS MENSAJES CON IATO" : null,
    ...input.contexto.map((t) => `${t.role === "user" ? "Cliente" : "Iato"}: ${t.content}`),
    "",
    email ? "Responder a este correo le escribe directo al cliente." : null,
    "",
    ...textFooter({ reason, internal: true }),
  ]);
  return { subject, html, text };
}
