import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { CEREMONY, UNIVERSES } from "@/lib/priveCopy";
import type { PriveOnboarding as OnboardingState } from "@/lib/priveApi";
import { ONBOARDING_STEPS, onboardingCompleted, onboardingProgress, onboardingSkipped } from "@/lib/priveOnboarding";

type Step = { key: string; eyebrow: string; title: string; body: React.ReactNode };

/** Las cinco formas de presentar algo en Privé. Nada es una reserva hasta que el lugar la confirma. */
export const RESERVATION_KINDS = [
  { term: "Recomendación", text: "Una sugerencia de la selección. No hay nada apartado ni pagado." },
  { term: "Enlace externo", text: "Te llevamos al sitio oficial del lugar o de su plataforma. La reserva la haces allí, con sus condiciones." },
  { term: "Solicitud de reserva", text: "Le pides a Iato y al equipo de IATOS que gestionen la reserva. Aún no es una reserva." },
  { term: "Reserva confirmada", text: "Solo cuando el lugar la confirma, con folio y fecha de confirmación." },
  { term: "Beneficio exclusivo comprobado", text: "Solo si existe un acuerdo firmado y vigente con el lugar. Si no lo hay, no se muestra." },
] as const;

function buildSteps(consent: boolean | null | undefined, setConsent: (v: boolean) => void): Step[] {
  return [
    {
      key: "world",
      eyebrow: "Your World",
      title: "Tu mundo",
      body: (
        <>
          <p>Privé reúne experiencias en destinos del mundo, elegidas y revisadas por el equipo de IATOS.</p>
          <p>Cada ficha dice de dónde viene la información y cuándo se revisó. Si algo no se ha podido comprobar, lo verás marcado.</p>
        </>
      ),
    },
    {
      key: "curated",
      eyebrow: "Curated for You",
      title: "Elegido para ti",
      body: (
        <>
          <p>
            Con tu permiso, usamos tu Travel DNA (gustos, presupuesto y ritmo de viaje) para ordenar lo que ves primero. Sin permiso,
            verás la selección del editor.
          </p>
          <div role="group" aria-label="Usar mi Travel DNA en Privé" className="grid sm:grid-cols-2 gap-2 pt-1">
            <button type="button" aria-pressed={consent === true} onClick={() => setConsent(true)} className={`prive-btn ${consent === true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>
              Sí, personalizar con mi DNA
            </button>
            <button type="button" aria-pressed={consent === false} onClick={() => setConsent(false)} className={`prive-btn ${consent === false ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>
              Ahora no
            </button>
          </div>
          <p className="text-sm">
            Puedes ver y editar tus preferencias cuando quieras en{" "}
            <Link to="/dashboard/perfil" className="prive-link">Mi perfil → Travel DNA</Link>, y cambiar este permiso desde tu membresía.
          </p>
        </>
      ),
    },
    {
      key: "collections",
      eyebrow: "The Collections",
      title: "Las 12 colecciones",
      body: (
        <>
          <p>La selección se organiza en doce universos. Algunos piden confirmar tu mayoría de edad.</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm" aria-label="Universos de Privé">
            {UNIVERSES.map((u) => (
              <li key={u.id} className="prive-champagne">
                {u.name}
                {u.adult && <span className="prive-muted"> · 18+</span>}
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      key: "planner",
      eyebrow: "Your Experience Planner",
      title: "Tu planeador de experiencias",
      body: (
        <>
          <p>Guarda lo que te interese y agrégalo al itinerario de tu viaje.</p>
          <p>
            Antes de agregarlo te avisamos si choca con algo: un <strong className="prive-champagne font-normal">horario</strong> ya ocupado,
            tu <strong className="prive-champagne font-normal">presupuesto</strong> o un <strong className="prive-champagne font-normal">traslado</strong> que
            no da tiempo. Los traslados se marcan como aproximados hasta que los calculas.
          </p>
        </>
      ),
    },
    {
      key: "concierge",
      eyebrow: "Reservations & Concierge",
      title: "Reservas y Concierge",
      body: (
        <>
          <p>Para que siempre sepas en qué punto está cada cosa, usamos cinco etiquetas:</p>
          <dl className="space-y-2 text-sm">
            {RESERVATION_KINDS.map((k) => (
              <div key={k.term}>
                <dt className="prive-champagne">{k.term}</dt>
                <dd className="prive-muted">{k.text}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">IATOS no garantiza reservas: depende de cada lugar.</p>
        </>
      ),
    },
    {
      key: "membership",
      eyebrow: "Your Membership",
      title: "Tu membresía",
      body: (
        <>
          <p>En Membresía encuentras tu tarjeta digital, el estado de tu acceso y tus preferencias.</p>
          <p>
            Desde ahí puedes cambiar tu contraseña Privé, cerrar todas tus sesiones Privé, volver a ver esta bienvenida, pedir ayuda y leer los{" "}
            <Link to="/terminos" className="prive-link">términos</Link>.
          </p>
        </>
      ),
    },
  ];
}

/**
 * Guía de inicio (6 pasos). Atrás / Siguiente / Saltar, con teclado (← → y Esc), foco en el título de
 * cada paso, progreso anunciado y avance guardado en el servidor para reanudar.
 */
export function PriveOnboarding({ initialStep, onboarding, onSave, onClose }: {
  initialStep: number;
  onboarding: OnboardingState;
  onSave: (next: OnboardingState) => void;
  onClose: (how: "completed" | "skipped") => void;
}) {
  const { reduce, scene, rise } = usePriveMotion();
  const [step, setStep] = useState(Math.max(0, Math.min(ONBOARDING_STEPS - 1, initialStep)));
  const [finale, setFinale] = useState(false);
  const [consent, setConsentState] = useState<boolean | null | undefined>(onboarding.dna_consent);
  const stateRef = useRef<OnboardingState>(onboarding);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const persist = (next: OnboardingState) => {
    stateRef.current = next;
    onSave(next);
  };

  const setConsent = (v: boolean) => {
    setConsentState(v);
    persist(onboardingProgress(stateRef.current, step, { dna_consent: v }));
  };

  const steps = buildSteps(consent, setConsent);
  const current = steps[step];

  const go = (to: number) => {
    const n = Math.max(0, Math.min(ONBOARDING_STEPS - 1, to));
    if (n === step) return;
    setStep(n);
    persist(onboardingProgress(stateRef.current, n));
  };
  const next = () => {
    if (finale) return;
    if (step < ONBOARDING_STEPS - 1) go(step + 1);
    else setFinale(true);
  };
  const back = () => {
    if (finale) setFinale(false);
    else go(step - 1);
  };
  const skip = () => {
    persist(onboardingSkipped(stateRef.current, step));
    onClose("skipped");
  };
  const explore = () => {
    persist(onboardingCompleted(stateRef.current));
    onClose("completed");
  };

  // Foco: al abrir, en el diálogo; al cambiar de paso, en su título (lo anuncian los lectores).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      rootRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
  }, [step, finale]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === "Escape") { e.preventDefault(); skip(); return; }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (e.key === "Tab") {
      // Trampa de foco: Tab no sale del diálogo.
      const f = rootRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
      if (!f || f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prive-onb-title"
      onKeyDown={onKeyDown}
      className="prive-overlay outline-none"
      data-testid="prive-onboarding"
      data-motion={reduce ? "reduced" : "full"}
    >
      <div className="min-h-full max-w-xl mx-auto flex flex-col px-4 sm:px-6 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <div className="flex items-center justify-between min-h-[48px]">
          <p className="text-xs prive-muted" aria-live="polite" data-testid="prive-onb-progress">
            {finale ? "Listo" : `Paso ${step + 1} de ${ONBOARDING_STEPS}`}
          </p>
          {!finale && (
            <button type="button" onClick={skip} className="min-h-[44px] px-3 text-xs tracking-[0.28em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
              Saltar guía
            </button>
          )}
        </div>
        {!finale && (
          <div className="grid gap-1 mb-8" style={{ gridTemplateColumns: `repeat(${ONBOARDING_STEPS}, 1fr)` }} aria-hidden="true">
            {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
              <span key={i} className={`h-[2px] rounded-full ${i <= step ? "bg-[color:var(--pv-gold)]" : "bg-[rgba(201,169,97,0.15)]"}`} />
            ))}
          </div>
        )}

        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {finale ? (
              <motion.div key="finale" {...scene()} className="text-center space-y-8 py-10">
                <Monogram size={72} className="mx-auto" draw reduce={reduce} />
                <h2 id="prive-onb-title" ref={headingRef} tabIndex={-1} className="prive-display text-3xl sm:text-5xl outline-none">
                  {CEREMONY.onboardingEnd}
                </h2>
                <motion.button {...rise(0.3)} type="button" onClick={explore} className="prive-btn prive-btn-gold">
                  {CEREMONY.explore}
                </motion.button>
              </motion.div>
            ) : (
              <motion.section key={current.key} {...scene()} aria-labelledby="prive-onb-title" className="space-y-5">
                <p className="prive-eyebrow">{current.eyebrow}</p>
                <h2 id="prive-onb-title" ref={headingRef} tabIndex={-1} className="text-3xl sm:text-4xl outline-none">
                  {current.title}
                </h2>
                <div className="space-y-4 text-[15px] leading-relaxed prive-muted">{current.body}</div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {!finale && (
          <nav aria-label="Navegación de la guía" className="flex items-center justify-between gap-3 pt-8">
            <button type="button" onClick={back} disabled={step === 0} className="prive-btn prive-btn-ghost px-5" aria-label="Paso anterior">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">Atrás</span>
            </button>
            <button type="button" onClick={next} className="prive-btn prive-btn-gold px-6">
              {step === ONBOARDING_STEPS - 1 ? "Terminar" : "Siguiente"} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </nav>
        )}
        {!finale && <p className="sr-only">Usa las flechas izquierda y derecha para moverte entre pasos y Escape para saltar la guía.</p>}
      </div>
    </div>
  );
}
