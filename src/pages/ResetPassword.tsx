import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);

  useEffect(() => {
    // Supabase coloca el token en el hash. Detectamos type=recovery o sesión activa.
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery")) setHasRecovery(true);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setHasRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Mínimo 6 caracteres");
    if (password !== confirm) return toast.error("Las contraseñas no coinciden");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Contraseña actualizada");
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="container mx-auto py-6">
        <Link to="/auth" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Volver</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-gold mb-6">
              <Compass className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-4xl mb-2">Nueva contraseña</h1>
            <p className="text-muted-foreground text-sm">
              {hasRecovery ? "Escribe tu nueva contraseña" : "Abre el link desde tu correo para continuar."}
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5 glass-card rounded-2xl p-8">
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} className="mt-2 bg-input border-border h-12"
                placeholder="Mínimo 6 caracteres" />
            </div>
            <div>
              <Label htmlFor="confirm">Confirmar</Label>
              <Input id="confirm" type="password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} className="mt-2 bg-input border-border h-12" />
            </div>
            <Button type="submit" disabled={loading || !hasRecovery}
              className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12">
              {loading ? "Guardando..." : "Actualizar contraseña"}
            </Button>
          </form>
        </motion.div>
      </main>
    </div>
  );
};

export default ResetPassword;
