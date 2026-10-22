import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { WELCOME_DESTINATIONS } from "@/lib/priveCopy";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { loadPrivePhoto } from "@/lib/privePhoto";
import { usePriveT } from "@/components/prive/PriveLang";
import { WELCOME_TIMINGS } from "@/components/prive/timings";

/**
 * Grand Welcome: pantalla negra → "TE DAMOS LA BIENVENIDA A PRIVÉ" → "TU MUNDO ACABA DE CRECER." →
 * seis destinos (en inglés si el idioma de la persona es inglés). Siempre con "Saltar". Con
 * movimiento reducido no hay escenas ni temporizadores: todo aparece de una vez, estático. Quién
 * decide si se muestra (una vez por versión) es el servidor (welcome_version_seen).
 * Fotos: PrivePhoto (fila y caché compartidas, varias consultas por ciudad, reintento si Pexels o el
 * límite fallan); se piden desde "TU MUNDO…", antes de que la cuadrícula aparezca.
 */
export function GrandWelcome({ onDone }: { onDone: (how: "completed" | "skipped") => void }) {
  const { reduce, fade, rise } = usePriveMotion();
  const t = usePriveT();
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(reduce ? 4 : 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);

  const finish = (how: "completed" | "skipped") => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(how);
  };

  // Escenas con temporizador (solo con movimiento completo).
  useEffect(() => {
    if (reduce || phase >= 4) return;
    const ms = [WELCOME_TIMINGS.dark, WELCOME_TIMINGS.title, WELCOME_TIMINGS.bigger, WELCOME_TIMINGS.destinations][phase];
    const t = window.setTimeout(() => setPhase((p) => (Math.min(4, p + 1) as 0 | 1 | 2 | 3 | 4)), ms);
    return () => window.clearTimeout(t);
  }, [phase, reduce]);

  // Fotos: se piden desde "TU MUNDO…" (antes de que aparezca la cuadrícula), por la fila compartida.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || phase < 2) return;
    asked.current = true;
    WELCOME_DESTINATIONS.forEach((d) => { void loadPrivePhoto(d.queries); });
  }, [phase]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  useEffect(() => {
    if (phase === 4) continueRef.current?.focus();
  }, [phase]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish("skipped");
    }
  };

  const showDestinations = phase >= 3;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t.welcome.aria}
      onKeyDown={onKeyDown}
      className="prive-overlay outline-none"
      data-testid="prive-grand-welcome"
      data-motion={reduce ? "reduced" : "full"}
    >
      <div className="min-h-full flex flex-col px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <div className="sticky top-0 z-20 flex justify-end">
          <button type="button" onClick={() => finish("skipped")} className="min-h-[44px] px-4 text-xs tracking-[0.28em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
            {t.common.skip}
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-6">
          {reduce ? (
            <div aria-live="polite" className="space-y-4">
              <Monogram size={64} className="mx-auto" />
              <h2 className="prive-display text-3xl sm:text-5xl">{t.ceremony.grandWelcome}</h2>
              <p className="prive-display text-lg sm:text-2xl prive-champagne">{t.ceremony.worldBigger}</p>
            </div>
          ) : (
            <div aria-live="polite" className="min-h-[9rem] flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">
                {phase === 1 && (
                  <motion.h2 key="t1" {...fade(0, 1.1)} className="prive-display text-3xl sm:text-6xl">
                    {t.ceremony.grandWelcome}
                  </motion.h2>
                )}
                {phase === 2 && (
                  <motion.p key="t2" {...fade(0, 1.1)} className="prive-display text-2xl sm:text-5xl prive-champagne">
                    {t.ceremony.worldBigger}
                  </motion.p>
                )}
                {phase >= 3 && (
                  <motion.div key="t3" {...fade(0, 0.8)} className="space-y-2">
                    <p className="prive-eyebrow">{t.ceremony.grandWelcome}</p>
                    <p className="prive-display text-xl sm:text-3xl prive-champagne">{t.ceremony.worldBigger}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {showDestinations && (
            <section aria-label={t.welcome.someDestinations} className="w-full max-w-5xl">
              <ul className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                {WELCOME_DESTINATIONS.map((d, i) => {
                  const city = t.welcome.cities[i] ?? d.city;
                  return (
                    <motion.li
                      key={d.slug}
                      {...(reduce ? fade() : { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.9, delay: 0.12 * i, ease: EASE } })}
                      className="relative rounded-[14px] overflow-hidden"
                      data-testid="prive-welcome-city"
                    >
                      <PrivePhoto queries={d.queries} alt={t.common.photoAlt(city)} label={city} eager className="prive-veil aspect-[3/4]" creditClassName="is-inline">
                        <div className="absolute inset-x-0 bottom-0 z-[2] px-2.5 pt-2 pb-6 sm:px-3 text-left">
                          <p className="prive-serif text-base sm:text-lg leading-tight">{city}</p>
                        </div>
                      </PrivePhoto>
                    </motion.li>
                  );
                })}
              </ul>
              <p className="text-[11px] prive-muted mt-3">{t.common.illustrativeNote}</p>
            </section>
          )}
        </div>

        <div className="flex justify-center min-h-[56px]">
          {phase === 4 && (
            <motion.button {...rise(0.1)} ref={continueRef} type="button" onClick={() => finish("completed")} className="prive-btn prive-btn-gold">
              {t.common.continue}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
