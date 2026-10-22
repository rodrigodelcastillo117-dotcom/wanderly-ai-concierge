// Token firmado de salida (Fase 12: sin open redirects). Sin Deno.
//
// booking-bridge firma {intención, usuario, origen de la app, caducidad} con HMAC-SHA256 usando una
// llave derivada de la service key (el cliente nunca la tiene). booking-go solo redirige si la firma
// es válida, no venció, y entonces usa la URL GUARDADA en la intención (nunca una URL del cliente).
// Desde el cierre de auditoría (AUD-04) el token lleva también la huella SHA-256 del destino que se
// guardó (`h`) y el nivel con el que pasó (`t`: "a" lista estricta, "s" fuente del servidor): si el
// destino guardado cambia, o se intenta salir por la vía "confiable" con un destino que entró por la
// estricta, booking-go no redirige.

// A2-T1 (segunda auditoría): el token lleva `n`, cuántas veces se había abierto la intención al firmarlo,
// y booking-go solo lo acepta mientras redirect_count < n + MAX_TOKEN_USES. Así un enlace filtrado no
// sirve indefinidamente durante los 30 minutos, pero "volver a abrir" (el mismo botón, unas cuantas
// veces) sigue funcionando; para más, la app pide otro token (start_booking con la misma selección).
// Una petición HEAD no consume usos (booking-go no la marca como salida).

const enc = new TextEncoder();
export const REDIRECT_TTL_MS = 30 * 60 * 1000;
export const MAX_TOKEN_USES = 3;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`booking-redirect-v1|${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export type RedirectClaims = { i: string; u: string; o: string; x: number; h?: string; t?: "a" | "s"; n?: number };
const validUses = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100000);

/** Huella del destino: base64url(SHA-256(url)). */
export async function targetHash(url: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(url))));
}
const HASH = /^[A-Za-z0-9_-]{43}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function signRedirect(secret: string, claims: Omit<RedirectClaims, "x">, nowMs = Date.now(), ttlMs = REDIRECT_TTL_MS): Promise<string | null> {
  if (!secret || !UUID.test(claims.i) || !UUID.test(claims.u)) return null;
  if (claims.h !== undefined && (!HASH.test(claims.h) || (claims.t !== "a" && claims.t !== "s"))) return null;
  if (!validUses(claims.n)) return null;
  const body = b64url(enc.encode(JSON.stringify({ ...claims, x: nowMs + ttlMs })));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

export type VerifyResult = { ok: true; claims: RedirectClaims; reason?: undefined } | { ok: false; reason: "formato" | "firma" | "vencido"; claims?: undefined };

export async function verifyRedirect(secret: string, token: unknown, nowMs = Date.now()): Promise<VerifyResult> {
  if (!secret || typeof token !== "string" || token.length > 1200) return { ok: false, reason: "formato" };
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return { ok: false, reason: "formato" };
  // Se compara la firma CODIFICADA (forma canónica): así un token con los bits de relleno del último
  // carácter cambiados no pasa por válido. Tiempo constante.
  const expected = b64url(await hmac(secret, m[1]));
  const given = m[2];
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  if (diff !== 0) return { ok: false, reason: "firma" };
  let claims: RedirectClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(m[1])));
  } catch {
    return { ok: false, reason: "formato" };
  }
  if (!claims || !UUID.test(String(claims.i)) || !UUID.test(String(claims.u)) || typeof claims.x !== "number") return { ok: false, reason: "formato" };
  if (claims.h !== undefined && (!HASH.test(String(claims.h)) || (claims.t !== "a" && claims.t !== "s"))) return { ok: false, reason: "formato" };
  if (!validUses(claims.n)) return { ok: false, reason: "formato" };
  if (claims.x <= nowMs) return { ok: false, reason: "vencido" };
  return { ok: true, claims };
}
