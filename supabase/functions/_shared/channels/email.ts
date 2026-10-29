// Canal de correo (Resend, vía _shared/email.ts sendEmail). La entrada de correos ya existe aparte
// (reservations-inbound con Resend inbound firmado), así que este canal solo envía.
import type { Channel, ChannelMessage, ChannelSendContext, ChannelSendResult } from "./types.ts";

export type EmailSend = (m: { to: string | string[]; subject: string; html: string; text: string; from?: string; replyTo?: string; headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; id?: string; error?: string }>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function emailChannel(o: { send: EmailSend; from?: string | null }): Channel {
  return {
    id: "email",
    label: "Correo",
    async send(to: string, m: ChannelMessage, ctx?: ChannelSendContext): Promise<ChannelSendResult> {
      if (!EMAIL.test(String(to ?? "").trim())) return { ok: false, channel: "email", to, code: "BAD_ADDRESS", error: "correo inválido" };
      const r = await o.send({
        to: to.trim(),
        subject: (m.subject ?? m.text.split("\n")[0] ?? "IATOS").slice(0, 180),
        html: m.html ?? `<div style="font-family:sans-serif;white-space:pre-line">${esc(m.text)}</div>`,
        text: m.text,
        ...(m.from ?? o.from ? { from: (m.from ?? o.from)! } : {}),
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
        ...(ctx?.incidentId ? { headers: { "X-IATOS-Incident": ctx.incidentId } } : {}),
      });
      return r.ok ? { ok: true, channel: "email", to, providerMessageId: r.id ?? null }
        : { ok: false, channel: "email", to, code: "SEND_FAILED", error: (r.error ?? "error").slice(0, 200) };
    },
  };
}
