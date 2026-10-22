// /prive — el hub de IATOS Privé. Una pantalla por estado real del servidor (priveView.ts):
// adelanto (sin PRO), progreso honesto (PRO < 90 días pagados), invitación lista, candado,
// pausa, y el hub con los 12 universos. Ocultar no da acceso: el servidor revisa cada llamada.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { ProgressRing } from "@/components/prive/ProgressRing";
import { LockScreen } from "@/components/prive/LockScreen";
import { UniverseTiles } from "@/components/prive/UniverseTiles";
import { PriveCatalogSlot } from "@/components/prive/PriveCatalogSlot";
import { GrandWelcome } from "@/components/prive/GrandWelcome";
import { PriveOnboarding } from "@/components/prive/PriveOnboarding";
import { MemberCard } from "@/components/prive/MemberCard";
import { PriveHero, PriveHeroClub, PriveHeroEditorial } from "@/components/prive/PriveHero";
import { PriveTripProvider } from "@/components/prive/home/context";
import { HomeVariantProvider, parseVariant } from "@/components/prive/home/ForYouHome";
import { SUPPORT_EMAIL, WELCOME_VERSION, formatDate, messageFor } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { onboardingResumeStep, shouldAutoPlayWelcome } from "@/lib/priveOnboarding";
import { PRO_PATH } from "@/lib/functionErrors";
import type { PriveOnboarding as OnboardingState, PriveStatus } from "@/lib/priveApi";
import { PrivateEditionBand } from "@/components/prive/edition";
import { editionText } from "@/lib/priveEditionI18n";

const Center = ({ children, label }: { children: React.ReactNode; label: string }) => {
  const { rise, reduce } = usePriveMotion();
  return (
    <motion.section {...rise()} aria-label={label} data-motion={reduce ? "reduced" : "full"} className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20 text-center">
      {children}
    </motion.section>
  );
};

function Explainer() {
  const t = usePriveT();
  return (
    <ul className="text-left space-y-2 text-sm prive-muted max-w-md mx-auto">
      {t.tenure.explainer.map((l) => (
        <li key={l} className="flex gap-3"><span className="prive-gold" aria-hidden="true">·</span><span>{l}</span></li>
      ))}
    </ul>
  );
}

function Teaser() {
  const t = usePriveT();
  return (
    <Center label="IATOS Privé">
      <Monogram size={88} className="mx-auto mb-8" />
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="prive-display text-3xl sm:text-5xl mb-6">
        {t.ceremony.teaserLine1}<br />{t.ceremony.teaserLine2}
      </h1>
      <p className="prive-champagne max-w-lg mx-auto mb-8">{t.hub.teaserIntro}</p>
      <div className="prive-panel p-6 sm:p-8 text-left space-y-4 mb-10">
        <p className="text-sm prive-champagne">{t.hub.teaserOpen}</p>
        <Explainer />
        <div className="pt-2">
          <Link to={PRO_PATH} className="prive-btn prive-btn-gold">{t.hub.knowPro}</Link>
        </div>
      </div>
      <h2 className="text-2xl mb-5 text-left">{t.hub.twelveCollections}</h2>
      <UniverseTiles locked />
    </Center>
  );
}

function Progress({ s }: { s: PriveStatus }) {
  const t = usePriveT();
  return (
    <Center label={t.hub.progressLabel}>
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="text-3xl sm:text-4xl mb-8">{t.hub.progressTitle}</h1>
      <div className="flex justify-center mb-6">
        <ProgressRing value={s.tenure_days} total={s.required_days} />
      </div>
      <p className="prive-serif text-2xl mb-6 prive-champagne">{t.tenure.line(s.tenure_days, s.required_days)}</p>
      <Explainer />
      <p className="text-sm prive-muted mt-8 max-w-md mx-auto">
        {t.hub.meanwhile}{" "}
        <Link to="/dashboard/concierge?tab=members" className="prive-link">Members Only</Link>.
      </p>
    </Center>
  );
}

function InvitationReady() {
  const t = usePriveT();
  return (
    <Center label={t.hub.readyTitle}>
      <Monogram size={80} className="mx-auto mb-8" draw />
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="text-3xl sm:text-5xl mb-4">{t.hub.readyTitle}</h1>
      <p className="prive-display text-xl prive-champagne mb-10">{t.ceremony.invitationReady}</p>
      <Link to="/prive/invitacion" className="prive-btn prive-btn-gold">{t.hub.openMyInvitation}</Link>
    </Center>
  );
}

function Preparing() {
  const t = usePriveT();
  return (
    <Center label={t.hub.preparingTitle}>
      <Monogram size={72} className="mx-auto mb-8" />
      <h1 className="text-3xl sm:text-4xl mb-4">{t.hub.preparingTitle}</h1>
      <p className="prive-muted max-w-md mx-auto">{t.hub.preparingBody}</p>
    </Center>
  );
}

