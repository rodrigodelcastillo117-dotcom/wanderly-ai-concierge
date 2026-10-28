import { signupErrorMessage } from "@/lib/signupErrors";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimPendingReferral } from "@/lib/referral";
import { useTrialCopy } from "@/hooks/usePlanConfig";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { readPendingToken } from "@/lib/priveSession";
import { useOptionalOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { warmProfileBasics } from "@/lib/profileBasics";
import { preloadInitialRoute } from "@/lib/routeChunks";

/** En las pruebas no se descargan pantallas de verdad (cada prueba monta solo lo que revisa). */
const PRELOAD = import.meta.env.MODE !== "test";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { copy: trial } = useTrialCopy();
  const location = useLocation();
  // Ruta que se pidió antes de iniciar sesión (ProtectedRoute la manda en state.from). Solo rutas internas.
  const returnTo = safeRedirectPath((location.state as { from?: unknown } | null)?.from);
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">(searchParams.get("mode") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  // "¿Olvidaste tu contraseña?": desactivado mientras se envía y 60 s después (cada toque
  // mandaba otro correo y Supabase acaba rechazándolos por límite de envíos).
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");

  // Rendimiento (login → inicio, E2E 28-oct-2026): la pantalla a la que se va después (el inicio o la
  // ruta pedida) se descarga mientras la persona escribe, no hasta después de iniciar sesión.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (!w.requestIdleCallback || !PRELOAD) return;
    const id = w.requestIdleCallback(() => { preloadInitialRoute(returnTo?.split(/[?#]/)[0] ?? "/dashboard"); }, { timeout: 2500 });
    return () => w.cancelIdleCallback?.(id);
  }, [returnTo]);

  // Ya con sesión, ¿a dónde va? Con la misma señal que ProtectedRoute (user_onboarding_state, que el
  // OnboardingProvider ya está pidiendo): antes /auth hacía OTRAS 3 consultas y esperaba a que
  // terminaran. Solo si el proveedor dice "sin terminar" (o no hay proveedor) se revisan las tablas
  // viejas (ai_user_preferences / travel_profiles) por compatibilidad: quien terminó el onboarding
  // pero no el perfil profundo iba a /onboarding, rebotaba a /dashboard y perdía la ruta pedida.
  const onbCtx = useOptionalOnboardingStatus();
  const hasOnbCtx = !!onbCtx;
  const onbStatus = onbCtx?.status ?? null;
  const onbLoading = onbCtx?.isLoading ?? false;
  const routedFor = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!user || routedFor.current === user.id) return;
    const fallback = () => (readPendingToken("invite") ? "/prive/invitacion" : "/dashboard");
    const go = (done: boolean) => {
      routedFor.current = user.id;
      // Quien llegó desde el correo de invitación Privé (el token quedó guardado al abrir el
      // enlace) vuelve a su invitación, no al inicio.
      navigate(done ? (returnTo ?? fallback()) : "/onboarding", { replace: true });
    };
    if (hasOnbCtx) {
      if (onbStatus?.user_id === user.id && onbStatus.completed_onboarding) return go(true);
      if (onbLoading || onbStatus?.user_id !== user.id) return; // la consulta del proveedor sigue en curso
    }
    routedFor.current = user.id;
    void (async () => {
      const [{ data: prefs }, { data: tp }, onb] = await Promise.all([
        supabase.from("ai_user_preferences").select("completado").eq("user_id", user.id).maybeSingle(),
        supabase.from("travel_profiles").select("completado").eq("user_id", user.id).maybeSingle(),
        hasOnbCtx
          ? Promise.resolve({ data: onbStatus })
          : supabase.from("user_onboarding_state").select("completed_onboarding").eq("user_id", user.id).maybeSingle(),
      ]);
      if (!mounted.current) return;
      const done = (prefs as any)?.completado || (tp as any)?.completado || (onb as any)?.data?.completed_onboarding;
      navigate(done ? (returnTo ?? fallback()) : "/onboarding", { replace: true });
    })();
  }, [user, navigate, returnTo, hasOnbCtx, onbStatus, onbLoading]);

  // Una vez por sesión nueva: el referido pendiente y el nombre/avatar del inicio (en paralelo con lo de arriba).
  useEffect(() => {
    if (!user) return;
    claimPendingReferral().catch(() => {});
    warmProfileBasics(user.id);
    if (PRELOAD) preloadInitialRoute(returnTo?.split(/[?#]/)[0] ?? "/dashboard");
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        if (password.length < 8) {
          toast.error("La contraseña debe tener al menos 8 caracteres");
          return;
        }
        if (!acceptedTerms) {
          toast.error("Acepta los Términos y la Política de Privacidad para continuar");
          return;
        }
        const { error } = await signUp(email, password, fullName);
        if (error) {
          toast.error(signupErrorMessage(error));
        } else {
          // Auto-confirm está activo: iniciamos sesión de inmediato para evitar quedar sin sesión
          const { error: signInErr } = await signIn(email, password);
          if (signInErr) {
            toast.success("Cuenta creada. Inicia sesión para continuar.");
            setMode("login");
          } else {
            toast.success("¡Bienvenido a IATOS AI!");
          }
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) toast.error("Credenciales inválidas");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (resetState !== "idle") return;
    if (!email) return toast.error("Escribe tu correo arriba primero");
    setResetState("sending");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setResetState("idle");
      toast.error("No pudimos enviar el correo de recuperación. Intenta de nuevo.");
    } else {
      setResetState("sent");
      toast.success("Te enviamos un correo para recuperar tu contraseña");
      window.setTimeout(() => setResetState("idle"), 60_000);
    }
  };


  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="container mx-auto py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Volver</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-gold mb-6">
              <Compass className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-4xl mb-2">
              {mode === "signup" ? "Crea tu cuenta" : "Bienvenido de vuelta"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {mode === "signup" ? trial.signup : "Tu próximo viaje te espera."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 glass-card rounded-2xl p-8">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name">Nombre completo</Label>
                <Input
                  id="name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-2 bg-input border-border h-12"
                  placeholder="Rodrigo Hernández"
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 bg-input border-border h-12"
                placeholder="tu@correo.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 bg-input border-border h-12"
                placeholder={mode === "signup" ? "Mínimo 8 caracteres" : "Tu contraseña"}
              />
            </div>

            {mode === "signup" && (
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(v) => setAcceptedTerms(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="terms" className="text-xs text-muted-foreground font-normal leading-relaxed cursor-pointer">
                  Acepto los{" "}
                  <Link to="/terminos" target="_blank" className="text-primary hover:underline">
                    Términos de Servicio
                  </Link>{" "}
                  y la{" "}
                  <Link to="/privacidad" target="_blank" className="text-primary hover:underline">
                    Política de Privacidad
                  </Link>{" "}
                  de IATOS AI.
                </Label>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || (mode === "signup" && !acceptedTerms)}
              className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12"
            >
              {loading ? "Procesando..." : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
            </Button>

            {mode === "login" && (
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetState !== "idle"}
                aria-busy={resetState === "sending"}
                className="w-full text-center text-sm text-muted-foreground hover:text-primary transition disabled:opacity-60 disabled:hover:text-muted-foreground"
              >
                {resetState === "sending"
                  ? "Enviando correo…"
                  : resetState === "sent"
                    ? "Correo enviado. Revisa tu bandeja (puedes pedir otro en 1 min)"
                    : "¿Olvidaste tu contraseña?"}
              </button>
            )}
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {mode === "signup" ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
              className="text-primary hover:underline"
            >
              {mode === "signup" ? "Iniciar sesión" : "Crea una"}
            </button>
          </p>

        </motion.div>
      </main>
    </div>
  );
};

export default Auth;
