// "Continuar con Google" (auditoría de cuenta #2). El botón existe en /auth, pero solo se muestra cuando
// el dueño activa VITE_GOOGLE_LOGIN_ENABLED=true DESPUÉS de habilitar el proveedor Google en Supabase
// (Authentication → Providers → Google) y de agregar la URL de regreso (docs/ops/LEEME.md). Si se
// mostrara con el proveedor apagado, Supabase respondería "provider is not enabled" a quien lo toque.
import { supabase } from "@/integrations/supabase/client";

/** Lee SOLO VITE_GOOGLE_LOGIN_ENABLED (antes recibía import.meta.env completo y el build metía todas las
 *  variables VITE_* en el paquete de /auth; ronda 2 de la auditoría técnica, P2-5). Acepta el valor o, en
 *  pruebas, un objeto con esa llave. */
export function googleLoginEnabled(flag: unknown = import.meta.env.VITE_GOOGLE_LOGIN_ENABLED): boolean {
  const v = flag && typeof flag === "object" ? (flag as Record<string, unknown>).VITE_GOOGLE_LOGIN_ENABLED : flag;
  return String(v ?? "").trim().toLowerCase() === "true";
}

/**
 * Inicia el flujo OAuth de Google. Regresa a /auth (con la ruta pedida en `next`, solo interna), donde la
 * sesión nueva se detecta y la persona sigue a su inicio, al onboarding o a la ruta que pidió.
 */
export async function startGoogleLogin(returnTo: string | null, origin: string = window.location.origin): Promise<{ error: string | null }> {
  const next = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? `?next=${encodeURIComponent(returnTo)}` : "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth${next}` },
  });
  return { error: error ? "No pudimos abrir el inicio de sesión con Google. Intenta de nuevo o usa tu correo." : null };
}
