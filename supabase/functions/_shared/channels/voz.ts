// Canal de VOZ · interfaz lista, APAGADO y SIN llamadas reales. Para cuando el dueño apruebe llamadas cortas a
// proveedores (hotel, chofer) con un agente de voz (Retell o Vapi) sobre un número de Twilio en México.
//
// Cómo encajaría (ver docs/iatos/IATOS_OPERADOR.md §Voz):
//   1. El operador pide `llamar({ a, proposito, guion, idioma, incidentId })`.
//   2. El adaptador crea la llamada en Retell/Vapi (que usa el número de Twilio) con un guion que SIEMPRE abre con:
//      "Hola, soy el asistente de IA de IATOS, llamo en nombre de <viajero> por su reserva <X>. Esta llamada puede grabarse."
//      (AI Act art. 50 en la UE; FCC 24-17 en EE. UU.: nunca llamadas de venta).
//   3. El webhook de fin de llamada trae transcripción y resultado → bitácora del incidente (canal 'voz') y despierta al
//      operador. Nada se confirma solo por voz: el resultado se marca "dicho por teléfono, sin comprobante".
// Secretos: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM y RETELL_API_KEY o VAPI_API_KEY.
// Topes sugeridos: 3 min por llamada, 2 llamadas por caso, solo en horario del proveedor (politica.ts ventanaProveedor).
import type { Channel, ChannelMessage, ChannelSendResult } from "./types.ts";

export type VozProveedor = "retell" | "vapi";
export type LlamadaPedido = { a: string; proposito: string; guion: string; idioma: "es" | "en" | "fr" | "pt" | "it"; incidentId: string; viajero: string | null; reserva: string | null; maxMinutos?: number };
export type LlamadaResultado = { ok: false; code: "NO_IMPLEMENTADO" | "APAGADO" | "FUERA_DE_HORARIO"; mensaje: string } | { ok: true; callId: string };

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
  /** Hoy siempre NO_IMPLEMENTADO: no se hacen llamadas reales. */
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
