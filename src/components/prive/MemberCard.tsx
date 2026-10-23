import { motion } from "framer-motion";
import { Monogram } from "@/components/prive/Monogram";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { ceremonialCode, formatDate } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { useMemberCard } from "@/lib/memberCard";
import { TierCard } from "@/components/membercard/TierCard";

export type MemberCardStatus = "active" | "paused_pro" | "paused_tenure" | "revoked";

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
  const t = usePriveT();
  const lang = usePriveLang();
  const C = t.card;
  const since = formatDate(activatedAt, lang);
  // Con la membresía activa se muestra la MISMA tarjeta de rango del menú y del Travel Avatar
  // (Platinum, Rose Gold, Special Edition, la negra solo de fundadores). Antes aquí salía una
  // tarjeta negra para todos y parecía la de fundador. Sin respuesta del servidor: la de Privé.
  const { card } = useMemberCard(status === "active" ? undefined : null);
  const rank = status === "active" && card ? card : null;
  const anim = reveal
    ? reduce
      ? rise()
      : { initial: { opacity: 0, y: 24, rotateX: 12 }, animate: { opacity: 1, y: 0, rotateX: 0 }, transition: { duration: 1.1, ease: EASE } }
    : { initial: false as const };
  return (
    <figure className="flex flex-col items-center gap-3" style={{ perspective: 1200 }}>
      {rank ? (
        <motion.div {...anim} className="w-full max-w-[420px]" data-testid="prive-member-card" data-tier={rank.tier} aria-label={C.aria}>
          <TierCard tier={rank.tier} edition={rank.edition ?? null} name={rank.name ?? firstName} number={rank.number ?? memberCode}
            since={rank.since ?? activatedAt} lang={lang === "en" ? "en" : "es"} interactive testId="prive-tier-card" />
          <p className="mt-2 text-center text-xs prive-champagne">{C.status[status]}</p>
        </motion.div>
      ) : (
      <motion.div {...anim} className="prive-card text-left" data-testid="prive-member-card" aria-label={C.aria}>
        <div className="flex items-start justify-between">
          <div>
            <p className="prive-eyebrow">IATOS Privé</p>
            <p className="text-[11px] tracking-[0.2em] uppercase prive-muted mt-1">{C.member}</p>
          </div>
          <Monogram size={46} />
        </div>
        <div>
          <p className="prive-serif text-2xl sm:text-[1.7rem] leading-tight text-[color:var(--pv-text)]">{firstName ?? C.fallbackName}</p>
          <p className="text-xs mt-1 prive-champagne">{C.status[status]}</p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{C.code}</p>
            <p className="prive-card-code text-sm prive-champagne truncate">{memberCode ?? "—"}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{C.since}</p>
            <p className="text-sm prive-champagne">{since ?? "—"}</p>
          </div>
        </div>
      </motion.div>
      )}
      <figcaption className="text-center max-w-[400px] px-2">
        <p className="prive-serif text-lg tracking-[0.3em] prive-gold" aria-describedby="prive-ceremonial-note">
          {ceremonialCode(activatedAt)}
        </p>
        <p id="prive-ceremonial-note" className="text-[11px] prive-muted mt-1">{C.ceremonialNote}</p>
        <p className="text-[11px] prive-muted mt-1">{C.publicNote}</p>
      </figcaption>
    </figure>
  );
}
