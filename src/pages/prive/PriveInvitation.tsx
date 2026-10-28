// /prive/invitacion — la ceremonia "The 90-Day Invitation".
//   1 The Arrival      negro, el monograma aparece y una línea de luz champaña cruza el centro
//   2 The Invitation   el sobre digital y el botón "OPEN INVITATION"
//   3 The Reveal       el sobre se abre: "WELCOME, <NOMBRE>." / "YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED."
//                      (solo después de que el servidor aceptó la invitación)
//   4 Personal Access  contraseña Privé (elegida o generada una vez) y la tarjeta de miembro
//   5 Enter            "ENTER IATOS PRIVÉ"
// El token del enlace (#t=…) ya se quitó de la URL al arrancar la app (priveSession.ts) y solo vive
// en sessionStorage; es un puntero, no una autoridad: el servidor exige que la sesión sea del dueño.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { EASE, usePriveMotion } from "@/components/prive/motion";
import { Monogram } from "@/components/prive/Monogram";
import { Envelope } from "@/components/prive/Envelope";
import { MemberCard } from "@/components/prive/MemberCard";
import { PasswordCreator } from "@/components/prive/PasswordCreator";
import { pickPassphrase } from "@/lib/privePassword";
import { SUPPORT_EMAIL, messageFor } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { capturePriveTokenFromUrl, clearPendingToken, readPendingToken } from "@/lib/priveSession";
import { invitationStart, shouldProbeInvitationOwner, type InvitationMessageKind } from "@/lib/priveView";
import { CEREMONY_TIMINGS } from "@/components/prive/timings";
import type { PriveResult, PriveStatus } from "@/lib/priveApi";

type Scene = "loading" | "arrival" | "invitation" | "reveal" | "access" | "card" | "message";

// linkOnly: la invitación solo se abre con el enlace del correo (concesión, N-02): no se ofrece "Abrir ahora".
type Message = { kind: InvitationMessageKind; emailSent?: boolean; linkOnly?: boolean };


