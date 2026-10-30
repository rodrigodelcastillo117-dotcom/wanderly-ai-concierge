// Registro de canales: qué está prendido, qué falta para prenderlo y envío con respaldo (si un canal falla,
// se intenta el siguiente). Puro: el entorno y los adaptadores llegan por parámetro.
import type { Channel, ChannelId, ChannelMessage, ChannelSendContext, ChannelSendResult, ChannelStatus } from "./types.ts";
import { emailChannel, type EmailSend } from "./email.ts";
import { secretosWhatsApp } from "./whatsapp.ts";

/**
 * Secretos que necesita cada canal (los pone el dueño en Supabase → Edge Functions → Secrets).
 * WhatsApp: Meta Cloud API directa (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET) o Twilio
 * (TWILIO_*); el proveedor lo decide whatsapp.ts proveedorWhatsApp. SMS: Twilio. Voz: Vapi (channels/voz.ts).
 */
export const CHANNEL_SECRETS: Record<Exclude<ChannelId, "email">, (env: (k: string) => string | undefined) => string[]> = {
  // El secreto del webhook se deriva del token (channels/telegram.ts): el dueño pega UN solo secreto.
  telegram: () => ["TELEGRAM_BOT_TOKEN"],
  // Devuelve los que FALTAN según el proveedor (con alias WHATSAPP_PHONE_ID); el registro filtra de nuevo (no cambia nada).
  whatsapp: (env) => secretosWhatsApp(env),
  sms: () => ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM"],
  // Llamadas salientes con un agente de voz (Vapi) sobre su número; además VOZ_LLAMADAS_REALES=true (voz.ts).
  voz: () => ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VOZ_WEBHOOK_SECRET"],
};

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  email: "Correo", telegram: "Telegram", whatsapp: "WhatsApp", sms: "SMS", voz: "Llamada de voz",
};

/** Adaptador de un canal externo: lo construye otro módulo con los secretos ya presentes. */
export type ChannelAdapterFactory = (env: (k: string) => string | undefined) => Channel;

export type ChannelRegistryDeps = {
  env: (k: string) => string | undefined;
  /** Envío de correo (sendEmail de _shared/email.ts). */
  sendEmail: EmailSend;
  /** Remitente por defecto del correo. */
  emailFrom?: string;
  /** Adaptadores ya escritos (telegram, whatsapp, sms, voz). Sin adaptador → apagado (no implementado). */
  adapters?: Partial<Record<Exclude<ChannelId, "email">, ChannelAdapterFactory>>;
};

export interface ChannelRegistry {
  status(): ChannelStatus[];
  isEnabled(id: ChannelId): boolean;
  get(id: ChannelId): Channel | null;
  send(id: ChannelId, to: string, message: ChannelMessage, ctx?: ChannelSendContext): Promise<ChannelSendResult>;
  /** Intenta en orden hasta que uno salga; devuelve todos los intentos (para la bitácora). */
  sendWithFallback(attempts: Array<{ channel: ChannelId; to: string }>, message: ChannelMessage, ctx?: ChannelSendContext):
    Promise<{ ok: boolean; delivered: ChannelSendResult | null; attempts: ChannelSendResult[] }>;
}

export function createChannelRegistry(deps: ChannelRegistryDeps): ChannelRegistry {
  const has = (k: string) => !!String(deps.env(k) ?? "").trim();
  const emailOn = has("RESEND_API_KEY") || has("LOVABLE_API_KEY");
  const statuses = new Map<ChannelId, ChannelStatus>();
  const channels = new Map<ChannelId, Channel>();

  statuses.set("email", {
    id: "email", label: CHANNEL_LABEL.email, enabled: emailOn, state: emailOn ? "activo" : "apagado_sin_secretos",
    missing: emailOn ? [] : ["RESEND_API_KEY"],
    note: emailOn ? "Correo con Resend: prendido." : "Correo apagado: falta RESEND_API_KEY (o LOVABLE_API_KEY con el conector de Resend).",
  });
  if (emailOn) channels.set("email", emailChannel({ send: deps.sendEmail, from: deps.emailFrom }));

  for (const id of ["telegram", "whatsapp", "sms", "voz"] as const) {
    const missing = CHANNEL_SECRETS[id](deps.env).filter((k) => !has(k));
    const adapter = deps.adapters?.[id];
    let st: ChannelStatus;
    if (missing.length) {
      st = { id, label: CHANNEL_LABEL[id], enabled: false, state: "apagado_sin_secretos", missing,
        note: `${CHANNEL_LABEL[id]} apagado: faltan los secretos ${missing.join(", ")}.` };
    } else if (!adapter) {
      st = { id, label: CHANNEL_LABEL[id], enabled: false, state: "apagado_no_implementado", missing: [],
        note: `${CHANNEL_LABEL[id]}: los secretos están, pero el adaptador todavía no está instalado.` };
    } else {
      st = { id, label: CHANNEL_LABEL[id], enabled: true, state: "activo", missing: [], note: `${CHANNEL_LABEL[id]}: prendido.` };
      channels.set(id, adapter(deps.env));
    }
    statuses.set(id, st);
  }

  const send = async (id: ChannelId, to: string, message: ChannelMessage, ctx?: ChannelSendContext): Promise<ChannelSendResult> => {
    const ch = channels.get(id);
    if (!ch) return { ok: false, channel: id, to, code: "CHANNEL_OFF", error: statuses.get(id)?.note ?? "apagado" };
    try {
      return await ch.send(to, message, ctx);
    } catch (e) {
      return { ok: false, channel: id, to, code: "SEND_FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  };

  return {
    status: () => [...statuses.values()],
    isEnabled: (id) => channels.has(id),
    get: (id) => channels.get(id) ?? null,
    send,
    async sendWithFallback(attempts, message, ctx) {
      const tried: ChannelSendResult[] = [];
      for (const a of attempts) {
        if (!a.to) continue;
        const r = await send(a.channel, a.to, message, ctx);
        tried.push(r);
        if (r.ok) return { ok: true, delivered: r, attempts: tried };
      }
      return { ok: false, delivered: null, attempts: tried };
    },
  };
}
