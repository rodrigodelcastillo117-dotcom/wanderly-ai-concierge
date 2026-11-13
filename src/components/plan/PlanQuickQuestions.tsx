// Paso corto de Planear (como antes del 28-oct-2026): solo lo que falta para cotizar (fechas, origen o
// un lugar que no reconocemos), sin la pantalla completa "Tu viaje, como lo entendimos". Con todo
// respondido se sigue directo: varias ciudades → la ruta con el globo; una ciudad → la cotización.
// "Ver todo lo que entendimos" abre el resumen completo (la función se conserva, ya no es obligatoria).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Loader2, Plane, Route as RouteIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { dayOfText } from "@/lib/planDefaults";
import { addIsoDays } from "@/lib/multiCityText";
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

type Ventana = { salida: string; regreso: string; noches: number; precio_mxn_pp: number };
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const corto = (iso: string) => `${Number(iso.slice(8, 10))} ${MES_CORTO[Number(iso.slice(5, 7)) - 1]}`;
const toDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

/**
 * «10 días en diciembre»: las salidas más baratas de ese mes para esa duración, con tarifas reales de referencia
 * (función fechas-baratas, sin SerpApi). Nada se elige solo: la persona toca una o elige otro día.
 */
function useCheapWindows(q: { origen: string | null; destino: string | null; mes: string | null; noches: number | null }) {
  const [state, setState] = useState<{ loading: boolean; ventanas: Ventana[] }>({ loading: false, ventanas: [] });
  const key = q.origen && q.destino && q.mes && q.noches ? `${q.origen}|${q.destino}|${q.mes}|${q.noches}` : "";
  useEffect(() => {
    if (!key) { setState({ loading: false, ventanas: [] }); return; }
    setState({ loading: true, ventanas: [] });
    let off = false;
    void (async () => {
      let ventanas: Ventana[] = [];
      try {
        const { data } = await supabase.functions.invoke("fechas-baratas", { body: { origen: q.origen, destino: q.destino, mes: q.mes, noches: q.noches } });
        const v = data as { ok?: boolean; ventanas?: Ventana[] } | null;
        if (v?.ok && Array.isArray(v.ventanas)) {
          ventanas = v.ventanas.filter((x) => ISO.test(String(x?.salida)) && ISO.test(String(x?.regreso)) && Number(x.precio_mxn_pp) > 0).slice(0, 3);
        }
      } catch { /* sin precios: se elige en el calendario */ }
      if (!off) setState({ loading: false, ventanas });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

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
  // «el 15 de diciembre» / «del 12 al 20 de enero»: días que la persona escribió → el calendario los marca solo.
  const written = dayOfText(spec.consulta_original ?? "");
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !fechas || spec.fecha_salida || !written) return;
    prefilled.current = true;
    onChange(setTripBasics(spec, { fecha_salida: written.salida, fecha_regreso: written.regreso ?? returnFor(written.salida, nights) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fechas, written?.salida]);
  // El calendario se abre en el mes que se escribió (o en el de la salida ya elegida).
  const startIso = spec.fecha_salida ?? written?.salida ?? (bounds ? bounds.min : null);
  const [viewMonth, setViewMonth] = useState<Date | undefined>(startIso ? toDate(startIso) : undefined);
  const startYm = startIso ? startIso.slice(0, 7) : "";
  useEffect(() => { if (startIso) setViewMonth(toDate(startIso)); }, [startYm]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrow = toDate(addIsoDays(toIso(new Date()), 1));
  const pickDay = (d: Date | undefined) => {
    if (!d) return;
    const iso = toIso(d);
    const s0 = spec.fecha_salida, r0 = spec.fecha_regreso;
    // Con «N días» el regreso sale solo. Sin duración: primer toque = salida, segundo (posterior) = regreso.
    if (!nights && s0 && !r0 && iso > s0) { onChange(setTripBasics(spec, { fecha_regreso: iso })); return; }
    onChange(setTripBasics(spec, { fecha_salida: iso, fecha_regreso: returnFor(iso, nights) }));
  };
  const cheap = useCheapWindows({
    origen: spec.origen ?? null, destino: stays[0] ?? null,
    mes: month ? `${month.year}-${String(month.month + 1).padStart(2, "0")}` : null, noches: month && nights ? nights : null,
  });
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
          {(cheap.loading || cheap.ventanas.length > 0) && (
            <div className="space-y-1.5" data-testid="plan-fechas-baratas">
              <p className="text-xs text-foreground">
                {cheap.loading
                  ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />Buscando los días más baratos de {month?.label}…</span>
                  : `Lo más barato en ${month?.label} para ${(nights ?? 0) + 1} días:`}
              </p>
              {cheap.ventanas.map((v) => {
                const on = spec.fecha_salida === v.salida && spec.fecha_regreso === v.regreso;
                return (
                  <button key={v.salida} type="button" aria-pressed={on} data-testid="plan-fecha-barata"
                    onClick={() => onChange(setTripBasics(spec, { fecha_salida: v.salida, fecha_regreso: v.regreso }))}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <span className="flex items-center gap-2"><Plane className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{corto(v.salida)} → {corto(v.regreso)}</span>
                    <span className="text-primary">vuelo desde {pesos(v.precio_mxn_pp)} <span className="text-[11px] text-muted-foreground">por persona</span></span>
                  </button>
                );
              })}
              {!cheap.loading && (
                <p className="text-[11px] text-muted-foreground">Precio de referencia de otros viajeros (Aviasales); el real se busca al cotizar. O elige cualquier otro día abajo.</p>
              )}
            </div>
          )}
          <div className="flex justify-center rounded-2xl border border-border bg-card/40" data-testid="plan-calendario">
            <Calendar mode="range" locale={es} weekStartsOn={1} numberOfMonths={1} month={viewMonth} onMonthChange={setViewMonth}
              selected={spec.fecha_salida ? { from: toDate(spec.fecha_salida), to: spec.fecha_regreso ? toDate(spec.fecha_regreso) : undefined } : undefined}
              onDayClick={pickDay} disabled={{ before: tomorrow }} />
          </div>
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
