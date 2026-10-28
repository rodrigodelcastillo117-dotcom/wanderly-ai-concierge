// "Entendí: CDMX → Riad → … → crucero (Yeda → Ciudad del Cabo) → Ciudad del Cabo → Londres → CDMX. ¿Es
// correcto?" Resumen EDITABLE de lo que entendió el intérprete, antes de gastar nada: texto original,
// interpretación (paradas en orden, tramos con modo, crucero, regreso, fechas, viajeros) y pendientes.
// Con pendientes no se arma nada; cada uno se responde, se acepta la sugerencia o se quita (exclusión
// aprobada). El botón de confirmar dice el costo antes de usar una búsqueda del plan.
import { useEffect, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Loader2, Plus, Route as RouteIcon, Ship, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  acceptSuggestion, addStop, cruiseLine, describeSpec, excludeMention, LEG_MODE_LABEL, LEG_MODES, moveStop, openQuestions, removeStop,
  replaceRegionStops, routeOfSpec, setCruise, setReturnVia, setTripBasics, updateStop, resolveQuestion,
  type LegMode, type Question, type Stop, type TripSpec,
} from "../../../supabase/functions/_shared/tripSpec";
import { CRUISE_PRICE_NOTE } from "@/lib/cruiseLinks";
import { GlobeLoader } from "@/components/brand/GlobeLoader";
import { useSlowLoading } from "@/hooks/useSlowLoading";
import { DRAFT_STATUS, DRAFT_WAITING_LABEL } from "@/lib/tripSpecDraft";
import { answerKindOf, answerQuestion, autoResolveQuestions, modeFromText, numericOptions, returnLegText, returnModeOf, setReturnMode } from "@/lib/tripSpecAnswers";

type Props = {
  spec: TripSpec;
  onChange: (s: TripSpec) => void;
  onConfirm: () => void;
  busy?: boolean;
  aviso?: string | null;
  /** Texto del botón de confirmar. */
  confirmLabel?: string;
  /** Aviso de costo (se muestra junto al botón). */
  costNote?: string;
  /** Mostrar el texto original arriba (en la ventana de corrección ya va aparte). */
  showOriginal?: boolean;
  onCancel?: () => void;
  /**
   * Borrador rápido: el resumen es del lector local mientras Iato (la IA) lo revisa. Se puede editar,
   * pero no se arma nada hasta que llegue la revisión (o falle: entonces el borrador queda como base).
   */
  draft?: boolean;
  /** Aviso breve de lo que completó Iato sobre el borrador ("Iato completó tu viaje: agregó …"). */
  nota?: string | null;
};

/** "Borrador · Iato lo está revisando…": discreto y dorado; si pasa de 5 s, el globo pequeño de la marca. */
function DraftStatus() {
  const slow = useSlowLoading(true);
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] tracking-wide text-primary" role="status" aria-live="polite" data-testid="spec-borrador">
      {slow
        ? <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center" data-testid="spec-borrador-globo"><GlobeLoader size="sm" srLabel="Iato está revisando tu viaje" className="scale-[0.58]" /></span>
        : <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      <span>{DRAFT_STATUS}</span>
    </div>
  );
}

const chip = "min-h-[36px] rounded-full border px-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const chipOn = `${chip} border-primary/60 bg-primary/10 text-primary hover:bg-primary/15`;
const chipOff = `${chip} border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground`;
const ghost = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const field = "h-9 bg-input border-border text-sm";

/**
 * Respuesta de una pregunta "otro" de la IA: viajeros y noches con TODAS sus opciones y un campo numérico
 * para "Otro número"; cómo regresas con sus modos; una pregunta libre con todas sus opciones.
 */