function SetPasswordPending() {
  const t = usePriveT();
  return (
    <Center label={t.hub.oneStepTitle}>
      <Monogram size={72} className="mx-auto mb-8" />
      <h1 className="text-3xl sm:text-4xl mb-4">{t.hub.oneStepTitle}</h1>
      <p className="prive-muted max-w-md mx-auto mb-8">{t.hub.oneStepBody}</p>
      <Link to="/prive/invitacion" className="prive-btn prive-btn-gold">{t.hub.createPassword}</Link>
    </Center>
  );
}

function Paused({ s, reason }: { s: PriveStatus; reason: "pro" | "tenure" }) {
  const t = usePriveT();
  const active = s.membership_status === "active";
  return (
    <Center label={t.hub.pausedLabel}>
      {active && (
        <div className="flex justify-center mb-10">
          <MemberCard firstName={s.first_name} status={reason === "pro" ? "paused_pro" : "paused_tenure"} activatedAt={s.activated_at} memberCode={s.member_code} />
        </div>
      )}
      {reason === "pro" ? (
        <>
          <h1 className="text-3xl sm:text-4xl mb-4">{t.hub.pausedProTitle(active)}</h1>
          <p className="prive-muted max-w-md mx-auto mb-8">{t.hub.pausedProBody(active)}</p>
          <Link to={PRO_PATH} className="prive-btn prive-btn-gold">{t.hub.reactivatePro}</Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl sm:text-4xl mb-4">{t.hub.pausedTenureTitle}</h1>
          <p className="prive-muted max-w-md mx-auto mb-6">{t.hub.pausedTenureBody(s.tenure_days, s.required_days)}</p>
          <div className="flex justify-center"><ProgressRing value={s.tenure_days} total={s.required_days} size={140} /></div>
        </>
      )}
    </Center>
  );
}

function Revoked() {
  const t = usePriveT();
  return (
    <Center label={t.hub.revokedLabel}>
      <Monogram size={64} className="mx-auto mb-8 opacity-70" />
      <h1 className="text-3xl mb-4">{t.hub.revokedTitle}</h1>
      <p className="prive-muted max-w-md mx-auto">
        {t.hub.revokedBefore} <a className="prive-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> {t.hub.revokedAfter}
      </p>
    </Center>
  );
}

function MustReset({ hard }: { hard: boolean }) {
  const t = usePriveT();
  const lang = usePriveLang();
  return (
    <Center label={t.hub.resetLabel}>
      <Lock className="w-8 h-8 mx-auto mb-6 prive-gold" aria-hidden="true" />
      <h1 className="text-3xl mb-4">{t.hub.resetTitle}</h1>
      <p className="prive-muted max-w-md mx-auto mb-8">{messageFor(hard ? "HARD_LOCKED" : "MUST_RESET", lang)}</p>
      <Link to="/prive/restablecer" className="prive-btn prive-btn-gold">{t.hub.resetByEmail}</Link>
    </Center>
  );
}

function UnlockedHub({ s }: { s: PriveStatus }) {
  const { lock } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const t = usePriveT();
  const lang = usePriveLang();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // Propuesta de portada (Fase 13): C por omisión; A y B se pueden ver con ?portada=a|b para comparar.
  const variant = parseVariant(sp.get("portada"));
  // Con catálogo publicable, el inicio trae sus colecciones; las fichas estáticas "En curaduría"
  // solo se ven mientras no hay nada que mostrar.
  const [hasCatalog, setHasCatalog] = useState<boolean | null>(null);
  const onContent = useCallback((v: boolean) => setHasCatalog(v), []);
  const hero = variant === "a" ? <PriveHeroEditorial firstName={s.first_name} />
    : variant === "b" ? <PriveHeroClub firstName={s.first_name} memberSince={formatDate(s.activated_at, lang)} />
      : <PriveHero firstName={s.first_name} />;
  return (
    <PriveTripProvider>
      <HomeVariantProvider value={variant}>
        <motion.div {...rise()} data-testid="prive-hub" data-motion={reduce ? "reduced" : "full"} data-variant={variant}>
          {hero}
          <div id="prive-home" className="max-w-6xl mx-auto px-4 sm:px-8 pb-24 scroll-mt-4">
            <div className="relative z-20 mb-16">
              <PriveCatalogSlot onContent={onContent} />
            </div>
            {/* Con el catálogo aún en curaduría, la revista sigue presente (ForYouHome la trae cuando hay catálogo). */}
            {hasCatalog === false && <div className="mb-16"><PrivateEditionBand /></div>}
            {hasCatalog === false && (
              <section aria-labelledby="prive-collections">
                <h2 id="prive-collections" className="text-2xl sm:text-3xl mb-6">{t.hub.collections}</h2>
                <UniverseTiles />
              </section>
            )}
            <div className="flex flex-wrap justify-center gap-3 mt-14">
              <Link to="/prive/mi" className="prive-btn prive-btn-ghost">{t.hub.myMembership}</Link>
              <button type="button" className="prive-btn prive-btn-ghost" onClick={async () => { await lock(); navigate("/prive", { replace: true }); }}>
                {t.hub.closePrive}
              </button>
            </div>
          </div>
        </motion.div>
      </HomeVariantProvider>
    </PriveTripProvider>
  );
}

