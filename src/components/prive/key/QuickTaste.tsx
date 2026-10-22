// Configuración rápida de gustos (Doc B §3, sin datos): pocas preguntas, con permiso explícito para usarlas.
// Sin permiso, se guardan pero NO ordenan Privé (prive_user_signals respeta dna_consent). Nada sensible.
import { useState } from "react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { usePriveKeyApi } from "@/lib/priveKey";
import type { KeyLang } from "@/lib/priveKeyI18n";
import { __resetForYouCache } from "./useForYouData";

const LOVES: [string, string, string][] = [
  ["alta_cocina", "Alta cocina", "Fine dining"], ["gastronomia", "Comer como local", "Eat like a local"], ["noche", "Noches y coctelería", "Nights & cocktails"],
  ["cultura", "Arte y cultura", "Art & culture"], ["mar", "Mar y playa", "Sea & beach"], ["bienestar", "Bienestar y naturaleza", "Wellness & nature"],
  ["artesania", "Talleres y artesanía", "Workshops & crafts"],
];
const BUDGETS: [string, string, string][] = [["estandar", "Cuidado", "Considered"], ["premium", "Alto", "High"], ["ultra", "Sin límite fijo", "No fixed limit"]];

export function QuickTaste({ lang, onSaved }: { lang: KeyLang; onSaved?: () => void }) {
  const api = usePriveKeyApi();
  const { patchStatus, status } = usePriveAccess();
  const en = lang === "en";
  const [open, setOpen] = useState(false);
  const [loves, setLoves] = useState<string[]>([]);
  const [budget, setBudget] = useState<string | null>(null);
  const [consent, setConsent] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async () => {
    setState("saving");
    try {
      const r = await api.tasteSave({ loves, budget }, consent);
      if (!r.ok) { setState("error"); return; }
      if (status) patchStatus({ onboarding: { ...status.onboarding, dna_consent: consent } });
      __resetForYouCache();
      setState("saved");
      onSaved?.();
    } catch (e) { setState(e instanceof PriveLockedError ? "idle" : "error"); }
  };
  if (state === "saved") return <p className="text-sm prive-champagne" role="status">{en ? "Saved. You can change or reset it anytime in My Privé." : "Guardado. Puedes cambiarlo o restablecerlo cuando quieras en Mi Privé."}</p>;
  if (!open) {
    return (
      <button type="button" className="pk-chip" onClick={() => setOpen(true)} data-testid="pk-taste-open">
        {en ? "Personalise in 3 taps" : "Personalizar en 3 toques"}
      </button>
    );
  }
  return (
    <div className="prive-panel space-y-4 p-4" data-testid="pk-taste">
      <fieldset className="space-y-2">
        <legend className="text-sm">{en ? "What do you enjoy most when you travel?" : "¿Qué disfrutas más al viajar?"}</legend>
        <div className="flex flex-wrap gap-2">
          {LOVES.map(([k, es, enl]) => (
            <button key={k} type="button" className="pk-chip text-xs" aria-pressed={loves.includes(k)}
              onClick={() => setLoves((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))}>{en ? enl : es}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm">{en ? "Your usual budget for an experience" : "Tu presupuesto habitual para una experiencia"}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {BUDGETS.map(([k, es, enl]) => <button key={k} type="button" role="radio" aria-checked={budget === k} className="pk-chip text-xs" onClick={() => setBudget(k)}>{en ? enl : es}</button>)}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-xs prive-muted">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        {en ? "Use these tastes to order what I see in Privé (you can withdraw it anytime)." : "Usar estos gustos para ordenar lo que veo en Privé (puedes retirarlo cuando quieras)."}
      </label>
      {state === "error" && <p className="text-xs text-amber-300" role="alert">{en ? "Couldn't save now." : "No se pudo guardar ahora."}</p>}
      <button type="button" className="prive-btn prive-btn-gold" disabled={!loves.length || state === "saving"} onClick={save}>{en ? "Save" : "Guardar"}</button>
    </div>
  );
}
