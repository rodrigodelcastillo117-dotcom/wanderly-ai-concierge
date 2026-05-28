import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Auth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">(searchParams.get("mode") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      // Verificar completado en ambas tablas (compatibilidad)
      (async () => {
        const [{ data: prefs }, { data: tp }] = await Promise.all([
          supabase.from("ai_user_preferences").select("completado").eq("user_id", user.id).maybeSingle(),
          supabase.from("travel_profiles").select("completado").eq("user_id", user.id).maybeSingle(),
        ]);
        const done = (prefs as any)?.completado || (tp as any)?.completado;
        navigate(done ? "/dashboard" : "/onboarding", { replace: true });
      })();
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        if (password.length < 6) {
          toast.error("La contraseña debe tener al menos 6 caracteres");
          return;
        }
        const { error } = await signUp(email, password, fullName);
        if (error) {
          toast.error(error.includes("already") ? "Ya existe una cuenta con este correo" : error);
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
    if (!email) return toast.error("Escribe tu correo arriba primero");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Te enviamos un correo para recuperar tu contraseña");
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
              {mode === "signup" ? "30 días gratis. Sin compromisos." : "Tu próximo viaje te espera."}
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
                placeholder="Mínimo 6 caracteres"
              />
            </div>

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
                className="w-full text-center text-sm text-muted-foreground hover:text-primary transition"
              >
                ¿Olvidaste tu contraseña?
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
