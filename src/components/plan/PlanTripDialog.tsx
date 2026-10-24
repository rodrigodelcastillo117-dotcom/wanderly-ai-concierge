// Ventana "Planear viaje": la nueva puerta de entrada (la ruta /dashboard/planear y sus flujos
// siguen igual). Buscador simple → "Explorar" lleva al flujo REAL con todo lleno (exploreTarget):
// ciudad → asistente de planear; país o varias ciudades → ruta multidestino. Debajo, "¿Flexible?"
// (la frase libre → el mismo parseo de siempre, /dashboard/planear?q=) y "Vuelos baratos desde…".
//
// Gasto: abrir la ventana solo LEE la caché compartida (fetchExplore sin live). Una búsqueda de
// precios nueva solo ocurre al pulsar "Explorar destinos" (en esa pantalla, con cuota y freno).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, CalendarDays, Minus, Plus, Search, Sparkles, Trash2, Users, Map as MapIcon, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { diffLocalDays, localISODatePlus } from "@/lib/localDate";
import { countryRouteFor } from "@/lib/countryRoutes";
import { usePlaceResolve } from "@/lib/placeResolveClient";
import { expandRegions } from "../../../supabase/functions/_shared/regions";
import { RegionBases } from "@/components/route/RegionBases";
import {
  CABIN_LABEL, cachedExplore, DEFAULT_ORIGIN, exploreTarget, fetchExplore, flightSearchPath, originChips,
  type CabinClass, type ExploreState, type Leg, type PlanForm, type TripKind,
} from "@/lib/exploreFlights";
import { PlaceCombobox } from "./PlaceCombobox";
import { FareCard } from "./DestinationCards";
import { ExploreMap } from "./ExploreMap";

