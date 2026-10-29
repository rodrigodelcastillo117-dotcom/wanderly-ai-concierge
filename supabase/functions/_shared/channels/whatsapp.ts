// Canal WHATSAPP · interfaz lista, APAGADO. No está registrado en incident-runtime.ts: aunque existan los secretos,
// el registro lo reporta "apagado_no_implementado" hasta que el dueño apruebe prenderlo (plantillas aprobadas por
// Meta, verificación del negocio y costo por mensaje: ver docs/iatos/IATOS_OPERADOR.md §Canales).
//
// Dos proveedores posibles (WHATSAPP_PROVIDER):
//   · "meta"   (Meta Cloud API directa): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET.
//              Envío: POST graph.facebook.com/v21.0/<phone_number_id>/messages. Entrada: firma X-Hub-Signature-256.
//   · "twilio" (por defecto): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM ("whatsapp:+52…").
//              Envío: POST api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json. Entrada: firma X-Twilio-Signature.
// Regla de Meta: fuera de la ventana de 24 h desde el último mensaje del viajero solo se pueden mandar PLANTILLAS
// aprobadas; dentro de la ventana, texto libre. `dentroDeVentana` lo decide; el adaptador no manda texto libre fuera.
// Puro (sin Deno): fetch y entorno por parámetro.
import type { Channel, ChannelMessage, ChannelSendResult, InboundMessage } from "./types.ts";

export type WhatsAppProvider = "meta" | "twilio";
export const WHATSAPP_WINDOW_MS = 24 * 3600 * 1000;

/** ¿Se puede mandar texto libre? Solo dentro de las 24 h desde el último mensaje del viajero. */
export function dentroDeVentana(ultimoMensajeDelViajero: string | null | undefined, ahora = new Date()): boolean {
  const t = ultimoMensajeDelViajero ? Date.parse(ultimoMensajeDelViajero) : NaN;
  return Number.isFinite(t) && ahora.getTime() - t < WHATSAPP_WINDOW_MS;
}

/** Teléfono en formato E.164 (+5215512345678) o null. */
export function e164(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

/** Cuerpo para Meta Cloud API (texto libre dentro de la ventana). */
export function metaTextPayload(to: string, text: string) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: text.slice(0, 4096) } };
}

/** Cuerpo para Meta Cloud API con plantilla aprobada (fuera de la ventana). */
export function metaTemplatePayload(to: string, template: string, lang: string, params: string[]) {
  return {
    messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
    template: { name: template, language: { code: lang }, components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p.slice(0, 1000) })) }] : [] },
  };
}

/** Formulario para Twilio (application/x-www-form-urlencoded). */
export function twilioForm(from: string, to: string, text: string): URLSearchParams {
  return new URLSearchParams({ From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`, To: `whatsapp:${to}`, Body: text.slice(0, 1600) });
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(alg: "SHA-256" | "SHA-1", key: string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: alg }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, cuerpo crudo). */
export async function verifyMetaSignature(header: string | null, rawBody: string, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const want = `sha256=${hex(await hmac("SHA-256", appSecret, rawBody))}`;
  return want.length === header.length && [...want].every((c, i) => c === header[i]);
}

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(auth_token, url + parámetros ordenados concatenados)). */
export async function verifyTwilioSignature(header: string | null, url: string, params: Record<string, string>, authToken: string): Promise<boolean> {
  if (!header || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = btoa(String.fromCharCode(...new Uint8Array(await hmac("SHA-1", authToken, data))));
  return want === header;
}

/** Mensajes entrantes de Meta (entry[].changes[].value.messages[]) → InboundMessage. */
export function parseMetaWebhook(body: unknown, now = new Date()): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }> } }> }> })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) {
    if (m.type !== "text" || !m.id || !m.from || !m.text?.body) continue;
    out.push({ channel: "whatsapp", from: `+${m.from}`, text: m.text.body.slice(0, 4000), providerMessageId: m.id,
      receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : now.toISOString() });
  }
  return out;
}

/**
 * Adaptador (listo, sin registrar). `send` exige que el viajero haya escrito en las últimas 24 h (`ventana`), si no
 * devuelve CHANNEL_OFF con la explicación: fuera de la ventana hacen falta plantillas aprobadas por Meta.
 */
export function whatsappChannel(o: { env: (k: string) => string | undefined; fetch?: typeof fetch; ventana?: (to: string) => Promise<boolean> }): Channel {
  const provider: WhatsAppProvider = String(o.env("WHATSAPP_PROVIDER") ?? "twilio").toLowerCase() === "meta" ? "meta" : "twilio";
  const doFetch = o.fetch ?? fetch;
  return {
    id: "whatsapp",
    label: "WhatsApp",
    async send(to: string, m: ChannelMessage): Promise<ChannelSendResult> {
      const phone = e164(to);
      if (!phone) return { ok: false, channel: "whatsapp", to, code: "BAD_ADDRESS", error: "teléfono inválido" };
      if (o.ventana && !(await o.ventana(phone))) return { ok: false, channel: "whatsapp", to, code: "CHANNEL_OFF", error: "fuera de la ventana de 24 h: hace falta una plantilla aprobada" };
      const text = [m.subject, m.text].filter(Boolean).join("\n\n");
      try {
        const r = provider === "meta"
          ? await doFetch(`https://graph.facebook.com/v21.0/${o.env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
            method: "POST", headers: { Authorization: `Bearer ${o.env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(metaTextPayload(phone, text)),
          })
          : await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${o.env("TWILIO_ACCOUNT_SID")}/Messages.json`, {
            method: "POST", headers: { Authorization: `Basic ${btoa(`${o.env("TWILIO_ACCOUNT_SID")}:${o.env("TWILIO_AUTH_TOKEN")}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: twilioForm(String(o.env("TWILIO_WHATSAPP_FROM") ?? ""), phone, text),
          });
        const j = await r.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; sid?: string };
        return r.ok ? { ok: true, channel: "whatsapp", to, providerMessageId: j.messages?.[0]?.id ?? j.sid ?? null } : { ok: false, channel: "whatsapp", to, code: "SEND_FAILED", error: `HTTP ${r.status}` };
      } catch {
        return { ok: false, channel: "whatsapp", to, code: "SEND_FAILED", error: "network_error" };
      }
    },
  };
}
