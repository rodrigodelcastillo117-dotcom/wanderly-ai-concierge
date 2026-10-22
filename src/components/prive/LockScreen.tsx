import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { Monogram } from "@/components/prive/Monogram";
import { usePriveMotion } from "@/components/prive/motion";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { formatLockedUntil, messageFor } from "@/lib/priveCopy";
import { PRIVE_PW_MAX } from "@/lib/privePassword";
import { PriveUsernameField } from "@/components/prive/PriveUsernameField";

/** Candado de Privé: la contraseña individual abre una sesión Privé que el servidor emite y vigila. */
export function LockScreen({ onUnlocked }: { onUnlocked?: () => void }) {
  const { unlock, status, notice, clearNotice } = usePriveAccess();
  const { rise, reduce } = usePriveMotion();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hard, setHard] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const statusLock = formatLockedUntil(status?.locked_until);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    clearNotice();
    const r = await unlock(pw);
    setBusy(false);
    if (r.ok) {
      setPw("");
      onUnlocked?.();
      return;
    }
    if (r.code === "LOCKED" || r.code === "RATE_LIMITED") {
      const when = formatLockedUntil(r.lockedUntil);
      setError(when ? `${messageFor(r.code)} Podrás intentarlo de nuevo ${when}.` : messageFor(r.code));
    } else {
      setHard(r.code === "HARD_LOCKED" || r.code === "MUST_RESET");
      setError(messageFor(r.code));
      if (r.code === "WRONG_PASSWORD") setWrongCount((n) => n + 1);
    }
    setPw("");
    inputRef.current?.focus();
  };

  return (
    <motion.section {...rise()} className="max-w-md mx-auto px-4 py-16 sm:py-24 text-center" aria-labelledby={`${id}-t`} data-motion={reduce ? "reduced" : "full"}>
      <Monogram size={84} className="mx-auto mb-8" />
      <p className="prive-eyebrow mb-3">IATOS Privé</p>
      <h1 id={`${id}-t`} className="text-3xl sm:text-4xl mb-3">Tu acceso personal</h1>
      <p className="prive-muted text-sm mb-8">
        Escribe tu contraseña Privé. Es solo tuya y distinta de la de tu cuenta IATOS.
      </p>
      {notice && <p role="status" className="text-sm prive-champagne mb-5">{notice}</p>}
      {statusLock && !error && (
        <p role="status" className="text-sm prive-champagne mb-5">Por seguridad pausamos los intentos. Podrás intentarlo de nuevo {statusLock}.</p>
      )}
      <form onSubmit={submit} className="space-y-4 text-left" noValidate>
        <PriveUsernameField />
        <label htmlFor={`${id}-pw`} className="block text-sm prive-champagne">Contraseña Privé</label>
        <div className="relative">
          <input
            ref={inputRef}
            id={`${id}-pw`}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            className="prive-input pr-12"
            value={pw}
            maxLength={PRIVE_PW_MAX * 2}
            onChange={(e) => { setPw(e.target.value); setError(null); }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center prive-muted"
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={show}
          >
            {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
        {error && <p id={`${id}-err`} role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
        {wrongCount > 0 && (
          <p className="text-xs prive-muted" data-testid="prive-autofill-hint">
            Si tu navegador llenó el campo solo, puede ser la contraseña de tu cuenta IATOS: bórrala y escribe tu contraseña Privé (la que creaste al aceptar la invitación).
          </p>
        )}
        <button type="submit" disabled={!pw || busy} className="prive-btn prive-btn-gold w-full">
          {busy ? "Verificando…" : "Ingresar"}
        </button>
      </form>
      <p className="mt-6 text-sm">
        <Link to="/prive/restablecer" className={hard ? "prive-btn prive-btn-ghost" : "prive-link"}>
          ¿Olvidaste tu contraseña Privé?
        </Link>
      </p>
    </motion.section>
  );
}
