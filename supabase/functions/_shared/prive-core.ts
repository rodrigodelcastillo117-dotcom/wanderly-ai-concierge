// Utilidades puras de IATOS Privé (sin Deno ni SDK) para prive-access y prive-cron. Se prueban con
// Vitest (src/test/priveCore.test.ts). Nada de esto guarda ni registra secretos.

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function sha1HexUpper(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-1", enc.encode(text))).toUpperCase();
}

export const byteLength = (s: string) => enc.encode(s).length;

/** Token de URL (invitación, restablecimiento, sesión): 32 bytes en base64url sin relleno = 43 caracteres. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isToken = (v: unknown): v is string => typeof v === "string" && TOKEN_RE.test(v);

/**
 * ip_hash de D8: sha256(ip || PRIVE_IP_SALT || día UTC) recortado a 16 hex. Rota cada día y sin la
 * sal no se puede revertir. Sin sal o sin IP conocida devuelve null (se omite el límite por IP).
 */
export async function ipHash(ip: string | null | undefined, salt: string | null | undefined, now = new Date()): Promise<string | null> {
  if (!salt || !ip || ip === "unknown") return null;
  const day = now.toISOString().slice(0, 10);
  return (await sha256Hex(`${ip}${salt}${day}`)).slice(0, 16);
}

/**
 * session_id del JWT de Supabase Auth (claim estándar desde 2023). Solo se llama DESPUÉS de que
 * Auth validó el token (getUser): aquí solo se lee el payload.
 */
export function jwtSessionId(authorization: string | null | undefined): string | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64)) as { session_id?: unknown };
    return typeof payload.session_id === "string" && /^[0-9a-f-]{36}$/i.test(payload.session_id) ? payload.session_id : null;
  } catch {
    return null;
  }
}

export type BreachCheck = "ok" | "breached" | "unavailable";

/**
 * HaveIBeenPwned (rango, anonimato k): solo viajan los 5 primeros caracteres del SHA-1; la
 * contraseña nunca sale del servidor. Gratis y sin llave. Si no responde en 2 s (o falla) se acepta
 * la contraseña y se registra 'unavailable' (D5: falla abierta registrada).
 */
export async function hibpCheck(
  password: string,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs = 2000,
): Promise<BreachCheck> {
  const sha1 = await sha1HexUpper(password);
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "IATOS-Prive" },
      signal: ctrl.signal,
    });
    if (!res.ok) return "unavailable";
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [suf, count] = line.trim().split(":");
      // Con Add-Padding la respuesta trae renglones de relleno con conteo 0.
      if (suf?.toUpperCase() === suffix && Number(count) > 0) return "breached";
    }
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** Reglas de longitud de la contraseña Privé (las mismas que la SQL): 8 a 72 bytes. */
export function passwordShapeProblem(pw: unknown): "PASSWORD_WEAK" | null {
  if (typeof pw !== "string") return "PASSWORD_WEAK";
  const n = byteLength(pw);
  if (n < 8 || n > 72) return "PASSWORD_WEAK";
  if (new Set([...pw]).size < 5) return "PASSWORD_WEAK";
  return null;
}

// 256 palabras comunes del español, sin acentos ni eñes, de 4 a 8 letras (8 bits por palabra).
export const PASSPHRASE_WORDS: readonly string[] = (
  "abeja abrazo aceite acero agua aguila ala alba alegria alma almeja altura amigo ancla anillo antena arbol arena " +
  "arroz astro atlas aurora avena azul bahia balcon ballena bambu banco barco barro bosque brisa brujula buho caballo " +
  "cacao cafe calma cama camino campana canela canoa cantera carbon caricia carta casa castillo cebra cedro cielo cima " +
  "circo ciruela clavel cobre cohete colina color cometa concha coral corona cosecha cristal cuarzo cuerda cueva cumbre " +
  "dalia delfin desierto diamante duna eco eclipse encino espejo espiga estrella faro feria fiesta flecha flor fogata " +
  "fresa fuente galaxia gaviota girasol globo granito grano guitarra hada halcon hielo hierba higo hoja horizonte huerto " +
  "iglesia isla jade jardin jazmin jirafa joya junco lago lagrima lampara lana laurel lava leon libro lima limon lince " +
  "lirio llama lluvia lobo loro luna madera maiz manzana mapa marea mariposa melodia menta mesa miel mimosa mirador " +
  "molino montana mosaico musgo naranja nave neblina nido nieve noche nogal nube nuez oasis ocaso oceano olivo onda " +
  "orilla oro oso otono paisaje paloma palmera pan papel parque pasto pera perla piano piedra pino planeta plata playa " +
  "pluma polen pradera prisma puente puerto pulsera quetzal radio raiz rama rayo refugio relampago reloj rio roble roca " +
  "rocio rosa rubi ruta sabana sal salvia sandia selva semilla sendero sierra silencio sol sombra sonrisa suspiro tango " +
  "tapiz taza teja telar templo tierra tigre tinta toronja torre trebol trigo trueno tucan tulipan uva valle vapor " +
  "velero ventana verano viento vino violeta volcan yate yeso zafiro zarza zorro brillo ambar cascada " +
  "estanque glaciar laguna nectar trufa colibri bruma acuarela salmon"
).split(" ").filter((w, i, all) => w.length >= 3 && w.length <= 9 && all.indexOf(w) === i).slice(0, 256);

/**
 * Frase de paso generada por el servidor (se muestra UNA vez): 6 palabras + 2 dígitos, ~54 bits.
 * `random` debe ser criptográfico (crypto.getRandomValues); se inyecta para poder probarla.
 */
export function generatePassphrase(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const words = PASSPHRASE_WORDS;
  if (words.length !== 256) throw new Error("lista de palabras incompleta");
  const picks = Array.from(random(6), (b) => words[b]);
  let digits = -1;
  while (digits < 0) {
    const b = random(1)[0];
    if (b < 200) digits = b % 100;  // muestreo por rechazo: sin sesgo
  }
  return `${picks.join("-")}-${String(digits).padStart(2, "0")}`;
}
