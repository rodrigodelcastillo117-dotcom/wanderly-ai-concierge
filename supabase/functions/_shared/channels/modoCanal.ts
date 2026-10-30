// concierge-chat (y scan-receipt) llamados desde Telegram/WhatsApp. Puro (sin Deno).
//
// La llamada SIEMPRE trae la sesión real del viajero (Authorization: Bearer <su JWT>), así que la RLS, su plan, sus
// cuotas y sus permisos son exactamente los de la app. Además trae `x-iatos-internal: canal_<canal>.<ms>.<firma>`,
// firmado con la llave de servicio (que nunca sale del servidor) y atado a ESE user_id. La firma solo cambia:
//   · el formato (JSON en vez de SSE y una nota para escribir corto y sin tablas),
//   · la cubeta por IP (la IP es la de nuestro servidor, compartida por todos los viajeros del canal).
// No da acceso a nada más. Un encabezado presente pero inválido (vencido, de otro usuario, alterado) se rechaza.
import { INTERNAL_HEADER, verifyInternal } from "../internalCall.ts";
import type { CanalConversacion } from "./formato.ts";

export type ModoCanal = { canal: CanalConversacion | null; invalido: boolean };

export async function canalDeLlamada(headers: { get(n: string): string | null }, secret: string, userId: string, nowMs = Date.now()): Promise<ModoCanal> {
  const h = headers.get(INTERNAL_HEADER);
  if (!h) return { canal: null, invalido: false };
  const p = await verifyInternal(h, secret, userId, nowMs);
  if (p === "canal_telegram") return { canal: "telegram", invalido: false };
  if (p === "canal_whatsapp") return { canal: "whatsapp", invalido: false };
  // "analysis" no aplica aquí (no se ignora en silencio: alguien la mandó a la función equivocada) → inválido.
  return { canal: null, invalido: true };
}

/** Nota para el modelo (va con las notas del turno, no cambia herramientas ni reglas de honestidad). */
export function notaCanal(canal: CanalConversacion): string {
  const n = canal === "telegram" ? "Telegram" : "WhatsApp";
  return `El viajero te escribe por ${n}, no por la app: responde breve (máximo ~8 líneas), en texto con viñetas simples, sin tablas ni ` +
    "encabezados. Las tarjetas se mostrarán como una lista con su enlace y las acciones como botones de confirmar: no repitas sus datos en el texto. " +
    "Si algo solo se puede hacer en la app (pagar, subir documentos, Privé), dilo y no lo prometas por el chat.";
}
