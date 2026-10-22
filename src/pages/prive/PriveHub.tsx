// /prive — el hub de IATOS Privé. Una pantalla por estado real del servidor (priveView.ts):
// adelanto (sin PRO), progreso honesto (PRO < 90 días pagados), invitación lista, candado,
// pausa, y el hub con los 12 universos. Ocultar no da acceso: el servidor revisa cada llamada.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import { CEREMONY, SUPPORT_EMAIL, TENURE_EXPLAINER, WELCOME_VERSION, messageFor, tenureLine } from "@/lib/priveCopy";
import { onboardingResumeStep, shouldAutoPlayWelcome } from "@/lib/priveOnboarding";
import { PRO_PATH } from "@/lib/functionErrors";
import type { PriveOnboarding as OnboardingState, PriveStatus } from "@/lib/priveApi";

const Center = ({ children, label }: { children: React.ReactNode; label: string }) => {
  const { rise, reduce } = usePriveMotion();
  return (
    <motion.section {...rise()} aria-label={label} data-motion={reduce ? "reduced" : "full"} className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20 text-center">
      {children}
    </motion.section>
  );
};

function Explainer() {
  return (
    <ul className="text-left space-y-2 text-sm prive-muted max-w-md mx-auto">
      {TENURE_EXPLAINER.map((l) => (
        <li key={l} className="flex gap-3"><span className="prive-gold" aria-hidden="true">·</span><span>{l}</span></li>
      ))}
    </ul>
  );
}

function Teaser() {
  return (
    <Center label="IATOS Privé">
      <Monogram size={88} className="mx-auto mb-8" />
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="prive-display text-3xl sm:text-5xl mb-6">
        There are places you visit.<br />And there are worlds you enter.
      </h1>
      <p className="prive-champagne max-w-lg mx-auto mb-8">
        Una colección de experiencias extraordinarias, destinos excepcionales y recomendaciones elegidas para ti.
      </p>
      <div className="prive-panel p-6 sm:p-8 text-left space-y-4 mb-10">
        <p className="text-sm prive-champagne">
          IATOS Privé se abre a quienes suman 90 días de IATOS PRO pagado. Cada invitación es personal.
        </p>
        <Explainer />
        <div className="pt-2">
          <Link to={PRO_PATH} className="prive-btn prive-btn-gold">Conocer IATOS PRO</Link>
        </div>
      </div>
      <h2 className="text-2xl mb-5 text-left">Las 12 colecciones</h2>
      <UniverseTiles locked />
    </Center>
  );
}

function Progress({ s }: { s: PriveStatus }) {
  return (
    <Center label="Tu camino a IATOS Privé">
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="text-3xl sm:text-4xl mb-8">Tu camino a Privé</h1>
      <div className="flex justify-center mb-6">
        <ProgressRing value={s.tenure_days} total={s.required_days} />
      </div>
      <p className="prive-serif text-2xl mb-6 prive-champagne">{tenureLine(s.tenure_days, s.required_days)}</p>
      <Explainer />
      <p className="text-sm prive-muted mt-8 max-w-md mx-auto">
        Mientras tanto, tu PRO incluye todos sus beneficios de siempre, también{" "}
        <Link to="/dashboard/concierge?tab=members" className="prive-link">Members Only</Link>.
      </p>
    </Center>
  );
}

function InvitationReady() {
  return (
    <Center label="Tu invitación está lista">
      <Monogram size={80} className="mx-auto mb-8" draw />
      <p className="prive-eyebrow mb-4">IATOS Privé</p>
      <h1 className="text-3xl sm:text-5xl mb-4">Tu invitación está lista</h1>
      <p className="prive-display text-xl prive-champagne mb-10">{CEREMONY.invitationReady}</p>
      <Link to="/prive/invitacion" className="prive-btn prive-btn-gold">Abrir mi invitación</Link>
    </Center>
  );
}

function Preparing() {
  return (
    <Center label="Tu invitación se está preparando">
      <Monogram size={72} className="mx-auto mb-8" />
      <h1 className="text-3xl sm:text-4xl mb-4">Tu invitación se está preparando</h1>
      <p className="prive-muted max-w-md mx-auto">
        Ya sumas los días necesarios. Estamos preparando tu invitación personal y te avisaremos por correo y aquí, en IATOS.
      </p>
    </Center>
  );
}

function SetPasswordPending() {
  return (
    <Center label="Falta un paso">
      <Monogram size={72} className="mx-auto mb-8" />
      <h1 className="text-3xl sm:text-4xl mb-4">Falta un paso</h1>
      <p className="prive-muted max-w-md mx-auto mb-8">Tu membresía está activa. Crea tu contraseña Privé personal para entrar.</p>
      <Link to="/prive/invitacion" className="prive-btn prive-btn-gold">Crear mi contraseña</Link>
    </Center>
  );
}

