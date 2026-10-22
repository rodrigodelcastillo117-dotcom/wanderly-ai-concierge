// Detección robusta del flujo "olvidé mi contraseña".
//
// Por qué existe: Supabase deja `type=recovery` en el hash solo unos instantes
// (lo borra después de validar el token) y emite PASSWORD_RECOVERY una sola vez.
// Si la página /reset-password (lazy) monta tarde, o el usuario recarga, ambas
// señales se pierden y el botón quedaba bloqueado. Aquí:
//  1) leemos la URL en cuanto se evalúa el módulo (antes de que Supabase la limpie),
//  2) guardamos una bandera en sessionStorage (sobrevive a recargas de la pestaña),
//  3) como respaldo, leemos el claim `amr` del access token (method = "recovery").
import type { Session } from "@supabase/supabase-js";

const FLAG_KEY = "iatos_pw_recovery_v1";
// La sesión de recuperación de Supabase dura lo que el access token + refresh;
// limitamos la bandera a 1 h para no dejar la pantalla "abierta" indefinidamente.
const FLAG_TTL_MS = 60 * 60 * 1000;

export interface RecoveryUrlState {
  isRecovery: boolean;
  error: { code: string; description: string } | null;
}

/** Lee `type=recovery` y los errores (`error`, `error_code`, `error_description`) del hash y del query. */
export function parseRecoveryUrl(href: string): RecoveryUrlState {
  let url: URL;
  try {
    url = new URL(href, "http://localhost");
  } catch {
    return { isRecovery: false, error: null };
  }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;
  const get = (k: string) => hash.get(k) ?? query.get(k);

  const isRecovery = get("type") === "recovery";
  const err = get("error");
  const errCode = get("error_code");
  if (err || errCode) {
    return {
      isRecovery,
      error: { code: errCode || err || "unknown", description: get("error_description") || "" },
    };
  }
  return { isRecovery, error: null };
}

export function markRecovery(now = Date.now()) {
  try {
    sessionStorage.setItem(FLAG_KEY, String(now));
  } catch {
    /* sessionStorage bloqueado: seguimos con las otras señales */
  }
}

export function hasRecoveryFlag(now = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(FLAG_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || now - ts > FLAG_TTL_MS) {
      sessionStorage.removeItem(FLAG_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveryFlag() {
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* noop */
  }
}

/** true si el access token viene de un enlace de recuperación (claim amr de GoTrue). */
export function sessionIsRecovery(session: Session | null | undefined): boolean {
  const token = session?.access_token;
  if (!token) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64));
    const amr = Array.isArray(payload?.amr) ? payload.amr : [];
    return amr.some((a: any) => (typeof a === "string" ? a : a?.method) === "recovery");
  } catch {
    return false;
  }
}

// Estado de la URL al arrancar la app. Se captura una vez, de forma síncrona,
// cuando AuthContext importa este módulo (antes de la respuesta de /auth/v1/user).
let initialUrlState: RecoveryUrlState = { isRecovery: false, error: null };

export function captureRecoveryFromUrl(href: string = typeof window !== "undefined" ? window.location.href : "") {
  const state = parseRecoveryUrl(href);
  if (state.isRecovery && !state.error) markRecovery();
  if (state.isRecovery || state.error) initialUrlState = state;
  return state;
}

export function getInitialRecoveryUrlState(): RecoveryUrlState {
  return initialUrlState;
}

/** Mensaje claro para el usuario según el error que Supabase dejó en la URL. */
export function recoveryErrorMessage(err: RecoveryUrlState["error"]): string | null {
  if (!err) return null;
  return "El enlace expiró o ya se usó; pide uno nuevo.";
}
