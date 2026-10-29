// Canales enchufables (correo, Telegram, WhatsApp, SMS, voz). Interfaz común para avisar al equipo, escribirle
// al usuario o a un proveedor, y para recibir mensajes (webhook) que se agregan a la bitácora del incidente.
//
// Para agregar un canal (p. ej. Telegram): escribe un adaptador que implemente `Channel` (send + parseInbound,
// verificando la firma del proveedor) y regístralo en createChannelRegistry({ adapters: { telegram } }). Sin sus
// secretos el registro lo deja APAGADO y lo reporta (status()): nunca se inventan credenciales.
// Puro: sin Deno (el entorno llega por parámetro).

export type ChannelId = "email" | "telegram" | "whatsapp" | "sms" | "voz";
export const CHANNEL_IDS: ChannelId[] = ["email", "telegram", "whatsapp", "sms", "voz"];

export type ChannelMessage = {
  /** Asunto (correo) o primera línea. */
  subject?: string | null;
  /** Texto plano: lo que se manda por Telegram/WhatsApp/SMS o lo que se lee en una llamada. */
  text: string;
  html?: string | null;
  from?: string | null;
  replyTo?: string | null;
};

export type ChannelSendContext = {
  incidentId?: string | null;
  /** A quién va: el equipo (alerta), el viajero o un proveedor. */
  purpose?: "alerta_equipo" | "usuario" | "proveedor";
};

export type ChannelSendResult = {
  ok: boolean;
  channel: ChannelId;
  to: string;
  providerMessageId?: string | null;
  code?: "CHANNEL_OFF" | "SEND_FAILED" | "BAD_ADDRESS";
  error?: string | null;
};

/** Mensaje que llegó por un canal (ya verificada la firma del proveedor). */
export type InboundMessage = {
  channel: ChannelId;
  from: string;
  text: string;
  providerMessageId: string;
  receivedAt: string;
  /** Si el canal sabe a qué caso pertenece (hilo, folio en el texto…). */
  incidentId?: string | null;
  /** Folio de 8 letras si venía en el texto ("Folio ABCD1234"). */
  folio?: string | null;
  raw?: unknown;
};

export type ChannelState = "activo" | "apagado_sin_secretos" | "apagado_no_implementado";

export type ChannelStatus = {
  id: ChannelId;
  label: string;
  enabled: boolean;
  state: ChannelState;
  /** Secretos que faltan (nombres, nunca valores). */
  missing: string[];
  /** Explicación en español para el dueño. */
  note: string;
};

export interface Channel {
  id: ChannelId;
  label: string;
  /** Envía. Un canal apagado devuelve { ok: false, code: "CHANNEL_OFF" } sin lanzar. */
  send(to: string, message: ChannelMessage, ctx?: ChannelSendContext): Promise<ChannelSendResult>;
  /** Webhook de entrada: verifica la firma y devuelve los mensajes (null = firma inválida). */
  parseInbound?(req: Request): Promise<InboundMessage[] | null>;
}

/** Folio "ABCD1234" mencionado en un texto (para ligar un mensaje entrante a su caso). */
export function folioInText(text: string): string | null {
  const m = /\bfolio[:\s#]*([A-Z0-9]{8})\b/i.exec(String(text ?? ""));
  return m ? m[1].toUpperCase() : null;
}
