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
import { SUPPORT_EMAIL, formatDate, messageFor } from "@/lib/priveCopy";
import type { PriveText } from "@/lib/priveI18n";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
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

function statusText(view: PriveView | null, s: PriveStatus, t: PriveText): string {
  const S = t.membership.status;
  switch (view) {
    case "paused_pro": return S.paused_pro;
    case "paused_tenure": return S.paused_tenure(s.tenure_days, s.required_days);
    case "revoked": return S.revoked;
    case "must_reset": return S.must_reset;
    default: return S.active;
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
  const { call, adoptSession } = usePriveAccess();
  const M = usePriveT().membership;
  const [old, setOld] = useState("");
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (done) return <p role="status" className="text-sm prive-champagne">{M.changed}</p>;
  if (!open) return <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setOpen(true)}>{M.changePassword}</button>;
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={id} className="block text-sm prive-champagne mb-2">{M.currentPassword}</label>
        <div className="relative">
          <input id={id} type={show ? "text" : "password"} autoComplete="current-password" className="prive-input pr-12" value={old} onChange={(e) => setOld(e.target.value)} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? M.hidePassword : M.showPassword} aria-pressed={show}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center prive-muted">
            {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <PasswordCreator
        submitLabel={M.saveNew}
        onChosen={async (pw) => {
          if (!old) return { ok: false, code: "WRONG_PASSWORD" };
          const r = await call<{ prive_session?: string; expires_at?: string }>("change_password", { old_password: old, new_password: pw }, { withSession: true });
          // Con la contraseña nueva el servidor abre otra sesión Privé; la anterior ya no vale.
          if (r.ok && r.data.prive_session) adoptSession(r.data.prive_session, r.data.expires_at ?? new Date(Date.now() + 12 * 3600e3).toISOString());
          return r;
        }}
        onComplete={() => { setOld(""); setDone(true); }}
      />
    </div>
  );
}