export default function PriveInvitation() {
  const { signOut } = useAuth();
  const { status, statusError, loading, call, refresh, unlock, adoptSession } = usePriveAccess();
  const { reduce, fade, rise, scene: sceneAnim } = usePriveMotion();
  const t = usePriveT();
  const lang = usePriveLang();
  const I = t.invitation;
  const C = t.ceremony;
  const navigate = useNavigate();
  const [scene, setScene] = useState<Scene>("loading");
  const [message, setMessage] = useState<Message | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [showEnter, setShowEnter] = useState(false);
  const decided = useRef(false);
  const tokenRef = useRef<string | null>(null);

  // Respaldo: si se llegó aquí con #t=… por navegación interna, también se quita de la URL.
  useEffect(() => {
    capturePriveTokenFromUrl();
    tokenRef.current = readPendingToken("invite");
  }, []);

  // Escena inicial según el estado del servidor (una sola vez).
  useEffect(() => {
    if (decided.current) return;
    if (status) {
      decided.current = true;
      const d = invitationStart(status);
      if (d.scene === "access") setResumed(true);
      if (shouldProbeInvitationOwner(d.message?.kind, !!tokenRef.current)) {
        // Enlace reenviado: primero se pregunta de quién es (no se activa nada sin derecho vigente).
        void call("accept_invitation", { token: tokenRef.current }).then((r) => {
          const other = !r.ok && r.code === "INVITATION_OTHER_ACCOUNT";
          if (other) clearPendingToken("invite");
          setMessage(other ? { kind: "INVITATION_OTHER_ACCOUNT" } : d.message ?? null);
          setScene("message");
        });
        return;
      }
      setMessage(d.message ?? null);
      setScene(d.scene);
    } else if (!loading && statusError) {
      decided.current = true;
      setMessage({ kind: "STATUS_ERROR" });
      setScene("message");
    }
  }, [status, statusError, loading, call]);

  // 1 → 2 automático; siempre se puede saltar.
  useEffect(() => {
    if (scene !== "arrival") return;
    const t = window.setTimeout(() => setScene("invitation"), reduce ? CEREMONY_TIMINGS.arrivalReduced : CEREMONY_TIMINGS.arrival);
    return () => window.clearTimeout(t);
  }, [scene, reduce]);

  useEffect(() => {
    if (scene !== "reveal") return;
    setShowContinue(reduce);
    if (reduce) return;
    const t = window.setTimeout(() => setShowContinue(true), CEREMONY_TIMINGS.revealButton);
    return () => window.clearTimeout(t);
  }, [scene, reduce]);

  useEffect(() => {
    if (scene !== "card") return;
    setShowEnter(reduce);
    if (reduce) return;
    const t = window.setTimeout(() => setShowEnter(true), CEREMONY_TIMINGS.enterButton);
    return () => window.clearTimeout(t);
  }, [scene, reduce]);

  const openInvitation = async () => {
    if (waiting) return;
    setWaiting(true);
    setInlineError(null);
    const token = tokenRef.current;
    const r = await call("accept_invitation", token ? { token } : {});
    setWaiting(false);
    if (r.ok) {
      clearPendingToken("invite");
      tokenRef.current = null;
      await refresh();
      setScene("reveal");
      return;
    }
    if (["INVITATION_OTHER_ACCOUNT", "INVITATION_EXPIRED", "INVITATION_LINK_REQUIRED", "NO_INVITATION", "NOT_PRO", "NOT_ELIGIBLE"].includes(r.code)) {
      if (r.code === "INVITATION_OTHER_ACCOUNT") clearPendingToken("invite");
      setMessage({ kind: r.code });
      setScene("message");
      return;
    }
    setInlineError(messageFor(r.code, lang));
  };

  const resend = async () => {
    setWaiting(true);
    const r = await call<{ email?: string }>("resend_invitation");
    setWaiting(false);
    if (r.ok) {
      // La invitación vieja ya no sirve; la nueva se abre sin token (el servidor la busca por usuario).
      clearPendingToken("invite");
      tokenRef.current = null;
      setMessage({
        kind: "RESENT",
        emailSent: r.data.email === "sent",
        linkOnly: message?.linkOnly === true || message?.kind === "INVITATION_LINK_REQUIRED",
      });
    } else {
      setInlineError(messageFor(r.code, lang));
    }
  };

  // La contraseña recién creada abre la primera sesión Privé (si el servidor no la emitió ya).
  const startSession = async (r: PriveResult, password: string | null) => {
    if (!r.ok) return;
    const d = r.data as { prive_session?: unknown; expires_at?: unknown; remember?: unknown };
    if (typeof d.prive_session === "string" && d.prive_session) {
      adoptSession(d.prive_session, typeof d.expires_at === "string" ? d.expires_at : new Date(Date.now() + 12 * 3600e3).toISOString(), d.remember === true);
    } else if (password) {
      await unlock(password);
    }
  };

  const onChosen = async (password: string) => {
    const r = await call("set_password", { password });
    if (!r.ok && r.code === "PASSWORD_ALREADY_SET") {
      setMessage({ kind: "PASSWORD_ALREADY_SET" });
      setScene("message");
      return r;
    }
    await startSession(r, password);
    return r;
  };

  const onGenerate = async () => {
    const r = await call<{ generated_password?: string }>("set_password", { generate: true });
    if (!r.ok && r.code === "PASSWORD_ALREADY_SET") {
      setMessage({ kind: "PASSWORD_ALREADY_SET" });
      setScene("message");
      return r;
    }
    if (r.ok) await startSession(r, pickPassphrase(r.data));
    return r;
  };

  const onPasswordDone = () => {
    void refresh();
    setScene("card");
  };

  const firstName = status?.first_name ?? null;

  return (
    <div className="relative min-h-screen min-h-[100dvh] flex flex-col overflow-hidden" data-scene={scene} data-motion={reduce ? "reduced" : "full"}>
      <div className="absolute top-0 right-0 z-20 pt-[max(env(safe-area-inset-top),0.75rem)] pr-3 flex gap-1">
        {scene === "arrival" && (
          <button type="button" onClick={() => setScene("invitation")} className="min-h-[44px] px-4 text-xs tracking-[0.28em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
            {t.common.skip}
          </button>
        )}
        <Link to="/dashboard" aria-label={I.exitAria} className="w-11 h-11 flex items-center justify-center prive-muted hover:text-[color:var(--pv-champagne)]">
          <X className="w-5 h-5" aria-hidden="true" />
        </Link>
      </div>

      <AnimatePresence mode="wait">
        {scene === "loading" && (
          <motion.div key="loading" {...sceneAnim()} className="flex-1 flex items-center justify-center" role="status" aria-label={I.preparing}>
            <Monogram size={48} className="opacity-40" />
          </motion.div>
        )}

        {scene === "arrival" && (
          <motion.section key="arrival" {...sceneAnim()} className="flex-1 flex flex-col items-center justify-center relative" aria-label={I.arrival}>
            <motion.div {...fade(0.3, 1.6)}>
              <Monogram size={112} draw reduce={reduce} title="IATOS Privé" />
            </motion.div>
            <motion.div
              className="prive-lightline absolute left-0 right-0 top-1/2"
              aria-hidden="true"
              initial={reduce ? { opacity: 0 } : { scaleX: 0, opacity: 0 }}
              animate={reduce ? { opacity: 0.8 } : { scaleX: 1, opacity: [0, 1, 0.7] }}
              transition={reduce ? { duration: 0.08 } : { duration: 2.2, delay: 0.9, ease: EASE }}
              style={{ transformOrigin: "center" }}
            />
            <motion.p {...fade(1.8, 1.2)} className="prive-eyebrow mt-28">{C.brand}</motion.p>
          </motion.section>
        )}

        {(scene === "invitation" || scene === "reveal") && (
          <motion.section key="envelope" {...sceneAnim()} className="flex-1 flex flex-col items-center justify-center gap-10 px-4 py-16" aria-label={scene === "reveal" ? I.yourInvitation : I.theInvitation}>
            {scene === "invitation" && (
              <motion.div {...rise(0.1)} className="text-center space-y-2">
                <p className="prive-eyebrow">{C.brand}</p>
                <p className="prive-display text-xl sm:text-2xl prive-champagne">{C.privateInvitation}</p>
              </motion.div>
            )}
            <motion.div {...(reduce ? fade() : { initial: { opacity: 0, y: 30, rotateX: 8 }, animate: { opacity: 1, y: 0, rotateX: 0 }, transition: { duration: 1.4, ease: EASE } })} className={scene === "reveal" ? "mt-24 sm:mt-32" : ""}>
              <Envelope open={scene === "reveal"} reduce={reduce} waiting={waiting}>
                {/* La carta solo existe en el DOM después de que el servidor aceptó la invitación. */}
                {scene === "reveal" && (<>
                <Monogram size={34} ink="#8e7238" />
                <p className="prive-serif text-[clamp(1.15rem,4.6vw,1.6rem)] tracking-[0.12em] mt-2 text-[#1b170f]" data-testid="prive-welcome-name">
                  {firstName ? C.welcomeName(firstName) : C.welcomeAnon}
                </p>
                <p className="text-[clamp(0.55rem,2.2vw,0.7rem)] tracking-[0.22em] mt-2 text-[#5a4a2a]">{C.unlocked}</p>
                </>)}
              </Envelope>
            </motion.div>
            {scene === "invitation" ? (
              <div className="flex flex-col items-center gap-4 min-h-[96px]">
                <motion.button {...rise(0.8)} type="button" onClick={openInvitation} disabled={waiting} className="prive-btn prive-btn-gold" aria-busy={waiting}>
                  {waiting ? I.opening : C.openInvitation}
                </motion.button>
                {inlineError && <p role="alert" className="text-sm text-[#f0b4a8] text-center max-w-sm">{inlineError}</p>}
              </div>
            ) : (
              <div className="min-h-[96px] flex flex-col items-center gap-3">
                <h1 className="sr-only">{firstName ? C.welcomeName(firstName) : C.welcomeAnon} {C.unlocked}</h1>
                {showContinue && (
                  <motion.button {...rise()} type="button" onClick={() => setScene("access")} className="prive-btn prive-btn-ghost" autoFocus>
                    {t.common.continue}
                  </motion.button>
                )}
              </div>
            )}
          </motion.section>
        )}

        {scene === "access" && (
          <motion.section key="access" {...sceneAnim()} className="flex-1 w-full max-w-md mx-auto px-4 py-16 sm:py-20" aria-labelledby="prive-access-title">
            <Monogram size={56} className="mb-6" />
            <p className="prive-eyebrow mb-3">{resumed ? I.resumed : I.personalAccess}</p>
            <h1 id="prive-access-title" className="text-3xl sm:text-4xl mb-3">{I.passwordTitle}</h1>
            <p className="text-sm prive-muted mb-8">{I.passwordBody}</p>
            <PasswordCreator onChosen={onChosen} onGenerate={onGenerate} onComplete={onPasswordDone} submitLabel={I.createPassword} />
          </motion.section>
        )}

        {scene === "card" && (
          <motion.section key="card" {...sceneAnim()} className="flex-1 flex flex-col items-center justify-center gap-8 px-4 py-16" aria-labelledby="prive-card-title">
            <h1 id="prive-card-title" className="sr-only">{I.cardTitle}</h1>
            <MemberCard firstName={firstName} status="active" activatedAt={status?.activated_at ?? null} memberCode={status?.member_code ?? null} reveal />
            <div className="min-h-[56px]">
              {showEnter && (
                <motion.button {...rise()} type="button" onClick={() => navigate("/prive", { replace: true })} className="prive-btn prive-btn-gold" autoFocus>
                  {C.enter}
                </motion.button>
              )}
            </div>
          </motion.section>
        )}

        {scene === "message" && message && (
          <motion.section key={`msg-${message.kind}`} {...sceneAnim()} className="flex-1 flex items-center justify-center px-4 py-16" aria-live="polite">
            <InvitationMessage
              kind={message.kind}
              emailSent={message.emailSent === true}
              linkOnly={message.linkOnly === true}
              status={status}
              busy={waiting}
              error={inlineError}
              onResend={resend}
              onOpenAgain={() => { setInlineError(null); setScene("invitation"); }}
              onSwitchAccount={async () => { await signOut(); navigate("/auth", { replace: true, state: { from: "/prive/invitacion" } }); }}
              onRetry={() => { decided.current = false; setScene("loading"); void refresh(); }}
            />
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function InvitationMessage({ kind, emailSent, linkOnly, status, busy, error, onResend, onOpenAgain, onSwitchAccount, onRetry }: {
  kind: Message["kind"];
  emailSent: boolean;
  linkOnly: boolean;
  status: PriveStatus | null;
  busy: boolean;
  error: string | null;
  onResend: () => void;
  onOpenAgain: () => void;
  onSwitchAccount: () => void;
  onRetry: () => void;
}) {
  const t = usePriveT();
  const lang = usePriveLang();
  const M = t.invitation.msg;
  const msg = (c: Parameters<typeof messageFor>[0]) => messageFor(c, lang);
  const box = (title: string, body: React.ReactNode, actions?: React.ReactNode) => (
    <div className="max-w-md text-center" data-testid={`prive-invite-msg-${kind}`}>
      <Monogram size={64} className="mx-auto mb-8" />
      <h1 className="text-3xl mb-4">{title}</h1>
      <div className="prive-muted text-sm space-y-3 mb-8">{body}</div>
      {error && <p role="alert" className="text-sm text-[#f0b4a8] mb-4">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">{actions}</div>
    </div>
  );
  const toPrive = <Link to="/prive" className="prive-btn prive-btn-gold">{t.common.goPrive}</Link>;
  switch (kind) {
    case "ALREADY_ACTIVE":
      return box(M.alreadyActiveTitle, <p>{M.alreadyActiveBody}</p>, toPrive);
    case "PASSWORD_ALREADY_SET":
      return box(M.passwordSetTitle, <p>{msg("PASSWORD_ALREADY_SET")}</p>, (
        <>
          {toPrive}
          <Link to="/prive/restablecer" className="prive-btn prive-btn-ghost">{M.reset}</Link>
        </>
      ));
    case "INVITATION_OTHER_ACCOUNT":
      return box(M.otherAccountTitle, <p>{msg("INVITATION_OTHER_ACCOUNT")}</p>, (
        <>
          <button type="button" onClick={onSwitchAccount} className="prive-btn prive-btn-gold">{M.switchAccount}</button>
          <Link to="/dashboard" className="prive-btn prive-btn-ghost">{M.backToIatos}</Link>
        </>
      ));
    case "INVITATION_EXPIRED":
      return box(M.expiredTitle, <p>{msg("INVITATION_EXPIRED")}</p>, (
        <button type="button" onClick={onResend} disabled={busy} className="prive-btn prive-btn-gold">{busy ? t.common.sending : M.sendNew}</button>
      ));
    case "INVITATION_LINK_REQUIRED":
      return box(M.linkRequiredTitle, <p>{msg("INVITATION_LINK_REQUIRED")}</p>, (
        <button type="button" onClick={onResend} disabled={busy} className="prive-btn prive-btn-gold">{busy ? t.common.sending : M.sendNew}</button>
      ));
    case "RESENT":
      // Una invitación por concesión solo se abre con el enlace del correo (N-02): sin "Abrir ahora".
      if (linkOnly) return box(M.resentTitle, <p>{M.resentLinkOnly}</p>, toPrive);
      return box(M.resentTitle, <p>{emailSent ? M.resentSent : M.resentReady}</p>, (
        <button type="button" onClick={onOpenAgain} className="prive-btn prive-btn-gold">{M.openNow}</button>
      ));
    case "NO_INVITATION":
      return box(M.noInvitationTitle, <p>{msg("NO_INVITATION")}</p>, (
        <>
          <Link to="/prive" className="prive-btn prive-btn-ghost">{M.seeStatus}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="prive-btn prive-btn-ghost">{M.writeSupport}</a>
        </>
      ));
    case "NOT_PRO":
      return box(M.notProTitle, <p>{msg("NOT_PRO")}</p>, <Link to="/dashboard/pro" className="prive-btn prive-btn-gold">{M.seePlan}</Link>);
    case "NOT_ELIGIBLE":
      return box(M.notEligibleTitle, (
        <>
          {/* P1-1: con PRO de cortesía no se repite la promesa de los 90 días: se dice que no suma. */}
          {status?.pro_basis === "comped" ? (
            <>
              <p className="prive-champagne" data-testid="prive-invitation-comped">{t.tenure.comped.line}.</p>
              <p>{t.tenure.comped.body[0]}</p>
            </>
          ) : (
            <>
              <p>{msg("NOT_ELIGIBLE")}</p>
              {status && <p className="prive-champagne prive-nums">{t.tenure.line(status.tenure_days, status.required_days)}.</p>}
            </>
          )}
        </>
      ), <Link to="/prive" className="prive-btn prive-btn-ghost">{M.seeProgress}</Link>);
    case "REVOKED":
      return box(M.revokedTitle, <p>{M.revokedBody} <a className="prive-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>);
    default:
      return box(M.failedTitle, <p>{msg(kind === "STATUS_ERROR" ? "SERVICE_UNAVAILABLE" : kind)}</p>, (
        <button type="button" onClick={onRetry} className="prive-btn prive-btn-ghost">{t.common.retry}</button>
      ));
  }
}
