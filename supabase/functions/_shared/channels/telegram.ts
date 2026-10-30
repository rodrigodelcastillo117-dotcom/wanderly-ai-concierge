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

type TgMessage = {
  message_id?: number; date?: number; text?: string; caption?: string; chat?: { id?: number; type?: string };
  from?: { id?: number; username?: string; first_name?: string; is_bot?: boolean; language_code?: string };
  location?: { latitude?: number; longitude?: number };
  photo?: Array<{ file_id?: string; file_unique_id?: string; width?: number; height?: number; file_size?: number }>;
  document?: { file_id?: string; mime_type?: string; file_size?: number; file_name?: string };
};
export type TelegramUpdate = {
  update_id?: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: { id?: string; data?: string; from?: { id?: number; username?: string; is_bot?: boolean }; message?: { message_id?: number; chat?: { id?: number; type?: string } } };
};

/** Tope de un archivo que se descarga (getFile de la Bot API sirve hasta 20 MB; un ticket nunca pesa tanto). */
export const TELEGRAM_MAX_MEDIA = 8 * 1024 * 1024;

/**
 * Mensajes de chats privados (grupos y bots se ignoran): texto, ubicación compartida, foto o archivo (imagen/PDF, para
 * tickets) y toques de botón (callback_query). Lo demás (stickers, audios…) no se procesa.
 */
