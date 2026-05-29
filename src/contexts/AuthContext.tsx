import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const finishAuth = (newSession: Session | null) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    };

    const timeoutId = window.setTimeout(() => {
      finishAuth(null);
    }, 4500);

    // Listener primero — mantiene la sesión sincronizada (refresh automático, login, logout explícito)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      window.clearTimeout(timeoutId);
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
    return { error: error?.message };
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
