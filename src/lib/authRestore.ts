// Arranque de la sesión (E-09).
//
// Antes, si Supabase tardaba más de 4.5 s en devolver la sesión guardada (red lenta, token
// vencido que hay que refrescar), la app daba por hecho "no hay sesión": ProtectedRoute mandaba
// a /auth y se perdía la pantalla a la que iba la persona, aunque su sesión seguía guardada en
// el dispositivo. Una sesión lenta NO es una sesión cerrada: mientras haya una sesión guardada,
// mostramos "Recuperando tu sesión…" y reintentamos; solo cerramos si Supabase lo confirma.

/** Tiempo antes de avisar que la recuperación va lenta (y empezar a reintentar). */
export const RESTORE_SLOW_MS = 4500;
/** Espera entre reintentos: 3 s, 6 s, 12 s… hasta 30 s. */
export const restoreRetryDelay = (attempt: number) => Math.min(30_000, 3000 * 2 ** Math.max(0, attempt));

/**
 * ¿Hay una sesión de Supabase guardada en este dispositivo? Supabase la guarda en
 * localStorage con la llave `sb-<proyecto>-auth-token`. Solo miramos que exista y tenga un
 * refresh token: si está vencida, Supabase la refresca; si el refresh token ya no sirve, emite
 * SIGNED_OUT y la borra.
 */
export function hasStoredSession(storage: Pick<Storage, "length" | "key" | "getItem"> | null = safeLocalStorage()): boolean {
  if (!storage) return false;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const raw = storage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const s = parsed?.currentSession ?? parsed;
      if (s && typeof s.refresh_token === "string" && s.refresh_token.length > 0) return true;
    }
  } catch {
    /* almacenamiento ilegible: lo tratamos como sin sesión */
  }
  return false;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Error de red/tiempo de espera de Supabase (no significa que la sesión sea inválida). */
export function isRetryableAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; status?: number; message?: string };
  if (e.name === "AuthRetryableFetchError") return true;
  if (e.status === 0 || (typeof e.status === "number" && e.status >= 500)) return true;
  return /failed to fetch|network|timeout|load failed/i.test(String(e.message ?? ""));
}

export type RestoreOutcome = "signed_in" | "signed_out" | "retry";

/**
 * Qué hacer con la respuesta de getSession():
 *  - con sesión → entrar;
 *  - sin sesión por un error de red y con sesión guardada → seguir recuperando (reintentar);
 *  - sin sesión y sin nada guardado (o Supabase dijo que no es válida) → sesión cerrada.
 * `thrown` = getSession() lanzó (red caída).
 */
export function restoreOutcome(args: { hasSession: boolean; error?: unknown; thrown?: boolean; stored: boolean }): RestoreOutcome {
  if (args.hasSession) return "signed_in";
  if (!args.stored) return "signed_out";
  if (args.thrown || isRetryableAuthError(args.error)) return "retry";
  return "signed_out";
}

/**
 * Una pantalla recibió "sesión inválida" (401). Antes eso cerraba la sesión de inmediato, y un
 * tropiezo de red al abrir la app en frío (iPhone tras forzar el cierre) sacaba a la persona.
 * Ahora se intenta renovar la sesión: solo si Supabase dice que el refresh token ya no sirve
 * (error de auth, no de red) se considera vencida de verdad.
 */
export async function sessionTrulyExpired(auth: {
  refreshSession: () => Promise<{ data: { session: unknown | null }; error: unknown }>;
}): Promise<boolean> {
  try {
    const { data, error } = await auth.refreshSession();
    if (data?.session) return false;
    if (!error || isRetryableAuthError(error)) return false;
    return true;
  } catch {
    return false; // red caída: no es un cierre de sesión
  }
}
