// Canal WHATSAPP (WhatsApp Business Platform). Dos proveedores con la MISMA interfaz (WhatsAppProveedor):
//
//   · "meta"   (Meta Cloud API directa, recomendado): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (alias WHATSAPP_PHONE_ID),
//              WHATSAPP_APP_SECRET. Envío: POST graph.facebook.com/<versión>/<phone_number_id>/messages (Bearer).
//              Webhook: GET con hub.mode=subscribe, hub.verify_token, hub.challenge (se responde el challenge);
//              POST firmado con X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, cuerpo crudo).
//              Medios: GET /<media_id> → url (vence a los 5 min) y GET url con el mismo token.
//              (Documentación oficial de Meta consultada el 30-oct-2026; los ejemplos usan la versión v26.0.)
//   · "twilio" (alternativa): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM ("whatsapp:+52…").
//              Envío: POST api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json. Entrada: firma X-Twilio-Signature
//              (HMAC-SHA1 de la URL + parámetros ordenados, en base64). Plantillas: Content SIDs aprobados
//              (TWILIO_WHATSAPP_CONTENT_SIDS = {"iatos_aviso_caso":"HX…", …}).
//
// Proveedor: WHATSAPP_PROVIDER si existe; si no, "meta" si está WHATSAPP_TOKEN, "twilio" si está TWILIO_WHATSAPP_FROM,
// y "meta" por omisión. Sin sus secretos el canal queda APAGADO (registry.ts).
//
// Regla de Meta (ventana de atención de 24 h): el texto libre (mensajes de "servicio") solo se manda si el viajero
// escribió en las últimas 24 h; fuera de la ventana SOLO plantillas aprobadas (PLANTILLAS_WHATSAPP). El adaptador
// nunca manda texto libre fuera de la ventana. Puro (sin Deno): fetch y entorno por parámetro.
import type { Channel, ChannelMessage, ChannelSendContext, ChannelSendResult, InboundMessage } from "./types.ts";
import { folioInText } from "./types.ts";

export type WhatsAppProvider = "meta" | "twilio";
export const WHATSAPP_WINDOW_MS = 24 * 3600 * 1000;
export const WHATSAPP_GRAPH_VERSION = "v26.0";
export const WHATSAPP_MAX_TEXTO = 4096;
export const WHATSAPP_MAX_BOTONES = 3;
export const WHATSAPP_MAX_TITULO_BOTON = 20;

type Env = (k: string) => string | undefined;
const val = (env: Env, k: string) => String(env(k) ?? "").trim();

/** Proveedor elegido (ver encabezado). */
export function proveedorWhatsApp(env: Env): WhatsAppProvider {
  const p = val(env, "WHATSAPP_PROVIDER").toLowerCase();
  if (p === "meta" || p === "twilio") return p;
  if (val(env, "WHATSAPP_TOKEN")) return "meta";
  if (val(env, "TWILIO_WHATSAPP_FROM")) return "twilio";
  return "meta";
}

/** Secretos que faltan para prender WhatsApp (nombres, nunca valores). */
export function secretosWhatsApp(env: Env): string[] {
  const need = proveedorWhatsApp(env) === "meta"
    ? ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]
    : ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"];
  return need.filter((k) => !(val(env, k) || (k === "WHATSAPP_PHONE_NUMBER_ID" && val(env, "WHATSAPP_PHONE_ID"))));
}

/** ¿Se puede mandar texto libre? Solo dentro de las 24 h desde el último mensaje del viajero. */
export function dentroDeVentana(ultimoMensajeDelViajero: string | null | undefined, ahora = new Date()): boolean {
  const t = ultimoMensajeDelViajero ? Date.parse(ultimoMensajeDelViajero) : NaN;
  return Number.isFinite(t) && ahora.getTime() - t < WHATSAPP_WINDOW_MS && ahora.getTime() - t >= -60_000;
}

