// "Ya tengo vuelos y hotel": formulario para crear el viaje con lo que la persona ya compró, sin
// buscar vuelos ni hoteles (0 SerpApi, 0 logistics-plan, 0 IA). Ciudades en orden con el mismo campo
// de destino y la misma expansión de regiones ("Toscana" → Siena · Lucca), fechas por ciudad,
// personas, hotel por ciudad (opcional, se ubica en Google Maps una vez al confirmar) y vuelo
// (opcional, con su seguimiento si la persona lo pide).
import { useMemo, useState } from "react";
import { CalendarDays, Check, Hotel, Minus, Plane, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localISODate } from "@/lib/localDate";
import { usePlaceResolve } from "@/lib/placeResolveClient";
import { expandRegions, placeKey } from "../../../supabase/functions/_shared/regions";
import { RegionBases } from "@/components/route/RegionBases";
import {
  createBroughtTrip, fmtDay, hotelQuery, MAX_BROUGHT_CITIES, MAX_BROUGHT_FLIGHTS, resolveHotels, validateBroughtTrip,
  type BroughtCity, type BroughtError, type BroughtFlight, type ResolvedHotel,
} from "@/lib/broughtTrip";
import { PlaceCombobox } from "./PlaceCombobox";

type CityForm = { llegada: string; salida: string; hotel: string };
const EMPTY: CityForm = { llegada: "", salida: "", hotel: "" };

function DateInput({ id, label, value, min, onChange, invalid }: { id: string; label: string; value: string; min?: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className={`flex items-center gap-2 rounded-xl border bg-black/40 px-3 focus-within:border-primary/60 ${invalid ? "border-amber-400/60" : "border-border/70"}`}>
        <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-primary/80" />
        <input id={id} type="date" value={value} min={min} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full min-w-0 bg-transparent text-sm text-foreground [color-scheme:dark] focus:outline-none" />
      </div>
    </div>
  );
}

const nightsLabel = (a: string, b: string) => {
  if (!a || !b || b <= a) return null;
  const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return `${n} ${n === 1 ? "noche" : "noches"}`;
};