function AnswerChips({ q, spec, onChange }: { q: Question; spec: TripSpec; onChange: (s: TripSpec) => void }) {
  const kind = answerKindOf(q);
  const [other, setOther] = useState(false);
  const [num, setNum] = useState("");
  const answer = (a: string | number | LegMode) => onChange(answerQuestion(spec, q.id, a));
  if (kind === "viajeros" || kind === "noches") {
    const { numbers, other: otherLabel } = numericOptions(q, kind === "viajeros" ? [1, 2, 3, 4] : []);
    const unit = (n: number) => (kind === "noches" ? `${n} ${n === 1 ? "noche" : "noches"}` : String(n));
    return (
      <div className="flex w-full flex-wrap items-center gap-2" data-testid="spec-respuesta" data-kind={kind}>
        {numbers.map((n) => (
          <button key={n} type="button" className={chipOn} onClick={() => answer(n)} data-testid="spec-opcion">{unit(n)}</button>
        ))}
        {otherLabel && !other && <button type="button" className={chipOff} onClick={() => setOther(true)} data-testid="spec-opcion-otro">{otherLabel}</button>}
        {(other || (!numbers.length)) && (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (Number(num) > 0) answer(Number(num)); }}>
            <Input type="number" inputMode="numeric" min={1} max={kind === "viajeros" ? 20 : 60} autoFocus={other}
              aria-label={kind === "viajeros" ? "Número de viajeros" : "Número de noches"} placeholder={kind === "viajeros" ? "Viajeros" : "Noches"}
              className="h-9 w-24 bg-input border-border text-sm" value={num} onChange={(e) => setNum(e.target.value)} data-testid="spec-numero" />
            <Button type="submit" variant="outline" className="h-9 shrink-0" disabled={!(Number(num) > 0)}>Usar</Button>
          </form>
        )}
      </div>
    );
  }
  if (kind === "regreso_modo") {
    const opts = (q.opciones ?? []).map((o) => ({ label: o, mode: modeFromText(o) }));
    const known = opts.filter((o) => o.mode);
    return (
      <div className="flex w-full flex-wrap items-center gap-2" data-testid="spec-respuesta" data-kind={kind}>
        {(known.length ? known : [{ label: "Coche", mode: "coche" as LegMode }, { label: "Vuelo", mode: "vuelo" as LegMode }]).map((o) => (
          <button key={o.label} type="button" className={chipOn} onClick={() => answer(o.mode!)} data-testid="spec-opcion">{o.label}</button>
        ))}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Otro
          <select aria-label="Cómo regresas" value="" onChange={(e) => e.target.value && answer(e.target.value as LegMode)}
            className="rounded-full border border-border/60 bg-black/40 px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <option value="">Elegir…</option>
            {LEG_MODES.filter((m) => m !== "crucero").map((m) => <option key={m} value={m}>{m === "por_definir" ? "Aún no lo sé" : LEG_MODE_LABEL[m]}</option>)}
          </select>
        </label>
      </div>
    );
  }
  return (
    <>
      {(q.opciones ?? []).map((o) => (
        <button key={o} type="button" className={chipOn} onClick={() => answer(o)} data-testid="spec-opcion">{o}</button>
      ))}
    </>
  );
}

