import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { priveApi } from "@/lib/priveApi";
import { CEREMONY, WELCOME_DESTINATIONS } from "@/lib/priveCopy";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { WELCOME_TIMINGS } from "@/components/prive/timings";



type Photo = { image: string; photographer: string | null } | null;

/**
 * Grand Welcome: pantalla negra → "WELCOME TO PRIVÉ" → "YOUR WORLD JUST GOT BIGGER." → seis destinos.
 * Siempre con "Saltar". Con movimiento reducido no hay escenas ni temporizadores: todo aparece de una
 * vez, estático. Quién decide si se muestra (una vez por versión) es el servidor (welcome_version_seen).
 */
export function GrandWelcome({ onDone }: { onDone: (how: "completed" | "skipped") => void }) {
  const { reduce, fade, rise } = usePriveMotion();
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(reduce ? 4 : 0);
  const [photos, setPhotos] = useState<Photo[]>(() => WELCOME_DESTINATIONS.map(() => null));
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

  // Fotos: se piden cuando falta poco para verlas (desde "YOUR WORLD…"), una vez y sin bloquear nada.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || phase < 2) return;
    asked.current = true;
    let alive = true;
    WELCOME_DESTINATIONS.forEach((d, i) => {
      void priveApi.illustrativePhoto(d.query).then((p) => {
        if (alive) setPhotos((prev) => prev.map((x, j) => (j === i ? p : x)));
      });
    });
    return () => { alive = false; };
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
      aria-label="Bienvenida a IATOS Privé"
      onKeyDown={onKeyDown}
      className="prive-overlay outline-none"
      data-testid="prive-grand-welcome"
      data-motion={reduce ? "reduced" : "full"}
    >
      <div className="min-h-full flex flex-col px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <div className="sticky top-0 z-20 flex justify-end">
          <button type="button" onClick={() => finish("skipped")} className="min-h-[44px] px-4 text-xs tracking-[0.28em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
            Saltar
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-6">
          {reduce ? (
            <div aria-live="polite" className="space-y-4">
              <Monogram size={64} className="mx-auto" />
              <h2 className="prive-display text-3xl sm:text-5xl">{CEREMONY.grandWelcome}</h2>
              <p className="prive-display text-lg sm:text-2xl prive-champagne">{CEREMONY.worldBigger}</p>
            </div>
          ) : (
            <div aria-live="polite" className="min-h-[9rem] flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">
                {phase === 1 && (
                  <motion.h2 key="t1" {...fade(0, 1.1)} className="prive-display text-3xl sm:text-6xl">
                    {CEREMONY.grandWelcome}
                  </motion.h2>
                )}
                {phase === 2 && (
                  <motion.p key="t2" {...fade(0, 1.1)} className="prive-display text-2xl sm:text-5xl prive-champagne">
                    {CEREMONY.worldBigger}
                  </motion.p>
                )}
                {phase >= 3 && (
                  <motion.div key="t3" {...fade(0, 0.8)} className="space-y-2">
                    <p className="prive-eyebrow">{CEREMONY.grandWelcome}</p>
                    <p className="prive-display text-xl sm:text-3xl prive-champagne">{CEREMONY.worldBigger}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {showDestinations && (
            <section aria-label="Algunos destinos" className="w-full max-w-5xl">
              <ul className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                {WELCOME_DESTINATIONS.map((d, i) => {
                  const p = photos[i];
                  return (
                    <motion.li
                      key={d.city}
                      {...(reduce ? fade() : { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.9, delay: 0.12 * i, ease: EASE } })}
                      className="prive-photo"
                    >
                      {p ? (
                        <img src={p.image} alt={`Foto ilustrativa de ${d.city}`} loading="lazy" decoding="async" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                          <Monogram size={36} className="opacity-30" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 z-10 p-2 sm:p-3 text-left">
                        <p className="prive-serif text-sm sm:text-lg leading-tight">{d.city}</p>
                        {p && (
                          <p className="text-[9px] sm:text-[10px] leading-snug prive-muted mt-0.5">
                            Foto ilustrativa · Pexels{p.photographer ? ` · ${p.photographer}` : ""}
                          </p>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
              <p className="text-[11px] prive-muted mt-3">
                Fotos ilustrativas de Pexels: muestran la ciudad, no un lugar de la selección.
              </p>
            </section>
          )}
        </div>

        <div className="flex justify-center min-h-[56px]">
          {phase === 4 && (
            <motion.button {...rise(0.1)} ref={continueRef} type="button" onClick={() => finish("completed")} className="prive-btn prive-btn-gold">
              Continuar
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