/** Teléfono en formato E.164 (+5215512345678) o null. */
export function e164(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  const withPlus = d.startsWith("+") ? d : d ? `+${d}` : "";
  return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
}

// ═══ Plantillas (texto listo para someter a Meta; ver docs/iatos/IATOS_CANALES.md) ═══

export type PlantillaWhatsApp = {
  nombre: string;
  categoria: "UTILITY";
  /** Idioma de Meta → cuerpo con {{1}}, {{2}}… (nunca al inicio ni al final; sin variables pegadas). */
  textos: Record<"es_MX" | "en_US", string>;
  pie: Record<"es_MX" | "en_US", string>;
  /** Ejemplos para la revisión de Meta (en el orden de las variables). */
  ejemplo: Record<"es_MX" | "en_US", string[]>;
  /** Para qué sirve (para el dueño). */
  uso: string;
};

export const PLANTILLAS_WHATSAPP: Record<"iatos_aviso_caso" | "iatos_aviso_vuelo", PlantillaWhatsApp> = {
  iatos_aviso_caso: {
    nombre: "iatos_aviso_caso",
    categoria: "UTILITY",
    textos: {
      es_MX: "Hola {{1}}, hay novedades en tu caso {{2}} con IATOS: {{3}}\n\nResponde a este mensaje para seguir por aquí con el operador de IATOS.",
      en_US: "Hi {{1}}, there is an update on your IATOS case {{2}}: {{3}}\n\nReply to this message to continue here with the IATOS operator.",
    },
    pie: { es_MX: "IATOS · asistente de viaje con IA", en_US: "IATOS · AI travel assistant" },
    ejemplo: {
      es_MX: ["Ana", "AB12CD34", "localizamos a tu chofer y llega en 10 minutos a la puerta 3"],
      en_US: ["Ana", "AB12CD34", "we found your driver and he will be at door 3 in 10 minutes"],
    },
    uso: "Avisos de un caso abierto (incidente) cuando el viajero no ha escrito en las últimas 24 horas.",
  },
  iatos_aviso_vuelo: {
    nombre: "iatos_aviso_vuelo",
    categoria: "UTILITY",
    textos: {
      es_MX: "Aviso de tu vuelo {{1}} del {{2}}: {{3}}\n\nTe seguimos avisando por aquí. Si necesitas ayuda, responde a este mensaje.",
      en_US: "Update on your flight {{1}} on {{2}}: {{3}}\n\nWe will keep you posted here. If you need help, reply to this message.",
    },
    pie: { es_MX: "IATOS · seguimiento de vuelos", en_US: "IATOS · flight tracking" },
    ejemplo: {
      es_MX: ["AM 401", "12 de noviembre", "cambió de puerta a la B12 y sale a las 14:35"],
      en_US: ["AM 401", "November 12", "the gate changed to B12 and it now departs at 14:35"],
    },
    uso: "Cambios de un vuelo que el viajero sigue (puerta, retraso, cancelación) fuera de la ventana de 24 horas.",
  },
};

/**
 * Valor de una variable de plantilla: Meta rechaza saltos de línea, tabuladores y más de 4 espacios seguidos dentro
 * de una variable; se limpia y se recorta (≤ 300 caracteres).
 */
export function paramPlantilla(v: unknown, max = 300): string {
  const s = String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (s || "-").slice(0, max);
}

/** Cuerpo para Meta Cloud API (texto libre dentro de la ventana). */
export function metaTextPayload(to: string, text: string) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: text.slice(0, WHATSAPP_MAX_TEXTO) } };
}

/** Cuerpo para Meta Cloud API con plantilla aprobada (fuera de la ventana). Variables posicionales. */
export function metaTemplatePayload(to: string, template: string, lang: string, params: string[]) {
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template",
    template: { name: template, language: { code: lang }, components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: paramPlantilla(p, 1000) })) }] : [] },
  };
}

export type BotonWhatsApp = { id: string; titulo: string };

