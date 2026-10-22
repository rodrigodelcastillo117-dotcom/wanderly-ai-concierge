import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setSentryUser } from "@/lib/sentry";
import { identifyUser, resetAnalytics, track } from "@/lib/analytics";
import { captureRecoveryFromUrl, clearRecoveryFlag, hasRecoveryFlag, markRecovery } from "@/lib/passwordRecovery";
import { hasStoredSession, restoreOutcome, restoreRetryDelay, RESTORE_SLOW_MS } from "@/lib/authRestore";

// Borra los viajes guardados para lectura offline (public/sw.js) al cerrar sesión,
// para que otra persona en el mismo dispositivo no los vea.
const clearOfflineTripCache = () => {
  try {
    if (typeof caches !== "undefined") void caches.delete("iatos-data-v1").catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({ type: "iatos:clear-user-cache" });
  } catch {
    /* noop */
  }
};

// Capturamos `type=recovery` en cuanto se evalúa este módulo (parte del bundle
// inicial): Supabase borra el hash tras validar el token y /reset-password es lazy.
captureRecoveryFromUrl();

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** true si esta pestaña llegó por un enlace de recuperación de contraseña aún vigente. */
  passwordRecovery: boolean;
  /** true si la sesión guardada está tardando en recuperarse (red lenta): se muestra un aviso y se reintenta, nunca se cierra la sesión. */
  restoring: boolean;
  /** Reintenta ya la recuperación de la sesión (botón "Reintentar"). */
  retryRestore: () => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState<boolean>(() => hasRecoveryFlag());
  const [restoring, setRestoring] = useState(false);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    let mounted = true;
    // true en cuanto sabemos si hay sesión o no; a partir de ahí ya no se reintenta.
    let settled = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const finishAuth = (newSession: Session | null) => {
      if (!mounted) return;
      settled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
      setRestoring(false);
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setSentryUser(newSession?.user ? { id: newSession.user.id, email: newSession.user.email } : null);
      if (newSession?.user) identifyUser(newSession.user.id, { email: newSession.user.email });
      setLoading(false);
    };

    // Recuperar la sesión va lento pero sigue guardada: mostramos "Recuperando tu sesión…"
    // (loading sigue en true, así ProtectedRoute no manda a /auth) y volvemos a intentar.
    const scheduleRetry = () => {
      if (!mounted || settled) return;
      setRestoring(true);
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(attempt, restoreRetryDelay(attempts++));
    };

    // Hidratar desde storage local. NO cerramos sesión por errores transitorios de red:
    // el refresh token de Supabase + autoRefreshToken validan contra el servidor cuando hay
    // conexión. Si el refresh falla con un error real de auth, el listener recibe SIGNED_OUT.
    function attempt() {
      supabase.auth.getSession()
        .then(({ data, error }) => {
          if (settled) return;
          const outcome = restoreOutcome({ hasSession: !!data?.session, error, stored: hasStoredSession() });
          if (outcome === "retry") scheduleRetry();
          else finishAuth(data?.session ?? null);
        })
        .catch(() => {
          if (settled) return;
          const outcome = restoreOutcome({ hasSession: false, thrown: true, stored: hasStoredSession() });
          if (outcome === "retry") scheduleRetry();
          else finishAuth(null);
        });
    }

    // Pasado RESTORE_SLOW_MS sin respuesta: si no hay nada guardado, no hay sesión (se va a /auth
    // como antes). Si hay una sesión guardada, NO se cierra: se sigue intentando.
    const slowTimer = window.setTimeout(() => {
      if (settled) return;
      if (hasStoredSession()) scheduleRetry();
      else finishAuth(null);
    }, RESTORE_SLOW_MS);

    retryRef.current = () => {
      if (settled) return;
      window.clearTimeout(retryTimer);
      attempt();
    };

    // Listener primero — mantiene la sesión sincronizada (refresh automático, login, logout explícito)
    // Este listener se registra al montar la app (no la página lazy), así que sí
    // recibe PASSWORD_RECOVERY, que Supabase emite una sola vez.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") {
        markRecovery();
        if (mounted) setPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        clearRecoveryFlag();
        clearOfflineTripCache();
        if (mounted) setPasswordRecovery(false);
      }
      // Un INITIAL_SESSION vacío por un error de red no es un cierre de sesión si la sesión
      // sigue guardada: lo decide getSession() (que reintenta).
      if (event === "INITIAL_SESSION" && !newSession && !settled && hasStoredSession()) return;
      finishAuth(newSession);
    });

    attempt();

    return () => {
      mounted = false;
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const retryRestore = useCallback(() => retryRef.current(), []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) track("login", { method: "password" });
    return { error: error?.message };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: { full_name: fullName },
      },
    });
    if (!error) track("signup", { method: "password" });
    return { error: error?.message };
  };

  const signOut = async () => {
    clearRecoveryFlag();
    setPasswordRecovery(false);
    clearOfflineTripCache();
    await supabase.auth.signOut({ scope: "local" });
    resetAnalytics();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, passwordRecovery, restoring, retryRestore, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
