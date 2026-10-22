import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { universesFor } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";

/**
 * Los 12 universos como fichas sobrias. Sin contenido del catálogo, cada ficha dice "En curaduría"
 * (nunca se inventa un conteo). `counts` lo puede dar el catálogo cuando exista. En el teléfono van en
 * un carril horizontal (no una columna de doce fichas); desde 640 px, en cuadrícula.
 */
export function UniverseTiles({ locked = false, counts }: { locked?: boolean; counts?: Partial<Record<string, number>> }) {
  const { reduce } = usePriveMotion();
  const t = usePriveT();
  const lang = usePriveLang();
  return (
    <ul className="prive-tiles" aria-label={t.hub.twelveCollections}>
      {universesFor(lang).map((u, i) => {
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
              <p className="prive-serif text-lg sm:text-xl leading-tight">{u.name}{u.sub && <span className="block text-[10px] tracking-[0.18em] uppercase prive-gold mt-1 font-sans">{u.sub}</span>}</p>
              {locked ? <Lock className="w-4 h-4 prive-muted shrink-0 mt-1" aria-label={t.common.locked} /> : null}
            </div>
            <div>
              <p className="text-[13px] prive-muted leading-snug">{u.line}</p>
              <p className="text-[10px] tracking-[0.24em] uppercase mt-3 prive-gold">
                {typeof n === "number" && n > 0 ? t.common.experiences(n) : t.common.curating}
                {u.adult ? <span className="prive-muted"> · 18+</span> : null}
              </p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
