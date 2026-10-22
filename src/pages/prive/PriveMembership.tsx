// /prive/membresia — tarjeta digital, estado, contraseña, sesiones, bienvenida, términos y ayuda.
// Ver la tarjeta y el estado no requiere sesión Privé (son datos propios y públicos de prive_status);
// cambiar la contraseña, cerrar sesiones o cambiar preferencias sí (el servidor lo exige).
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { MemberCard, type MemberCardStatus } from "@/components/prive/MemberCard";
import { LockScreen } from "@/components/prive/LockScreen";
import { PasswordCreator } from "@/components/prive/PasswordCreator";
import { ReportCompromised } from "@/components/prive/ReportCompromised";
import { SUPPORT_EMAIL, formatDateEs, messageFor } from "@/lib/priveCopy";
import { onboardingProgress } from "@/lib/priveOnboarding";
import { clearPriveSession } from "@/lib/priveSession";
import type { PriveStatus } from "@/lib/priveApi";
import type { PriveView } from "@/lib/priveView";

function cardStatus(view: PriveView | null): MemberCardStatus {
  if (view === "paused_pro") return "paused_pro";
  if (view === "paused_tenure") return "paused_tenure";
  if (view === "revoked") return "revoked";
  return "active";
}

function statusText(view: PriveView | null, s: PriveStatus): string {
  switch (view) {
    case "paused_pro": return "Pausada porque tu PRO terminó. Al reactivar IATOS PRO vuelve sin repetir los 90 días.";
    case "paused_tenure": return `Pausada: un periodo reembolsado o en disputa dejó de contar (${s.tenure_days} de ${s.required_days} días). Vuelve sola al sumar ${s.required_days}.`;
    case "revoked": return "No activa.";
    case "must_reset": return "Activa · necesitas crear una contraseña Privé nueva.";
    default: return "Activa.";
  }
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="prive-panel p-5 sm:p-7 space-y-4">
      <h2 id={id} className="text-2xl">{title}</h2>
      {children}
    </section>
  );
};

function ChangePassword() {
  const { call } = usePriveAccess();
  const [old, setOld] = useState("");
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (done) return <p role="status" className="text-sm prive-champagne">Listo. Cambiamos tu contraseña Privé.</p>;
  if (!open) return <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setOpen(true)}>Cambiar contraseña</button>;
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={id} className="block text-sm prive-champagne mb-2">Contraseña Privé actual</label>
        <div className="relative">
          <input id={id} type={show ? "text" : "password"} autoComplete="current-password" className="prive-input pr-12" value={old} onChange={(e) => setOld(e.target.value)} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center prive-muted">
            {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <PasswordCreator
        submitLabel="Guardar contraseña nueva"
        onChosen={async (pw) => {
          if (!old) return { ok: false, code: "WRONG_PASSWORD" };
          return call("change_password", { old_password: old, new_password: pw }, { withSession: true });
        }}
        onComplete={() => { setOld(""); setDone(true); }}
      />
    </div>
  );
}

