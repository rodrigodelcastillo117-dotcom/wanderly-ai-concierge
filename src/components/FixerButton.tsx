import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, X, AlertTriangle, AlertCircle, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Número de WhatsApp del Fixer (formato internacional, sin "+" ni espacios).
// Cambiar aquí cuando haya equipo dedicado o un Telegram/Slack workflow.
const FIXER_WHATSAPP_NUMBER = "525543580077";

type Urgencia = "critica" | "alta" | "media";

type Trip = {
  id?: string;
  destino?: string;
  pais_destino?: string;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
} | null;

type Turn = { role: "user" | "assistant"; content?: string; text?: string };

interface FixerButtonProps {
  trip?: Trip;
  ultimosTurnos?: Turn[];
  className?: string;
  variant?: "header" | "inline";
}

const URGENCIAS: Array<{
  id: Urgencia;
  emoji: string;
  titulo: string;
  desc: string;
  icon: any;
}> = [
  { id: "critica", emoji: "🔴", titulo: "Crítico", desc: "Vuelo cancelado, problema médico, robo", icon: AlertTriangle },
  { id: "alta", emoji: "🟡", titulo: "Importante", desc: "Cambio de itinerario, problema con reserva", icon: AlertCircle },
  { id: "media", emoji: "🟢", titulo: "Pregunta general", desc: "Consejo, recomendación adicional", icon: MessageCircle },
];

function construirMensajeFixer({
  nombre,
  trip,
  urgencia,
  motivo,
  ultimosTurnos,
}: {
  nombre: string;
  trip: Trip;
  urgencia: Urgencia;
  motivo: string;
  ultimosTurnos: Turn[];
}) {
  const emoji = urgencia === "critica" ? "🔴" : urgencia === "alta" ? "🟡" : "🟢";

  let mensaje = `${emoji} *Solicitud Fixer IATOS*\n\n`;
  mensaje += `Hola, soy *${nombre}* (usuario IATOS AI).\n\n`;
  mensaje += `*Urgencia:* ${urgencia.toUpperCase()}\n`;

  if (trip && (trip.destino || trip.id)) {
    mensaje += `*Viaje activo:* ${trip.destino ?? "—"}\n`;
    if (trip.fecha_salida || trip.fecha_regreso) {
      mensaje += `*Fechas:* ${trip.fecha_salida ?? "?"} al ${trip.fecha_regreso ?? "?"}\n`;
    }
    if (trip.pais_destino) {
      mensaje += `*País:* ${trip.pais_destino}\n`;
    }
  } else {
    mensaje += `*Viaje:* Sin viaje activo registrado\n`;
  }

  if (motivo.trim()) {
    mensaje += `\n*Motivo:*\n${motivo.trim()}\n`;
  }

  if (ultimosTurnos && ultimosTurnos.length > 0) {
    mensaje += `\n*Contexto chat con Iato (últimos 3 turnos):*\n`;
    ultimosTurnos.slice(-3).forEach((t) => {
      const role = t.role === "user" ? "👤" : "🤖";
      const txt = (t.content ?? t.text ?? "").slice(0, 200);
      mensaje += `${role} ${txt}\n`;
    });
  }

  mensaje += `\n_Enviado desde IATOS AI · ${new Date().toLocaleString("es-MX")}_`;
  return mensaje;
}

