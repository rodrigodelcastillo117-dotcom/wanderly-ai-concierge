import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, CheckCircle2, Plane, Wallet, MapPin, Sparkles, ArrowRight } from "lucide-react";
import { convert, fxLabel, type FxTable } from "@/lib/fx";
import { useFxTable } from "@/hooks/useFxTable";
import { computeGoal } from "@/lib/savingsGoal";
import { estimateTripCost, regionOf, REGIONS, type Region } from "@/lib/tripEstimate";
import { localISODate, parseLocalDate } from "@/lib/localDate";
import { shortTripName } from "@/lib/tripName";
import { duplicateTripMarks, markedTripName } from "@/lib/tripList";

export type Trip = {
  id: string;
  destino: string;
  pais_destino: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  total_estimado: number | null;
  moneda: string | null;
  created_at?: string | null;
};

const FIXED_FIELDS: { key: string; label: string }[] = [
  { key: "renta", label: "Renta / hipoteca" },
  { key: "luz", label: "Luz" },
  { key: "agua", label: "Agua" },
  { key: "gas", label: "Gas" },
  { key: "internet", label: "Internet" },
  { key: "celular", label: "Celular" },
  { key: "supermercado", label: "Supermercado" },
  { key: "gasolina", label: "Gasolina" },
  { key: "transporte", label: "Transporte público / Uber" },
  { key: "seguros", label: "Seguros (auto, salud, vida)" },
  { key: "creditos", label: "Tarjetas / créditos" },
  { key: "colegiaturas", label: "Colegiaturas / cursos" },
  { key: "suscripciones", label: "Suscripciones (Netflix, Spotify, etc.)" },
  { key: "mantenimiento", label: "Mantenimiento / cuotas" },
];

const VAR_FIELDS: { key: string; label: string }[] = [
  { key: "restaurantes", label: "Restaurantes" },
  { key: "comidas_trabajo", label: "Comidas en el trabajo" },
  { key: "antros", label: "Antros / bares" },
  { key: "cine", label: "Cine / entretenimiento" },
  { key: "pareja", label: "Pareja (citas, regalos)" },
  { key: "shopping", label: "Shopping / ropa" },
  { key: "lujos", label: "Lujos / caprichos" },
  { key: "hobbies", label: "Hobbies / gym" },
  { key: "viajes_cortos", label: "Escapadas de fin de semana" },
  { key: "regalos", label: "Regalos / familia" },
  { key: "imprevistos", label: "Imprevistos / buffer" },
];

const STORAGE_KEY = "iatos_savings_calc_v1";

export type State = {
  tripId: string;
  sueldo: string;
  extras: string;
  patrimonio: string;
  fijos: Record<string, string>;
  variables: Record<string, string>;
};

export const defaultState = (): State => ({
  tripId: "",
  sueldo: "",
  extras: "",
  patrimonio: "",
  fijos: Object.fromEntries(FIXED_FIELDS.map(f => [f.key, ""])),
  variables: Object.fromEntries(VAR_FIELDS.map(f => [f.key, ""])),
});

// Montos negativos no tienen sentido aquí (antes "-5000" restaba gastos o sumaba ingreso).
const pos = (v: unknown) => Math.max(0, Number(v) || 0);
const sum = (obj: Record<string, string>) =>
  Object.values(obj).reduce((acc, v) => acc + pos(v), 0);

