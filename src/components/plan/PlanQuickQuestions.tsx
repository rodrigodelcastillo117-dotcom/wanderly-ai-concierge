// Paso corto de Planear (como antes del 28-oct-2026): solo lo que falta para cotizar (fechas, origen o
// un lugar que no reconocemos), sin la pantalla completa "Tu viaje, como lo entendimos". Con todo
// respondido se sigue directo: varias ciudades → la ruta con el globo; una ciudad → la cotización.
// "Ver todo lo que entendimos" abre el resumen completo (la función se conserva, ya no es obligatoria).
import { useEffect } from "react";
import { ArrowLeft, CalendarDays, Route as RouteIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuestionRow } from "@/components/plan/TripSpecReview";
import { autoResolveQuestions } from "@/lib/tripSpecAnswers";
import { monthBounds, pendingQuestions, returnFor } from "@/lib/planDirect";
import { setTripBasics, type TripSpec } from "../../../supabase/functions/_shared/tripSpec";

type Props = {
  spec: TripSpec;
  onChange: (s: TripSpec) => void;
  onContinue: () => void;
  onSeeAll: () => void;
  onBack: () => void;
  /** Mes que dijo el texto ("en abril"): la salida se elige dentro de ese mes. */
  month?: { month: number; year: number; label: string } | null;
  /** Noches que dijo el texto ("10 días" → 9): el regreso se propone solo al elegir la salida. */
  nights?: number | null;
  aviso?: string | null;
  busy?: boolean;
};

const field = "h-11 bg-input border-border text-sm [color-scheme:dark]";

export function PlanQuickQuestions({ spec, onChange: onChangeRaw, onContinue, onSeeAll, onBack, month = null, nights = null, aviso = null, busy = false }: Props) {
  const onChange = (s: TripSpec) => onChangeRaw(autoResolveQuestions(s));
  useEffect(() => {
    const r = autoResolveQuestions(spec);
    if (r !== spec) onChangeRaw(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
  const pend = pendingQuestions(spec);
  // Las fechas se siguen viendo al contestarlas (para corregirlas antes de continuar).
  const fechas = spec.preguntas.find((q) => q.tipo === "fechas") ?? null;
  const others = pend.filter((q) => q.tipo !== "fechas");
  const bounds = monthBounds(month);
  const stays = spec.paradas.filter((s) => s.rol === "estancia").map((s) => s.ciudad);
  const setSalida = (v: string | null) => {
    const back = spec.fecha_regreso && v && spec.fecha_regreso > v ? spec.fecha_regreso : returnFor(v, nights);
    onChange(setTripBasics(spec, { fecha_salida: v, fecha_regreso: back }));
  };
  return (
    <div className="space-y-5" data-testid="plan-preguntas">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Editar lo que escribí
      </button>
      <div>
        <p className="flex items-center gap-2 text-sm text-primary" data-testid="plan-preguntas-ruta">
          <RouteIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{stays.join(" → ") || "Tu viaje"}</span>
        </p>
        <h1 className="mt-2 font-display text-2xl sm:text-3xl">{fechas && !others.length ? "¿Qué fechas?" : "Solo falta esto"}</h1>
        {aviso && <p className="mt-2 text-xs text-amber-400/90" role="alert" data-testid="spec-aviso">{aviso}</p>}
      </div>

      {fechas && (
        <section aria-label="Fechas" className="space-y-2" data-testid="plan-preguntas-fechas">
          {(month || nights) && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {month && nights ? `Escribiste ${nights + 1} días en ${month.label}: elige el día de salida.`
                : month ? `Escribiste ${month.label}: elige el día de salida.` : `Escribiste ${nights + 1} días: elige el día de salida.`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">Salida
              <Input type="date" className={field} value={spec.fecha_salida ?? ""} min={bounds?.min} max={bounds?.max}
                onChange={(e) => setSalida(e.target.value || null)} /></label>
            <label className="text-[11px] text-muted-foreground">Regreso
              <Input type="date" className={field} value={spec.fecha_regreso ?? ""} min={spec.fecha_salida ?? undefined}
                onChange={(e) => onChange(setTripBasics(spec, { fecha_regreso: e.target.value || null }))} /></label>
          </div>
        </section>
      )}

      {others.length > 0 && (
        <ul className="space-y-2">{others.map((q) => <QuestionRow key={q.id} q={q} spec={spec} onChange={onChange} />)}</ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onSeeAll} className="text-left text-xs text-primary underline-offset-2 hover:underline" data-testid="plan-ver-todo">
          Ver todo lo que entendimos
        </button>
        <Button type="button" onClick={onContinue} disabled={busy || pend.length > 0} data-testid="plan-continuar"
          className="h-12 bg-gradient-gold text-primary-foreground hover:opacity-90">
          {pend.length > 0 ? `Falta ${pend.length === 1 ? "1 dato" : `${pend.length} datos`}` : "Continuar"}
        </Button>
      </div>
    </div>
  );
}

export default PlanQuickQuestions;
