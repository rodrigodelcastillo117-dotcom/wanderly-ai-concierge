// Correo al Fixer humano (F-08 / IATOS-051). Lógica pura, probada en src/test/fixerEmail.test.ts.
//
// Antes: urgencia sin validar entraba al HTML y al estilo, el escape propio no escapaba comillas
// (rompía el href del mailto) y el correo del cliente y el replyTo salían del CUERPO de la
// petición, así que cualquiera podía hacerse pasar por otra persona ante el staff.
// Ahora: todo pasa por escapeHtml de _shared/email.ts, urgencia es un enum, los textos tienen
// tope, el asunto no admite saltos de línea y la identidad (correo, replyTo) la pone index.ts
// con el usuario autenticado.
import { escapeHtml, oneLine } from "../_shared/email.ts";

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

/** Asunto en una sola línea (sin inyección de encabezados) y HTML con todo escapado. */
export function buildFixerEmail(
  input: FixerInput,
  identity: { email: string | null; userId: string },
  now: Date = new Date(),
): { subject: string; html: string } {
  const color = COLOR[input.urgencia];
  const e = escapeHtml;
  const email = identity.email ?? "";
  const subject = oneLine(`[IATOS Fixer · ${input.urgencia.toUpperCase()}] ${input.userName} — ${oneLine(input.motivo, 60)}`, 180);
  const trip = input.trip
    ? `<h3 style="margin:18px 0 4px;color:#111">Viaje activo</h3>
       <p style="margin:2px 0"><b>Título:</b> ${e(input.trip.titulo ?? "Sin título")}</p>
       <p style="margin:2px 0"><b>Destinos:</b> ${e(input.trip.destinos ?? "N/A")}</p>
       <p style="margin:2px 0"><b>Fechas:</b> ${e(input.trip.fechaSalida ?? "?")} al ${e(input.trip.fechaRegreso ?? "?")}</p>`
    : "";
  const chat = input.contexto.length
    ? `<h3 style="margin:18px 0 4px;color:#111">Contexto chat con Iato</h3>
       <div style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px">
         ${input.contexto.map((t) => `<p style="margin:6px 0"><b>${t.role === "user" ? "Cliente" : "Iato"}:</b> ${e(t.content)}</p>`).join("")}
       </div>`
    : "";
  const reply = email
    ? `<p style="font-size:13px"><a href="mailto:${e(encodeURIComponent(email))}" style="color:${color}">Responder al cliente directo</a></p>`
    : "";
  const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#111;padding:20px;max-width:640px;margin:0 auto">
  <h2 style="color:${color};margin:0 0 12px">Solicitud Fixer IATOS — ${e(input.urgencia.toUpperCase())}</h2>
  <h3 style="margin:18px 0 4px;color:#111">Cliente</h3>
  <p style="margin:2px 0"><b>Nombre (lo escribió el cliente):</b> ${e(input.userName)}</p>
  <p style="margin:2px 0"><b>Email de la cuenta:</b> ${e(email || "sin correo")}</p>
  <p style="margin:2px 0"><b>ID de usuario:</b> ${e(identity.userId)}</p>
  ${input.userPhone ? `<p style="margin:2px 0"><b>Teléfono:</b> ${e(input.userPhone)}</p>` : ""}
  ${trip}
  <h3 style="margin:18px 0 4px;color:#111">Motivo</h3>
  <div style="background:#fffbea;padding:12px;border-left:3px solid ${color};border-radius:4px;white-space:pre-wrap">${e(input.motivo)}</div>
  ${chat}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5"/>
  <p style="color:#888;font-size:12px">IATOS AI · ${e(now.toLocaleString("es-MX", { timeZone: "America/Mexico_City" }))}</p>
  ${reply}
</body></html>`;
  return { subject, html };
}
