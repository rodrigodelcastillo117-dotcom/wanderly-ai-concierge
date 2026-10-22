import { motion } from "framer-motion";
import { EASE } from "@/components/prive/motion";

/**
 * Monograma de IATOS Privé: doble aro fino y una "P" de serifa con la "I" entrelazada.
 * SVG en línea (sin imagen). Con `draw`, los aros se trazan al aparecer.
 */
export function Monogram({ size = 72, draw = false, reduce = false, className = "", title, ink }: {
  size?: number;
  draw?: boolean;
  reduce?: boolean;
  className?: string;
  /** Sin título es decorativo (aria-hidden). */
  title?: string;
  /** Color sólido (p. ej. tinta oscura sobre el sello dorado); por omisión, degradado oro. */
  ink?: string;
}) {
  const animateRing = draw && !reduce;
  const paint = ink ?? "url(#prive-mono-gold)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id="prive-mono-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9d6a4" />
          <stop offset="0.5" stopColor="#c9a961" />
          <stop offset="1" stopColor="#9b7d43" />
        </linearGradient>
      </defs>
      <motion.circle
        cx="50" cy="50" r="46" fill="none" stroke={paint} strokeWidth="0.8"
        initial={animateRing ? { pathLength: 0, opacity: 0 } : false}
        animate={animateRing ? { pathLength: 1, opacity: 1 } : undefined}
        transition={{ duration: 1.6, ease: EASE }}
      />
      <motion.circle
        cx="50" cy="50" r="41" fill="none" stroke={paint} strokeWidth="0.4" opacity="0.7"
        initial={animateRing ? { pathLength: 0, opacity: 0 } : false}
        animate={animateRing ? { pathLength: 1, opacity: 0.7 } : undefined}
        transition={{ duration: 1.6, delay: 0.25, ease: EASE }}
      />
      <text
        x="50" y="63" textAnchor="middle" fill={paint}
        style={{ fontFamily: '"Cormorant Garamond", "Fraunces", Georgia, serif', fontSize: 44, fontStyle: "italic", fontWeight: 400 }}
      >
        P
      </text>
      <line x1="50" y1="24" x2="50" y2="76" stroke={paint} strokeWidth="0.7" opacity="0.85" />
      <path d="M50 18 l2.2 3 -2.2 3 -2.2 -3 z" fill={paint} />
    </svg>
  );
}