function QuestionRow({ q, spec, onChange }: { q: Question; spec: TripSpec; onChange: (s: TripSpec) => void }) {
  const [text, setText] = useState("");
  const kind = answerKindOf(q);
  const stop = q.parada ? spec.paradas.find((s) => s.id === q.parada) ?? null : null;
  const suggested = spec.paradas.filter((s) => s.sugerida && ((q.parada && s.id === q.parada) || (s.de_region && s.de_region === q.texto)));
  const useText = () => {
    const list = text.split(/\s*(?:,|;| y )\s*/).map((c) => c.trim()).filter(Boolean);
    if (list.length) { onChange(replaceRegionStops(spec, q.id, list)); setText(""); }
  };
  return (
    <li className="rounded-xl border border-amber-400/30 bg-amber-400/[0.04] p-3" data-testid="spec-pregunta" data-tipo={q.tipo}>
      <p className="flex items-start gap-2 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/90" aria-hidden="true" />{q.pregunta}</p>
      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        {/* Preguntas libres de la IA (viajeros, noches, cómo regresas…): todas sus opciones, con campo si es un número. */}
        {q.tipo === "otro" && (kind !== "otro" || suggested.length === 0) && <AnswerChips q={q} spec={spec} onChange={onChange} />}
        {(q.tipo === "ciudades_de_pais" || q.tipo === "lugar_desconocido" || (q.tipo === "otro" && kind === "otro" && suggested.length > 0)) && (suggested.length > 0 || stop) && (
          <button type="button" className={chipOn} onClick={() => onChange(acceptSuggestion(spec, q.id))} data-testid="spec-aceptar">
            {q.opciones[0] ?? `Sí, ${suggested.map((s) => s.ciudad).join(", ") || stop?.ciudad}`}
          </button>
        )}
        {q.tipo === "conexion_o_estancia" && (<>
          <button type="button" className={chipOff} onClick={() => onChange(setReturnVia(spec, q.id, "conexion"))} data-testid="spec-escala">Solo escala</button>
          <button type="button" className={chipOn} onClick={() => onChange(setReturnVia(spec, q.id, "estancia"))} data-testid="spec-estancia">Me quedo unos días</button>
        </>)}
        {q.tipo === "crucero" && stop && <CruiseFields stop={stop} spec={spec} onChange={onChange} />}
        {q.tipo === "crucero" && !stop && (
          <p className="text-xs text-muted-foreground">Agrega abajo la ciudad donde desembarcas y marca «Crucero» en cómo llegas.</p>
        )}
        {q.tipo === "fechas" && (
          <div className="grid w-full grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">Salida
              <Input type="date" className={`${field} [color-scheme:dark]`} value={spec.fecha_salida ?? ""} onChange={(e) => onChange(setTripBasics(spec, { fecha_salida: e.target.value || null }))} /></label>
            <label className="text-[11px] text-muted-foreground">Regreso
              <Input type="date" className={`${field} [color-scheme:dark]`} value={spec.fecha_regreso ?? ""} min={spec.fecha_salida ?? undefined} onChange={(e) => onChange(setTripBasics(spec, { fecha_regreso: e.target.value || null }))} /></label>
          </div>
        )}
        {q.tipo === "origen" && (
          <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onChange(setTripBasics(spec, { origen: text.trim() })); }}>
            <Input aria-label="Ciudad de salida" placeholder="Ciudad de salida" className={field} value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" variant="outline" className="h-9 shrink-0">Usar</Button>
          </form>
        )}
        {(q.tipo === "ciudades_de_pais" || q.tipo === "lugar_desconocido") && (
          <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); useText(); }}>
            <Input aria-label={q.tipo === "ciudades_de_pais" ? `Ciudades de ${q.texto}` : `¿Qué ciudad es ${q.texto}?`}
              placeholder={q.tipo === "ciudades_de_pais" ? "Otras ciudades (separadas por coma)" : "Escribe la ciudad"} className={field} value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" variant="outline" className="h-9 shrink-0" disabled={!text.trim()}>Usar</Button>
          </form>
        )}
        {q.tipo !== "fechas" && q.tipo !== "origen" && kind === "otro" && (
          <button type="button" className={chipOff} onClick={() => onChange(excludeMention(spec, q.id))} data-testid="spec-quitar">
            {q.tipo === "conexion_o_estancia" ? "Quitar la escala" : q.tipo === "crucero" ? "Sin crucero" : `Quitar «${q.texto}»`}
          </button>
        )}
        {q.tipo === "otro" && <button type="button" className={chipOff} onClick={() => onChange(resolveQuestion(spec, q.id, "preferencia"))}>{kind === "otro" ? "Entendido" : "Lo decido después"}</button>}
      </div>
    </li>
  );
}

