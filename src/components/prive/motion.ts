// Movimiento de Privé: suave y corto. Con "reducir movimiento" (sistema operativo) todo pasa a un
// fundido de 80 ms sin desplazamiento, escala ni giro (docs/iatos/IATOS_PRIVE_UX.md §7).
import { useReducedMotion, type Transition } from "framer-motion";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Variant = { initial: Record<string, number>; animate: Record<string, number>; exit?: Record<string, number>; transition: Transition };

const REDUCED: Variant = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.08 } };

export function usePriveMotion() {
  const reduce = !!useReducedMotion();
  return {
    reduce,
    /** Fundido simple. */
    fade: (delay = 0, duration = 0.9): Variant =>
      reduce ? REDUCED : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration, delay, ease: EASE } },
    /** Fundido con 12 px hacia arriba. */
    rise: (delay = 0, y = 12, duration = 0.8): Variant =>
      reduce
        ? REDUCED
        : { initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -y / 2 }, transition: { duration, delay, ease: EASE } },
    /** Para escenas que cambian (AnimatePresence). */
    scene: (): Variant =>
      reduce ? REDUCED : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.6, ease: EASE } },
  };
}
