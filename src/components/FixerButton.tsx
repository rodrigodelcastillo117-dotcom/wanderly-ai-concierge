import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, X, AlertTriangle, AlertCircle, MessageCircle, Loader2, ArrowLeft, Check, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Datos del Fixer (números visibles + email backend)
const FIXER_WHATSAPP_DIGITS = "525543580077";
const FIXER_WHATSAPP_DISPLAY = "+52 55 4358 0077";
const FIXER_EMAIL_FALLBACK = "rodrigo@traveliatos.life";

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
  icon: LucideIcon;
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
  const tagUrgencia =
    urgencia === "critica" ? "[CRITICO]" : urgencia === "alta" ? "[IMPORTANTE]" : "[CONSULTA]";

  let mensaje = `${tagUrgencia} *Solicitud Fixer IATOS*\n\n`;
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
      const role = t.role === "user" ? "Tú:" : "Iato:";
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
  const [step, setStep] = useState<"urgencia" | "detalle">("urgencia");
  const [urgencia, setUrgencia] = useState<Urgencia | null>(null);
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStep("urgencia");
    setUrgencia(null);
    setMotivo("");
  };

  const handleClose = () => {
    if (submitting) return;
    setOpen(false);
    setTimeout(reset, 200);
  };

  const handleSubmit = () => {
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

    // CRÍTICO iOS/Safari: abrir WhatsApp SÍNCRONO con el gesto del usuario.
    // Cualquier await antes de window.open hace que Safari pierda el gesto
    // y la apertura se sienta lentísima o no ocurra.
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

    const numero = String(FIXER_WHATSAPP_NUMBER).replace(/\D/g, "");
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;

    // 1) Abrir YA.
    const win = window.open(url, "_blank");
    if (!win) {
      // Fallback iOS estricto: navega en la misma pestaña preservando el gesto.
      window.location.href = url;
    }

    // 2) Loggear en background (fire-and-forget).
    setSubmitting(true);
    void supabase
      .from("fixer_escalations")
      .insert({
        user_id: user.id,
        trip_id: trip?.id ?? null,
        motivo: motivo.trim() || null,
        urgencia,
        contexto_chat: ultimosTurnos.slice(-5).map((t) => ({
          role: t.role,
          content: t.content ?? t.text ?? "",
        })),
        status: "whatsapp_abierto",
      })
      .then(({ error }) => {
        if (error) console.error("[FixerButton] log error:", error);
      });

    toast.success("Tu Fixer recibió tu solicitud", {
      description: "Te contactará por WhatsApp en minutos.",
    });
    setOpen(false);
    setTimeout(() => {
      reset();
      setSubmitting(false);
    }, 200);
  };

  const triggerClass =
    variant === "header"
      ? "group relative flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl bg-white/5 border border-primary/30 hover:border-primary hover:bg-primary/10 transition text-sm"
      : "inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-gold text-primary-foreground gold-glow text-sm";

  const selectedUrgencia = URGENCIAS.find((u) => u.id === urgencia);
  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-background/90 backdrop-blur-xl p-0 sm:p-6"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 28, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 28, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-full max-w-md max-h-[calc(100dvh-0.75rem)] flex-col overflow-hidden rounded-t-[28px] border border-primary/30 bg-card shadow-[0_30px_90px_-24px_hsl(var(--primary)/0.45)] sm:rounded-[28px] sm:max-h-[min(720px,calc(100dvh-3rem))]"
          >
            <div className="shrink-0 border-b border-border/80 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-gold text-primary-foreground shadow-[0_10px_28px_-10px_hsl(var(--primary)/0.75)]">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-primary">The Fixer</p>
                    <h3 className="font-display text-xl leading-tight">Asistencia humana</h3>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  disabled={submitting}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-full border border-border bg-background/60 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setStep("urgencia")}
                  className={`rounded-full px-3 py-2 transition ${step === "urgencia" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  1. Urgencia
                </button>
                <button
                  type="button"
                  onClick={() => urgencia && setStep("detalle")}
                  className={`rounded-full px-3 py-2 transition ${step === "detalle" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  2. Enviar
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {step === "urgencia" ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">¿Qué tan urgente es?</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Elige una opción. Te llevamos al mensaje final.</p>
                  </div>

                  <div className="space-y-2.5">
                    {URGENCIAS.map((u) => {
                      const selected = urgencia === u.id;
                      const Icon = u.icon;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setUrgencia(u.id);
                            setStep("detalle");
                          }}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                            selected
                              ? "border-primary bg-primary/10 shadow-[0_0_28px_-12px_hsl(var(--primary)/0.8)]"
                              : "border-border bg-background/40 hover:border-primary/50"
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium leading-tight">{u.titulo}</span>
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{u.desc}</span>
                            </span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setStep("urgencia")}
                    className="inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Cambiar urgencia
                  </button>

                  <div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-primary">Solicitud</p>
                    <p className="mt-1 text-sm font-medium">{selectedUrgencia?.titulo ?? "Urgencia seleccionada"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Un humano revisa tu caso y abre conversación por WhatsApp.</p>
                  </div>

                  <div>
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      Mensaje opcional
                    </label>
                    <Textarea
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ej. Mi vuelo se canceló y necesito reubicación esta noche."
                      className="min-h-[112px] resize-none text-sm leading-relaxed"
                      maxLength={600}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border/80 bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
              {step === "urgencia" ? (
                <Button variant="outline" onClick={handleClose} disabled={submitting} className="h-11 w-full rounded-full">
                  Ahora no
                </Button>
              ) : (
                <div className="grid grid-cols-[0.85fr_1.15fr] gap-2">
                  <Button variant="outline" onClick={() => setStep("urgencia")} disabled={submitting} className="h-11 rounded-full">
                    Atrás
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={!urgencia || submitting}
                    className="h-11 rounded-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}
                    WhatsApp
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

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
      {typeof document !== "undefined" ? createPortal(modal, document.body) : modal}
    </>
  );
};

export default FixerButton;
