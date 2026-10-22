import { motion } from "framer-motion";
import { Monogram } from "@/components/prive/Monogram";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { ceremonialCode, formatDateEs } from "@/lib/priveCopy";

export type MemberCardStatus = "active" | "paused_pro" | "paused_tenure" | "revoked";

const STATUS_LABEL: Record<MemberCardStatus, string> = {
  active: "Miembro activo",
  paused_pro: "Pausada · tu PRO terminó",
  paused_tenure: "Pausada · antigüedad en revisión",
  revoked: "No activa",
};

/**
 * Tarjeta digital de miembro. SOLO datos públicos: nombre, estado, fecha de activación, código de
 * miembro (público, no sirve para entrar) y un código ceremonial decorativo. Por diseño no recibe
 * ni muestra la contraseña Privé, el token de sesión ni el enlace de invitación.
 */
export function MemberCard({ firstName, status, activatedAt, memberCode, reveal = false }: {
  firstName: string | null;
  status: MemberCardStatus;
  activatedAt: string | null;
  memberCode: string | null;
  reveal?: boolean;
}) {
  const { reduce, rise } = usePriveMotion();
  const since = formatDateEs(activatedAt);
  const anim = reveal
    ? reduce
      ? rise()
      : { initial: { opacity: 0, y: 24, rotateX: 12 }, animate: { opacity: 1, y: 0, rotateX: 0 }, transition: { duration: 1.1, ease: EASE } }
    : { initial: false as const };
  return (
    <figure className="flex flex-col items-center gap-3" style={{ perspective: 1200 }}>
      <motion.div {...anim} className="prive-card" data-testid="prive-member-card" aria-label="Tarjeta de miembro IATOS Privé">
        <div className="flex items-start justify-between">
          <div>
            <p className="prive-eyebrow">IATOS Privé</p>
            <p className="text-[11px] tracking-[0.2em] uppercase prive-muted mt-1">Member</p>
          </div>
          <Monogram size={46} />
        </div>
        <div>
          <p className="prive-serif text-2xl sm:text-[1.7rem] leading-tight text-[color:var(--pv-text)]">{firstName ?? "Miembro"}</p>
          <p className="text-xs mt-1 prive-champagne">{STATUS_LABEL[status]}</p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">Código de miembro</p>
            <p className="prive-card-code text-sm prive-champagne truncate">{memberCode ?? "—"}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">Miembro desde</p>
            <p className="text-sm prive-champagne">{since ?? "—"}</p>
          </div>
        </div>
      </motion.div>
      <figcaption className="text-center max-w-[400px] px-2">
        <p className="prive-serif text-lg tracking-[0.3em] prive-gold" aria-describedby="prive-ceremonial-note">
          {ceremonialCode(activatedAt)}
        </p>
        <p id="prive-ceremonial-note" className="text-[11px] prive-muted mt-1">
          Código ceremonial: es solo un adorno con tu fecha de activación. No es una contraseña ni da acceso a nada.
        </p>
        <p className="text-[11px] prive-muted mt-1">
          Tu código de miembro es público: identifica tu membresía, pero no sirve para entrar.
        </p>
      </figcaption>
    </figure>
  );
}