export function BroughtTripForm({ origin, onDone }: { origin?: string | null; onDone: (tripId: string) => void }) {
  const { user } = useAuth();
  const today = localISODate();
  const [stops, setStops] = useState<string[]>([""]);
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [perCity, setPerCity] = useState<Record<string, CityForm>>({});
  const [personas, setPersonas] = useState(2);
  const [flights, setFlights] = useState<BroughtFlight[]>([{ numero: "", fecha: "", seguir: false }]);
  const [resolved, setResolved] = useState<Record<string, ResolvedHotel>>({});
  const [errors, setErrors] = useState<BroughtError[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | "ubicando" | "guardando">(null);

  // Regiones y países que la tabla no conoce: la misma vista previa (place-resolve) del buscador.
  const typed = stops.map((s) => s.trim()).filter(Boolean);
  const { places, lookup } = usePlaceResolve(typed);
  const expansion = useMemo(() => expandRegions(typed, null, choices, lookup), [typed.join("|"), choices, lookup]); // eslint-disable-line react-hooks/exhaustive-deps
  const cities = expansion.destinations;
  // Llave de cada ciudad por nombre y aparición (Delhi al llegar y Delhi al final son dos estancias).
  const keyAt = (i: number) => `${placeKey(cities[i])}#${cities.slice(0, i).filter((c) => placeKey(c) === placeKey(cities[i])).length}`;
  const formAt = (i: number) => perCity[keyAt(i)] ?? EMPTY;

  const touch = () => { setConfirming(false); setErrors([]); };
  const setCity = (i: number, patch: Partial<CityForm>) => {
    touch();
    setPerCity((prev) => {
      const next = { ...prev };
      const k = keyAt(i);
      next[k] = { ...(prev[k] ?? EMPTY), ...patch };
      // La llegada a la siguiente ciudad es, casi siempre, el día que sales de esta.
      if (patch.salida && cities[i + 1]) {
        const nk = keyAt(i + 1);
        if (!(prev[nk]?.llegada)) next[nk] = { ...(prev[nk] ?? EMPTY), llegada: patch.salida };
      }
      return next;
    });
  };
  const setStop = (i: number, v: string) => { touch(); setStops((s) => s.map((x, j) => (j === i ? v : x))); };
  const addStop = () => setStops((s) => (s.length >= MAX_BROUGHT_CITIES ? s : [...s, ""]));
  const removeStop = (i: number) => { touch(); setStops((s) => (s.length <= 1 ? [""] : s.filter((_, j) => j !== i))); };
  const setFlight = (i: number, patch: Partial<BroughtFlight>) => { touch(); setFlights((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x))); };

  const input = (): { cities: BroughtCity[]; flights: BroughtFlight[] } => ({
    cities: cities.map((c, i) => ({ ciudad: c, llegada: formAt(i).llegada, salida: formAt(i).salida, hotel: formAt(i).hotel.trim() || null })),
    flights: flights.filter((f) => f.numero.trim() || f.fecha),
  });
  const hotelAt = (i: number) => resolved[placeKey(hotelQuery(formAt(i).hotel, cities[i]))] ?? null;
  const withHotel = cities.map((c, i) => ({ c, i })).filter(({ i }) => formAt(i).hotel.trim());

  async function save() {
    if (!user) { setErrors([{ campo: "guardar", mensaje: "Inicia sesión para guardar tu viaje." }]); return; }
    setBusy("guardando");
    const { cities: cs, flights: fs } = input();
    const r = await createBroughtTrip(supabase as any, {
      userId: user.id, cities: cs, personas, origin: origin ?? null, flights: fs, expansions: expansion.expansions, today,
    }, { resolved });
    setResolved(r.resolved);
    setBusy(null);
    if ("errors" in r) { setErrors(r.errors); setConfirming(false); return; }
    for (const w of r.warnings) toast.warning(w);
    toast.success("Viaje guardado", { description: "Vuelos y hotel quedan como «Ya los tienes»." });
    onDone(r.tripId);
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const { cities: cs, flights: fs } = input();
    const errs = validateBroughtTrip({ cities: cs, personas, flights: fs, today });
    if (errs.length) { setErrors(errs); return; }
    if (!cs.some((c) => c.hotel)) { await save(); return; }
    if (!confirming) {
      // Una llamada por hotel nuevo (Google Maps), solo ahora; lo ya ubicado no se vuelve a buscar.
      setBusy("ubicando");
      const copy = { ...resolved };
      const r = await resolveHotels(supabase as any, cs, copy);
      setResolved(copy);
      setBusy(null);
      if (r.errors.length) { setErrors(r.errors); return; }
      setErrors([]);
      setConfirming(true);
      return;
    }
    await save();
  }

  const errFor = (campo: BroughtError["campo"], i?: number) => errors.filter((e) => e.campo === campo && (i === undefined ? e.index === undefined : e.index === i));
  const general = errors.filter((e) => e.index === undefined || e.campo === "guardar");
  const ErrLines = ({ list }: { list: BroughtError[] }) => list.length ? (
    <div className="mt-1.5 space-y-0.5" role="alert">{list.map((e, k) => <p key={k} className="text-xs text-amber-400/90">{e.mensaje}</p>)}</div>
  ) : null;

  return (
    <form onSubmit={submit} noValidate data-testid="brought-form" className="mt-5 space-y-6">
      <p className="rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3 text-sm text-muted-foreground">
        Ya compraste vuelos y hotel: dinos tus ciudades y fechas. <span className="text-foreground">No buscamos vuelos ni hoteles</span>; aquí armas restaurantes, museos, tours y experiencias.
      </p>

      {/* 1 · Ciudades en orden */}
      <section aria-labelledby="ya-ciudades">
        <h3 id="ya-ciudades" className="text-sm font-medium text-foreground">Ciudades en orden</h3>
        <ol className="mt-2 space-y-2" aria-label="Ciudades del viaje">
          {stops.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs text-primary">{i + 1}</span>
              <PlaceCombobox className="flex-1" label={`Ciudad ${i + 1}`} value={s} onChange={(v) => setStop(i, v)}
                placeholder={i === 0 ? "Ciudad, región o país (ej. Roma)" : "Siguiente ciudad"} icon={<Search className="h-4 w-4" />} />
              {stops.length > 1 && (
                <button type="button" onClick={() => removeStop(i)} aria-label={`Quitar ciudad ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <Trash2 aria-hidden className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
        <RegionBases stops={typed} nights={null} choices={choices} onChange={(c) => { touch(); setChoices(c); }} places={places}
          onPick={(inp, label) => setStops((s) => s.map((x) => (placeKey(x) === placeKey(inp) ? label : x)))} />
        <button type="button" onClick={addStop} disabled={stops.length >= MAX_BROUGHT_CITIES}
          className="mt-2 flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-2 text-xs text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Plus aria-hidden className="h-3.5 w-3.5" /> Agregar ciudad
        </button>
        <ErrLines list={errFor("ciudades").concat(errors.filter((e) => e.campo === "ciudades" && e.index !== undefined))} />
      </section>

      {/* 2 · Fechas y hotel por ciudad (las bases ya expandidas) */}
      {cities.length > 0 && (
        <section aria-labelledby="ya-fechas">
          <h3 id="ya-fechas" className="text-sm font-medium text-foreground">Fechas y hotel por ciudad</h3>
          <ol className="mt-2 space-y-3">
            {cities.map((c, i) => {
              const f = formAt(i);
              const prevSalida = i > 0 ? formAt(i - 1).salida : "";
              const dateErr = errFor("fechas", i);
              const hotelErr = errFor("hotel", i);
              const h = f.hotel.trim() ? hotelAt(i) : null;
              const nl = nightsLabel(f.llegada, f.salida);
              return (
                <li key={`${c}-${i}`} data-testid="brought-city" data-city={c} className="rounded-2xl border border-border/50 bg-black/20 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.18em] text-primary">{c}</p>
                    {nl && <p className="text-[11px] text-muted-foreground">{nl}</p>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <DateInput id={`ya-llegada-${i}`} label={`Llegas a ${c}`} value={f.llegada} min={prevSalida || today} invalid={dateErr.length > 0}
                      onChange={(v) => setCity(i, { llegada: v })} />
                    <DateInput id={`ya-salida-${i}`} label={`Sales de ${c}`} value={f.salida} min={f.llegada || prevSalida || today} invalid={dateErr.length > 0}
                      onChange={(v) => setCity(i, { salida: v })} />
                  </div>
                  <ErrLines list={dateErr} />
                  <label htmlFor={`ya-hotel-${i}`} className="mt-2 block text-xs text-muted-foreground">Tu hotel en {c} (opcional)</label>
                  <div className={`mt-1 flex items-center gap-2 rounded-xl border bg-black/40 px-3 focus-within:border-primary/60 ${hotelErr.length ? "border-amber-400/60" : "border-border/70"}`}>
                    <Hotel aria-hidden className="h-4 w-4 shrink-0 text-primary/80" />
                    <input id={`ya-hotel-${i}`} value={f.hotel} maxLength={200} autoComplete="off" onChange={(e) => setCity(i, { hotel: e.target.value })}
                      placeholder="Nombre o dirección del hotel" className="h-11 w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
                  </div>
                  {h && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-emerald-400" data-testid="brought-hotel-ok">
                      <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="min-w-0 break-words">{h.nombre}{h.direccion ? ` · ${h.direccion}` : ""} <span className="text-muted-foreground">(Google Maps)</span></span>
                    </p>
                  )}
                  <ErrLines list={hotelErr} />
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* 3 · Personas */}
      <section aria-labelledby="ya-personas" className="flex items-center justify-between gap-4">
        <h3 id="ya-personas" className="text-sm font-medium text-foreground">Personas</h3>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Menos personas" disabled={personas <= 1} onClick={() => { touch(); setPersonas((n) => n - 1); }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Minus aria-hidden className="h-4 w-4" />
          </button>
          <span className="w-6 text-center text-sm tabular-nums" aria-live="polite" data-testid="brought-personas">{personas}</span>
          <button type="button" aria-label="Más personas" disabled={personas >= 20} onClick={() => { touch(); setPersonas((n) => n + 1); }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Plus aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </section>
      <ErrLines list={errFor("personas")} />

      {/* 4 · Vuelo (opcional) */}
      <section aria-labelledby="ya-vuelo">
        <h3 id="ya-vuelo" className="flex items-center gap-2 text-sm font-medium text-foreground"><Plane aria-hidden className="h-4 w-4 text-primary" /> Tu vuelo (opcional)</h3>
        <ol className="mt-2 space-y-3">
          {flights.map((f, i) => (
            <li key={i} className="rounded-2xl border border-border/50 bg-black/20 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label htmlFor={`ya-vuelo-num-${i}`} className="mb-1 block text-xs text-muted-foreground">Número de vuelo</label>
                  <input id={`ya-vuelo-num-${i}`} value={f.numero} maxLength={10} autoComplete="off" placeholder="AM 17" onChange={(e) => setFlight(i, { numero: e.target.value })}
                    className="h-11 w-full min-w-0 rounded-xl border border-border/70 bg-black/40 px-3 text-sm uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none" />
                </div>
                <DateInput id={`ya-vuelo-fecha-${i}`} label="Fecha del vuelo" value={f.fecha} onChange={(v) => setFlight(i, { fecha: v })} invalid={errFor("vuelo", i).length > 0} />
              </div>
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-foreground">
                <input type="checkbox" checked={!!f.seguir} onChange={(e) => setFlight(i, { seguir: e.target.checked })} className="mt-0.5 accent-[hsl(var(--primary))]" />
                <span>Avisarme del estado de este vuelo
                  <span className="block text-[11px] text-muted-foreground">Usa uno de los vuelos que tu plan permite seguir. Con el plan gratuito, solo el día del vuelo.</span>
                </span>
              </label>
              <ErrLines list={errFor("vuelo", i)} />
            </li>
          ))}
        </ol>
        {flights.length < MAX_BROUGHT_FLIGHTS && (
          <button type="button" onClick={() => setFlights((f) => [...f, { numero: "", fecha: "", seguir: false }])}
            className="mt-2 flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-2 text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Plus aria-hidden className="h-3.5 w-3.5" /> Agregar otro vuelo
          </button>
        )}
        <ErrLines list={errFor("vuelo")} />
      </section>

      {/* Confirmación de los hoteles ubicados (antes de guardar) */}
      {confirming && withHotel.length > 0 && (
        <section aria-labelledby="ya-confirmar" data-testid="brought-confirm" className="rounded-2xl border border-primary/40 bg-primary/[0.06] p-4">
          <h3 id="ya-confirmar" className="text-sm font-medium text-foreground">Así encontramos tus hoteles en Google Maps</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {withHotel.map(({ c, i }) => {
              const h = hotelAt(i);
              return h ? (
                <li key={`${c}-${i}`} className="flex items-start gap-2"><Hotel aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 break-words"><span className="text-primary">{c}:</span> {h.nombre}{h.direccion ? <span className="text-muted-foreground"> · {h.direccion}</span> : null}</span></li>
              ) : null;
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">¿Alguno no es? Corrige su nombre o escribe la dirección.</p>
        </section>
      )}

      <ErrLines list={general.filter((e) => e.campo !== "ciudades" && e.campo !== "personas" && e.campo !== "vuelo")} />

      <div className="flex flex-col items-center gap-2">
        <button type="submit" disabled={!!busy} data-testid="brought-save"
          className="flex min-h-[48px] items-center gap-2 rounded-full bg-gradient-gold px-8 text-sm font-medium tracking-wide text-primary-foreground shadow-[0_10px_30px_-10px_hsl(41_47%_59%/0.7)] hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          {busy === "ubicando" ? "Ubicando tus hoteles…" : busy === "guardando" ? "Guardando…" : confirming ? "Confirmar y guardar" : "Guardar mi viaje"}
        </button>
        <p className="text-center text-[11px] text-muted-foreground">
          No buscamos vuelos ni hoteles: vuelos y hotel quedan como «Ya los tienes» y no se suman al total.
          {cities.length > 0 && formAt(0).llegada && formAt(cities.length - 1).salida
            ? ` Del ${fmtDay(formAt(0).llegada)} al ${fmtDay(formAt(cities.length - 1).salida)}.` : ""}
        </p>
      </div>
    </form>
  );
}

export default BroughtTripForm;
