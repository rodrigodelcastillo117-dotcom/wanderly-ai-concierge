import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { clearPriveSession } from "@/lib/priveSession";
import { messageFor } from "@/lib/priveCopy";

/**
 * "Alguien más conoce mi contraseña Privé": el servidor la invalida, cierra todas las sesiones Privé
 * y pide crear una nueva con un enlace al correo. No necesita sesión Privé (justo cuando podría estar en riesgo).
 */
export function ReportCompromised() {
  const { call, refresh } = usePriveAccess();
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  const report = async () => {
    setBusy(true);
    setError(null);
    const r = await call<{ email?: string }>("report_compromised");
    setBusy(false);
    if (r.ok) {
      clearPriveSession();
      setEmailed(r.data.email === "sent");
      setStep("done");
      void refresh();
    } else setError(messageFor(r.code));
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm prive-champagne">
        <ShieldAlert className="w-4 h-4 prive-gold" aria-hidden="true" /> ¿Crees que alguien más conoce tu contraseña Privé?
      </p>
      {step === "idle" && (
        <button type="button" onClick={() => setStep("confirm")} className="prive-btn prive-btn-ghost">Reportar contraseña comprometida</button>
      )}
      {step === "confirm" && (
        <div className="space-y-3" role="group" aria-label="Confirmar reporte">
          <p className="text-sm prive-muted">
            Bloquearemos tu contraseña Privé actual y cerraremos todas tus sesiones Privé. Para volver a entrar crearás una nueva
            con un enlace a tu correo. Tu cuenta IATOS no cambia.
          </p>
          {error && <p role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={report} disabled={busy} className="prive-btn prive-btn-gold">{busy ? "Enviando…" : "Sí, bloquearla"}</button>
            <button type="button" onClick={() => setStep("idle")} className="prive-btn prive-btn-ghost">Cancelar</button>
          </div>
        </div>
      )}
      {step === "done" && (
        <p role="status" className="text-sm prive-champagne">
          Listo. Bloqueamos tu contraseña Privé y cerramos tus sesiones.{" "}
          {emailed ? "Te enviamos a tu correo un enlace para crear una nueva." : "Para crear una nueva, pide el enlace a tu correo."}
        </p>
      )}
    </div>
  );
}
