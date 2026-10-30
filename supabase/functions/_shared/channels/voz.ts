// Canal de VOZ · llamadas SALIENTES cortas a proveedores (hotel, chofer) con un agente de voz. PREPARADO y APAGADO:
// sin el permiso explícito VOZ_LLAMADAS_REALES=true y sus secretos no se hace ninguna llamada (ni se toca la red).
//
// Proveedor elegido: Vapi (https://docs.vapi.ai, consultado el 30-oct-2026). Razón: permite crear la llamada con un
// asistente TRANSITORIO (guion, primera frase y duración máxima por llamada, sin tener que crear agentes en su panel)
// y salidas estructuradas (structured outputs) para el resultado. Retell exige un agente creado antes y no documenta su
// firma de webhooks fuera de su SDK.
//   · Crear llamada: POST https://api.vapi.ai/call (Authorization: Bearer VAPI_API_KEY) con { assistant, phoneNumberId,
//     customer: { number } }. El número (VAPI_PHONE_NUMBER_ID) es un número de Twilio México importado a Vapi.
//   · Fin de llamada: webhook "end-of-call-report" (message.type) con artifact.transcript y
//     artifact.structuredOutputs[<id>].result. Para un servidor dado en la llamada, Vapi NO manda credenciales: la
//     función voz-webhook exige el encabezado x-iatos-voz que ponemos en server.headers, firmado con VOZ_WEBHOOK_SECRET y
//     atado al caso (firmaLlamada).
// Reglas: la llamada SIEMPRE abre diciendo que es el asistente de IA de IATOS, en nombre de quién y que puede grabarse
// (AI Act art. 50; FCC 24-17). Nunca llamadas de venta. Máx. 3 minutos. Nada se da por confirmado solo por voz: el
// resultado va a la bitácora marcado "dicho por teléfono, sin comprobante".
// Puro (sin Deno): fetch y entorno por parámetro.
import type { Channel, ChannelMessage, ChannelSendResult } from "./types.ts";
import type { IncidentDb } from "../incidents.ts";
import { addIncidentEvent } from "../incidents.ts";

export type VozProveedor = "retell" | "vapi";
export type LlamadaPedido = {
  a: string; proposito: string; guion: string; idioma: "es" | "en" | "fr" | "pt" | "it"; incidentId: string; viajero: string | null; reserva: string | null; maxMinutos?: number;
  /** El que pide la llamada ya revisó el horario local del proveedor (politica.ts ventanaProveedor). */
  enHorario?: boolean;
};
export type LlamadaResultado =
  | { ok: false; code: "NO_IMPLEMENTADO" | "APAGADO" | "FUERA_DE_HORARIO" | "NUMERO_INVALIDO" | "FALLO"; mensaje: string }
  | { ok: true; callId: string };

/** Apertura obligatoria de toda llamada (transparencia: es una IA, en nombre de quién, puede grabarse). */
export function aperturaLlamada(p: Pick<LlamadaPedido, "idioma" | "viajero" | "reserva">): string {
  const v = p.viajero ?? (p.idioma === "en" ? "our traveler" : "nuestro viajero");
  const r = p.reserva ? (p.idioma === "en" ? ` about booking ${p.reserva}` : ` por su reserva ${p.reserva}`) : "";
  return p.idioma === "en"
    ? `Hello, this is the IATOS AI assistant calling on behalf of ${v}${r}. This call may be recorded.`
    : `Hola, soy el asistente de IA de IATOS, llamo en nombre de ${v}${r}. Esta llamada puede grabarse.`;
}

export interface AdaptadorVoz {
  proveedor: VozProveedor;
  llamar(p: LlamadaPedido): Promise<LlamadaResultado>;
}

export function vozApagada(proveedor: VozProveedor = "retell"): AdaptadorVoz {
  return {
    proveedor,
    llamar: async () => ({ ok: false, code: "NO_IMPLEMENTADO", mensaje: "Las llamadas con voz IA no están activas: requieren aprobación del dueño, número de Twilio México y cuenta de Retell/Vapi." }),
  };
}

/** Como Channel (para el registro): nunca llama; responde CHANNEL_OFF con la explicación. */
export function vozChannel(): Channel {
  return {
    id: "voz",
    label: "Llamada de voz",
    send: async (to: string, _m: ChannelMessage): Promise<ChannelSendResult> => ({ ok: false, channel: "voz", to, code: "CHANNEL_OFF", error: "Llamadas con voz IA no implementadas (apagado)" }),
  };
}

// ═══ Vapi ═══

/** Resultado estructurado que se le pide al agente (crear una vez en Vapi como "structured output"; ver la guía). */
export const RESULTADO_LLAMADA_SCHEMA = {
  type: "object",
  properties: {
    contesto: { type: "boolean", description: "¿Contestó una persona del proveedor (no buzón ni menú sin salida)?" },
    confirmado: { type: "boolean", description: "¿El proveedor confirmó EXPLÍCITAMENTE lo que se pidió?" },
    resumen: { type: "string", description: "Qué dijo el proveedor, en una o dos frases, en español." },
    dato_clave: { type: ["string", "null"], description: "Dato concreto que dio: hora de llegada, nombre de quien atendió, número de reserva. null si no dio." },
    siguiente_paso: { type: "string", description: "Qué quedó pendiente o qué hay que hacer después." },
    requiere_humano: { type: "boolean", description: "true si el proveedor pidió hablar con una persona, se negó, o algo no quedó claro." },
  },
  required: ["contesto", "confirmado", "resumen", "siguiente_paso", "requiere_humano"],
} as const;

