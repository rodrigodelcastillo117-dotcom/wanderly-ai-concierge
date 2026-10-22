import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setSentryUser } from "@/lib/sentry";
import { identifyUser, resetAnalytics, track } from "@/lib/analytics";
import { captureRecoveryFromUrl, clearRecoveryFlag, hasRecoveryFlag, markRecovery } from "@/lib/passwordRecovery";

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

  useEffect(() => {
    let mounted = true;
    const finishAuth = (newSession: Session | null) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setSentryUser(newSession?.user ? { id: newSession.user.id, email: newSession.user.email } : null);
      if (newSession?.user) identifyUser(newSession.user.id, { email: newSession.user.email });
      setLoading(false);
    };

    const timeoutId = window.setTimeout(() => {
      finishAuth(null);
    }, 4500);

    // Listener primero — mantiene la sesión sincronizada (refresh automático, login, logout explícito)
    // Este listener se registra al montar la app (no la página lazy), así que sí
    // recibe PASSWORD_RECOVERY, que Supabase emite una sola vez.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      window.clearTimeout(timeoutId);
      if (event === "PASSWORD_RECOVERY") {
        markRecovery();
        if (mounted) setPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        clearRecoveryFlag();
        clearOfflineTripCache();
        if (mounted) setPasswordRecovery(false);
      }
      finishAuth(newSession);
    });

    // Hidratar desde storage local. NO cerramos sesión por errores transitorios de red:
    // solo confiamos en getSession() para la persistencia local del dispositivo.
    // El refresh token de Supabase + autoRefreshToken se encargan de validar contra el servidor
    // cuando hay conexión. Si el refresh falla con un error real de auth, el listener
    // recibirá SIGNED_OUT y limpiará el estado.
    supabase.auth.getSession()
      .then(({ data }) => {
        window.clearTimeout(timeoutId);
        finishAuth(data.session ?? null);
      })
      .catch(() => {
        window.clearTimeout(timeoutId);
        finishAuth(null);
      });

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
    };
  }, []);

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
    <AuthContext.Provider value={{ user, session, loading, passwordRecovery, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