const fmtMoney = (n: number, currency = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export type SavingsState = "pagado" | "sin_tipo_cambio" | "sin_ingresos" | "sin_costo" | "sin_fecha" | "ok" | "ajustado" | "imposible";

const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Un viaje se puede financiar si no tiene fecha o sale hoy o después. */
export const isUpcoming = (t: Pick<Trip, "fecha_salida">, now = today()) =>
  !t.fecha_salida || new Date(t.fecha_salida + "T00:00:00") >= now;

/**
 * Ingresos, gastos y ahorro se capturan en MXN. Si el viaje está cotizado en otra moneda, su costo
 * se convierte a MXN con `fx` (fuente y fecha visibles); sin tipo de cambio no se calcula nada
 * (antes se comparaban pesos contra dólares como si fueran la misma moneda).
 */
export function computeSavings(state: State, trip: Trip | null, now = new Date(), fx: FxTable | null = null) {
  const sueldo = pos(state.sueldo);
  const extras = pos(state.extras);
  const patrimonio = pos(state.patrimonio);
  const fijos = sum(state.fijos);
  const variables = sum(state.variables);
  const ingreso = sueldo + extras;
  const capacidadAhorro = ingreso - fijos - variables;

  const monedaViaje = String(trip?.moneda || "MXN").toUpperCase();
  const costoOriginal = pos(trip?.total_estimado ?? 0);
  const costoConvertido = monedaViaje === "MXN" ? costoOriginal : fx ? convert(costoOriginal, monedaViaje, "MXN", fx) : null;
  const costoViaje = costoConvertido ?? 0;
  const faltante = Math.max(0, costoViaje - patrimonio);

  let meses = 0;
  let fechaViaje: Date | null = null;
  if (trip?.fecha_salida) {
    fechaViaje = new Date(trip.fecha_salida + "T00:00:00");
    meses = (fechaViaje.getFullYear() - now.getFullYear()) * 12 + (fechaViaje.getMonth() - now.getMonth());
    if (fechaViaje.getDate() < now.getDate()) meses -= 1;
    meses = Math.max(0, meses);
  }

  // Sale este mes: hay que tener todo ya, así que cuenta como un solo mes.
  const ahorroRequerido = faltante / Math.max(1, meses);
  const ratio = capacidadAhorro > 0 ? ahorroRequerido / capacidadAhorro : Infinity;

  let estado: SavingsState = "ok";
  if (costoOriginal > 0 && costoConvertido == null) estado = "sin_tipo_cambio";
  else if (costoViaje === 0) estado = "sin_costo";
  else if (faltante === 0) estado = "pagado";
  else if (!fechaViaje) estado = "sin_fecha";
  else if (ingreso === 0) estado = "sin_ingresos";
  else if (capacidadAhorro <= 0 || ratio > 1) estado = "imposible";
  else if (ratio > 0.7) estado = "ajustado";

  // Sugerencia automática de recortes para llegar al ahorro requerido
  const recorteSugerido = estado === "imposible" ? ahorroRequerido - Math.max(0, capacidadAhorro) : 0;

  return {
    ingreso, sueldo, extras, patrimonio, fijos, variables,
    capacidadAhorro, costoViaje, faltante, meses, fechaViaje,
    ahorroRequerido, ratio, estado, recorteSugerido,
    currency: "MXN",
    monedaViaje,
    costoOriginal,
    convertido: monedaViaje !== "MXN" && costoConvertido != null,
  };
}

const PLAN_KEY = "iatos_savings_plan_v2";

export type Plan = {
  /** Viaje de la persona al que se liga la meta ("" = destino libre). */
  tripId: string;
  destino: string;
  fecha: string;
  costo: string;
  /** De dónde salió el costo: lo escribió, estimación de referencia o el estimado de su viaje. */
  costoFuente: "manual" | "estimacion" | "viaje";
  ahorrado: string;
  dias: string;
  personas: string;
  region: Region | "";
};

export const defaultPlan = (now = new Date()): Plan => ({
  tripId: "",
  destino: "",
  // Sin fecha elegida se propone dentro de 6 meses (se ve y se puede cambiar).
  fecha: localISODate(new Date(now.getFullYear(), now.getMonth() + 6, now.getDate())),
  costo: "",
  costoFuente: "manual",
  ahorrado: "",
  dias: "7",
  personas: "2",
  region: "",
});

const POPULAR_DESTINATIONS = [
  "París", "Roma", "Madrid", "Barcelona", "Londres", "Nueva York", "Tokio", "Dubái",
  "Cancún", "Los Cabos", "Tulum", "Miami", "Bangkok", "Buenos Aires", "Lima", "Lisboa",
];

const shortDate = (iso: string | null) => {
  const d = parseLocalDate(iso);
  return d ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "sin fecha";
};

/**
 * Ahorro para tu viaje: funciona sin viaje planeado. Destino (o un viaje tuyo), fecha, costo (o
 * "usa una estimación", marcada como tal) y lo que ya llevas → cuánto apartar al mes. Lo de sueldo
 * y gastos del mes queda como paso opcional ("¿Te alcanza?").
 */
export const TripSavingsCalculator = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [plan, setPlan] = useState<Plan>(() => defaultPlan());
  const [state, setState] = useState<State>(defaultState);
  const fx = useFxTable();

  // Lo guardado en este dispositivo (la versión anterior guardaba sueldo, gastos y "patrimonio").
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState({ ...defaultState(), ...parsed, fijos: { ...defaultState().fijos, ...(parsed.fijos ?? {}) }, variables: { ...defaultState().variables, ...(parsed.variables ?? {}) } });
      }
      const rawPlan = localStorage.getItem(PLAN_KEY);
      if (rawPlan) setPlan((p) => ({ ...p, ...JSON.parse(rawPlan) }));
      else if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.patrimonio) setPlan((p) => ({ ...p, ahorrado: String(parsed.patrimonio) }));
      }
    } catch {/* sin almacenamiento */}
  }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {/* */} }, [state]);
  useEffect(() => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch {/* */} }, [plan]);

  useEffect(() => {
    if (!user) return;
    supabase.from("trips")
      .select("id,destino,pais_destino,fecha_salida,fecha_regreso,total_estimado,moneda,created_at")
      .eq("user_id", user.id)
      .order("fecha_salida", { ascending: true })
      .then(({ data }) => setTrips(((data ?? []) as Trip[]).filter((t) => isUpcoming(t))));
  }, [user]);

  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));

  /** Costo del viaje en MXN (null si está en otra moneda y no hay tipo de cambio). */
  const tripCostMxn = (t: Trip): number | null => {
    const amount = Number(t.total_estimado) || 0;
    if (!amount) return null;
    const cur = String(t.moneda || "MXN").toUpperCase();
    if (cur === "MXN") return amount;
    return fx ? convert(amount, cur, "MXN", fx) : null;
  };

  const linkTrip = (t: Trip | null) => {
    if (!t) { set({ tripId: "" }); return; }
    const cost = tripCostMxn(t);
    const days = parseLocalDate(t.fecha_salida) && parseLocalDate(t.fecha_regreso)
      ? Math.max(1, Math.round((parseLocalDate(t.fecha_regreso)!.getTime() - parseLocalDate(t.fecha_salida)!.getTime()) / 86_400_000) + 1)
      : null;
    set({
      tripId: t.id,
      destino: t.destino,
      fecha: t.fecha_salida ?? plan.fecha,
      ...(cost != null ? { costo: String(Math.round(cost)), costoFuente: "viaje" as const } : {}),
      ...(days ? { dias: String(days) } : {}),
    });
  };

  const linked = trips.find((t) => t.id === plan.tripId) ?? null;
  const detectedRegion = regionOf(plan.destino);
  const estimate = useMemo(
    () => estimateTripCost({ destino: plan.destino, region: plan.region || detectedRegion, dias: Number(plan.dias), personas: Number(plan.personas) }),
    [plan.destino, plan.region, detectedRegion, plan.dias, plan.personas],
  );
  const goal = useMemo(
    () => computeGoal({ costMxn: Number(plan.costo), savedMxn: Number(plan.ahorrado), dateISO: plan.fecha }),
    [plan.costo, plan.ahorrado, plan.fecha],
  );

  // Paso opcional: ¿te alcanza con tu sueldo y tus gastos? (la lógica de siempre, sobre esta meta).
  const asTrip: Trip = {
    id: plan.tripId || "meta", destino: plan.destino || "tu viaje", pais_destino: null,
    fecha_salida: plan.fecha || null, fecha_regreso: null, total_estimado: Number(plan.costo) || 0, moneda: "MXN",
  };
  const computed = useMemo(
    () => computeSavings({ ...state, patrimonio: plan.ahorrado }, asTrip, new Date(), fx),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asTrip se deriva de plan
    [state, plan, fx],
  );
  const setFijo = (k: string, v: string) => setState(s => ({ ...s, fijos: { ...s.fijos, [k]: v } }));
  const setVar = (k: string, v: string) => setState(s => ({ ...s, variables: { ...s.variables, [k]: v } }));

  // Viajes iguales (mismo nombre y fechas) con (2), (3)… como en Mis viajes (R3 viajes P2-14: tres chips
  // «Madrid · 10 mar 2027» idénticos).
  const dups = useMemo(() => duplicateTripMarks(trips as any), [trips]);
  const pct = Math.round(goal.avance * 100);
  const maxBar = Math.max(1, goal.costo);

  return (
    <section aria-label="Ahorro para tu viaje" className="grid lg:grid-cols-[1.1fr_1fr] gap-3 md:gap-6 items-start">
      {/* ── Tu meta ─────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-5 md:p-7">
        {trips.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">¿Es para un viaje que ya planeaste?</p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x" role="group" aria-label="Vincular a un viaje">
              {trips.map((t) => (
                <button key={t.id} type="button" onClick={() => linkTrip(plan.tripId === t.id ? null : t)} aria-pressed={plan.tripId === t.id}
                  className={`snap-start shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs transition ${plan.tripId === t.id ? "bg-gradient-gold text-primary-foreground border-transparent" : "border-primary/25 text-foreground/85 hover:border-primary/50"}`}>
                  <Plane className="w-3 h-3" aria-hidden="true" /> {markedTripName(shortTripName(t), dups.n.get(t.id))} · {shortDate(t.fecha_salida)}
                </button>
              ))}
              <button type="button" onClick={() => linkTrip(null)} aria-pressed={!plan.tripId}
                className={`snap-start shrink-0 px-3 py-2 rounded-full border text-xs transition ${!plan.tripId ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                Otro destino
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">¿A dónde quieres ir?</span>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" aria-hidden="true" />
              <input id="calc-destino" list="calc-destinos" value={plan.destino} placeholder="Ej. París"
                onChange={(e) => set({ destino: e.target.value, tripId: "", region: "" })}
                className="w-full rounded-lg bg-background/60 border border-border pl-9 pr-3 py-2.5 placeholder:text-muted-foreground placeholder:italic focus:border-primary outline-none" />
              <datalist id="calc-destinos">{POPULAR_DESTINATIONS.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
          </label>
          {/* Fecha, días y personas en un solo renglón (también en móvil). */}
          <div className="col-span-2 grid grid-cols-[1.6fr_1fr_1fr] gap-2 sm:gap-3">
            <label className="block min-w-0">
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">¿Cuándo sales?</span>
              <input id="calc-fecha" type="date" value={plan.fecha} min={localISODate()} onChange={(e) => set({ fecha: e.target.value })}
                className="w-full min-w-0 rounded-lg bg-background/60 border border-border px-2 sm:px-3 py-2.5 text-sm focus:border-primary outline-none" />
            </label>
            <SmallNum label="Días" value={plan.dias} onChange={(v) => set({ dias: v })} />
            <SmallNum label="Personas" value={plan.personas} onChange={(v) => set({ personas: v })} />
          </div>

          <div className="col-span-2">
            <NumField label="¿Cuánto cuesta el viaje? (MXN)" value={plan.costo} placeholder="Ej. 120000"
              onChange={(v) => set({ costo: v, costoFuente: "manual" })} />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button type="button" onClick={() => estimate && set({ costo: String(estimate.total), costoFuente: "estimacion" })}
                disabled={!estimate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-primary/40 text-primary hover:bg-primary/10 transition disabled:opacity-50">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Usa una estimación{estimate ? ` (${fmtMoney(estimate.total)})` : ""}
              </button>
              {!detectedRegion && plan.destino.trim().length > 1 && (
                <select aria-label="Región del destino" value={plan.region} onChange={(e) => set({ region: e.target.value as Region | "" })}
                  className="rounded-full bg-background/60 border border-border px-3 py-1.5 text-xs">
                  <option value="">¿En qué región está?</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              )}
              {!estimate && !plan.destino.trim() && <span className="text-[11px] text-muted-foreground">Escribe el destino para estimar.</span>}
            </div>
            {plan.costoFuente === "estimacion" && estimate && (
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed" role="note">
                <strong className="text-primary">Estimación de referencia</strong>, no es una cotización: vuelo redondo desde México
                (~{fmtMoney(estimate.vuelo)} por persona) + hotel 4-5★, comidas y traslados (~{fmtMoney(estimate.diario)} por persona al día)
                · {estimate.personas} {estimate.personas === 1 ? "persona" : "personas"} · {estimate.dias} días · {estimate.regionLabel}. Ajústala si ya tienes precios.
              </p>
            )}
            {plan.costoFuente === "viaje" && linked && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Costo estimado de tu viaje a {linked.destino}
                {String(linked.moneda || "MXN").toUpperCase() !== "MXN" && fx && <> ({fmtMoney(Number(linked.total_estimado), String(linked.moneda))} · {fxLabel(fx)})</>}.
              </p>
            )}
          </div>

          <div className="col-span-2">
            <NumField label="¿Cuánto llevas ahorrado para este viaje?" value={plan.ahorrado} placeholder="Ej. 20000" onChange={(v) => set({ ahorrado: v })} />
          </div>
        </div>

        {!plan.tripId && plan.destino.trim() && (
          <Link to="/dashboard/planear" className="mt-5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2">
            ¿Ya te decidiste? Planea tu viaje a {plan.destino.trim()} <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* ── Resultado ───────────────────────────────────── */}
      {/* En móvil la respuesta va primero: se ve cambiar mientras escribes debajo. */}
      <div className="order-first lg:order-none rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 md:p-7 lg:sticky lg:top-6" aria-live="polite">
        <div className="flex items-center gap-4 md:gap-5">
          <ProgressRing pct={pct} />
          <div className="min-w-0">
            {goal.estado === "ok" && (
              <>
                <p className="text-[10px] uppercase tracking-[0.25em] text-primary mb-1">Aparta cada mes</p>
                <p className="font-display text-3xl md:text-4xl leading-none" data-testid="ahorro-mensual">{fmtMoney(goal.mensual)}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {goal.meses > 0 ? `Durante ${goal.mesesAhorro} ${goal.mesesAhorro === 1 ? "mes" : "meses"}` : "Sales este mes: es lo que te falta"}
                  {" "}· ≈ {fmtMoney(goal.semanal)} por semana
                </p>
              </>
            )}
            {goal.estado === "cubierto" && (
              <>
                <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 mb-1">Meta cubierta</p>
                <p className="font-display text-2xl md:text-3xl leading-tight">Ya tienes lo del viaje</p>
                <p className="text-xs text-muted-foreground mt-2">Confirma precios antes de reservar.</p>
              </>
            )}
            {goal.estado === "sin_costo" && (
              <>
                <p className="font-display text-xl md:text-2xl leading-tight">¿Cuánto cuesta el viaje?</p>
                <p className="text-xs text-muted-foreground mt-2">Escríbelo o toca <strong>Usa una estimación</strong> y te digo cuánto apartar al mes.</p>
              </>
            )}
            {goal.estado === "sin_fecha" && <p className="font-display text-xl md:text-2xl leading-tight">Elige cuándo sales</p>}
            {goal.estado === "fecha_pasada" && <p className="font-display text-xl md:text-2xl leading-tight">Esa fecha ya pasó: elige una próxima</p>}
          </div>
        </div>

        {goal.costo > 0 && (
          <dl className="grid grid-cols-3 gap-2 mt-5 text-center">
            <div className="rounded-xl bg-background/40 border border-border p-2.5">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</dt>
              <dd className="font-display text-base md:text-lg">{fmtMoney(goal.costo)}</dd>
            </div>
            <div className="rounded-xl bg-background/40 border border-border p-2.5">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Llevas</dt>
              <dd className="font-display text-base md:text-lg">{fmtMoney(goal.ahorrado)}</dd>
            </div>
            <div className="rounded-xl bg-background/40 border border-border p-2.5">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Te falta</dt>
              <dd className="font-display text-base md:text-lg text-primary">{fmtMoney(goal.faltante)}</dd>
            </div>
          </dl>
        )}

        {goal.estado === "ok" && goal.calendario.length > 1 && (
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Así crece tu ahorro</p>
            <div className="flex items-end gap-1 h-20" aria-hidden="true">
              {goal.calendario.map((m) => (
                <div key={m.mes} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-gradient-to-t from-primary/50 to-primary" style={{ height: `${Math.max(6, (m.acumulado / maxBar) * 64)}px` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>{goal.calendario[0].mes}</span>
              <span>{plan.destino.trim() ? `✈ ${plan.destino.trim()}` : "✈ salida"} · {shortDate(plan.fecha)}</span>
            </div>
          </div>
        )}

        {/* Paso opcional: ¿te alcanza? */}
        <details className="mt-5 rounded-xl border border-border bg-background/30 group">
          <summary className="cursor-pointer px-4 py-3 text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" aria-hidden="true" /> ¿Te alcanza con tu sueldo? <span className="text-[11px] text-muted-foreground">(opcional)</span></span>
          </summary>
          <div className="px-4 pb-4">
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              <NumField label="Sueldo neto mensual" value={state.sueldo} onChange={(v) => setState(s => ({ ...s, sueldo: v }))} placeholder="Ej. 35000" compact />
              <NumField label="Otros ingresos" value={state.extras} onChange={(v) => setState(s => ({ ...s, extras: v }))} placeholder="Ej. 5000" compact />
            </div>
            <details className="mb-2 rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs flex justify-between"><span>Gastos fijos del mes</span><span className="text-muted-foreground">{fmtMoney(computed.fijos)}</span></summary>
              <div className="grid sm:grid-cols-2 gap-2 p-3 pt-1">
                {FIXED_FIELDS.map(f => <NumField key={f.key} label={f.label} value={state.fijos[f.key] ?? ""} onChange={(v) => setFijo(f.key, v)} compact />)}
              </div>
            </details>
            <details className="mb-3 rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs flex justify-between"><span>Gustos y gastos variables</span><span className="text-muted-foreground">{fmtMoney(computed.variables)}</span></summary>
              <div className="grid sm:grid-cols-2 gap-2 p-3 pt-1">
                {VAR_FIELDS.map(f => <NumField key={f.key} label={f.label} value={state.variables[f.key] ?? ""} onChange={(v) => setVar(f.key, v)} compact />)}
              </div>
            </details>
            <AffordVerdict computed={computed} />
          </div>
        </details>
      </div>
    </section>
  );
};

/** Veredicto del paso opcional (sueldo − gastos contra lo que hay que apartar). */
const AffordVerdict = ({ computed }: { computed: ReturnType<typeof computeSavings> }) => {
  const c = computed;
  if (c.estado === "sin_costo" || c.estado === "sin_fecha" || c.estado === "sin_tipo_cambio") {
    return <p className="text-xs text-muted-foreground">Primero completa costo y fecha de tu meta.</p>;
  }
  if (c.estado === "pagado") return <Verdict icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />} title="Ya lo tienes cubierto" body="Tu ahorro alcanza para la meta." />;
  if (c.estado === "sin_ingresos") return <p className="text-xs text-muted-foreground">Escribe tu sueldo para ver si te alcanza.</p>;
  if (c.estado === "ok") {
    return <Verdict icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />} title="Te alcanza con holgura"
      body={`Apartar ${fmtMoney(c.ahorroRequerido)} al mes usa el ${(c.ratio * 100).toFixed(0)}% de lo que te sobra (${fmtMoney(c.capacidadAhorro)}/mes).`} />;
  }
  if (c.estado === "ajustado") {
    return <Verdict icon={<AlertTriangle className="w-5 h-5 text-amber-400" />} title="Te alcanza, pero justo"
      body={`Usa el ${(c.ratio * 100).toFixed(0)}% de lo que te sobra (${fmtMoney(c.capacidadAhorro)}/mes). Un imprevisto te mueve el plan: baja gustos o mueve la fecha 1-2 meses.`} />;
  }
  const mesesNecesarios = c.capacidadAhorro > 0 ? Math.ceil(c.faltante / c.capacidadAhorro) : 0;
  const body = c.capacidadAhorro <= 0
    ? `Tus gastos (${fmtMoney(c.fijos + c.variables)}/mes) superan tus ingresos (${fmtMoney(c.ingreso)}/mes). Primero genera margen recortando gustos o subiendo ingresos.`
    : `Te sobran ${fmtMoney(c.capacidadAhorro)}/mes y necesitas ${fmtMoney(c.ahorroRequerido)}/mes. Con tu ritmo actual lo juntas en ${mesesNecesarios} meses: mueve la salida o recorta ${fmtMoney(Math.min(c.recorteSugerido, c.variables || c.recorteSugerido))}/mes en gustos.`;
  return <Verdict icon={<AlertTriangle className="w-5 h-5 text-destructive" />} title="Con tu ritmo actual no alcanza" body={body} />;
};

const ProgressRing = ({ pct }: { pct: number }) => {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-20 h-20 md:w-24 md:h-24 shrink-0" role="img" aria-label={`Llevas el ${pct}% de la meta`}>
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <span className="font-display text-lg md:text-xl leading-none">{pct}%<span className="block text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">ahorrado</span></span>
      </div>
    </div>
  );
};

