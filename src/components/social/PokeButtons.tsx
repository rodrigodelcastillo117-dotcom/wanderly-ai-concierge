import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { GESTO_COPY, SOCIAL_ERRORS, untilText, type GestoSaludo, type SaludosState } from "@/lib/social";

type Props = {
  friendId: string;
  friendName: string;
  state: SaludosState;
  onChange: (next: SaludosState) => void;
};

const RECIBIDO: Record<GestoSaludo, string> = {
  saludo: "te mandó un saludo ✈️",
  brindis: "brindó por su próximo viaje 🥂",
  maleta: "ya quiere hacer maleta contigo 🧳",
  devuelta: "te devolvió el saludo 👋",
};

/**
 * Saludos entre amigos: un toque manda un aviso a la campana del otro (lo crea el servidor con
 * saludar_amigo: solo entre amigos aceptados y uno cada 24 h por pareja).
 */
export function PokeButtons({ friendId, friendName, state, onChange }: Props) {
  const [sending, setSending] = useState<GestoSaludo | null>(null);
  const [flying, setFlying] = useState<string | null>(null);
  const reduce = usePrefersReducedMotion();

  const send = async (gesto: GestoSaludo) => {
    if (sending || !state.puedo) return;
    setSending(gesto);
    const { data, error } = await supabase.rpc("saludar_amigo", { p_amigo: friendId, p_gesto: gesto });
    setSending(null);
    const r = (data ?? {}) as { ok?: boolean; error?: string; proximo?: string; total?: number; gesto?: GestoSaludo };
    if (error) { toast.error("No se pudo mandar el saludo. Intenta de nuevo."); return; }
    if (!r.ok) {
      if (r.error === "muy_pronto") {
        onChange({ ...state, puedo: false, proximo: r.proximo ?? null });
        toast.info(`Ya saludaste a ${friendName} hoy. Podrás de nuevo ${untilText(r.proximo ?? null)}.`);
        return;
      }
      toast.error(SOCIAL_ERRORS[r.error ?? ""] ?? "No se pudo mandar el saludo.");
      return;
    }
    const sent = r.gesto ?? gesto;
    setFlying(sent === "devuelta" ? "👋" : GESTO_COPY[sent as Exclude<GestoSaludo, "devuelta">]?.emoji ?? "✈️");
    setTimeout(() => setFlying(null), 1400);
    onChange({
      ...state, puedo: false, proximo: r.proximo ?? null, ultimo_enviado: new Date().toISOString(),
      por_devolver: false, total: typeof r.total === "number" ? r.total : state.total + 1,
    });
    toast.success(sent === "devuelta" ? `¡Le devolviste el saludo a ${friendName}!` : `${GESTO_COPY[sent as Exclude<GestoSaludo, "devuelta">]?.enviado ?? "¡Saludo enviado!"} ${friendName} lo verá en su campana.`);
  };

  const recibido = state.ultimo_recibido && state.gesto_recibido
    ? `${friendName} ${RECIBIDO[state.gesto_recibido]} ${formatDistanceToNow(new Date(state.ultimo_recibido), { addSuffix: true, locale: es })}`
    : null;

  return (
    <div className="relative" data-testid="poke-panel">
      <AnimatePresence>
        {flying && (
          <motion.span
            key="fly"
            aria-hidden="true"
            className="pointer-events-none absolute left-6 -top-2 z-10 text-3xl"
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
            animate={reduce ? { opacity: 0 } : { x: 220, y: -90, opacity: 0, rotate: -12, scale: 1.4 }}
            transition={{ duration: reduce ? 0.3 : 1.2, ease: "easeOut" }}
          >
            {flying}
          </motion.span>
        )}
      </AnimatePresence>

      {state.por_devolver && state.puedo ? (
        <div className="space-y-2">
          {recibido && <p className="text-xs text-primary">{recibido}</p>}
          <button
            type="button"
            onClick={() => send("devuelta")}
            disabled={!!sending}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-gradient-gold text-primary-foreground text-sm font-medium gold-glow hover:opacity-90 transition disabled:opacity-60 motion-safe:animate-[pulse_2.4s_ease-in-out_infinite]"
          >
            <span aria-hidden="true">👋</span> {sending ? "Enviando…" : "Devolver saludo"}
          </button>
        </div>
      ) : state.puedo ? (
        <div className="space-y-2">
          <div role="group" aria-label={`Saludar a ${friendName}`} className="flex flex-wrap gap-1.5 sm:gap-2">
            {(Object.keys(GESTO_COPY) as Exclude<GestoSaludo, "devuelta">[]).map((g, i) => (
              <button
                key={g}
                type="button"
                onClick={() => send(g)}
                disabled={!!sending}
                className={`inline-flex items-center gap-1.5 sm:gap-2 h-11 px-3.5 sm:px-5 rounded-full text-[13px] sm:text-sm font-medium transition disabled:opacity-60 ${
                  i === 0
                    ? "bg-gradient-gold text-primary-foreground gold-glow hover:opacity-90"
                    : "border border-primary/30 text-foreground hover:bg-primary/10 hover:border-primary/50"
                }`}
              >
                <span aria-hidden="true">{GESTO_COPY[g].emoji}</span>
                {sending === g ? "Enviando…" : i === 0 ? "Saludar" : GESTO_COPY[g].label}
              </button>
            ))}
          </div>
          {recibido && <p className="text-xs text-muted-foreground">{recibido}</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-white/10 bg-white/[0.03] text-sm text-muted-foreground" data-testid="poke-cooldown">
            <span aria-hidden="true">✈️</span> Saludo enviado · otro {untilText(state.proximo)}
          </span>
          {recibido && <p className="text-xs text-muted-foreground">{recibido}</p>}
        </div>
      )}
    </div>
  );
}
