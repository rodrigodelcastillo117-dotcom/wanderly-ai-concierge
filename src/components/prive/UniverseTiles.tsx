import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { UNIVERSES } from "@/lib/priveCopy";

/**
 * Los 12 universos como fichas sobrias. Sin contenido del catálogo, cada ficha dice "En curaduría"
 * (nunca se inventa un conteo). `counts` lo puede dar el catálogo cuando exista.
 */
export function UniverseTiles({ locked = false, counts }: { locked?: boolean; counts?: Partial<Record<string, number>> }) {
  const { reduce } = usePriveMotion();
  return (
    <ul className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Los 12 universos de IATOS Privé">
      {UNIVERSES.map((u, i) => {
        const n = counts?.[u.id];
        return (
          <motion.li
            key={u.id}
            className="prive-tile"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0.08 } : { duration: 0.22, delay: Math.min(i, 6) * 0.04, ease: EASE }}
            data-universe={u.id}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="prive-serif text-lg sm:text-xl leading-tight">{u.name}</p>
              {locked ? <Lock className="w-4 h-4 prive-muted shrink-0 mt-1" aria-label="Bloqueado" /> : null}
            </div>
            <div>
              <p className="text-[13px] prive-muted leading-snug">{u.line}</p>
              <p className="text-[10px] tracking-[0.24em] uppercase mt-3 prive-gold">
                {typeof n === "number" && n > 0 ? `${n} ${n === 1 ? "experiencia" : "experiencias"}` : "En curaduría"}
                {u.adult ? <span className="prive-muted"> · 18+</span> : null}
              </p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
