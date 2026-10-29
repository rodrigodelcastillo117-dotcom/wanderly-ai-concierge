// "Continuar con Google" (auditoría de cuenta #2). El proveedor Google está encendido en Lovable Cloud con
// credenciales administradas por Lovable (29-oct-2026: supabase--configure_social_auth ["google"]), así
// que el botón se muestra por omisión. Para apagarlo sin tocar código: VITE_GOOGLE_LOGIN_ENABLED=false.
// Con credenciales administradas el flujo pasa por el ayudante de Lovable (src/integrations/lovable,
// broker /~oauth en el mismo dominio); supabase.auth.signInWithOAuth directo exigiría credenciales propias.
import { lovable } from "@/integrations/lovable/index";

/** Ruta interna a la que volver después de Google. No viaja en redirect_uri (el broker regresa a /auth tal
 *  cual): se guarda aquí y /auth la toma una sola vez al ver la sesión nueva. */
export const GOOGLE_NEXT_KEY = "iatos_google_next";

/** Lee SOLO VITE_GOOGLE_LOGIN_ENABLED (antes recibía import.meta.env completo y el build metía todas las
 *  variables VITE_* en el paquete de /auth; ronda 2 de la auditoría técnica, P2-5). Acepta el valor o, en
 *  pruebas, un objeto con esa llave. Encendido salvo que diga explícitamente false/no/0/off. */
export function googleLoginEnabled(flag: unknown = import.meta.env.VITE_GOOGLE_LOGIN_ENABLED): boolean {
  const v = flag && typeof flag === "object" ? (flag as Record<string, unknown>).VITE_GOOGLE_LOGIN_ENABLED : flag;
  return !["false", "no", "0", "off"].includes(String(v ?? "").trim().toLowerCase());
}

const safeInternal = (p: string | null): string | null => (p && p.startsWith("/") && !p.startsWith("//") ? p : null);

/** Ruta pedida antes de ir a Google (solo rutas internas). */
export function peekGoogleNext(): string | null {
  try {
    return safeInternal(sessionStorage.getItem(GOOGLE_NEXT_KEY));
  } catch {
    return null;
  }
}

/** Se borra al usarla: no debe regresar a alguien a una ruta vieja en su siguiente inicio de sesión. */
export function clearGoogleNext(): void {
  try { sessionStorage.removeItem(GOOGLE_NEXT_KEY); } catch { /* nada que borrar */ }
}

/**
 * Inicia el flujo OAuth de Google. Regresa a /auth, donde la sesión nueva se detecta y la persona sigue a
 * su inicio, al onboarding o a la ruta que pidió (guardada en sessionStorage).
 */
export async function startGoogleLogin(returnTo: string | null, origin: string = window.location.origin): Promise<{ error: string | null }> {
  try {
    const next = safeInternal(returnTo);
    if (next) sessionStorage.setItem(GOOGLE_NEXT_KEY, next);
    else sessionStorage.removeItem(GOOGLE_NEXT_KEY);
  } catch { /* sin sessionStorage se vuelve al inicio */ }
  try {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${origin}/auth` });
    if (result && "error" in result && result.error) throw result.error;
    return { error: null };
  } catch {
    return { error: "No pudimos abrir el inicio de sesión con Google. Intenta de nuevo o usa tu correo." };
  }
}