export type ResultadoLlamada = { contesto: boolean; confirmado: boolean; resumen: string; dato_clave: string | null; siguiente_paso: string; requiere_humano: boolean };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmacHex(key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encabezado x-iatos-voz: "<incidentId>.<ms>.<hmac>" (válido 2 h: la llamada dura ≤ 3 min y el análisis llega después). */
export async function firmaLlamada(secret: string, incidentId: string, nowMs = Date.now()): Promise<string | null> {
  if (!secret || !UUID.test(incidentId)) return null;
  return `${incidentId}.${nowMs}.${await hmacHex(secret, `voz|${incidentId}|${nowMs}`)}`;
}
export async function verificarFirmaLlamada(header: string | null, secret: string, nowMs = Date.now()): Promise<string | null> {
  const m = /^([0-9a-f-]{36})\.(\d{10,16})\.([0-9a-f]{64})$/i.exec(String(header ?? "").trim());
  if (!m || !secret || !UUID.test(m[1])) return null;
  const ts = Number(m[2]);
  if (Math.abs(nowMs - ts) > 2 * 3600_000) return null;
  const want = await hmacHex(secret, `voz|${m[1]}|${ts}`);
  let d = want.length ^ m[3].length;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ (m[3].charCodeAt(i) || 0);
  return d === 0 ? m[1] : null;
}

/** Guion del agente (system prompt): qué pedir, qué NO hacer, y cómo cerrar. */
export function guionSistema(p: LlamadaPedido): string {
  return [
    "Eres el asistente de IA de IATOS (agencia de viajes). Llamas a un proveedor en nombre de un viajero. Ya dijiste que eres una IA y que la llamada puede grabarse.",
    `Propósito de la llamada: ${p.proposito.slice(0, 300)}`,
    `Guion: ${p.guion.slice(0, 1500)}`,
    "Reglas: sé breve y amable; habla en el idioma del proveedor; NO pagues, NO des datos de tarjeta, NO aceptes cargos ni cambios de precio, NO canceles nada;",
    "si te piden algo que no está en el guion o quieren hablar con una persona, di que una persona de IATOS los contactará y despídete.",
    "Si contesta un menú telefónico, elige la opción de recepción o reservaciones. Si cae en buzón, deja un mensaje corto con el propósito y cuelga.",
    "Antes de colgar, repite lo que quedó acordado (hora, nombre de quien atendió, número de reserva).",
  ].join("\n");
}

export type VapiConfig = { apiKey: string; phoneNumberId: string; webhookUrl: string; webhookSecret: string; structuredOutputId?: string | null; modelo?: string | null };

/** Cuerpo de POST /call (asistente transitorio). */
export async function cuerpoLlamadaVapi(p: LlamadaPedido, c: VapiConfig, nowMs = Date.now()) {
  const firma = await firmaLlamada(c.webhookSecret, p.incidentId, nowMs);
  return {
    phoneNumberId: c.phoneNumberId,
    customer: { number: p.a },
    assistant: {
      name: "IATOS proveedor",
      firstMessage: aperturaLlamada(p),
      firstMessageMode: "assistant-speaks-first",
      maxDurationSeconds: Math.max(60, Math.min(5, p.maxMinutos ?? 3) * 60),
      model: { provider: "anthropic", model: c.modelo || "claude-haiku-4-5", messages: [{ role: "system", content: guionSistema(p) }] },
      transcriber: { provider: "deepgram", language: p.idioma === "en" ? "en" : "multi" },
      server: { url: c.webhookUrl, headers: { "x-iatos-voz": firma ?? "" } },
      serverMessages: ["end-of-call-report"],
      ...(c.structuredOutputId ? { artifactPlan: { structuredOutputIds: [c.structuredOutputId] } } : {}),
      metadata: { incident_id: p.incidentId },
    },
  };
}

/**
 * Adaptador Vapi. APAGADO salvo que existan VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VOZ_WEBHOOK_SECRET y además
 * VOZ_LLAMADAS_REALES=true (permiso explícito del dueño). Apagado no toca la red.
 */
export function vozVapi(o: { env: (k: string) => string | undefined; fetch?: typeof fetch; webhookUrl: string }): AdaptadorVoz {
  const v = (k: string) => String(o.env(k) ?? "").trim();
  return {
    proveedor: "vapi",
    async llamar(p) {
      const faltan = ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VOZ_WEBHOOK_SECRET"].filter((k) => !v(k));
      if (faltan.length || v("VOZ_LLAMADAS_REALES") !== "true") {
        return { ok: false, code: "APAGADO", mensaje: `Llamadas con voz IA apagadas${faltan.length ? ` (faltan ${faltan.join(", ")})` : " (falta VOZ_LLAMADAS_REALES=true, permiso del dueño)"}.` };
      }
      if (p.enHorario === false) return { ok: false, code: "FUERA_DE_HORARIO", mensaje: "Es fuera del horario del proveedor; se programa para su horario." };
      if (!/^\+\d{8,15}$/.test(p.a) || !UUID.test(p.incidentId)) return { ok: false, code: "NUMERO_INVALIDO", mensaje: "Número o caso inválido." };
      try {
        const body = await cuerpoLlamadaVapi(p, { apiKey: v("VAPI_API_KEY"), phoneNumberId: v("VAPI_PHONE_NUMBER_ID"), webhookUrl: o.webhookUrl, webhookSecret: v("VOZ_WEBHOOK_SECRET"), structuredOutputId: v("VAPI_STRUCTURED_OUTPUT_ID") || null, modelo: v("VAPI_MODEL") || null });
        const r = await (o.fetch ?? fetch)("https://api.vapi.ai/call", {
          method: "POST", headers: { Authorization: `Bearer ${v("VAPI_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
        });
        const j = await r.json().catch(() => ({})) as { id?: string };
        return r.ok && j.id ? { ok: true, callId: String(j.id) } : { ok: false, code: "FALLO", mensaje: `Vapi respondió HTTP ${r.status}` };
      } catch {
        return { ok: false, code: "FALLO", mensaje: "No se pudo hablar con Vapi." };
      }
    },
  };
}

export type FinDeLlamada = { callId: string | null; endedReason: string | null; transcript: string; resultado: ResultadoLlamada | null; duracionSeg: number | null };

/** Lee el webhook "end-of-call-report" de Vapi. null si es otro evento. */
export function leerFinDeLlamada(body: unknown): FinDeLlamada | null {
  const m = (body as { message?: Record<string, unknown> })?.message;
  if (!m || m.type !== "end-of-call-report") return null;
  const call = (m.call ?? {}) as { id?: string; startedAt?: string; endedAt?: string };
  const art = (m.artifact ?? {}) as { transcript?: string; structuredOutputs?: Record<string, { result?: unknown }> };
  const salidas = Object.values(art.structuredOutputs ?? {});
  const res = salidas.find((s) => s && typeof s.result === "object" && s.result)?.result as Partial<ResultadoLlamada> | undefined;
  const resultado: ResultadoLlamada | null = res ? {
    contesto: res.contesto === true, confirmado: res.confirmado === true, resumen: String(res.resumen ?? "").slice(0, 600),
    dato_clave: typeof res.dato_clave === "string" ? res.dato_clave.slice(0, 200) : null, siguiente_paso: String(res.siguiente_paso ?? "").slice(0, 300),
    requiere_humano: res.requiere_humano !== false,
  } : null;
  const ini = call.startedAt ? Date.parse(call.startedAt) : NaN, fin = call.endedAt ? Date.parse(call.endedAt) : NaN;
  return {
    callId: call.id ? String(call.id).slice(0, 100) : null, endedReason: typeof m.endedReason === "string" ? m.endedReason.slice(0, 80) : null,
    transcript: String(art.transcript ?? "").slice(0, 3500), resultado, duracionSeg: Number.isFinite(ini) && Number.isFinite(fin) ? Math.round((fin - ini) / 1000) : null,
  };
}

/**
 * Resultado de la llamada → bitácora del caso (canal 'voz', del proveedor, no visible al viajero hasta que el operador
 * lo use). Siempre marcado "dicho por teléfono, sin comprobante". Idempotente por callId.
 */
export async function registrarLlamada(db: IncidentDb, incidentId: string, f: FinDeLlamada) {
  const r = f.resultado;
  const cuerpo = [
    "Llamada con voz IA (dicho por teléfono, sin comprobante).",
    r ? `${r.contesto ? "Contestó el proveedor." : "No contestó una persona."} ${r.confirmado ? "Confirmó." : "No confirmó."} ${r.resumen}` : "Sin resultado estructurado.",
    r?.dato_clave ? `Dato: ${r.dato_clave}` : null,
    r?.siguiente_paso ? `Siguiente paso: ${r.siguiente_paso}` : null,
    f.endedReason ? `Fin: ${f.endedReason}${f.duracionSeg != null ? ` (${f.duracionSeg} s)` : ""}` : null,
  ].filter(Boolean).join("\n");
  return addIncidentEvent(db, incidentId, {
    kind: "mensaje", actor: "proveedor", channel: "voz", direction: "entrante", counterpart: "Proveedor (llamada)", body: cuerpo, visibleToUser: false, delivery: "recibido",
    dedupeKey: `voz:${f.callId ?? cuerpo.slice(0, 40)}`, providerMessageId: f.callId ?? undefined,
    data: { voz: { proveedor: "vapi", call_id: f.callId, resultado: r, requiere_humano: r ? r.requiere_humano : true, sin_comprobante: true, transcripcion: f.transcript.slice(0, 2000) } },
  });
}