function Paused({ s, reason }: { s: PriveStatus; reason: "pro" | "tenure" }) {
  const active = s.membership_status === "active";
  return (
    <Center label="Membresía en pausa">
      {active && (
        <div className="flex justify-center mb-10">
          <MemberCard firstName={s.first_name} status={reason === "pro" ? "paused_pro" : "paused_tenure"} activatedAt={s.activated_at} memberCode={s.member_code} />
        </div>
      )}
      {reason === "pro" ? (
        <>
          <h1 className="text-3xl sm:text-4xl mb-4">{active ? "Tu membresía Privé está en pausa" : "Tu invitación te espera"}</h1>
          <p className="prive-muted max-w-md mx-auto mb-8">
            {active
              ? "Está pausada porque tu PRO terminó. Si reactivas IATOS PRO, tu acceso vuelve sin repetir los 90 días."
              : "Tu invitación se puede abrir mientras tu plan IATOS PRO esté vigente."}
          </p>
          <Link to={PRO_PATH} className="prive-btn prive-btn-gold">Reactivar IATOS PRO</Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl sm:text-4xl mb-4">Tu acceso está en pausa</h1>
          <p className="prive-muted max-w-md mx-auto mb-6">
            Un periodo reembolsado o en disputa dejó de contar y hoy suman {s.tenure_days} de {s.required_days} días de PRO pagado.
            El acceso vuelve solo en cuanto sumes {s.required_days} otra vez; no tienes que hacer nada más.
          </p>
          <div className="flex justify-center"><ProgressRing value={s.tenure_days} total={s.required_days} size={140} /></div>
        </>
      )}
    </Center>
  );
}

function Revoked() {
  return (
    <Center label="Membresía no activa">
      <Monogram size={64} className="mx-auto mb-8 opacity-70" />
      <h1 className="text-3xl mb-4">Tu membresía Privé no está activa</h1>
      <p className="prive-muted max-w-md mx-auto">
        Si crees que se trata de un error, escríbenos a <a className="prive-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> y lo revisamos contigo.
        Tu cuenta y tu plan IATOS siguen igual.
      </p>
    </Center>
  );
}

function MustReset({ hard }: { hard: boolean }) {
  return (
    <Center label="Restablece tu contraseña Privé">
      <Lock className="w-8 h-8 mx-auto mb-6 prive-gold" aria-hidden="true" />
      <h1 className="text-3xl mb-4">Crea una contraseña Privé nueva</h1>
      <p className="prive-muted max-w-md mx-auto mb-8">{messageFor(hard ? "HARD_LOCKED" : "MUST_RESET")}</p>
      <Link to="/prive/restablecer" className="prive-btn prive-btn-gold">Restablecer por correo</Link>
    </Center>
  );
}

function UnlockedHub({ s }: { s: PriveStatus }) {
  const { lock } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const navigate = useNavigate();
  return (
    <motion.div {...rise()} className="max-w-5xl mx-auto px-4 sm:px-8 pb-24" data-testid="prive-hub" data-motion={reduce ? "reduced" : "full"}>
      <section className="text-center py-12 sm:py-20">
        <p className="prive-eyebrow mb-4">IATOS Privé</p>
        <h1 className="prive-display text-4xl sm:text-6xl mb-5">{CEREMONY.tagline}</h1>
        <p className="prive-champagne">{s.first_name ? `Hola, ${s.first_name}.` : "Hola."} Esta es tu selección.</p>
      </section>
      <div className="prive-divider mb-12" />
      <div className="mb-14">
        <PriveCatalogSlot />
      </div>
      <section aria-labelledby="prive-collections">
        <h2 id="prive-collections" className="text-2xl sm:text-3xl mb-6">Las colecciones</h2>
        <UniverseTiles />
      </section>
      <div className="flex flex-wrap justify-center gap-3 mt-14">
        <Link to="/prive/membresia" className="prive-btn prive-btn-ghost">Mi membresía</Link>
        <button type="button" className="prive-btn prive-btn-ghost" onClick={async () => { await lock(); navigate("/prive", { replace: true }); }}>
          Cerrar Privé
        </button>
      </div>
    </motion.div>
  );
}

export default function PriveHub() {
  const { loading, status, statusError, view, refresh, call, patchStatus } = usePriveAccess();
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

  if (loading && !status) {
    return <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando IATOS Privé"><Monogram size={56} className="opacity-60" /></div>;
  }
  if (!status) {
    return (
      <Center label="Error">
        <h1 className="text-2xl mb-3">No pudimos cargar Privé</h1>
        <p className="prive-muted mb-6">{messageFor(statusError)}</p>
        <button type="button" onClick={() => void refresh()} className="prive-btn prive-btn-ghost">Reintentar</button>
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
      {view === "unlocked" && <UnlockedHub s={status} />}
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
