import { motion } from "framer-motion";
import { EASE, usePriveMotion } from "@/components/prive/motion";

/** Anillo de antigüedad PRO pagada (N de 90). Sin cuenta regresiva ni urgencia. */
export function ProgressRing({ value, total, size = 176 }: { value: number; total: number; size?: number }) {
  const { reduce } = usePriveMotion();
  const v = Math.max(0, Math.min(value, total));
  const frac = total > 0 ? v / total : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={v}
      aria-label={`${v} de ${total} días de PRO pagado`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="prive-ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9d6a4" />
            <stop offset="1" stopColor="#b8975a" />
          </linearGradient>
        </defs>
        <circle className="prive-ring-track" cx="50" cy="50" r={r} fill="none" strokeWidth="2" />
        <motion.circle
          className="prive-ring-value"
          cx="50" cy="50" r={r} fill="none" strokeWidth="2.4"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - frac) : c }}
          animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={reduce ? { duration: 0 } : { duration: 1.4, ease: EASE, delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="prive-serif prive-nums text-5xl leading-none" data-testid="prive-ring-value">{v}</span>
        <span className="text-[11px] tracking-[0.24em] uppercase prive-muted mt-2">de {total} días</span>
      </div>
    </div>
  );
}
