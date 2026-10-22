import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { universesFor } from "@/lib/priveCopy";
import { PRIVE_TEXT, type PriveText } from "@/lib/priveI18n";
import { usePriveT } from "@/components/prive/PriveLang";
import type { PriveOnboarding as OnboardingState } from "@/lib/priveApi";
import { ONBOARDING_STEPS, onboardingCompleted, onboardingProgress, onboardingSkipped } from "@/lib/priveOnboarding";

type Step = { key: string; eyebrow: string; title: string; body: React.ReactNode };

/** Las cinco formas de presentar algo en Privé. Nada es una reserva hasta que el lugar la confirma. */
export const RESERVATION_KINDS = PRIVE_TEXT.es.onboarding.reservationKinds;

function buildSteps(t: PriveText, consent: boolean | null | undefined, setConsent: (v: boolean) => void): Step[] {
  const O = t.onboarding;
  const S = O.steps;
  const strong = (x: string) => <strong className="prive-champagne font-normal">{x}</strong>;
  return [
    { key: "world", eyebrow: S.world.eyebrow, title: S.world.title, body: <>{S.world.p.map((p) => <p key={p}>{p}</p>)}</> },
    {
      key: "curated",
      eyebrow: S.curated.eyebrow,
      title: S.curated.title,
      body: (
        <>
          {S.curated.p.map((p) => <p key={p}>{p}</p>)}
          <div role="group" aria-label={O.consentGroup} className="grid sm:grid-cols-2 gap-2 pt-1">
            <button type="button" aria-pressed={consent === true} onClick={() => setConsent(true)} className={`prive-btn ${consent === true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>
              {O.consentYes}
            </button>
            <button type="button" aria-pressed={consent === false} onClick={() => setConsent(false)} className={`prive-btn ${consent === false ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>
              {O.consentNo}
            </button>
          </div>
          <p className="text-sm">
            {O.consentEditBefore}{" "}
            <Link to="/dashboard/perfil" className="prive-link">{O.consentEditLink}</Link>{O.consentEditAfter}
          </p>
        </>
      ),
    },
    {
      key: "collections",
      eyebrow: S.collections.eyebrow,
      title: S.collections.title,
      body: (
        <>
          {S.collections.p.map((p) => <p key={p}>{p}</p>)}
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm" aria-label={O.universesAria}>
            {universesFor(t.lang).map((u) => (
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
      eyebrow: S.planner.eyebrow,
      title: S.planner.title,
      body: (
        <>
          {S.planner.p.map((p) => <p key={p}>{p}</p>)}
          <p>
            {O.plannerWarnBefore} {strong(O.plannerTime)} {O.plannerWarnMid1} {strong(O.plannerBudget)} {O.plannerWarnMid2} {strong(O.plannerTransfer)}{" "}
            {O.plannerWarnAfter}
          </p>
        </>
      ),
    },
    {
      key: "concierge",
      eyebrow: S.concierge.eyebrow,
      title: S.concierge.title,
      body: (
        <>
          {S.concierge.p.map((p) => <p key={p}>{p}</p>)}
          <dl className="space-y-2 text-sm">
            {O.reservationKinds.map((k) => (
              <div key={k.term}>
                <dt className="prive-champagne">{k.term}</dt>
                <dd className="prive-muted">{k.text}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">{O.noGuarantee}</p>
        </>
      ),
    },
    {
      key: "membership",
      eyebrow: S.membership.eyebrow,
      title: S.membership.title,
      body: (
        <>
          {S.membership.p.map((p) => <p key={p}>{p}</p>)}
          <p>
            {O.membershipBefore}{" "}
            <Link to="/terminos" className="prive-link">{O.terms}</Link>.
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
  const t = usePriveT();
  const O = t.onboarding;
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

  const steps = buildSteps(t, consent, setConsent);
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
            {finale ? O.ready : O.progress(step + 1, ONBOARDING_STEPS)}
          </p>
          {!finale && (
            <button type="button" onClick={skip} className="min-h-[44px] px-3 text-xs tracking-[0.28em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
              {O.skipGuide}
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
                  {t.ceremony.onboardingEnd}
                </h2>
                <motion.button {...rise(0.3)} type="button" onClick={explore} className="prive-btn prive-btn-gold">
                  {t.ceremony.explore}
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
          <nav aria-label={O.navAria} className="flex items-center justify-between gap-3 pt-8">
            <button type="button" onClick={back} disabled={step === 0} className="prive-btn prive-btn-ghost px-5" aria-label={O.prevStep}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">{O.back}</span>
            </button>
            <button type="button" onClick={next} className="prive-btn prive-btn-gold px-6">
              {step === ONBOARDING_STEPS - 1 ? O.finish : O.next} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </nav>
        )}
        {!finale && <p className="sr-only">{O.srHint}</p>}
      </div>
    </div>
  );
}
