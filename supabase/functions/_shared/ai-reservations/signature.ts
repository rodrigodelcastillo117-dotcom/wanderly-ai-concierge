// Verificación de la firma de los webhooks de Resend (firmados con Svix). Sin dependencias: Web
// Crypto existe igual en Deno y en Node (Vitest). Pasos documentados por Svix
// (https://docs.svix.com/receiving/verifying-payloads/how-manual):
//   contenido firmado = `${svix-id}.${svix-timestamp}.${cuerpo crudo}`
//   llave = base64-decode(secreto sin el prefijo "whsec_")
//   firma = base64(HMAC-SHA256(llave, contenido)); el encabezado svix-signature trae una lista
//   separada por espacios de "v1,<firma>".
// Se rechaza todo lo que no traiga firma válida, y los mensajes con más de 5 minutos de diferencia
// (ataques de repetición).

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SignatureResult = { ok: true; id: string; timestamp: number } | { ok: false; reason: string };

// Devuelve ArrayBuffer (no Uint8Array<ArrayBuffer>) para compilar igual en Deno 2.1 y 2.9.
function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}
function bytesToB64(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

/** Comparación en tiempo constante. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const keyBytes = b64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToB64(sig);
}

export async function verifySvixSignature(
  headers: Headers,
  rawBody: string,
  secret: string | undefined,
  now: Date = new Date(),
): Promise<SignatureResult> {
  if (!secret || !secret.trim()) return { ok: false, reason: "secret_not_configured" };
  const id = headers.get("svix-id") ?? "";
  const ts = headers.get("svix-timestamp") ?? "";
  const sigHeader = headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigHeader) return { ok: false, reason: "missing_signature_headers" };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: "bad_timestamp" };
  const timestamp = Number(ts);
  if (Math.abs(now.getTime() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_out_of_tolerance" };
  let expected: string;
  try {
    expected = await signSvix(secret.trim(), id, timestamp, rawBody);
  } catch {
    return { ok: false, reason: "bad_secret" };
  }
  const candidates = sigHeader.split(" ").map((s) => s.trim()).filter(Boolean);
  for (const c of candidates) {
    const [version, sig] = c.split(",", 2);
    if (version === "v1" && sig && safeEqual(sig, expected)) return { ok: true, id, timestamp };
  }
  return { ok: false, reason: "signature_mismatch" };
}

// ───────────────────────────── Enlaces firmados (descarga del .ics desde el correo) ─────────────────
/** HMAC-SHA256 en base64url (32 caracteres) de un texto: el enlace no se puede adivinar ni alterar. */
export async function signLink(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToB64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

export async function verifyLink(secret: string | undefined, data: string, sig: string | null): Promise<boolean> {
  if (!secret || !sig) return false;
  return safeEqual(await signLink(secret, data), sig);
}
