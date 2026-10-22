import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { clearPriveSession } from "@/lib/priveSession";
import { messageFor } from "@/lib/priveCopy";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";

/**
 * "Alguien más conoce mi contraseña Privé": el servidor la invalida, cierra todas las sesiones Privé
 * y pide crear una nueva con un enlace al correo. No necesita sesión Privé (justo cuando podría estar en riesgo).
 */
export function ReportCompromised() {
  const { call, refresh } = usePriveAccess();
  const t = usePriveT();
  const lang = usePriveLang();
  const R = t.compromised;
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
    } else setError(messageFor(r.code, lang));
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm prive-champagne">
        <ShieldAlert className="w-4 h-4 prive-gold" aria-hidden="true" /> {R.question}
      </p>
      {step === "idle" && (
        <button type="button" onClick={() => setStep("confirm")} className="prive-btn prive-btn-ghost">{R.report}</button>
      )}
      {step === "confirm" && (
        <div className="space-y-3" role="group" aria-label={R.confirmAria}>
          <p className="text-sm prive-muted">{R.confirmBody}</p>
          {error && <p role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={report} disabled={busy} className="prive-btn prive-btn-gold">{busy ? t.common.sending : R.yes}</button>
            <button type="button" onClick={() => setStep("idle")} className="prive-btn prive-btn-ghost">{t.common.cancel}</button>
          </div>
        </div>
      )}
      {step === "done" && (
        <p role="status" className="text-sm prive-champagne">
          {R.done}{" "}
          {emailed ? R.emailed : R.askEmail}
        </p>
      )}
    </div>
  );
}
