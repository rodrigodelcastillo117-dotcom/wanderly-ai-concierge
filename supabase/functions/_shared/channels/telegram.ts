// Canal TELEGRAM (Bot API). Implementa `Channel` (types.ts): enviar texto a un chat y leer el webhook de entrada.
//
// Secretos: solo TELEGRAM_BOT_TOKEN (lo da @BotFather). Sin él el canal queda APAGADO (registry.ts). El secreto del
// webhook (encabezado X-Telegram-Bot-Api-Secret-Token) se DERIVA del token (HMAC) para que el dueño pegue un solo
// secreto; si existe TELEGRAM_WEBHOOK_SECRET se usa ese. El webhook se registra con setWebhook (función canales,
// acción configurar_telegram, solo administradores). Puro: fetch y entorno por parámetro (probado con Vitest).
import type { Channel, ChannelMessage, ChannelSendContext, ChannelSendResult, InboundMessage } from "./types.ts";
import { folioInText } from "./types.ts";

const API = "https://api.telegram.org";
export const TELEGRAM_MAX = 4096;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Secreto del webhook: TELEGRAM_WEBHOOK_SECRET o HMAC-SHA256("iatos-telegram-webhook", token) (64 hex; Telegram acepta A-Za-z0-9_-). */
export async function telegramWebhookSecret(token: string, explicit?: string | null): Promise<string> {
  if (explicit && /^[A-Za-z0-9_-]{16,256}$/.test(explicit)) return explicit;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("iatos-telegram-webhook")));
}

/** Comparación en tiempo constante. */
export function sameSecret(a: string | null | undefined, b: string): boolean {
  const x = String(a ?? "");
  if (x.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < b.length; i++) d |= x.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type TelegramUpdate = {
  update_id?: number;
  message?: { message_id?: number; date?: number; text?: string; caption?: string; chat?: { id?: number; type?: string }; from?: { id?: number; username?: string; first_name?: string; is_bot?: boolean } };
  edited_message?: TelegramUpdate["message"];
};

/** Mensajes de texto de chats privados (grupos y bots se ignoran). */
export function parseTelegramUpdate(u: TelegramUpdate, now = new Date()): InboundMessage[] {
  const m = u?.message;
  if (!m || typeof u.update_id !== "number" || !m.chat || m.chat.type !== "private" || m.from?.is_bot) return [];
  const text = String(m.text ?? m.caption ?? "").trim();
  if (!text || typeof m.chat.id !== "number") return [];
  return [{
    channel: "telegram", from: String(m.chat.id), text: text.slice(0, 4000), providerMessageId: String(u.update_id),
    receivedAt: typeof m.date === "number" ? new Date(m.date * 1000).toISOString() : now.toISOString(), folio: folioInText(text),
    raw: { username: m.from?.username ?? null, first_name: m.from?.first_name ?? null, message_id: m.message_id ?? null },
  }];
}

/** "/start ABCD2345", "/vincular ABCD2345" o el código solo → código de vinculación (8 caracteres). */
export function linkCodeIn(text: string): string | null {
  const t = String(text ?? "").trim();
  const m = /^\/(?:start|vincular|link)(?:@\w+)?\s+([A-Za-z0-9]{8})\s*$/i.exec(t) ?? /^([A-HJ-NP-Z2-9]{8})$/.exec(t.toUpperCase());
  return m ? m[1].toUpperCase() : null;
}

export function telegramChannel(o: { token: string; fetch?: typeof fetch; webhookSecret?: string | null }): Channel {
  const doFetch = o.fetch ?? fetch;
  return {
    id: "telegram",
    label: "Telegram",
    async send(to: string, m: ChannelMessage, _ctx?: ChannelSendContext): Promise<ChannelSendResult> {
      if (!/^-?\d{3,20}$/.test(String(to ?? ""))) return { ok: false, channel: "telegram", to, code: "BAD_ADDRESS", error: "chat_id inválido" };
      const text = [m.subject && !m.text.startsWith(m.subject) ? m.subject : null, m.text].filter(Boolean).join("\n\n").slice(0, TELEGRAM_MAX);
      try {
        const r = await doFetch(`${API}/bot${o.token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(to), text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10_000),
        });
        const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
        // Nunca se devuelve la URL (lleva el token).
        if (!r.ok || !j.ok) return { ok: false, channel: "telegram", to, code: "SEND_FAILED", error: String(j.description ?? `HTTP ${r.status}`).slice(0, 200) };
        return { ok: true, channel: "telegram", to, providerMessageId: j.result?.message_id ? String(j.result.message_id) : null };
      } catch (e) {
        return { ok: false, channel: "telegram", to, code: "SEND_FAILED", error: (e as Error)?.name === "TimeoutError" ? "timeout" : "network_error" };
      }
    },
    async parseInbound(req: Request): Promise<InboundMessage[] | null> {
      const secret = await telegramWebhookSecret(o.token, o.webhookSecret);
      if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token"), secret)) return null;
      const body = await req.json().catch(() => null) as TelegramUpdate | null;
      return body ? parseTelegramUpdate(body) : [];
    },
  };
}

/** Registra el webhook (lo llama un administrador desde la app). Devuelve el nombre del bot. */
export async function configureTelegramWebhook(o: { token: string; url: string; secret: string; fetch?: typeof fetch }): Promise<{ ok: boolean; bot: string | null; error?: string }> {
  const doFetch = o.fetch ?? fetch;
  try {
    const me = await (await doFetch(`${API}/bot${o.token}/getMe`, { signal: AbortSignal.timeout(10_000) })).json() as { ok?: boolean; result?: { username?: string } };
    if (!me.ok) return { ok: false, bot: null, error: "El token no es válido (revisa TELEGRAM_BOT_TOKEN)" };
    const r = await (await doFetch(`${API}/bot${o.token}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: o.url, secret_token: o.secret, allowed_updates: ["message"], drop_pending_updates: true }),
      signal: AbortSignal.timeout(10_000),
    })).json() as { ok?: boolean; description?: string };
    return r.ok ? { ok: true, bot: me.result?.username ?? null } : { ok: false, bot: me.result?.username ?? null, error: String(r.description ?? "setWebhook falló").slice(0, 200) };
  } catch {
    return { ok: false, bot: null, error: "No se pudo hablar con Telegram" };
  }
}

/** Nombre del bot (getMe) para el enlace t.me/<bot>. */
export async function telegramBotName(token: string, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const me = await (await f(`${API}/bot${token}/getMe`, { signal: AbortSignal.timeout(6_000) })).json() as { ok?: boolean; result?: { username?: string } };
    return me.ok ? me.result?.username ?? null : null;
  } catch {
    return null;
  }
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1 (se confunden al copiarlos)
/** Código de vinculación de un solo uso (8 caracteres). Se guarda solo su SHA-256. */
export function newLinkCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => ALFABETO[x % ALFABETO.length]).join("");
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