function CruiseFields({ stop, spec, onChange }: { stop: Stop; spec: TripSpec; onChange: (s: TripSpec) => void }) {
  const c = stop.crucero;
  const set = (patch: Parameters<typeof setCruise>[2]) => onChange(setCruise(spec, stop.id, patch));
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2" data-testid="spec-crucero-campos">
      <label className="text-[11px] text-muted-foreground">Puerto de salida
        <Input className={field} value={c?.puerto_salida ?? ""} placeholder="Ej.: Yeda" onChange={(e) => set({ puerto_salida: e.target.value || null })} /></label>
      <label className="text-[11px] text-muted-foreground">Puerto de llegada
        <Input className={field} value={c?.puerto_llegada ?? ""} placeholder={stop.ciudad} onChange={(e) => set({ puerto_llegada: e.target.value || null })} /></label>
      <label className="text-[11px] text-muted-foreground">Sale
        <Input type="date" className={`${field} [color-scheme:dark]`} value={c?.fecha_salida ?? ""} onChange={(e) => set({ fecha_salida: e.target.value || null })} /></label>
      <label className="text-[11px] text-muted-foreground">Llega
        <Input type="date" className={`${field} [color-scheme:dark]`} value={c?.fecha_llegada ?? ""} min={c?.fecha_salida ?? undefined} onChange={(e) => set({ fecha_llegada: e.target.value || null })} /></label>
      <label className="text-[11px] text-muted-foreground">Noches a bordo
        <Input type="number" min={1} max={120} className={field} value={c?.noches ?? ""} onChange={(e) => set({ noches: Number(e.target.value) || null })} /></label>
      <label className="text-[11px] text-muted-foreground">Naviera (si ya la elegiste)
        <Input className={field} value={c?.naviera ?? ""} placeholder="Opcional" onChange={(e) => set({ naviera: e.target.value || null })} /></label>
    </div>
  );
}

