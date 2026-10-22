// Token firmado de salida (Fase 12: sin open redirects). Sin Deno.
//
// booking-bridge firma {intención, usuario, origen de la app, caducidad} con HMAC-SHA256 usando una
// llave derivada de la service key (el cliente nunca la tiene). booking-go solo redirige si la firma
// es válida, no venció, y entonces usa la URL GUARDADA en la intención (nunca una URL del cliente).

const enc = new TextEncoder();
export const REDIRECT_TTL_MS = 30 * 60 * 1000;

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

export type RedirectClaims = { i: string; u: string; o: string; x: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function signRedirect(secret: string, claims: Omit<RedirectClaims, "x">, nowMs = Date.now(), ttlMs = REDIRECT_TTL_MS): Promise<string | null> {
  if (!secret || !UUID.test(claims.i) || !UUID.test(claims.u)) return null;
  const body = b64url(enc.encode(JSON.stringify({ ...claims, x: nowMs + ttlMs })));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

export type VerifyResult = { ok: true; claims: RedirectClaims; reason?: undefined } | { ok: false; reason: "formato" | "firma" | "vencido"; claims?: undefined };

export async function verifyRedirect(secret: string, token: unknown, nowMs = Date.now()): Promise<VerifyResult> {
  if (!secret || typeof token !== "string" || token.length > 1200) return { ok: false, reason: "formato" };
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return { ok: false, reason: "formato" };
  const expected = await hmac(secret, m[1]);
  let given: Uint8Array;
  try { given = fromB64url(m[2]); } catch { return { ok: false, reason: "formato" }; }
  // Tiempo constante.
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ (given[i] ?? 0);
  if (diff !== 0) return { ok: false, reason: "firma" };
  let claims: RedirectClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(m[1])));
  } catch {
    return { ok: false, reason: "formato" };
  }
  if (!claims || !UUID.test(String(claims.i)) || !UUID.test(String(claims.u)) || typeof claims.x !== "number") return { ok: false, reason: "formato" };
  if (claims.x <= nowMs) return { ok: false, reason: "vencido" };
  return { ok: true, claims };
}
