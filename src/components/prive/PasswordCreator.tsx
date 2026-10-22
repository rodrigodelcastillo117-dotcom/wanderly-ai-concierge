import { useId, useMemo, useState } from "react";
import { Check, Circle, Copy, Eye, EyeOff } from "lucide-react";
import { checkPrivePassword, PRIVE_PW_MAX } from "@/lib/privePassword";
import { messageFor } from "@/lib/priveCopy";
import type { PriveResult } from "@/lib/priveApi";

type GenResult = PriveResult<{ passphrase?: string; password?: string; generated?: string }>;

/** La frase generada puede venir como passphrase (contrato) o, por tolerancia, password/generated. */
export const pickPassphrase = (d: { passphrase?: unknown; password?: unknown; generated?: unknown }) =>
  [d.passphrase, d.password, d.generated].find((v): v is string => typeof v === "string" && v.length > 0) ?? null;

/**
 * Crear una contraseña Privé: elegida por la persona (con guía de fuerza, 12–72 caracteres) o una
 * frase generada por el servidor que se muestra UNA sola vez. La frase vive solo en el estado de
 * este componente mientras está en pantalla: no se guarda en ningún almacenamiento y se borra al
 * pulsar "La guardé".
 */
export function PasswordCreator({ onChosen, onGenerate, onComplete, submitLabel = "Crear mi contraseña", intro }: {
  onChosen: (password: string) => Promise<PriveResult>;
  onGenerate?: () => Promise<GenResult>;
  onComplete: () => void;
  submitLabel?: string;
  intro?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"choose" | "generate">("choose");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ids = { pw: useId(), confirm: useId(), rules: useId(), err: useId() };
  const check = useMemo(() => checkPrivePassword(pw, confirm), [pw, confirm]);

  const submitChosen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!check.acceptable || busy) return;
    setBusy(true);
    setError(null);
    const r = await onChosen(pw);
    setBusy(false);
    if (r.ok) {
      setPw("");
      setConfirm("");
      onComplete();
    } else setError(messageFor(r.code));
  };

  const generate = async () => {
    if (!onGenerate || busy) return;
    setBusy(true);
    setError(null);
    const r = await onGenerate();
    setBusy(false);
    if (r.ok) {
      const p = pickPassphrase(r.data);
      if (p) setGenerated(p);
      else setError(messageFor("SERVICE_UNAVAILABLE"));
    } else setError(messageFor(r.code));
  };

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const savedIt = () => {
    setGenerated(null);
    setCopied(false);
    onComplete();
  };

  if (generated) {
    return (
      <div className="space-y-5" data-testid="prive-generated">
        <p className="prive-eyebrow">Tu contraseña Privé</p>
        <output
          aria-label="Contraseña Privé generada"
          className="block prive-panel px-5 py-5 text-center prive-card-code text-lg sm:text-xl break-words prive-champagne select-all"
        >
          {generated}
        </output>
        <p className="text-sm prive-muted" role="note">
          Solo la verás esta vez. Guárdala en tu gestor de contraseñas: IATOS no puede volver a mostrártela y nunca te la
          pedirá por correo ni por teléfono. Si la pierdes, podrás restablecerla desde tu correo.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={copy} className="prive-btn prive-btn-ghost">
            <Copy className="w-4 h-4" aria-hidden="true" /> {copied ? "Copiada" : "Copiar"}
          </button>
          <button type="button" onClick={savedIt} className="prive-btn prive-btn-gold">La guardé</button>
        </div>
        <p aria-live="polite" className="sr-only">{copied ? "Contraseña copiada al portapapeles" : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {intro}
      {onGenerate && (
        <div role="tablist" aria-label="Cómo crear tu contraseña" className="grid grid-cols-2 gap-2 p-1 rounded-full prive-hairline">
          {(["choose", "generate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setError(null); }}
              className={`min-h-[44px] rounded-full text-[13px] transition ${mode === m ? "bg-[rgba(201,169,97,0.16)] prive-champagne" : "prive-muted"}`}
            >
              {m === "choose" ? "Elegir la mía" : "Generar una por mí"}
            </button>
          ))}
        </div>
      )}

      {mode === "choose" ? (
        <form onSubmit={submitChosen} className="space-y-4" noValidate>
          <div>
            <label htmlFor={ids.pw} className="block text-sm prive-champagne mb-2">Contraseña Privé</label>
            <div className="relative">
              <input
                id={ids.pw}
                type={show ? "text" : "password"}
                autoComplete="new-password"
                className="prive-input pr-12"
                value={pw}
                maxLength={PRIVE_PW_MAX * 2}
                onChange={(e) => { setPw(e.target.value); setError(null); }}
                aria-describedby={`${ids.rules} ${error ? ids.err : ""}`.trim()}
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
          </div>
          <div>
            <label htmlFor={ids.confirm} className="block text-sm prive-champagne mb-2">Repítela</label>
            <input
              id={ids.confirm}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              className="prive-input"
              value={confirm}
              maxLength={PRIVE_PW_MAX * 2}
              onChange={(e) => { setConfirm(e.target.value); setError(null); }}
            />
          </div>

          <div id={ids.rules} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 grid grid-cols-4 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1 rounded-full ${pw && check.score >= i ? "bg-[color:var(--pv-gold)]" : "bg-[rgba(201,169,97,0.15)]"}`} />
                ))}
              </div>
              <span className="text-xs prive-champagne min-w-[88px] text-right" aria-live="polite" data-testid="prive-pw-strength">
                {pw ? check.label : "—"}
              </span>
            </div>
            <p className="text-xs prive-muted">{check.bytes} de {PRIVE_PW_MAX} caracteres · los acentos y emojis cuentan doble o más.</p>
            <ul className="space-y-1.5" aria-label="Requisitos de la contraseña">
              {check.rules.map((r) => (
                <li key={r.id} className={`flex items-center gap-2 text-xs ${r.ok ? "prive-champagne" : "prive-muted"}`} data-ok={r.ok}>
                  {r.ok ? <Check className="w-3.5 h-3.5 prive-gold" aria-hidden="true" /> : <Circle className="w-3 h-3" aria-hidden="true" />}
                  <span>{r.label}</span>
                  <span className="sr-only">{r.ok ? "(cumplido)" : "(pendiente)"}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs prive-muted">
              Consejo: una frase de 4 o más palabras que no uses en otro sitio. Es distinta de la contraseña de tu cuenta IATOS.
            </p>
          </div>

          {error && <p id={ids.err} role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <button type="submit" disabled={!check.acceptable || busy} className="prive-btn prive-btn-gold w-full sm:w-auto">
            {busy ? "Guardando…" : submitLabel}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm prive-muted">
            Generamos en el servidor una frase segura de varias palabras. Te la mostraremos una sola vez para que la guardes.
          </p>
          {error && <p role="alert" className="text-sm text-[#f0b4a8]">{error}</p>}
          <button type="button" onClick={generate} disabled={busy} className="prive-btn prive-btn-gold w-full sm:w-auto">
            {busy ? "Generando…" : "Generar mi contraseña"}
          </button>
        </div>
      )}
    </div>
  );
}