export function TripSpecReview({ spec, onChange: onChangeRaw, onConfirm, busy, aviso, confirmLabel = "Sí, armar mi viaje", costNote = "Armar tu viaje usa una búsqueda de tu plan.", showOriginal = true, onCancel, draft = false, nota = null }: Props) {
  // Lo que ya contesta el resumen o el texto no queda pendiente (viajeros puestos, "… en coche").
  const onChange = (s: TripSpec) => onChangeRaw(autoResolveQuestions(s));
  useEffect(() => {
    const r = autoResolveQuestions(spec);
    if (r !== spec) onChangeRaw(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
  const [adding, setAdding] = useState("");
  const pend = openQuestions(spec);
  const route = routeOfSpec(spec);
  const stays = spec.paradas.filter((s) => s.rol === "estancia").length;
  const flowLabel = route.kind === "multi" ? `Ruta de ${stays} ${stays === 1 ? "ciudad" : "ciudades"}${route.seaLegs.length ? " con crucero" : ""}` : route.kind === "unico" ? "Viaje a un destino" : null;
  return (
    <div className="space-y-4" data-testid="spec-review">
      <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-3.5 sm:p-4">
        {draft && <DraftStatus />}
        {!draft && nota && (
          <p className="mb-2 flex items-start gap-2 text-[11px] tracking-wide text-primary" role="status" data-testid="spec-ia-nota">
            <Sparkles className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />{nota}
          </p>
        )}
        <p className="flex items-start gap-2 text-sm" role="status" data-testid="spec-entendi">
          <RouteIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>Entendí: <span className="font-medium">{describeSpec(spec)}</span><span className="text-muted-foreground">. ¿Es correcto?</span></span>
        </p>
        {flowLabel && <p className="mt-1 pl-6 text-xs text-muted-foreground" data-testid="spec-flujo">{flowLabel}</p>}
        {aviso && <p className="mt-2 pl-6 text-xs text-amber-400/90" role="alert" data-testid="spec-aviso">{aviso}</p>}
        {showOriginal && spec.consulta_original && (
          <details className="mt-2 pl-6">
            <summary className="cursor-pointer text-xs text-primary">Lo que escribiste</summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground" data-testid="spec-original">{spec.consulta_original}</p>
          </details>
        )}
      </div>

      {spec.intencion !== "viaje_futuro" && (
        <p className="rounded-xl border border-border/60 p-3 text-xs text-muted-foreground" data-testid="spec-relato">
          {spec.intencion === "relato_pasado"
            ? "Esto suena a viajes que ya hiciste: van a tu perfil de viajero, no armamos un viaje nuevo con ellos."
            : "Separamos lo que ya viviste (va a tu perfil de viajero) de lo que quieres planear (va a este viaje)."}
        </p>
      )}

      {pend.length > 0 && (
        <section aria-labelledby="spec-pendientes">
          <h3 id="spec-pendientes" className="mb-2 text-xs uppercase tracking-widest text-amber-400/90">Pendientes ({pend.length})</h3>
          <ul className="space-y-2">{pend.map((q) => <QuestionRow key={q.id} q={q} spec={spec} onChange={onChange} />)}</ul>
        </section>
      )}

      <section aria-labelledby="spec-paradas">
        <h3 id="spec-paradas" className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Orden del viaje</h3>
        <ol className="space-y-1.5">
          <li className="rounded-xl border border-border/40 px-3 py-2 text-xs text-muted-foreground">Sales de <span className="text-foreground">{spec.origen || "¿origen?"}</span></li>
          {spec.paradas.map((s, i) => (
            <li key={s.id} className="rounded-xl border border-border/60 bg-surface/40 px-2.5 py-2" data-testid="spec-parada">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {s.ciudad}{s.de_region && s.de_region !== s.ciudad ? <span className="font-normal text-muted-foreground"> ({s.de_region})</span> : null}
                </span>
                {s.sugerida && <span className="shrink-0 rounded-full border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary">sugerida</span>}
                <button type="button" className={ghost} aria-label={`Subir ${s.ciudad}`} disabled={i === 0} onClick={() => onChange(moveStop(spec, s.id, -1))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={ghost} aria-label={`Bajar ${s.ciudad}`} disabled={i === spec.paradas.length - 1} onClick={() => onChange(moveStop(spec, s.id, 1))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={ghost} aria-label={`Quitar ${s.ciudad}`} onClick={() => onChange(removeStop(spec, s.id))}><X className="h-4 w-4" aria-hidden="true" /></button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-8 text-xs">
                <label className="flex items-center gap-1 text-muted-foreground">Llegas en
                  <select aria-label={`Cómo llegas a ${s.ciudad}`} value={s.llegada_por} onChange={(e) => onChange(updateStop(spec, s.id, { llegada_por: e.target.value as LegMode }))}
                    className="rounded-full border border-border/60 bg-black/40 px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {LEG_MODES.map((m) => <option key={m} value={m}>{LEG_MODE_LABEL[m]}</option>)}
                  </select>
                </label>
                <span role="radiogroup" aria-label={`¿Te quedas en ${s.ciudad}?`} className="flex gap-1">
                  <button type="button" role="radio" aria-checked={s.rol === "estancia"} className={s.rol === "estancia" ? chipOn : chipOff} onClick={() => onChange(updateStop(spec, s.id, { rol: "estancia" }))}>Me quedo</button>
                  <button type="button" role="radio" aria-checked={s.rol === "conexion"} className={s.rol === "conexion" ? chipOn : chipOff} onClick={() => onChange(updateStop(spec, s.id, { rol: "conexion", noches: null }))}>Solo escala</button>
                </span>
                {s.rol === "estancia" && (
                  <label className="flex items-center gap-1 text-muted-foreground">Noches
                    <Input type="number" min={1} max={60} aria-label={`Noches en ${s.ciudad}`} className="h-8 w-16 bg-input border-border text-xs" value={s.noches ?? ""}
                      onChange={(e) => onChange(updateStop(spec, s.id, { noches: Number(e.target.value) || null }))} />
                  </label>
                )}
              </div>
              {s.llegada_por === "crucero" && (
                <div className="mt-2 space-y-2 pl-8">
                  <p className="flex items-center gap-1.5 text-xs text-foreground" data-testid="spec-crucero">
                    <Ship className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{cruiseLine(s.crucero, spec.paradas[i - 1]?.ciudad ?? null, s.ciudad)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{CRUISE_PRICE_NOTE}</p>
                  {!pend.some((q) => q.tipo === "crucero" && q.parada === s.id) && <CruiseFields stop={s} spec={spec} onChange={onChange} />}
                </div>
              )}
            </li>
          ))}
          <li>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) { onChange(addStop(spec, adding)); setAdding(""); } }}>
              <Input aria-label="Agregar parada" placeholder="Agregar ciudad o puerto" className={field} value={adding} onChange={(e) => setAdding(e.target.value)} />
              <Button type="submit" variant="outline" className="h-9 shrink-0" disabled={!adding.trim()}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Agregar</Button>
            </form>
          </li>
          <li className="rounded-xl border border-border/40 px-3 py-2 text-xs text-muted-foreground" data-testid="spec-regreso">
            Regresas a <span className="text-foreground">{spec.regreso.a || spec.origen || "¿?"}</span>
            {spec.regreso.via ? <> por <span className="text-foreground">{spec.regreso.via}</span></> : null}
            {/* El modo real del regreso (coche, tren, vuelo…), no siempre "el vuelo de regreso". */}
            {spec.paradas.length > 0 && <> · <span data-testid="spec-regreso-tramo">{returnLegText(spec)}</span></>}
            {spec.paradas.length > 0 && (
              <label className="mt-1.5 flex items-center gap-1">Regresas en
                <select aria-label="Cómo regresas" value={returnModeOf(spec)} onChange={(e) => onChange(setReturnMode(spec, e.target.value as LegMode))}
                  className="rounded-full border border-border/60 bg-black/40 px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {LEG_MODES.filter((m) => m !== "crucero").map((m) => <option key={m} value={m}>{LEG_MODE_LABEL[m]}</option>)}
                </select>
              </label>
            )}
          </li>
        </ol>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Fechas y viajeros">
        <label className="text-[11px] text-muted-foreground">Salida
          <Input type="date" className={`${field} [color-scheme:dark]`} value={spec.fecha_salida ?? ""} onChange={(e) => onChange(setTripBasics(spec, { fecha_salida: e.target.value || null }))} /></label>
        <label className="text-[11px] text-muted-foreground">Regreso
          <Input type="date" className={`${field} [color-scheme:dark]`} value={spec.fecha_regreso ?? ""} min={spec.fecha_salida ?? undefined} onChange={(e) => onChange(setTripBasics(spec, { fecha_regreso: e.target.value || null }))} /></label>
        <label className="text-[11px] text-muted-foreground">Viajeros
          <Input type="number" min={1} max={20} className={field} value={spec.viajeros ?? ""} onChange={(e) => onChange(setTripBasics(spec, { viajeros: Number(e.target.value) || null }))} /></label>
        <label className="text-[11px] text-muted-foreground">Sales de
          <Input className={field} value={spec.origen ?? ""} onChange={(e) => onChange(setTripBasics(spec, { origen: e.target.value || null }))} /></label>
      </section>

      {(spec.preferencias.length > 0 || spec.reservas.length > 0 || spec.sugerencias.length > 0) && (
        <section className="space-y-1 text-xs text-muted-foreground">
          {spec.preferencias.length > 0 && <p>Preferencias: <span className="text-foreground">{spec.preferencias.join(" · ")}</span></p>}
          {spec.reservas.length > 0 && <p>Ya compraste: <span className="text-foreground">{spec.reservas.join(" · ")}</span></p>}
          {spec.sugerencias.map((s, i) => <p key={i} data-testid="spec-sugerencia">Sugerencia de Iato (no cambia tu orden): {s}</p>)}
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {costNote && <p className="text-xs text-muted-foreground sm:mr-auto" data-testid="spec-costo">{costNote}</p>}
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>}
        <Button type="button" onClick={onConfirm} disabled={draft || busy || route.kind === "preguntas" || route.kind === "vacio" || route.kind === "relato_pasado"}
          className="bg-gradient-gold text-primary-foreground hover:opacity-90" data-testid="spec-confirmar" data-borrador={draft ? "true" : undefined}>
          {draft ? DRAFT_WAITING_LABEL : route.kind === "preguntas" ? `Resuelve ${pend.length} ${pend.length === 1 ? "pendiente" : "pendientes"}` : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export default TripSpecReview;
