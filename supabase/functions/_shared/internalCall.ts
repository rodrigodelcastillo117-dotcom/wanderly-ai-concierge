// Firma de llamadas internas entre funciones (sin dependencias de Deno; se prueba con Vitest).
//
// analizar-viaje y logistics-plan llaman a flights-search / hotels-search con el JWT del usuario.
// Esas búsquedas ya están cubiertas por la cuota del análisis, así que no deben gastar la bolsa de
// búsquedas en vivo del usuario. Un encabezado normal lo podría falsificar cualquiera desde el
// navegador; por eso va firmado con HMAC usando la service key (que el cliente nunca tiene), atado
// al usuario y con caducidad de 10 minutos.
//
// Canales (30-oct-2026): telegram-webhook y whatsapp-webhook llaman a concierge-chat EN NOMBRE del usuario
// vinculado (con una sesión real de ese usuario: RLS intacta) y firman además "canal_telegram" /
// "canal_whatsapp" atado a ese mismo user_id. La firma solo cambia el formato (JSON, sin SSE) y la cubeta por IP
// (la IP es la de nuestro servidor); NO salta cuotas, plan ni permisos. Un propósito nunca vale por otro: una firma
// de canal no sirve como "analysis" (que sí evita gastar búsquedas en vivo).

export const INTERNAL_HEADER = "x-iatos-internal";
export const INTERNAL_PURPOSES = ["analysis", "canal_telegram", "canal_whatsapp"] as const;
export type InternalPurpose = typeof INTERNAL_PURPOSES[number];
const MAX_AGE_MS = 10 * 60 * 1000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valor del encabezado: `<propósito>.<ms>.<firma>`. Sin secreto no se firma (devuelve null). */
export async function signInternal(secret: string, userId: string, purpose: InternalPurpose, nowMs = Date.now()): Promise<string | null> {
  if (!secret || !userId) return null;
  return `${purpose}.${nowMs}.${await hmacHex(secret, `${purpose}|${userId}|${nowMs}`)}`;
}

/** Propósito válido para este usuario, o null si falta, caducó o la firma no coincide. */
export async function verifyInternal(
  header: string | null | undefined, secret: string, userId: string, nowMs = Date.now(),
): Promise<InternalPurpose | null> {
  if (!header || !secret || !userId) return null;
  const m = /^(analysis|canal_telegram|canal_whatsapp)\.(\d{10,16})\.([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return null;
  const ts = Number(m[2]);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > MAX_AGE_MS) return null;
  const expected = await hmacHex(secret, `${m[1]}|${userId}|${ts}`);
  // Comparación de tiempo constante.
  let diff = expected.length ^ m[3].length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (m[3].charCodeAt(i) || 0);
  return diff === 0 ? (m[1] as InternalPurpose) : null;
}