/** Título de botón: máximo 20 caracteres (Meta). */
export const tituloBoton = (t: string) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length <= WHATSAPP_MAX_TITULO_BOTON ? s : `${s.slice(0, WHATSAPP_MAX_TITULO_BOTON - 1).trimEnd()}…`;
};

/** Mensaje interactivo con botones de respuesta (máx. 3; cuerpo ≤ 1024; id ≤ 256). */
export function metaButtonsPayload(to: string, cuerpo: string, botones: BotonWhatsApp[]) {
  const vistos = new Set<string>();
  const bs = botones.slice(0, WHATSAPP_MAX_BOTONES).map((b) => {
    let t = tituloBoton(b.titulo);
    while (vistos.has(t)) t = tituloBoton(`${t.slice(0, 17)} ${vistos.size + 1}`); // títulos únicos
    vistos.add(t);
    return { type: "reply", reply: { id: String(b.id).slice(0, 256), title: t } };
  });
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "interactive",
    interactive: { type: "button", body: { text: cuerpo.slice(0, 1024) }, action: { buttons: bs } },
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
function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, cuerpo crudo). Comparación en tiempo constante. */
export async function verifyMetaSignature(header: string | null, rawBody: string, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  return igualesSeguro(`sha256=${hex(await hmac("SHA-256", appSecret, rawBody))}`, header.trim());
}

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(auth_token, url + parámetros ordenados concatenados)). */
export async function verifyTwilioSignature(header: string | null, url: string, params: Record<string, string>, authToken: string): Promise<boolean> {
  if (!header || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = btoa(String.fromCharCode(...new Uint8Array(await hmac("SHA-1", authToken, data))));
  return igualesSeguro(want, header.trim());
}

/** Token de verificación del webhook de Meta: WHATSAPP_VERIFY_TOKEN o derivado del app secret (un secreto menos que pegar). */
export async function whatsappVerifyToken(appSecret: string, explicit?: string | null): Promise<string> {
  if (explicit && /^[A-Za-z0-9_-]{16,128}$/.test(explicit)) return explicit;
  return hex(await hmac("SHA-256", appSecret, "iatos-whatsapp-verify")).slice(0, 40);
}

/** GET de verificación de Meta: devuelve el challenge si el token coincide; null si no. */
export function verificarSuscripcionMeta(url: URL, token: string): string | null {
  const mode = url.searchParams.get("hub.mode");
  const tk = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !token || !igualesSeguro(tk, token) || !/^[\w-]{1,128}$/.test(challenge)) return null;
  return challenge;
}

type MetaMsg = {
  id?: string; from?: string; timestamp?: string; type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
  button?: { payload?: string; text?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
};

/** Mensajes entrantes de Meta (entry[].changes[].value.messages[]) → InboundMessage. Texto, botón, ubicación, foto. */
export function parseMetaWebhook(body: unknown, now = new Date()): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: MetaMsg[]; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }> } }> }> })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) {
    const contactos = c.value?.contacts ?? [];
    for (const m of c.value?.messages ?? []) {
      if (!m.id || !m.from || !/^\d{8,15}$/.test(m.from)) continue;
      const base = {
        channel: "whatsapp" as const, from: `+${m.from}`, providerMessageId: m.id,
        receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : now.toISOString(),
        raw: { name: contactos.find((x) => x.wa_id === m.from)?.profile?.name ?? null },
      };
      if (m.type === "text" && m.text?.body) {
        out.push({ ...base, text: m.text.body.slice(0, 4000), folio: folioInText(m.text.body) });
      } else if (m.type === "interactive" && m.interactive?.button_reply?.id) {
        out.push({ ...base, text: String(m.interactive.button_reply.title ?? "").slice(0, 100), boton: m.interactive.button_reply.id.slice(0, 256) });
      } else if (m.type === "button" && m.button?.payload) {
        // Botón de respuesta rápida de una plantilla.
        out.push({ ...base, text: String(m.button.text ?? "").slice(0, 100), boton: m.button.payload.slice(0, 256) });
      } else if (m.type === "location" && Number.isFinite(m.location?.latitude) && Number.isFinite(m.location?.longitude)) {
        out.push({ ...base, text: [m.location!.name, m.location!.address].filter(Boolean).join(", ").slice(0, 300), ubicacion: { lat: Number(m.location!.latitude), lng: Number(m.location!.longitude) } });
      } else if (m.type === "image" && m.image?.id) {
        out.push({ ...base, text: String(m.image.caption ?? "").slice(0, 1000), media: { ref: m.image.id, mime: m.image.mime_type ?? "image/jpeg" } });
      } else if (m.type === "document" && m.document?.id && /^(image\/|application\/pdf)/.test(String(m.document.mime_type ?? ""))) {
        out.push({ ...base, text: String(m.document.caption ?? "").slice(0, 1000), media: { ref: m.document.id, mime: m.document.mime_type ?? null } });
      }
    }
  }
  return out;
}

