// "¿Algo no se entiende? Cuéntanos": diálogo sencillo para mandar una opinión al equipo IATOS.
// Tipo, texto (obligatorio, máx. 2000), calificación opcional 1–5 y "pueden contactarme por correo"
// (marcada). Se le dice al usuario qué se adjunta solo (pantalla, dispositivo y viaje; la versión de la app
// y la ruta se envían sin mostrarse). Estados
// honestos: enviada (le llegó al equipo), sin conexión (no se envió; el texto se queda) y error.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Star, WifiOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import {
  contextLines, draftProblem, newIdemKey, OPINION_MAX, OPINION_TYPE_LABEL, OPINION_TYPES, opinionContext, type OpinionDraft,
  type OpinionType, sendOpinion, type SendResult,
} from "@/lib/opinion";

const PLACEHOLDER: Record<OpinionType, string> = {
  no_funciona: "Qué intentabas hacer y qué pasó. Ej.: toqué «Buscar vuelos» y no salió nada.",
  confuso: "Qué no se entiende. Ej.: no supe dónde ver los vuelos de mi viaje.",
  idea: "Qué te gustaría que hiciera IATOS.",
  me_gusto: "Qué te gustó. Nos ayuda a saber qué cuidar.",
};

const EMPTY: OpinionDraft = { tipo: null, texto: "", calificacion: null, contactar: true };

export function OpinionDialog({ open, onOpenChange, pathname }: { open: boolean; onOpenChange: (v: boolean) => void; pathname: string }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<OpinionDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [touched, setTouched] = useState(false);
  // Una clave por envío: reintentar el mismo (tras perder la red) no lo duplica.
  const idem = useRef<string>(newIdemKey());
  const ctx = useMemo(() => opinionContext(pathname), [pathname]);

  // Al abrir de nuevo después de un envío: diálogo limpio.
  useEffect(() => {
    if (open && result?.ok) {
      setDraft(EMPTY); setResult(null); setTouched(false); idem.current = newIdemKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [open]);

  const problem = draftProblem(draft);
  const set = (p: Partial<OpinionDraft>) => { setDraft((d) => ({ ...d, ...p })); if (result && !result.ok) setResult(null); };

  const submit = async () => {
    setTouched(true);
    if (problem || !draft.tipo || busy) return;
    setBusy(true);
    const r = await sendOpinion({ ...draft, tipo: draft.tipo }, ctx, idem.current);
    setBusy(false);
    setResult(r);
  };

  const sent = result && result.ok === true ? (result as Extract<SendResult, { ok: true }>) : null;
  const failed = result && result.ok === false ? (result as Extract<SendResult, { ok: false }>) : null;
  const count = draft.texto.trim().length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-md max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl p-5 sm:p-6" data-testid="opinion-dialog">
        {sent ? (
          <div className="py-4 text-center space-y-3" role="status" data-testid="opinion-sent">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
              <Check className="h-6 w-6" aria-hidden="true" />
            </span>
            <DialogTitle className="font-display text-2xl">¡Gracias! Le llegó al equipo de IATOS.</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Lo lee una persona del equipo. Folio {sent.folio}.
              {" "}Si te responden, lo verás en Concierge › Mis solicitudes{draft.contactar ? " y en tu correo" : ""}.
            </DialogDescription>
            <div className="flex flex-col gap-2 pt-2">
              <Button className="bg-gradient-gold text-primary-foreground hover:opacity-90" onClick={() => onOpenChange(false)}>Listo</Button>
              <Button asChild variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                <Link to="/dashboard/concierge?tab=solicitudes">Ver mis solicitudes</Link>
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-2xl">Cuéntanos</DialogTitle>
              <DialogDescription>Lo lee una persona del equipo IATOS. Nos ayuda a mejorar la app.</DialogDescription>
            </DialogHeader>

            <fieldset>
              <legend className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">¿Qué nos quieres contar?</legend>
              <div role="radiogroup" aria-label="Tipo de opinión" className="grid grid-cols-2 gap-2">
                {OPINION_TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={draft.tipo === t} onClick={() => set({ tipo: t })}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm text-left transition ${draft.tipo === t ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-foreground hover:bg-white/[0.04]"}`}>
                    {OPINION_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="opinion-texto" className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Cuéntanos con tus palabras</label>
              <Textarea id="opinion-texto" rows={4} maxLength={OPINION_MAX} value={draft.texto} aria-describedby="opinion-count"
                placeholder={draft.tipo ? PLACEHOLDER[draft.tipo] : "Escribe aquí"} onChange={(e) => set({ texto: e.target.value })}
                aria-invalid={touched && !!problem && draft.tipo !== null} />
              <p id="opinion-count" className="mt-1 text-right text-[11px] text-muted-foreground">{count}/{OPINION_MAX}</p>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5" id="opinion-rating">Calificación (opcional)</p>
              <div role="group" aria-labelledby="opinion-rating" className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = (draft.calificacion ?? 0) >= n;
                  return (
                    <button key={n} type="button" aria-label={`${n} de 5`} aria-pressed={draft.calificacion === n}
                      onClick={() => set({ calificacion: draft.calificacion === n ? null : n })}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-white/[0.04]">
                      <Star className={`h-5 w-5 ${on ? "fill-primary text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox checked={draft.contactar} onCheckedChange={(v) => set({ contactar: v === true })} className="mt-0.5" aria-label="Pueden contactarme por correo" />
              <span>
                Pueden contactarme por correo
                {user?.email ? <span className="block text-xs text-muted-foreground break-all">{user.email}</span> : null}
              </span>
            </label>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-muted-foreground" data-testid="opinion-context">
              <p className="text-foreground/80 mb-1">Se adjunta automáticamente:</p>
              <ul className="space-y-0.5 break-words">
                {contextLines(ctx).map((l) => <li key={l}>{l}</li>)}
              </ul>
              <p className="mt-1.5">El equipo ve tu nombre y tu correo. Sin capturas de pantalla ni otros datos.</p>
            </div>

            {/* Barra fija al pie del diálogo (ronda 3, P2-2): a 390 px el aviso de "sin conexión" o de error
                empujaba «Reintentar» debajo del borde y había que desplazarse dentro del diálogo. */}
            <div data-testid="opinion-actions"
              className="sticky bottom-0 z-10 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 space-y-2 border-t border-white/[0.06] bg-background px-5 pt-3 pb-5 sm:px-6 sm:pb-6">
              {touched && problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : null}
              {failed ? (
                <p role="alert" data-testid="opinion-error" className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${failed.kind === "offline" ? "border-amber-400/40 text-amber-200" : "border-red-400/40 text-red-300"}`}>
                  {failed.kind === "offline" ? <WifiOff className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> : null}
                  <span>{failed.message}</span>
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={busy} className="flex-1 sm:flex-none bg-gradient-gold text-primary-foreground hover:opacity-90">
                  {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                  {busy ? "Enviando…" : failed ? "Reintentar" : "Enviar"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default OpinionDialog;