export default function PriveHub() {
  const { loading, status, statusError, view, refresh, call, patchStatus } = usePriveAccess();
  const t = usePriveT();
  const lang = usePriveLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [overlay, setOverlay] = useState<"welcome" | "onboarding" | null>(null);
  const [onbStep, setOnbStep] = useState(0);
  const handled = useRef({ welcome: false, onboarding: false });
  const navState = location.state as { replayWelcome?: boolean; replayOnboarding?: boolean } | null;
  const replay = navState?.replayWelcome === true;
  const replayGuide = navState?.replayOnboarding === true;

  // Al entrar desbloqueado: bienvenida (una vez por versión, según el servidor) y luego la guía.
  useEffect(() => {
    if (view !== "unlocked" || !status || overlay) return;
    if (replay || replayGuide) {
      handled.current.welcome = true;
      handled.current.onboarding = true;
      navigate(location.pathname, { replace: true, state: null });
      setOnbStep(0);
      setOverlay(replay ? "welcome" : "onboarding");
      return;
    }
    if (!handled.current.welcome && shouldAutoPlayWelcome(status)) {
      handled.current.welcome = true;
      setOverlay("welcome");
      return;
    }
    const resume = onboardingResumeStep(status.onboarding);
    if (!handled.current.onboarding && resume !== null) {
      handled.current.onboarding = true;
      setOnbStep(resume);
      setOverlay("onboarding");
    }
  }, [view, status, overlay, replay, replayGuide, navigate, location.pathname]);

  const welcomeDone = useCallback(async () => {
    setOverlay(null);
    if (status && status.welcome_version_seen < WELCOME_VERSION) {
      patchStatus({ welcome_version_seen: WELCOME_VERSION });
      await call("save_progress", { welcome_version: WELCOME_VERSION }, { withSession: true });
    }
  }, [status, patchStatus, call]);

  const saveOnboarding = useCallback(
    (next: OnboardingState) => {
      patchStatus({ onboarding: next });
      void call("save_progress", { onboarding: next }, { withSession: true });
    },
    [patchStatus, call],
  );

  // Se decide en el render (no en el efecto) para que el hub no alcance a pedir fotos un instante antes.
  const overlayPending = overlay !== null || (view === "unlocked" && !!status && (
    replay || replayGuide
    || (!handled.current.welcome && shouldAutoPlayWelcome(status))
    || (!handled.current.onboarding && onboardingResumeStep(status.onboarding) !== null)));

  if (loading && !status) {
    return <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label={t.common.loadingPrive}><Monogram size={56} className="opacity-60" /></div>;
  }
  if (!status) {
    return (
      <Center label="Error">
        <h1 className="text-2xl mb-3">{t.hub.loadError}</h1>
        <p className="prive-muted mb-6">{messageFor(statusError, lang)}</p>
        <button type="button" onClick={() => void refresh()} className="prive-btn prive-btn-ghost">{t.common.retry}</button>
        {/* Sin red Privé no se puede comprobar, pero las ediciones guardadas en este dispositivo sí se leen. */}
        {statusError === "NETWORK" && (
          <p className="mt-8"><Link to="/prive/edicion/sin-conexion" className="prive-link" data-testid="prive-offline-editions">{editionText(lang === "en" ? "en" : "es").offline.openSaved}</Link></p>
        )}
      </Center>
    );
  }

  return (
    <>
      {view === "teaser" && <Teaser />}
      {view === "progress" && <Progress s={status} />}
      {view === "preparing" && <Preparing />}
      {view === "invitation" && <InvitationReady />}
      {view === "set_password" && <SetPasswordPending />}
      {view === "paused_pro" && <Paused s={status} reason="pro" />}
      {view === "paused_tenure" && <Paused s={status} reason="tenure" />}
      {view === "revoked" && <Revoked />}
      {view === "must_reset" && <MustReset hard={status.password_status === "hard_locked"} />}
      {view === "locked" && <LockScreen />}
      {/* Con la bienvenida o la guía abiertas (o a punto de abrirse), el hub no se monta: sus fotos no
          compiten detrás del velo y la fila de Pexels atiende primero a las seis ciudades de la bienvenida. */}
      {view === "unlocked" && !overlayPending && <UnlockedHub s={status} />}
      {view === "unlocked" && overlay === "welcome" && (
        <GrandWelcome
          onDone={() => {
            void welcomeDone();
          }}
        />
      )}
      {view === "unlocked" && overlay === "onboarding" && (
        <PriveOnboarding
          initialStep={onbStep}
          onboarding={status.onboarding}
          onSave={saveOnboarding}
          onClose={() => setOverlay(null)}
        />
      )}
    </>
  );
}