/** Mensaje entrante de Twilio (formulario) → InboundMessage. */
export function parseTwilioForm(p: Record<string, string>, now = new Date()): InboundMessage[] {
  const from = e164(p.From);
  if (!from || !p.MessageSid) return [];
  const base = { channel: "whatsapp" as const, from, providerMessageId: p.MessageSid, receivedAt: now.toISOString(), raw: { name: p.ProfileName ?? null } };
  if (p.ButtonPayload) return [{ ...base, text: String(p.ButtonText ?? p.Body ?? "").slice(0, 100), boton: p.ButtonPayload.slice(0, 256) }];
  if (p.Latitude && p.Longitude && Number.isFinite(Number(p.Latitude)) && Number.isFinite(Number(p.Longitude))) {
    return [{ ...base, text: String(p.Body ?? "").slice(0, 300), ubicacion: { lat: Number(p.Latitude), lng: Number(p.Longitude) } }];
  }
  if (Number(p.NumMedia ?? 0) > 0 && p.MediaUrl0 && /^https:\/\/api\.twilio\.com\//.test(p.MediaUrl0)) {
    return [{ ...base, text: String(p.Body ?? "").slice(0, 1000), media: { ref: p.MediaUrl0, mime: p.MediaContentType0 ?? null } }];
  }
  const body = String(p.Body ?? "").trim();
  return body ? [{ ...base, text: body.slice(0, 4000), folio: folioInText(body) }] : [];
}

// ═══ Proveedor (envío, botones, plantillas, medios) ═══

export type ResultadoWA = ChannelSendResult;

