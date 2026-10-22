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
import { capturePriveTokenFromUrl, clearPendingToken, clearPriveSession, readPendingToken } from "@/lib/priveSession";

export default function PriveReset() {
  const { user } = useAuth();
  const { call, refresh } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"request" | "sent" | "form" | "done" | "invalid">("request");
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
    else setError(messageFor(r.code));
  };

  const complete = async (pw: string) => {
    if (!token) return { ok: false as const, code: "RESET_INVALID" as const };
    const r = await call("complete_reset", { token, new_password: pw });
    if (!r.ok && r.code === "RESET_INVALID") {
      clearPendingToken("reset");
      setToken(null);
      setPhase("invalid");
    }
    return r;
  };

  const done = () => {
    clearPendingToken("reset");
    clearPriveSession();
    setToken(null);
    setPhase("done");
    void refresh();
  };

  const masked = maskEmail(user?.email);

  return (
    <motion.section {...rise()} className="max-w-md mx-auto px-4 py-12 sm:py-20" aria-labelledby="prive-reset-title" data-motion={reduce ? "reduced" : "full"}>
      <Monogram size={56} className="mb-6" />
      <p className="prive-eyebrow mb-3">IATOS Privé</p>
      <h1 id="prive-reset-title" className="text-3xl sm:text-4xl mb-4">
        {phase === "done" ? "Listo" : "Restablecer tu contraseña Privé"}
      </h1>

      {phase === "request" && (
        <div className="space-y-5">
          <p className="text-sm prive-muted">
            Te enviaremos un enlace a tu correo de IATOS{masked ? ` (${masked})` : ""}. Vence en 30 minutos y solo funciona con esta
            cuenta. Tu contraseña de IATOS no cambia.
          </p>
          {error && <p role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <button type="button" onClick={request} disabled={busy} className="prive-btn prive-btn-gold w-full sm:w-auto">
            {busy ? "Enviando…" : "Enviarme el enlace"}
          </button>
        </div>
      )}

      {phase === "sent" && (
        <div className="space-y-4" role="status">
          <p className="text-sm prive-champagne">
            Si tu membresía Privé está activa, te enviamos el enlace a tu correo{masked ? ` (${masked})` : ""}. Ábrelo en este mismo dispositivo
            en los próximos 30 minutos.
          </p>
          <p className="text-sm prive-muted">¿No llega? Revisa la carpeta de spam o vuelve a pedirlo en unos minutos.</p>
        </div>
      )}

      {phase === "form" && (
        <PasswordCreator
          onChosen={complete}
          onComplete={done}
          submitLabel="Guardar contraseña nueva"
          intro={<p className="text-sm prive-muted">Elige una contraseña Privé nueva. Al guardarla cerraremos tus sesiones Privé abiertas.</p>}
        />
      )}

      {phase === "invalid" && (
        <div className="space-y-5">
          <p role="alert" className="text-sm prive-champagne">{messageFor("RESET_INVALID")}</p>
          <button type="button" onClick={() => setPhase("request")} className="prive-btn prive-btn-gold">Pedir un enlace nuevo</button>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-5" role="status">
          <p className="text-sm prive-champagne">Tu contraseña Privé cambió. Por seguridad cerramos tus sesiones Privé abiertas.</p>
          <Link to="/prive" className="prive-btn prive-btn-gold">Entrar a IATOS Privé</Link>
        </div>
      )}

      {(phase === "request" || phase === "sent") && (
        <div className="mt-12 pt-8 border-t border-[color:var(--pv-line)]">
          <ReportCompromised />
        </div>
      )}
    </motion.section>
  );
}