export const FixerButton = ({ trip, ultimosTurnos = [], className = "", variant = "header" }: FixerButtonProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [urgencia, setUrgencia] = useState<Urgencia | null>(null);
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setUrgencia(null);
    setMotivo("");
  };

  const handleClose = () => {
    if (submitting) return;
    setOpen(false);
    setTimeout(reset, 200);
  };

  const handleSubmit = async () => {
    if (!urgencia) {
      toast.error("Selecciona el nivel de urgencia");
      return;
    }
    if (!FIXER_WHATSAPP_NUMBER || FIXER_WHATSAPP_NUMBER.length < 8) {
      toast.error("Fixer no configurado todavía");
      return;
    }
    if (!user) {
      toast.error("Inicia sesión para contactar a tu Fixer");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Registrar escalación
      const { data: esc, error: insErr } = await supabase
        .from("fixer_escalations")
        .insert({
          user_id: user.id,
          trip_id: trip?.id ?? null,
          motivo: motivo.trim() || null,
          urgencia,
          contexto_chat: ultimosTurnos.slice(-5) as any,
          status: "iniciado",
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      // 2. Construir mensaje + abrir WhatsApp
      const nombre =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        user.email ||
        "Usuario IATOS";

      const mensaje = construirMensajeFixer({
        nombre,
        trip,
        urgencia,
        motivo,
        ultimosTurnos,
      });

      const url = `https://wa.me/${FIXER_WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;
      window.open(url, "_blank", "noopener,noreferrer");

      // 3. Marcar como WhatsApp abierto
      if (esc?.id) {
        await supabase
          .from("fixer_escalations")
          .update({ status: "whatsapp_abierto" })
          .eq("id", esc.id);
      }

      toast.success("Tu Fixer recibió tu solicitud", {
        description: "Te contactará por WhatsApp en minutos.",
      });
      setOpen(false);
      setTimeout(reset, 200);
    } catch (e: any) {
      console.error("[FixerButton]", e);
      toast.error("No pudimos registrar la solicitud", { description: e?.message ?? "Inténtalo de nuevo" });
    } finally {
      setSubmitting(false);
    }
  };

  const triggerClass =
    variant === "header"
      ? "group relative flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl bg-white/5 border border-primary/30 hover:border-primary hover:bg-primary/10 transition text-sm"
      : "inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-gold text-primary-foreground gold-glow text-sm";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${triggerClass} ${className}`}
        title="Un humano premium toma el control vía WhatsApp"
      >
        <Phone className="w-4 h-4 text-primary" />
        <span className="hidden sm:inline">Contactar Fixer</span>
        <span className="sm:hidden">Fixer</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md overflow-y-auto overscroll-contain"
            onClick={handleClose}
          >
            <div className="min-h-[100dvh] w-full flex items-start sm:items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
            <motion.div
              initial={{ scale: 0.94, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl border border-primary/40 bg-card p-6 sm:p-7 md:p-8 relative shadow-[0_30px_80px_-20px_hsl(var(--primary)/0.4)]"
            >
              <button
                onClick={handleClose}
                disabled={submitting}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-12 h-12 rounded-full bg-gradient-gold flex items-center justify-center mb-4 gold-glow">
                <Phone className="w-5 h-5 text-primary-foreground" />
              </div>
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2">The Fixer</p>
              <h3 className="font-display text-2xl mb-2">Contactar a tu Fixer</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Un humano premium revisará tu caso y te contactará por WhatsApp.
              </p>

              <div className="space-y-2 mb-5">
                <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Nivel de urgencia</p>
                {URGENCIAS.map((u) => {
                  const selected = urgencia === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUrgencia(u.id)}
                      className={`w-full text-left px-4 py-3 rounded-2xl border transition flex items-start gap-3 ${
                        selected
                          ? "border-primary bg-primary/10 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.6)]"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <span className="text-xl leading-none mt-0.5">{u.emoji}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{u.titulo}</p>
                        <p className="text-xs text-muted-foreground">{u.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mb-6">
                <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase mb-2">
                  Cuéntale a tu Fixer (opcional)
                </p>
                <Textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej. Mi vuelo Air France a París se canceló, necesito reubicación esta noche."
                  className="min-h-[88px] resize-none"
                  maxLength={600}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={submitting}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!urgencia || submitting}
                  className="flex-1 bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Phone className="w-4 h-4 mr-2" />
                  )}
                  Contactar Fixer →
                </Button>
              </div>
            </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default FixerButton;