export default function PriveMembership() {
  const { loading, status, statusError, view, unlocked, call, refresh, patchStatus } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const t = usePriveT();
  const lang = usePriveLang();
  const M = t.membership;
  const navigate = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !status) {
    return <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label={M.loading}><Monogram size={56} className="opacity-60" /></div>;
  }
  if (!status) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl mb-3">{M.loadError}</h1>
        <p className="prive-muted mb-6">{messageFor(statusError, lang)}</p>
        <button type="button" onClick={() => void refresh()} className="prive-btn prive-btn-ghost">{t.common.retry}</button>
      </div>
    );
  }

  const hasMembership = status.membership_status === "active";
  if (!hasMembership) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Monogram size={64} className="mx-auto mb-6" />
        <h1 className="text-3xl mb-3">{M.noneTitle}</h1>
        <p className="prive-muted mb-8">{M.noneBody}</p>
        <Link to="/prive" className="prive-btn prive-btn-gold">{M.seeStatus}</Link>
      </div>
    );
  }

  const revokeAll = async () => {
    setBusy(true);
    const r = await call("revoke_sessions", {}, { withSession: true });
    setBusy(false);
    if (r.ok) {
      clearPriveSession();
      setMsg(M.closedAll);
      void refresh();
    } else setMsg(messageFor(r.code, lang));
  };

  const setConsent = async (v: boolean) => {
    const next = onboardingProgress(status.onboarding, status.onboarding.step ?? 0, { dna_consent: v });
    const r = await call("save_progress", { onboarding: next }, { withSession: true });
    if (r.ok) patchStatus({ onboarding: next });
    setMsg(r.ok ? (v ? M.dnaOn : M.dnaOff) : messageFor(r.code, lang));
  };

  const basis = status.basis === "grant" ? M.basisGrant : M.basisTenure;
  const consent = status.onboarding.dna_consent;

  return (
    <motion.div {...rise()} className="max-w-3xl mx-auto px-4 sm:px-6 pb-24" data-motion={reduce ? "reduced" : "full"}>
      <header className="text-center py-10">
        <p className="prive-eyebrow mb-3">IATOS Privé</p>
        <h1 className="text-3xl sm:text-5xl">{M.title}</h1>
      </header>

      <div className="flex justify-center mb-10">
        <MemberCard firstName={status.first_name} status={cardStatus(view)} activatedAt={status.activated_at} memberCode={status.member_code} />
      </div>

      {msg && <p role="status" className="text-center text-sm prive-champagne mb-6">{msg}</p>}

      <div className="space-y-5">
        <Section title={M.sState}>
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><dt className="prive-muted">{M.dtMembership}</dt><dd className="prive-champagne" data-testid="prive-membership-status">{statusText(view, status, t)}</dd></div>
            <div><dt className="prive-muted">{M.dtBasis}</dt><dd className="prive-champagne">{basis}</dd></div>
            <div><dt className="prive-muted">{M.dtSince}</dt><dd className="prive-champagne">{formatDate(status.activated_at, lang) ?? "—"}</dd></div>
            {/* Sin PRO vigente el servidor no calcula la antigüedad (devuelve 0): no se muestra un 0 engañoso. */}
            {status.is_pro && <div><dt className="prive-muted">{M.dtDays}</dt><dd className="prive-champagne">{status.tenure_days}</dd></div>}
          </dl>
        </Section>

        {view === "locked" || view === "must_reset" ? (
          <Section title={M.sPasswordSessions}>
            {view === "locked" ? (
              <>
                <p className="text-sm prive-muted">{M.enterFirst}</p>
                <LockScreen />
              </>
            ) : (
              <Link to="/prive/restablecer" className="prive-btn prive-btn-gold">{M.createNew}</Link>
            )}
            <ReportCompromised />
          </Section>
        ) : unlocked ? (
          <>
            <Section title={M.sPassword}>
              <ChangePassword />
              <p className="text-sm"><Link to="/prive/restablecer" className="prive-link">{M.forgot}</Link></p>
              <ReportCompromised />
            </Section>
            <Section title={M.sSessions}>
              <p className="text-sm prive-muted">{M.sessionsBody}</p>
              <button type="button" onClick={revokeAll} disabled={busy} className="prive-btn prive-btn-ghost">
                {busy ? M.closing : M.closeAll}
              </button>
            </Section>
            <Section title={M.sPrefs}>
              <p className="text-sm prive-muted">{M.prefsBody}</p>
              <div role="group" aria-label={t.onboarding.consentGroup} className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={consent === true} onClick={() => void setConsent(true)} className={`prive-btn ${consent === true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>{M.yes}</button>
                <button type="button" aria-pressed={consent !== true} onClick={() => void setConsent(false)} className={`prive-btn ${consent !== true ? "prive-btn-gold" : "prive-btn-ghost"} normal-case tracking-normal text-sm`}>{M.no}</button>
              </div>
              <p className="text-sm"><Link to="/dashboard/perfil" className="prive-link">{M.editDna}</Link></p>
            </Section>
            <Section title={M.sWelcome}>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="prive-btn prive-btn-ghost" onClick={() => navigate("/prive", { state: { replayWelcome: true } })}>{M.replayWelcome}</button>
                <button type="button" className="prive-btn prive-btn-ghost" onClick={() => navigate("/prive", { state: { replayOnboarding: true } })}>{M.replayGuide}</button>
              </div>
            </Section>
          </>
        ) : null}

        <Section title={M.sTerms}>
          <ul className="text-sm space-y-2 prive-muted">
            {M.termsList.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="text-sm flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/terminos" className="prive-link">{M.terms}</Link>
            <Link to="/privacidad" className="prive-link">{M.privacy}</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="prive-link">{M.help}: {SUPPORT_EMAIL}</a>
          </p>
        </Section>
      </div>
    </motion.div>
  );
}