const KINDS: Array<{ k: TripKind; label: string }> = [
  { k: "redondo", label: "Ida y vuelta" },
  { k: "sencillo", label: "Solo ida" },
  { k: "multi", label: "Varias ciudades" },
];

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Menos ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Minus aria-hidden className="h-4 w-4" />
        </button>
        <span className="w-5 text-center text-sm tabular-nums" aria-live="polite">{value}</span>
        <button type="button" aria-label={`Más ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Plus aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DateField({ id, label, value, min, onChange }: { id: string; label: string; value: string; min?: string; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-black/40 px-3 focus-within:border-primary/60">
        <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-primary/80" />
        <input id={id} type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full min-w-0 bg-transparent text-sm text-foreground [color-scheme:dark] focus:outline-none" />
      </div>
    </div>
  );
}

export function PlanTripDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [kind, setKind] = useState<TripKind>("redondo");
  const [adults, setAdults] = useState(2);
  const [minors, setMinors] = useState(0);
  const [cabin, setCabin] = useState<CabinClass>("turista");
  const [userOrigin, setUserOrigin] = useState<string | null>(null);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [originTouched, setOriginTouched] = useState(false);
  const [destination, setDestination] = useState("");
  const [depart, setDepart] = useState("");
  const [ret, setRet] = useState("");
  const [legs, setLegs] = useState<Leg[]>([{ from: DEFAULT_ORIGIN, to: "", date: "" }, { from: "", to: "", date: "" }]);
  const [libre, setLibre] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [cheapFrom, setCheapFrom] = useState(DEFAULT_ORIGIN);
  const [cheap, setCheap] = useState<ExploreState | null>(null);
  const [cheapLoading, setCheapLoading] = useState(false);
  const today = localISODatePlus(0);
  // Destino que el catálogo no conoce (Baviera, Ruta 66, un pueblo…): vista previa con place-resolve solo
  // cuando la persona lo escribe; la tabla curada de países y regiones va primero y no consulta nada.
  const [destTyped, setDestTyped] = useState(false);
  const [destChoices, setDestChoices] = useState<Record<string, string[]>>({});
  const destNeeds = open && kind !== "multi" && destTyped && !countryRouteFor(destination);
  const { places: destPlaces, lookup: destLookup } = usePlaceResolve(destNeeds ? [destination] : []);
  const destNights = kind === "redondo" && depart && ret ? diffLocalDays(depart, ret) : 0;

  // Origen del perfil (ciudad_origen), si existe; si no, Ciudad de México.
  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    Promise.resolve(supabase.from("profiles").select("ciudad_origen").eq("id", user.id).maybeSingle())
      .then(({ data }) => {
        const c = typeof data?.ciudad_origen === "string" ? data.ciudad_origen.trim() : "";
        if (!alive || !c) return;
        setUserOrigin(c);
        if (!originTouched) {
          setOrigin(c);
          setLegs((l) => (l[0] && (!l[0].from || l[0].from === DEFAULT_ORIGIN) ? [{ ...l[0], from: c }, ...l.slice(1)] : l));
        }
        setCheapFrom((prev) => (prev === DEFAULT_ORIGIN ? c : prev));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  // "Vuelos baratos desde…": solo la caché vigente (sin gasto). Se lee al abrir y al cambiar de chip.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const memo = cachedExplore(cheapFrom);
    if (memo) { setCheap(memo); return; }
    setCheapLoading(true);
    fetchExplore(cheapFrom)
      .then((s) => alive && setCheap(s))
      .catch(() => alive && setCheap({ estado: "sin_precios", motivo: "No pudimos leer los precios guardados ahora.", limite: false }))
      .finally(() => alive && setCheapLoading(false));
    return () => { alive = false; };
  }, [open, cheapFrom]);

  const chips = useMemo(() => originChips(userOrigin), [userOrigin]);
  const travelersText = `${adults + minors} ${adults + minors === 1 ? "pasajero" : "pasajeros"}`;

  const swap = () => {
    setOrigin(destination || "");
    setDestination(origin);
    setOriginTouched(true);
    setDestTyped(true);
  };

  const go = (path: string) => {
    onOpenChange(false);
    // "ventana": marca única para que la página destino, si ya estaba abierta (misma ruta), vuelva a
    // leer lo elegido aquí; sin esto MultiDestRoute conservaba las fechas viejas (E2E 23-oct, D1).
    navigate(path, { state: { ventana: Date.now() } });
  };

  const explore = () => {
    const form: PlanForm = { kind, adults, minors, cabin, origin, destination, depart, ret, legs };
    if (kind !== "multi" && !destination.trim()) { setFormError("Escribe a dónde quieres ir: una ciudad o un país."); return; }
    if (kind === "redondo" && depart && ret && ret <= depart) { setFormError("El regreso debe ser después de la salida."); return; }
    const t = exploreTarget(form);
    if (!t) { setFormError("Agrega al menos un tramo con destino."); return; }
    setFormError(null);
    // País o región fuera de la tabla, o carretera con paradas: la ruta por sus ciudades reales (Wikidata).
    const region = t.flow === "planear" && kind !== "multi" ? destLookup(destination) : null;
    if (region) {
      const r = expandRegions([destination], destNights > 0 ? [destNights] : null, destChoices, destLookup);
      const viajeros = String(Math.max(1, adults + minors));
      if (r.destinations.length >= 2) {
        const qs = new URLSearchParams({ origin: origin.trim() || DEFAULT_ORIGIN, destinos: r.destinations.join("|"), viajeros });
        if (depart) qs.set("fecha_salida", depart);
        if (kind === "redondo" && ret) qs.set("fecha_regreso", ret);
        if (Array.isArray(r.nightsPerCity) && r.nightsPerCity.length === r.destinations.length) qs.set("noches", r.nightsPerCity.join("|"));
        if (region.kind === "route") qs.set("modo", "coche");
        go(`/dashboard/ruta?${qs.toString()}`);
        return;
      }
      if (r.destinations.length === 1) {
        go(t.path.replace(/([?&]destino=)[^&]*/, `$1${encodeURIComponent(r.destinations[0])}`));
        return;
      }
    }
    go(t.path);
  };

  const exploreWithIato = () => {
    const q = libre.trim();
    go(q ? `/dashboard/planear?q=${encodeURIComponent(q)}` : "/dashboard/planear");
  };

  const setLeg = (i: number, patch: Partial<Leg>) => setLegs((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addLeg = () => setLegs((l) => (l.length >= 6 ? l : [...l, { from: l[l.length - 1]?.to ?? "", to: "", date: "" }]));
  const removeLeg = (i: number) => setLegs((l) => (l.length <= 2 ? l : l.filter((_, j) => j !== i)));

  const cheapList = cheap?.estado === "ok" ? cheap.destinos.filter((d) => d.precio_mxn != null).slice(0, 3) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="plan-dialog"
        className="left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto overflow-x-hidden rounded-none border-primary/15 bg-[#070707] p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl"
      >
        <div className="px-4 pb-6 pt-5 sm:px-7 sm:pt-7">
          <DialogTitle className="font-display text-xl text-foreground">Planear viaje</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Dinos de dónde sales y a dónde vas. Te llevamos al plan con todo lleno para que lo revises.
          </DialogDescription>

          {/* Tipo de viaje, pasajeros y clase */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Tipo de viaje" className="flex rounded-full border border-border/60 bg-black/40 p-1">
              {KINDS.map((o) => (
                <button key={o.k} type="button" role="radio" aria-checked={kind === o.k} onClick={() => setKind(o.k)}
                  className={`rounded-full px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${kind === o.k ? "bg-gradient-gold text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={`Pasajeros: ${adults} adultos, ${minors} menores`}
                  className="flex items-center gap-1.5 rounded-full border border-border/60 bg-black/40 px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <Users aria-hidden className="h-3.5 w-3.5 text-primary" /> {travelersText}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 border-primary/20 bg-[#0b0b0b]">
                <Stepper label="Adultos" value={adults} min={1} max={9} onChange={setAdults} />
                <Stepper label="Menores" value={minors} min={0} max={8} onChange={setMinors} />
              </PopoverContent>
            </Popover>
            <label className="sr-only" htmlFor="plan-clase">Clase</label>
            <select id="plan-clase" value={cabin} onChange={(e) => setCabin(e.target.value as CabinClass)}
              className="rounded-full border border-border/60 bg-black/40 px-3 py-2 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {(Object.keys(CABIN_LABEL) as CabinClass[]).map((c) => <option key={c} value={c}>{CABIN_LABEL[c]}</option>)}
            </select>
          </div>

          {/* Campos */}
          {kind !== "multi" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <PlaceCombobox label="Origen" value={origin} citiesOnly onChange={(v) => { setOrigin(v); setOriginTouched(true); }} placeholder="¿Desde dónde?" />
              <button type="button" onClick={swap} aria-label="Invertir origen y destino"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:mt-1">
                <ArrowLeftRight aria-hidden className="h-4 w-4 rotate-90 sm:rotate-0" />
              </button>
              <PlaceCombobox label="¿A dónde?" value={destination} onChange={(v) => { setDestination(v); setDestTyped(true); }} placeholder="¿A dónde? Ciudad o país" icon={<Search className="h-4 w-4" />} />
              {destNeeds && destPlaces.some((p) => p.status === "needs_clarification" || p.kind === "route" || !!destLookup(p.input)) && (
                <div className="-mt-2 sm:col-span-3">
                  <RegionBases stops={[destination.trim()]} nights={destNights > 0 ? [destNights] : null} choices={destChoices} onChange={setDestChoices}
                    places={destPlaces} onPick={(_input, label) => setDestination(label)} />
                </div>
              )}
              <div className={`grid gap-3 sm:col-span-3 ${kind === "redondo" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
                <DateField id="plan-salida" label="Salida" value={depart} min={today} onChange={setDepart} />
                {kind === "redondo" && <DateField id="plan-regreso" label="Regreso" value={ret} min={depart || today} onChange={setRet} />}
              </div>
            </div>
          ) : (
            <ol className="mt-4 space-y-3" aria-label="Tramos del viaje">
              {legs.map((l, i) => (
                <li key={i} className="grid gap-2 rounded-2xl border border-border/50 p-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
                  <PlaceCombobox label={`Tramo ${i + 1}: origen`} value={l.from} citiesOnly onChange={(v) => setLeg(i, { from: v })} placeholder="Desde" />
                  <PlaceCombobox label={`Tramo ${i + 1}: destino`} value={l.to} citiesOnly onChange={(v) => setLeg(i, { to: v })} placeholder="Hacia" icon={<Search className="h-4 w-4" />} />
                  <DateField id={`plan-tramo-${i}`} label={`Fecha del tramo ${i + 1}`} value={l.date} min={i > 0 ? legs[i - 1].date || today : today} onChange={(v) => setLeg(i, { date: v })} />
                  {legs.length > 2 ? (
                    <button type="button" onClick={() => removeLeg(i)} aria-label={`Quitar tramo ${i + 1}`}
                      className="flex h-12 w-12 items-center justify-center justify-self-end rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </button>
                  ) : <span aria-hidden className="hidden sm:block sm:w-12" />}
                </li>
              ))}
              <li>
                <button type="button" onClick={addLeg} disabled={legs.length >= 6}
                  className="flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-2 text-xs text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <Plus aria-hidden className="h-3.5 w-3.5" /> Agregar tramo
                </button>
              </li>
            </ol>
          )}

          {formError && <p role="alert" className="mt-3 text-sm text-amber-400/90">{formError}</p>}

          <div className="mt-5 flex justify-center">
            <button type="button" onClick={explore}
              className="flex min-h-[48px] items-center gap-2 rounded-full bg-gradient-gold px-8 text-sm font-medium tracking-wide text-primary-foreground shadow-[0_10px_30px_-10px_hsl(41_47%_59%/0.7)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Search aria-hidden className="h-4 w-4" /> Explorar
            </button>
          </div>

          {/* ¿Flexible? */}
          <section aria-labelledby="plan-flexible" className="mt-7 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent p-4 sm:p-5">
            <h3 id="plan-flexible" className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles aria-hidden className="h-4 w-4 text-primary" /> ¿Flexible? Descríbele tu viaje a Iato
            </h3>
            <label htmlFor="plan-libre" className="sr-only">Describe tu viaje</label>
            <textarea id="plan-libre" rows={2} value={libre} onChange={(e) => setLibre(e.target.value)}
              placeholder="Ej.: 10 días por Italia en mayo con mi pareja, comida y museos"
              className="mt-3 w-full resize-none rounded-2xl border border-border/60 bg-black/40 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none" />
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={exploreWithIato}
                className="rounded-full border border-primary/40 px-4 py-2 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Explorar con Iato
              </button>
            </div>
          </section>

          {/* Vuelos baratos desde… (solo precios ya guardados: abrir la ventana no gasta) */}
          <section aria-labelledby="plan-baratos" className="mt-7">
            <h3 id="plan-baratos" className="text-sm font-medium text-foreground">Vuelos baratos desde {cheapFrom}</h3>
            <div role="group" aria-label="Ciudad de salida" className="mt-3 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c} type="button" aria-pressed={cheapFrom === c} onClick={() => setCheapFrom(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cheapFrom === c ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>
                  {c}
                </button>
              ))}
            </div>

            <div className="mt-3" aria-live="polite">
              {cheapLoading && !cheap ? (
                <div className="grid gap-2 sm:grid-cols-3" aria-label="Cargando precios guardados">
                  {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />)}
                </div>
              ) : cheapList.length > 0 && cheap?.estado === "ok" ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {cheapList.map((d) => (
                    <FareCard key={`${d.destino}-${d.salida}`} origin={cheapFrom} d={d} consultadoAt={cheap.consultadoAt}
                      onOpen={() => go(flightSearchPath(cheapFrom, d, adults + minors))} />
                  ))}
                </div>
              ) : (
                <p data-testid="cheap-empty" className="rounded-2xl border border-dashed border-border/60 px-4 py-4 text-sm text-muted-foreground">
                  {cheap?.estado === "sin_precios"
                    ? <>Sin precio ahora. {cheap.motivo}</>
                    : <>Aún no hay precios guardados desde {cheapFrom}. Pulsa <span className="text-foreground">Explorar destinos</span> para consultarlos.</>}
                </p>
              )}
            </div>

            <div className="relative mt-3">
              <ExploreMap compact origin={cheapFrom} destinos={cheap?.estado === "ok" ? cheap.destinos.slice(0, 12) : []}
                label={`Mapa de destinos desde ${cheapFrom}`} className="h-40 sm:h-48" />
              <button type="button" onClick={() => go(`/dashboard/explorar?origen=${encodeURIComponent(cheapFrom)}&buscar=1`)}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-gradient-gold px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <MapIcon aria-hidden className="h-3.5 w-3.5" /> Explorar destinos
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin aria-hidden className="h-3 w-3" /> Precios de referencia por persona, ida y vuelta, en clase turista. Se vuelven a consultar antes de comprar.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlanTripDialog;
