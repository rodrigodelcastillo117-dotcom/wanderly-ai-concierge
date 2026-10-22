import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass, ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  clearRecoveryFlag,
  getInitialRecoveryUrlState,
  hasRecoveryFlag,
  markRecovery,
  parseRecoveryUrl,
  recoveryErrorMessage,
  sessionIsRecovery,
} from "@/lib/passwordRecovery";
import { toast } from "sonner";

// Mismo mínimo que en el registro (Auth.tsx) para no aceptar aquí algo que allá se rechaza.
const MIN_LEN = 8;

const ResetPassword = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading, passwordRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Error que Supabase deja en la URL cuando el enlace expiró o ya se usó
  // (#error=access_denied&error_code=otp_expired…). Puede venir en hash o query.
  const urlError = useMemo(() => {
    const now = parseRecoveryUrl(window.location.href);
    return now.error ?? getInitialRecoveryUrlState().error;
  }, []);

  // Si la URL actual todavía trae type=recovery, lo recordamos para recargas posteriores.
  useEffect(() => {
    if (parseRecoveryUrl(window.location.href).isRecovery && !urlError) markRecovery();
  }, [urlError]);

  // Hay recuperación válida si: (a) el access token dice amr=recovery, o
  // (b) esta pestaña llegó por el enlace (bandera/evento) y ya hay sesión.
  const recoveryEvidence = passwordRecovery || hasRecoveryFlag() || sessionIsRecovery(session);
  const hasRecovery = !urlError && !!session && recoveryEvidence;
  const verifying = !urlError && authLoading && recoveryEvidence;
  const expired = !!urlError || (!authLoading && recoveryEvidence && !session);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasRecovery) return;
    if (password.length < MIN_LEN) return toast.error(`Mínimo ${MIN_LEN} caracteres`);
    if (password !== confirm) return toast.error("Las contraseñas no coinciden");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error("No pudimos actualizar tu contraseña. Intenta de nuevo.");
    clearRecoveryFlag();
    toast.success("Contraseña actualizada");
    navigate("/dashboard", { replace: true });
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail || resending) return;
    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResending(false);
    if (error) return toast.error("No pudimos enviar el correo. Intenta de nuevo en unos minutos.");
    setResent(true);
    toast.success("Te enviamos un enlace nuevo. Revisa tu correo.");
  };

  const subtitle = expired
    ? recoveryErrorMessage(urlError) ?? "El enlace expiró o ya se usó; pide uno nuevo."
    : verifying
      ? "Verificando tu enlace…"
      : hasRecovery
        ? "Escribe tu nueva contraseña"
        : "Abre el enlace que te enviamos por correo para continuar.";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="container mx-auto py-6">
        <Link to="/auth" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm">Volver</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-gold mb-6">
              <Compass className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
            </div>
            <h1 className="font-display text-4xl mb-2">Nueva contraseña</h1>
            <p className="text-muted-foreground text-sm" role={expired ? "alert" : undefined}>
              {expired && <AlertTriangle className="inline w-4 h-4 mr-1 text-amber-400 align-[-2px]" aria-hidden="true" />}
              {subtitle}
            </p>
          </div>

          {hasRecovery ? (
            <form onSubmit={handleSubmit} className="space-y-5 glass-card rounded-2xl p-8">
              <div>
                <Label htmlFor="password">Contraseña</Label>
                <Input id="password" type="password" required autoComplete="new-password" minLength={MIN_LEN} value={password}
                  onChange={(e) => setPassword(e.target.value)} className="mt-2 bg-input border-border h-12"
                  placeholder={`Mínimo ${MIN_LEN} caracteres`} />
              </div>
              <div>
                <Label htmlFor="confirm">Confirmar</Label>
                <Input id="confirm" type="password" required autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} className="mt-2 bg-input border-border h-12" />
              </div>
              <Button type="submit" disabled={loading}
                className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12">
                {loading ? "Guardando..." : "Actualizar contraseña"}
              </Button>
            </form>
          ) : verifying ? null : (
            // Sin sesión de recuperación válida: ofrecemos pedir otro enlace aquí mismo.
            <form onSubmit={handleResend} className="space-y-5 glass-card rounded-2xl p-8">
              <div>
                <Label htmlFor="resend-email">Tu correo</Label>
                <Input id="resend-email" type="email" required autoComplete="email" value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)} className="mt-2 bg-input border-border h-12"
                  placeholder="tu@correo.com" />
              </div>
              <Button type="submit" disabled={resending || resent}
                className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12">
                {resending ? "Enviando..." : resent ? "Enlace enviado" : "Pedir un enlace nuevo"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Por seguridad, cada enlace funciona una sola vez y caduca pronto.
              </p>
            </form>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default ResetPassword;