export default function PriveMembership() {
  const { loading, status, statusError, view, unlocked, call, refresh, patchStatus } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !status) {
    return <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando tu membresía"><Monogram size={56} className="opacity-60" /></div>;
  }
  if (!status) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl mb-3">No pudimos cargar tu membresía</h1>
        <p className="prive-muted mb-6">{messageFor(statusError)}</p>
        <button type="button" onClick={() => void refresh()} className="prive-btn prive-btn-ghost">Reintentar</button>
      </div>
    );
  }

  const hasMembership = status.membership_status === "active";
  if (!hasMembership) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Monogram size={64} className="mx-auto mb-6" />
        <h1 className="text-3xl mb-3">Aún no tienes una membresía Privé activa</h1>
        <p className="prive-muted mb-8">En IATOS Privé puedes ver tu estado y cómo se abre tu acceso.</p>
        <Link to="/prive" className="prive-btn prive-btn-gold">Ver mi estado</Link>
      </div>
    );
  }

  const revokeAll = async () => {
    setBusy(true);
    const r = await call("revoke_sessions", {}, { withSession: true });
    setBusy(false);
    if (r.ok) {
      clearPriveSession();
      setMsg("Cerramos todas tus sesiones Privé, también en otros dispositivos.");
      void refresh();
    } else setMsg(messageFor(r.code));
  };

  const setConsent = async (v: boolean) => {
    const next = onboardingProgress(status.onboarding, status.onboarding.step ?? 0, { dna_consent: v });
    const r = await call("save_progress", { onboarding: next }, { withSession: true });
    if (r.ok) patchStatus({ onboarding: next });
    setMsg(r.ok ? (v ? "Usaremos tu Travel DNA para ordenar Privé." : "Ya no usaremos tu Travel DNA en Privé.") : messageFor(r.code));
  };

  const basis = status.basis === "grant" ? "Concesión de IATOS" : "90 días de IATOS PRO pagado";
  const consent = status.onboarding.dna_consent;

  return (
    <motion.div {...rise()} className="max-w-3xl mx-auto px-4 sm:px-6 pb-24" data-motion={reduce ? "reduced" : "full"}>
      <header className="text-center py-10">
        <p className="prive-eyebrow mb-3">IATOS Privé</p>
        <h1 className="text-3xl sm:text-5xl">Tu membresía</h1>
      </header>

      <div className="flex justify-center mb-10">
        <MemberCard firstName={status.first_name} status={cardStatus(view)} activatedAt={status.activated_at} memberCode={status.member_code} />
      </div>

      {msg && <p role="status" className="text-center text-sm prive-champagne mb-6">{msg}</p>}

      <div className="space-y-5">
        <Section title="Estado">
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><dt className="prive-muted">Membresía</dt><dd className="prive-champagne" data-testid="prive-membership-status">{statusText(view, status)}</dd></div>
            <div><dt className="prive-muted">Acceso por</dt><dd className="prive-champagne">{basis}</dd></div>
            <div><dt className="prive-muted">Miembro desde</dt><dd className="prive-champagne">{formatDateEs(status.activated_at) ?? "—"}</dd></div>
            <div><dt className="prive-muted">Días de PRO pagado</dt><dd className="prive-champagne">{status.tenure_days}</dd></div>
          </dl>
        </Section>

        {view === "locked" || view === "must_reset" ? (
          <Section title="Contraseña y sesiones">
            {view === "locked" ? (
              <>
                <p className="text-sm prive-muted">Para cambiar tu contraseña, tus preferencias o cerrar sesiones, primero entra a Privé.</p>
                <LockScreen />
              </>
            ) : (
              <Link to="/prive/restablecer" className="prive-btn prive-btn-gold">Crear una contraseña nueva</Link>
            )}
            <ReportCompromised />
          </Section>
        ) : unlocked ? (
          <>
            <Section title="Contraseña Privé">
              <ChangePassword />
              <p className="text-sm"><Link to="/prive/restablecer" className="prive-link">¿Olvidaste tu contraseña Privé?</Link></p>
              <ReportCompromised />
            </Section>
            <Section title="Sesiones">
              <p className="text-sm prive-muted">Cada sesión Privé dura hasta 12 horas (2 sin actividad) y es solo para este navegador.</p>
              <button type="button" onClick={revokeAll} disabled={busy} className="prive-btn prive-btn-ghost">
                {busy ? "Cerrando…" : "Cerrar todas mis sesiones Privé"}
              </button>
            </Section>
            <Section title="Preferencias">
              <p className="text-sm prive-muted">Usar mi Travel DNA para ordenar lo que veo en Privé.</p>
              <div role="group" aria-label="Usar mi Travel DNA en Privé" className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={consent === true} onClick={() => void setConsent(true)} className={`prive-btn ${consent === true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>Sí</button>
                <button type="button" aria-pressed={consent !== true} onClick={() => void setConsent(false)} className={`prive-btn ${consent !== true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>No</button>
              </div>
              <p className="text-sm"><Link to="/dashboard/perfil" className="prive-link">Editar mi Travel DNA</Link></p>
            </Section>
            <Section title="Bienvenida y guía">
              <div className="flex flex-wrap gap-3">
                <button type="button" className="prive-btn prive-btn-ghost" onClick={() => navigate("/prive", { state: { replayWelcome: true } })}>Ver la bienvenida otra vez</button>
                <button type="button" className="prive-btn prive-btn-ghost" onClick={() => navigate("/prive", { state: { replayOnboarding: true } })}>Ver la guía de inicio</button>
              </div>
            </Section>
          </>
        ) : null}

        <Section title="Términos y ayuda">
          <ul className="text-sm space-y-2 prive-muted">
            <li>IATOS Privé es parte de IATOS PRO: se mantiene mientras tu PRO esté vigente.</li>
            <li>Una recomendación o una solicitud no es una reserva; solo lo es cuando el lugar la confirma.</li>
            <li>Tu contraseña Privé es personal. IATOS nunca te la pedirá por correo, chat o teléfono.</li>
          </ul>
          <p className="text-sm flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/terminos" className="prive-link">Términos</Link>
            <Link to="/privacidad" className="prive-link">Privacidad</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="prive-link">Ayuda: {SUPPORT_EMAIL}</a>
          </p>
        </Section>
      </div>
    </motion.div>
  );
}