const SmallNum = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="block min-w-0">
    <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</span>
    <input type="number" inputMode="numeric" min="1" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="w-full min-w-0 rounded-lg bg-background/60 border border-border px-3 py-2.5 text-sm focus:border-primary outline-none" />
  </label>
);

const NumField = ({
  label, value, onChange, placeholder, hint, compact,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; compact?: boolean }) => (
  <label className="block">
    <span className={`block text-[11px] uppercase tracking-wider text-muted-foreground ${compact ? "mb-0.5" : "mb-1.5"}`}>{label}</span>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
      <input
        inputMode="decimal"
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "0"}
        aria-label={label}
        className={`w-full rounded-lg bg-background/60 border border-border pl-6 pr-2 placeholder:text-muted-foreground placeholder:italic ${compact ? "py-1.5 text-sm" : "py-2.5"} focus:border-primary outline-none`}
      />
    </div>
    {hint && <span className="block text-[10px] text-muted-foreground mt-0.5">{hint}</span>}
  </label>
);

const Verdict = ({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) => (
  <div className="flex items-start gap-3">
    <div className="shrink-0 mt-0.5">{icon}</div>
    <div>
      <p className="font-display text-lg md:text-xl mb-1">{title}</p>
      <p className="text-sm text-foreground/80 leading-relaxed">{body}</p>
    </div>
  </div>
);
