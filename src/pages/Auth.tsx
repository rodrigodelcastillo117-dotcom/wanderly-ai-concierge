import { signinErrorMessage, signupErrorMessage } from "@/lib/signupErrors";
import { googleLoginEnabled, startGoogleLogin } from "@/lib/googleLogin";
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
  // También ?next= (regreso del inicio de sesión con Google, que vuelve a /auth).
  const returnTo = safeRedirectPath((location.state as { from?: unknown } | null)?.from) ?? safeRedirectPath(searchParams.get("next"));
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
  // Errores visibles junto al formulario (además del aviso): el de inicio de sesión ofrece recuperar la
  // contraseña y el de registro explica por qué falta aceptar los Términos (antes el botón quedaba
  // deshabilitado sin decir por qué, auditoría de cuenta #12).
  const [loginError, setLoginError] = useState<{ message: string; offerReset: boolean } | null>(null);
  const [termsError, setTermsError] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const showGoogle = googleLoginEnabled();
  // Título de la pestaña según el modo (la ruta es la misma: /auth y /auth?mode=signup).
  useEffect(() => { document.title = mode === "signup" ? "Crea tu cuenta · IATOS" : "Inicia sesión · IATOS"; }, [mode]);

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
          setTermsError(true);
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
        if (error) {
          const info = signinErrorMessage((error as { message?: string })?.message);
          setLoginError(info);
          toast.error(info.message);
        } else setLoginError(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    const { error } = await startGoogleLogin(returnTo);
    // Con éxito el navegador sale a Google; solo se regresa aquí si algo falló.
    if (error) { setGoogleBusy(false); toast.error(error); }
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
            {showGoogle && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogle}
                  disabled={googleBusy}
                  className="w-full h-12 gap-3 border-border"
                  data-testid="auth-google"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.2 14.6 2.2 12 2.2 6.9 2.2 2.8 6.4 2.8 11.8S6.9 21.4 12 21.4c6.9 0 9.2-4.9 9.2-7.4 0-.5 0-.9-.1-1.3H12z"/></svg>
                  {googleBusy ? "Abriendo Google…" : "Continuar con Google"}
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />o con tu correo<span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
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
                  onCheckedChange={(v) => { setAcceptedTerms(v === true); if (v === true) setTermsError(false); }}
                  aria-invalid={termsError || undefined}
                  aria-describedby={termsError ? "terms-error" : undefined}
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

            {mode === "signup" && termsError && (
              <p id="terms-error" role="alert" className="text-xs text-destructive -mt-2">
                Para crear tu cuenta, marca la casilla de Términos y Política de Privacidad.
              </p>
            )}
            {mode === "login" && loginError && (
              <p role="alert" className="text-sm text-destructive" data-testid="auth-login-error">{loginError.message}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
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
              onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setLoginError(null); setTermsError(false); }}
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
