// "¿No entendimos bien tu viaje?" — recuperación en TODO viaje generado (arriba del detalle, también
// justo después de generar). Caso Diego: escribió Arabia, crucero, Cape Town y regreso por Londres y la
// app entendió un solo lugar.
//
// 1. Muestra TEXTO ORIGINAL → INTERPRETACIÓN → PENDIENTES. Un viaje viejo sin texto guardado muestra lo
//    entendido (destinos, fechas) y un campo para describirlo de nuevo.
// 2. Se corrige editando el texto (se vuelve a interpretar; el original NO se sobrescribe) o el resumen
//    (paradas, tramo crucero, ciudad de regreso…).
// 3. "Volver a armar mi viaje" dice qué se recalcula y que usa una búsqueda del plan; solo al confirmar
//    se genera, por el flujo correcto (multidestino con 2+ paradas o crucero), como una revisión nueva:
//    el viaje actual se conserva intacto (diario, gastos, selecciones) y apunta a la revisión.
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toastFunctionError } from "@/lib/functionErrors";
import { TripSpecReview } from "@/components/plan/TripSpecReview";
import { generateFromSpec, interpretTripAi, recalcSummary, specFromTrip } from "@/lib/tripSpecFlow";
import { DRAFT_FAIL_AVISO, draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";
import { consultaOf, type TripSpec } from "../../../supabase/functions/_shared/tripSpec";

type Props = { trip: any; className?: string };

export function TripUnderstoodButton({ trip, className = "" }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const saved = useMemo(() => consultaOf(trip), [trip]);
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<TripSpec | null>(null);
  const [text, setText] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Borrador rápido: el lector local al instante; Iato lo completa (sin pisar lo que se editó) al responder.
  const [draftBase, setDraftBase] = useState<TripSpec | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const specRef = useRef<TripSpec | null>(null);
  specRef.current = spec;
  const runRef = useRef(0);
  const changeSpec = (s: TripSpec) => { specRef.current = s; setSpec(s); };

  const openDialog = () => {
    const s = specFromTrip(trip);
    setSpec(s);
    setText(saved?.consulta_original ?? "");
    setEditingText(!saved?.consulta_original);
    setAviso(null);
    setNota(null);
    setDraftBase(null);
    runRef.current++;
    setConfirming(false);
    setOpen(true);
  };

  const reinterpret = async () => {
    const t = text.trim();
    if (!t) return;
    const ctx = { origen: trip?.ciudad_origen ?? null, fecha_salida: trip?.fecha_salida ?? null, fecha_regreso: trip?.fecha_regreso ?? null, viajeros: Number(trip?.num_viajeros) || null };
    const base = draftSpec(t, ctx);
    const run = ++runRef.current;
    changeSpec(base);
    setDraftBase(base);
    setAviso(null);
    setNota(null);
    setEditingText(false);
    setInterpreting(true);
    const r = await interpretTripAi(supabase as any, t, ctx);
    if (run !== runRef.current) return; // se cerró o se volvió a interpretar
    const edited = specRef.current ?? base;
    if (r.ok) {
      const m = mergeDraftWithAi(base, edited, r.spec, ctx);
      changeSpec(m.spec);
      setNota(m.nota);
      setAviso(r.recortadoParaIa ? "Tu texto es muy largo: Iato leyó los primeros 8,000 caracteres. Se guarda completo; revisa que esté todo." : null);
    } else {
      setAviso(DRAFT_FAIL_AVISO);
    }
    setDraftBase(null);
    setInterpreting(false);
  };

  const rebuild = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      const { tripId } = await generateFromSpec(supabase as any, spec, { userId: user?.id ?? null, previous: { id: trip.id, itinerario_json: trip.itinerario_json } });
      if (!tripId) throw new Error("Sin viaje guardado");
      toast.success("Listo: armamos la nueva versión. Tu viaje anterior se conserva en Mis viajes.");
      setOpen(false);
      navigate(`/dashboard/viajes/${tripId}`);
    } catch (e) {
      console.error(e);
      await toastFunctionError(e, "No pudimos volver a armar tu viaje. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const recalc = spec ? recalcSummary(spec) : null;

  return (
    <>
      <button type="button" onClick={openDialog} data-testid="no-entendimos"
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-primary/30 bg-black/40 px-3 text-xs text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> ¿No entendimos bien tu viaje?
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent data-testid="no-entendimos-dialog"
          className="left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto overflow-x-hidden rounded-none border-primary/15 bg-[#070707] p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl">
          <div className="space-y-5 px-4 pb-6 pt-5 sm:px-7 sm:pt-7">
            <div>
              <DialogTitle className="font-display text-xl text-foreground">¿No entendimos bien tu viaje?</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">Revisa lo que escribiste y lo que entendimos. Corrige el texto o el resumen; nada se vuelve a cotizar hasta que confirmes.</DialogDescription>
            </div>

            <section aria-labelledby="ne-original" className="rounded-2xl border border-border/60 p-3.5">
              <h3 id="ne-original" className="text-xs uppercase tracking-widest text-muted-foreground">Lo que escribiste</h3>
              {saved?.consulta_original && !editingText ? (
                <>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground" data-testid="ne-texto-original">{saved.consulta_original}</p>
                  <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setEditingText(true)}>Editar el texto y volver a interpretar</button>
                </>
              ) : (
                <>
                  {!saved?.consulta_original && <p className="mt-2 text-xs text-muted-foreground" data-testid="ne-sin-texto">No tenemos el texto original de este viaje. Descríbelo como lo pensaste (paradas, crucero, regreso…).</p>}
                  {saved?.consulta_original && <p className="mt-2 text-xs text-muted-foreground">Tu texto original se conserva; esta versión corregida se guarda con la nueva revisión.</p>}
                  <Textarea aria-label="Describe tu viaje" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="mt-2 bg-black/40 text-sm" data-testid="ne-textarea"
                    placeholder="Ej.: Arabia Saudita, luego un crucero hasta Cape Town y regreso por Londres, del 15 de noviembre al 19 de diciembre, 2 personas" />
                  <p className="mt-1 text-[11px] text-muted-foreground">{text.length.toLocaleString("es-MX")} caracteres · se guarda completo. Interpretar no usa búsquedas de tu plan.</p>
                  <div className="mt-2 flex justify-end gap-2">
                    {saved?.consulta_original && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingText(false); setText(saved.consulta_original); }}>Cancelar</Button>}
                    <Button type="button" size="sm" variant="outline" disabled={!text.trim() || interpreting} onClick={reinterpret} data-testid="ne-interpretar">
                      {interpreting ? "Interpretando…" : "Volver a interpretar"}
                    </Button>
                  </div>
                </>
              )}
            </section>

            {spec && !confirming && (
              <TripSpecReview spec={spec} onChange={changeSpec} aviso={aviso} showOriginal={false} draft={!!draftBase} nota={nota}
                confirmLabel="Volver a armar mi viaje" costNote="Volver a armar usa una búsqueda de tu plan. Antes te decimos qué se recalcula."
                onConfirm={() => setConfirming(true)} onCancel={() => setOpen(false)} />
            )}

            {spec && confirming && recalc && (
              <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4" data-testid="ne-confirmar">
                <p className="text-sm font-medium">Antes de volver a armar</p>
                <p className="text-xs text-muted-foreground">Se arma como {recalc.flujo === "multi" ? "ruta de varias ciudades" : "viaje a un destino"} y se recalcula:</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground">{recalc.recalcula.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="text-xs text-foreground" data-testid="ne-costo">{recalc.costo} Tu viaje actual se conserva tal cual (diario, gastos y selecciones).</p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Volver al resumen</Button>
                  <Button type="button" onClick={rebuild} disabled={busy} className="bg-gradient-gold text-primary-foreground hover:opacity-90" data-testid="ne-confirmar-armar">
                    {busy ? "Armando tu viaje…" : "Confirmar y volver a armar"}
                  </Button>
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default TripUnderstoodButton;