export function parseTelegramUpdate(u: TelegramUpdate, now = new Date()): InboundMessage[] {
  if (typeof u?.update_id !== "number") return [];
  const cb = u.callback_query;
  if (cb) {
    const chat = cb.message?.chat;
    if (!cb.id || !cb.data || !chat || chat.type !== "private" || typeof chat.id !== "number" || cb.from?.is_bot) return [];
    return [{
      channel: "telegram", from: String(chat.id), text: "", providerMessageId: String(u.update_id), receivedAt: now.toISOString(),
      boton: String(cb.data).slice(0, 64), callbackId: String(cb.id).slice(0, 100), raw: { username: cb.from?.username ?? null, message_id: cb.message?.message_id ?? null },
    }];
  }
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== "private" || m.from?.is_bot || typeof m.chat.id !== "number") return [];
  const text = String(m.text ?? m.caption ?? "").trim();
  const base = {
    channel: "telegram" as const, from: String(m.chat.id), text: text.slice(0, 4000), providerMessageId: String(u.update_id),
    receivedAt: typeof m.date === "number" ? new Date(m.date * 1000).toISOString() : now.toISOString(), folio: folioInText(text),
    raw: { username: m.from?.username ?? null, first_name: m.from?.first_name ?? null, message_id: m.message_id ?? null, idioma: m.from?.language_code ?? null },
  };
  if (m.location && Number.isFinite(m.location.latitude) && Number.isFinite(m.location.longitude)) {
    return [{ ...base, ubicacion: { lat: Number(m.location.latitude), lng: Number(m.location.longitude) } }];
  }
  if (Array.isArray(m.photo) && m.photo.length) {
    // La foto más grande que no pase del tope (Telegram manda varias resoluciones).
    const fotos = m.photo.filter((p) => p.file_id && (p.file_size ?? 0) <= TELEGRAM_MAX_MEDIA).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
    if (fotos[0]?.file_id) return [{ ...base, media: { ref: fotos[0].file_id, mime: "image/jpeg", bytes: fotos[0].file_size ?? null } }];
  }
  if (m.document?.file_id && /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(String(m.document.mime_type ?? "")) && (m.document.file_size ?? 0) <= TELEGRAM_MAX_MEDIA) {
    return [{ ...base, media: { ref: m.document.file_id, mime: m.document.mime_type ?? null, bytes: m.document.file_size ?? null } }];
  }
  if (!text) return [];
  return [base];
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
      body: JSON.stringify({ url: o.url, secret_token: o.secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
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

// ═══ Conversación (Iato por Telegram): texto con formato, botones, "escribiendo…", archivos ═══

export type TelegramBoton = { texto: string; data?: string; url?: string };

/** Teclado en línea: botones de acción (callback_data ≤ 64 bytes) o de enlace (https). Una fila por botón. */
export function inlineKeyboard(botones: TelegramBoton[]): { inline_keyboard: Array<Array<Record<string, string>>> } | undefined {
  const filas = botones.flatMap((b) => {
    const texto = String(b.texto ?? "").trim().slice(0, 60);
    if (!texto) return [];
    if (b.data && new TextEncoder().encode(b.data).length <= 64) return [[{ text: texto, callback_data: b.data }]];
    if (b.url && /^https:\/\//.test(b.url)) return [[{ text: texto, url: b.url }]];
    return [];
  });
  return filas.length ? { inline_keyboard: filas.slice(0, 8) } : undefined;
}

const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * Envía un mensaje con formato HTML de Telegram y botones. Si Telegram no acepta el HTML (400 "can't parse entities"),
 * reintenta en texto plano: el viajero siempre recibe la respuesta.
 */
export async function telegramEnviar(o: { token: string; fetch?: typeof fetch }, chatId: string, m: { html: string; botones?: TelegramBoton[] }): Promise<ChannelSendResult> {
  const f = o.fetch ?? fetch;
  if (!/^-?\d{3,20}$/.test(String(chatId ?? ""))) return { ok: false, channel: "telegram", to: chatId, code: "BAD_ADDRESS", error: "chat_id inválido" };
  const teclado = inlineKeyboard(m.botones ?? []);
  const intento = async (html: boolean) => {
    const r = await f(`${API}/bot${o.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text: (html ? m.html : sinEtiquetas(m.html)).slice(0, TELEGRAM_MAX), ...(html ? { parse_mode: "HTML" } : {}), disable_web_page_preview: true, ...(teclado ? { reply_markup: teclado } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    return { r, j };
  };
  try {
    let { r, j } = await intento(true);
    if (!j.ok && r.status === 400 && /parse entities|can't parse|unsupported start tag/i.test(String(j.description ?? ""))) ({ r, j } = await intento(false));
    if (!r.ok || !j.ok) return { ok: false, channel: "telegram", to: chatId, code: "SEND_FAILED", error: String(j.description ?? `HTTP ${r.status}`).slice(0, 200) };
    return { ok: true, channel: "telegram", to: chatId, providerMessageId: j.result?.message_id ? String(j.result.message_id) : null };
  } catch (e) {
    return { ok: false, channel: "telegram", to: chatId, code: "SEND_FAILED", error: (e as Error)?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

/** "Escribiendo…" mientras Iato piensa (dura ~5 s en la app de Telegram). */
export async function telegramEscribiendo(o: { token: string; fetch?: typeof fetch }, chatId: string): Promise<void> {
  const f = o.fetch ?? fetch;
  await f(`${API}/bot${o.token}/sendChatAction`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: Number(chatId), action: "typing" }), signal: AbortSignal.timeout(4_000),
  }).then((r) => r.body?.cancel()).catch(() => undefined);
}

/** Quita el "cargando" del botón tocado (Telegram lo pide siempre) y, si hay, muestra un aviso corto. */
export async function telegramResponderBoton(o: { token: string; fetch?: typeof fetch }, callbackId: string, texto?: string): Promise<void> {
  const f = o.fetch ?? fetch;
  await f(`${API}/bot${o.token}/answerCallbackQuery`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, ...(texto ? { text: texto.slice(0, 190) } : {}) }), signal: AbortSignal.timeout(4_000),
  }).then((r) => r.body?.cancel()).catch(() => undefined);
}

/** Descarga un archivo que mandó el viajero (getFile → /file/bot<token>/<ruta>). Nunca devuelve la URL (lleva el token). */
export async function telegramDescargar(o: { token: string; fetch?: typeof fetch }, fileId: string, maxBytes = TELEGRAM_MAX_MEDIA): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const f = o.fetch ?? fetch;
  if (!/^[\w-]{10,200}$/.test(fileId)) return null;
  try {
    const info = await (await f(`${API}/bot${o.token}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(8_000) })).json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
    const path = info.result?.file_path;
    if (!info.ok || !path || !/^[\w./-]{1,200}$/.test(path) || path.includes("..") || (info.result?.file_size ?? 0) > maxBytes) return null;
    const r = await f(`${API}/file/bot${o.token}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > maxBytes) return null;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", heic: "image/heic" } as Record<string, string>)[ext] ?? "image/jpeg";
    return { bytes, mime };
  } catch {
    return null;
  }
}