export interface WhatsAppProveedor {
  proveedor: WhatsAppProvider;
  texto(to: string, texto: string): Promise<ResultadoWA>;
  /** Botones de respuesta (Meta: interactivos; Twilio: texto con las opciones numeradas). */
  botones(to: string, cuerpo: string, botones: BotonWhatsApp[]): Promise<ResultadoWA>;
  plantilla(to: string, nombre: string, params: string[], idioma?: string): Promise<ResultadoWA>;
  /** Descarga un medio entrante (foto de un ticket). Máx. `maxBytes`. */
  descargar(ref: string, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

const fallo = (to: string, error: string, code: ChannelSendResult["code"] = "SEND_FAILED"): ResultadoWA => ({ ok: false, channel: "whatsapp", to, code, error });

export function whatsappProveedor(o: { env: Env; fetch?: typeof fetch }): WhatsAppProveedor {
  const env = o.env;
  const f = o.fetch ?? fetch;
  const prov = proveedorWhatsApp(env);
  const version = /^v\d{1,3}\.\d$/.test(val(env, "WHATSAPP_GRAPH_VERSION")) ? val(env, "WHATSAPP_GRAPH_VERSION") : WHATSAPP_GRAPH_VERSION;
  const phoneId = val(env, "WHATSAPP_PHONE_NUMBER_ID") || val(env, "WHATSAPP_PHONE_ID");
  const token = val(env, "WHATSAPP_TOKEN");
  const sid = val(env, "TWILIO_ACCOUNT_SID");
  const auth = val(env, "TWILIO_AUTH_TOKEN");
  const twFrom = val(env, "TWILIO_WHATSAPP_FROM");

  const meta = async (to: string, payload: unknown): Promise<ResultadoWA> => {
    const phone = e164(to);
    if (!phone) return fallo(to, "teléfono inválido", "BAD_ADDRESS");
    try {
      const r = await f(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } };
      // Nunca se devuelve el token; el error de Meta se recorta.
      return r.ok ? { ok: true, channel: "whatsapp", to: phone, providerMessageId: j.messages?.[0]?.id ?? null }
        : fallo(phone, `HTTP ${r.status}${j.error?.code ? ` (${j.error.code})` : ""}${j.error?.message ? `: ${String(j.error.message).slice(0, 120)}` : ""}`);
    } catch (e) {
      return fallo(phone, (e as Error)?.name === "TimeoutError" ? "timeout" : "network_error");
    }
  };
  const twilio = async (to: string, form: URLSearchParams): Promise<ResultadoWA> => {
    const phone = e164(to);
    if (!phone) return fallo(to, "teléfono inválido", "BAD_ADDRESS");
    try {
      const r = await f(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST", headers: { Authorization: `Basic ${btoa(`${sid}:${auth}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({})) as { sid?: string; message?: string };
      return r.ok ? { ok: true, channel: "whatsapp", to: phone, providerMessageId: j.sid ?? null } : fallo(phone, `HTTP ${r.status}`);
    } catch {
      return fallo(phone, "network_error");
    }
  };

  return {
    proveedor: prov,
    texto: (to, texto) => prov === "meta" ? meta(to, metaTextPayload(e164(to) ?? to, texto)) : twilio(to, twilioForm(twFrom, e164(to) ?? to, texto)),
    botones: (to, cuerpo, botones) => {
      if (!botones.length) return prov === "meta" ? meta(to, metaTextPayload(e164(to) ?? to, cuerpo)) : twilio(to, twilioForm(twFrom, e164(to) ?? to, cuerpo));
      if (prov === "meta") return meta(to, metaButtonsPayload(e164(to) ?? to, cuerpo, botones));
      // Twilio sin plantilla de botones: opciones numeradas; el viajero responde "1", "2"… (lo traduce conversacion.ts).
      const lista = botones.slice(0, WHATSAPP_MAX_BOTONES).map((b, i) => `${i + 1}. ${b.titulo}`).join("\n");
      return twilio(to, twilioForm(twFrom, e164(to) ?? to, `${cuerpo}\n\nResponde con el número:\n${lista}`));
    },
    plantilla: async (to, nombre, params, idioma = "es_MX") => {
      if (prov === "meta") return meta(to, metaTemplatePayload(e164(to) ?? to, nombre, idioma, params));
      let sids: Record<string, string> = {};
      try { sids = JSON.parse(val(env, "TWILIO_WHATSAPP_CONTENT_SIDS") || "{}"); } catch { sids = {}; }
      const contentSid = sids[`${nombre}:${idioma}`] ?? sids[nombre];
      if (!contentSid || !/^HX[0-9a-f]{32}$/i.test(contentSid)) return fallo(to, `plantilla ${nombre} sin Content SID aprobado`, "CHANNEL_OFF");
      const phone = e164(to);
      if (!phone) return fallo(to, "teléfono inválido", "BAD_ADDRESS");
      const vars = Object.fromEntries(params.map((p, i) => [String(i + 1), paramPlantilla(p)]));
      return twilio(phone, new URLSearchParams({ From: twFrom.startsWith("whatsapp:") ? twFrom : `whatsapp:${twFrom}`, To: `whatsapp:${phone}`, ContentSid: contentSid, ContentVariables: JSON.stringify(vars) }));
    },
    descargar: async (ref, maxBytes) => {
      try {
        let url = ref;
        let headers: Record<string, string>;
        if (prov === "meta") {
          if (!/^\d{5,30}$/.test(ref)) return null;
          const info = await (await f(`https://graph.facebook.com/${version}/${ref}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) })).json() as { url?: string; file_size?: number; mime_type?: string };
          if (!info.url || (info.file_size ?? 0) > maxBytes) return null;
          url = info.url;
          headers = { Authorization: `Bearer ${token}` };
        } else {
          if (!/^https:\/\/api\.twilio\.com\//.test(ref)) return null;
          headers = { Authorization: `Basic ${btoa(`${sid}:${auth}`)}` };
        }
        const r = await f(url, { headers, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) return null;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.byteLength || bytes.byteLength > maxBytes) return null;
        return { bytes, mime: (r.headers.get("content-type") ?? "image/jpeg").split(";")[0] };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Adaptador del registro (avisos del Operador y de la vigilancia). `ventana(to)` dice si el viajero escribió en las
 * últimas 24 h: dentro, texto libre; fuera, la plantilla de `ctx.plantilla` (si no hay, CHANNEL_OFF con la razón).
 * Sin `ventana` se asume CERRADA (nunca se arriesga un texto libre que Meta rechazaría).
 */
export function whatsappChannel(o: { env: Env; fetch?: typeof fetch; ventana?: (to: string) => Promise<boolean> }): Channel {
  const p = whatsappProveedor({ env: o.env, fetch: o.fetch });
  return {
    id: "whatsapp",
    label: "WhatsApp",
    async send(to: string, m: ChannelMessage, ctx?: ChannelSendContext): Promise<ChannelSendResult> {
      const phone = e164(to);
      if (!phone) return fallo(to, "teléfono inválido", "BAD_ADDRESS");
      const abierta = o.ventana ? await o.ventana(phone).catch(() => false) : false;
      if (abierta) return p.texto(phone, [m.subject && !m.text.startsWith(m.subject) ? m.subject : null, m.text].filter(Boolean).join("\n\n"));
      if (ctx?.plantilla?.nombre) return p.plantilla(phone, ctx.plantilla.nombre, ctx.plantilla.params, ctx.plantilla.idioma ?? "es_MX");
      return fallo(phone, "fuera de la ventana de 24 h: hace falta una plantilla aprobada", "CHANNEL_OFF");
    },
  };
}

/** Número público de WhatsApp de IATOS (para el enlace wa.me de la app): WHATSAPP_NUMERO, el de Twilio o el de Meta. */
export async function numeroWhatsApp(env: Env, f: typeof fetch = fetch): Promise<string | null> {
  const fijo = e164(val(env, "WHATSAPP_NUMERO"));
  if (fijo) return fijo;
  if (proveedorWhatsApp(env) === "twilio") return e164(val(env, "TWILIO_WHATSAPP_FROM"));
  const id = val(env, "WHATSAPP_PHONE_NUMBER_ID") || val(env, "WHATSAPP_PHONE_ID");
  if (!id || !val(env, "WHATSAPP_TOKEN")) return null;
  try {
    const r = await f(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(id)}?fields=display_phone_number`, { headers: { Authorization: `Bearer ${val(env, "WHATSAPP_TOKEN")}` }, signal: AbortSignal.timeout(6_000) });
    const j = await r.json().catch(() => ({})) as { display_phone_number?: string };
    return e164(j.display_phone_number ?? null);
  } catch {
    return null;
  }
}

/** Enlace que abre WhatsApp con el código ya escrito ("IATOS ABCD2345"). */
export const enlaceWaMe = (numero: string, codigo: string) => `https://wa.me/${numero.replace(/^\+/, "")}?text=${encodeURIComponent(`IATOS ${codigo}`)}`;
