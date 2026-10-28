// /prive/restablecer — restablecer la contraseña Privé.
//   · sin token: pide el enlace por correo (prive-access → request_reset; vence en 30 min)
//   · con token (#t=…, ya quitado de la URL al arrancar): crea la contraseña nueva (complete_reset)
// El servidor cierra todas las sesiones Privé al restablecer; aquí también se borra la local.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { PasswordCreator } from "@/components/prive/PasswordCreator";
import { ReportCompromised } from "@/components/prive/ReportCompromised";
import { maskEmail, messageFor } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { capturePriveTokenFromUrl, clearPendingToken, clearPriveSession, readPendingToken } from "@/lib/priveSession";

export default function PriveReset() {
  const { user } = useAuth();
  const { call, refresh, adoptSession, status } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const t = usePriveT();
  const lang = usePriveLang();
  const T = t.reset;
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"request" | "sent" | "form" | "done" | "invalid" | "no_password">("request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    capturePriveTokenFromUrl();
    const t = readPendingToken("reset");
    setToken(t);
    setPhase(t ? "form" : "request");
  }, []);

  const request = async () => {
    setBusy(true);
    setError(null);
    const r = await call("request_reset");
    setBusy(false);
    if (r.ok) setPhase("sent");
    // El servidor confirma que no hay contraseña (p. ej. el estado aún no cargaba): misma salida útil.
    else if (r.code === "NO_PASSWORD") setPhase("no_password");
    else setError(messageFor(r.code, lang));
  };

  const complete = async (pw: string) => {
    if (!token) return { ok: false as const, code: "RESET_INVALID" as const };
    const r = await call<{ prive_session?: string; expires_at?: string; remember?: boolean }>("complete_reset", { token, new_password: pw });
    if (r.ok) {
      // Las sesiones anteriores se cerraron; si el servidor ya abrió una con la contraseña nueva, se usa.
      clearPriveSession();
      if (r.data.prive_session) adoptSession(r.data.prive_session, r.data.expires_at ?? new Date(Date.now() + 12 * 3600e3).toISOString(), r.data.remember === true);
    }
    if (!r.ok && r.code === "RESET_INVALID") {
      clearPendingToken("reset");
      setToken(null);
      setPhase("invalid");
    }
    return r;
  };

  const done = () => {
    clearPendingToken("reset");
    setToken(null);
    setPhase("done");
    void refresh();
  };

  const masked = maskEmail(user?.email);
  // P1-2 (auditoría 28-oct): sin contraseña Privé no hay nada que restablecer. Antes se ofrecía el
  // formulario y "Reportar contraseña comprometida" y todo terminaba en "créala desde tu invitación"
  // aunque la cuenta no tuviera invitación. Con el estado del servidor se muestra la salida útil.
  const view = phase === "request" && status && !status.has_password ? "no_password" : phase;
  const invited = !!status && (status.membership_status === "invited" || status.invitation_pending
    || (status.membership_status === "active" && !status.has_password));

  return (
    <motion.section {...rise()} className="max-w-md mx-auto px-4 py-12 sm:py-20" aria-labelledby="prive-reset-title" data-motion={reduce ? "reduced" : "full"}>
      <Monogram size={56} className="mb-6" />
      <p className="prive-eyebrow mb-3">IATOS Privé</p>
      <h1 id="prive-reset-title" className="text-3xl sm:text-4xl mb-4">
        {view === "done" ? T.done : T.title}
      </h1>

      {view === "no_password" && (
        <div className="space-y-5" role="status" data-testid="prive-reset-no-password">
          <p className="prive-serif text-2xl prive-champagne">{T.noPasswordTitle}</p>
          <p className="text-sm prive-muted">{T.noPasswordBody}</p>
          {invited && <p className="text-sm prive-champagne">{T.noPasswordInvited}</p>}
          <div className="flex flex-wrap gap-3">
            {invited
              ? <Link to="/prive/invitacion" className="prive-btn prive-btn-gold">{T.openInvitation}</Link>
              : null}
            <Link to="/prive" className={`prive-btn ${invited ? "prive-btn-ghost" : "prive-btn-gold"}`}>{T.seeStatus}</Link>
          </div>
        </div>
      )}

      {view === "request" && (
        <div className="space-y-5">
          <p className="text-sm prive-muted">{T.requestBody(masked)}</p>
          {error && <p role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <button type="button" onClick={request} disabled={busy} className="prive-btn prive-btn-gold w-full sm:w-auto">
            {busy ? t.common.sending : T.send}
          </button>
        </div>
      )}

      {view === "sent" && (
        <div className="space-y-4" role="status">
          <p className="text-sm prive-champagne">{T.sentBody(masked)}</p>
          <p className="text-sm prive-muted">{T.notArriving}</p>
        </div>
      )}

      {view === "form" && (
        <PasswordCreator
          onChosen={complete}
          onComplete={done}
          submitLabel={T.saveNew}
          intro={<p className="text-sm prive-muted">{T.formIntro}</p>}
        />
      )}

      {view === "invalid" && (
        <div className="space-y-5">
          <p role="alert" className="text-sm prive-champagne">{messageFor("RESET_INVALID", lang)}</p>
          <button type="button" onClick={() => setPhase("request")} className="prive-btn prive-btn-gold">{T.requestNew}</button>
        </div>
      )}

      {view === "done" && (
        <div className="space-y-5" role="status">
          <p className="text-sm prive-champagne">{T.changed}</p>
          <Link to="/prive" className="prive-btn prive-btn-gold">{T.enter}</Link>
        </div>
      )}

      {(view === "request" || view === "sent") && (
        <div className="mt-12 pt-8 border-t border-[color:var(--pv-line)]">
          <ReportCompromised />
        </div>
      )}
    </motion.section>
  );
}
