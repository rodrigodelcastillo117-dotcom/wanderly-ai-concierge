import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { clearRouteConsulta, routeConsultaFor } from "@/lib/planDirect";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, MapPin, Plus, X, Sparkles, Train, Mountain, Wallet,
  Car, Luggage, Settings2, Route as RouteIcon, Loader2, Plane, Receipt, Wand2,
} from "lucide-react";
import { SlowLoading } from "@/components/brand/SlowLoading";
import { generateMultiDestTrip } from "@/lib/multiDestGenerate";
import { fitNights, nightsFromQuery } from "@/lib/multiCityText";
import { CityNightsEditor } from "@/components/route/CityNightsEditor";
import { RegionBases } from "@/components/route/RegionBases";
import { expandRegions, findRegion, placeKey } from "../../supabase/functions/_shared/regions.ts";
import { usePlaceResolve } from "@/lib/placeResolveClient";
import { diffLocalDays, formatLocalDate } from "@/lib/localDate";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


import { OriginPicker } from "@/components/OriginPicker";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { lazyWithRetry } from "@/lib/lazyRetry";
// react-globe.gl arrastra three.js (~1.9MB sin comprimir): se carga aparte,
// no bloquea el resto de la página mientras descarga.
const RouteGlobe3D = lazyWithRetry(() =>
  import("@/components/RouteGlobe3D").then((m) => ({ default: m.RouteGlobe3D }))
);

import { PriceSourceBadge } from "@/components/PriceSourceBadge";

import { VoiceInput } from "@/components/VoiceInput";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastFunctionError } from "@/lib/functionErrors";
// roadtrip: coche como modo entre paradas, vista previa estimada y panel del road trip.
import { TransportModePicker } from "@/components/roadtrip/TransportModePicker";
import { RoadTripPanel } from "@/components/roadtrip/RoadTripPanel";
import { buildRoadTripPlan, resolveLegModes, type LegMode, type TransportMode } from "@/lib/roadtrip";


// Dónde va el globo: en computadora (lg), en la columna derecha como siempre; en el celular, ARRIBA, justo
// después del título (antes quedaba hasta abajo de la página y Carlo no lo veía; aprobado por el dueño el
// 30-oct-2026). Se decide con matchMedia para montar UN solo globo (dos lienzos WebGL pesan el doble).
const LG_UP = "(min-width: 1024px)";
function useLgUp(): boolean {
  const [lg, setLg] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(LG_UP)?.matches);
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(LG_UP) : null;
    if (!mq) return;
    const on = () => setLg(!!mq.matches);
    on();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }
    mq.addListener?.(on);
    return () => mq.removeListener?.(on);
  }, []);
  return lg;
}

type ConnStyle = "tiempo" | "paisaje" | "smart";

type RoutePrefs = {
  connection: ConnStyle;
  roadtripStops: boolean;
  luggageLogistics: boolean;
  aiNotes?: string;
  themes?: string[];
  avoid?: string[];
  pace?: string;
  transportPreference?: string;
  budgetStyle?: string;
  summary?: string;
};

const DEFAULT_PREFS: RoutePrefs = {
  connection: "smart",
  roadtripStops: true,
  luggageLogistics: true,
};

const CONNECTION_OPTIONS: {
  id: ConnStyle;
  icon: typeof Train;
  title: string;
  sub: string;
}[] = [
  { id: "tiempo", icon: Train, title: "Optimizar por tiempo", sub: "Vuelos directos y trenes bala" },
  { id: "paisaje", icon: Mountain, title: "Optimizar por paisaje", sub: "Rutas escénicas y panorámicas" },
  { id: "smart", icon: Wallet, title: "Smart Spend", sub: "Mejor relación costo-beneficio" },
];

const MultiDestRoute = () => {
  const { user } = useAuth();
  const lgUp = useLgUp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Seeds desde la URL (cuando llega desde PlanTrip por detección automática)
  const seedDestinos = useMemo(
    () => (params.get("destinos") ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    [params],
  );
  const seedOrigin = params.get("origin") ?? "";
  const [fechaSalida, setFechaSalida] = useState(params.get("fecha_salida") ?? "");
  const [fechaRegreso, setFechaRegreso] = useState(params.get("fecha_regreso") ?? "");
  const [viajeros, setViajeros] = useState<number>(Number(params.get("viajeros") ?? "2"));
  // Las fechas y viajeros elegidos en pantalla se escriben en la URL (sin nueva entrada de historial).
  // Antes solo vivían en el estado: si la página se volvía a montar (recarga, guardia de rutas,
  // reintento del chunk) regresaban a las de la URL y se cotizaba con otras fechas sin avisar
  // (caso 22-oct-2026: el dueño eligió 23 → 30 oct y se guardó 22 oct → 1 nov).
  useEffect(() => {
    const want: Record<string, string> = { fecha_salida: fechaSalida, fecha_regreso: fechaRegreso, viajeros: String(viajeros) };
    if (Object.entries(want).every(([k, v]) => (params.get(k) ?? "") === v)) return;
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(want)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  }, [fechaSalida, fechaRegreso, viajeros]); // eslint-disable-line react-hooks/exhaustive-deps
  const presupuesto = params.get("presupuesto");
  const autoStart = params.get("auto") === "1" && seedDestinos.length >= 1;

  const [origin, setOrigin] = useState(seedOrigin);
  const [stops, setStops] = useState<string[]>(seedDestinos.length ? seedDestinos : ["", ""]);
  const [draft, setDraft] = useState("");
  const [resolvingPrompt, setResolvingPrompt] = useState(false);

  const [tripsCount, setTripsCount] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [prefs, setPrefs] = useState<RoutePrefs>(DEFAULT_PREFS);
  const [emociones, setEmociones] = useState<string[]>([]);
  const [emocionTexto, setEmocionTexto] = useState("");

  const [configOpen, setConfigOpen] = useState(false);
  // roadtrip: ?modo=coche llega desde "Ideas de road trips" o desde Iato.
  const seedMode = params.get("modo");
  const [transportMode, setTransportMode] = useState<TransportMode | null>(
    seedMode === "coche" || seedMode === "tren" || seedMode === "avion" || seedMode === "mixto" ? seedMode : null,
  );
  const [legModesSel, setLegModesSel] = useState<LegMode[]>([]);


  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<null | {
    logistics: any;
    autonomous: boolean;
    tripId?: string;
  }>(null);

  // Veteran when trips_count >= 3 OR strong behavioral signal
  const isVeteran = useMemo(() => {
    if (tripsCount === null) return false;
    return tripsCount >= 3 || confidence >= 20;
  }, [tripsCount, confidence]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ count: tCount }, { count: bCount }, { data: prof }] = await Promise.all([
        supabase.from("trips").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("behavioral_insights").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("profiles").select("ciudad_origen").eq("id", user.id).maybeSingle(),
      ]);
      setTripsCount(tCount ?? 0);
      setConfidence(bCount ?? 0);
      if (prof?.ciudad_origen && !origin) setOrigin(prof.ciudad_origen);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Detecta si los stops actuales parecen frases conversacionales (no ciudades reales)
  const stopsLookLikePhrases = useMemo(() => {
    return stops.some((s) => {
      const t = s.trim();
      if (!t) return false;
      if (t.split(/\s+/).length > 3) return true;
      return /\b(viaje|crea|haz|planea|roadtrip|d[íi]as?|completo|novi[oa]|pareja|familia|norte|sur|este|oeste|regi[óo]n)\b/i.test(t);
    });
  }, [stops]);

  // Si los destinos vienen como frase, llama al AI para extraer ciudades reales.
  useEffect(() => {
    if (!autoStart || !user || resolvingPrompt) return;
    if (!stopsLookLikePhrases) return;
    let cancelled = false;
    (async () => {
      setResolvingPrompt(true);
      try {
        const prompt = `${origin ? `Salgo de ${origin}. ` : ""}${stops.filter(Boolean).join(". ")}. Fechas: ${fechaSalida || "flexible"} a ${fechaRegreso || "flexible"}. Viajeros: ${viajeros}.`;
        const { data, error } = await supabase.functions.invoke("parsear-viaje", { body: { prompt } });
        if (error) throw error;
        const cities: string[] = Array.isArray(data?.destinations) && data.destinations.length
          ? data.destinations
          : [];
        if (!cancelled && cities.length >= 1) {
          setStops(cities);
          toast.success(`IATOS AI detectó ${cities.length} ciudades a visitar`);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("No pudimos interpretar el destino. Edita las ciudades manualmente.");
      } finally {
        if (!cancelled) setResolvingPrompt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, user, stopsLookLikePhrases]);

  // NOTA: ya no auto-generamos la ruta automáticamente.
  // El usuario debe revisar/editar la travesía y pulsar "Generar travesía"
  // para avanzar a la siguiente página.

  // Destinos que la persona escribió en esta pantalla: solo esos se revisan con place-resolve (país,
  // región fuera de la tabla, carretera, pueblo). Lo que llega por la URL al abrir no consulta nada.
  const [typedKeys, setTypedKeys] = useState<Set<string>>(() => new Set());
  const markTyped = (...vals: string[]) =>
    setTypedKeys((prev) => {
      const next = new Set(prev);
      for (const v of vals) if (v.trim()) next.add(placeKey(v));
      return next;
    });

  const addStop = () => {
    const v = draft.trim();
    if (!v) return;
    setStops((s) => [...s.filter(Boolean), v]);
    markTyped(v);
    setDraft("");
  };

  const [editingWithAI, setEditingWithAI] = useState(false);
  const editStopsWithAI = async () => {
    const instruction = draft.trim();
    if (!instruction) {
      toast.error("Escribe una instrucción para la IA");
      return;
    }
    setEditingWithAI(true);
    try {
      const current = stops.filter(Boolean);
      const prompt = `Lista actual de ciudades del viaje en orden: ${current.length ? current.join(" → ") : "(vacía)"}.

Instrucción del usuario: "${instruction}"

Aplica la instrucción (puede pedir agregar, quitar, reemplazar, reordenar o expandir una región). Devuelve la lista FINAL actualizada de ciudades reales en el campo "destinations" en el orden que tenga más sentido logístico.`;
      const { data, error } = await supabase.functions.invoke("parsear-viaje", { body: { prompt } });
      if (error) throw error;
      const cities: string[] = Array.isArray(data?.destinations) ? data.destinations.filter(Boolean) : [];
      if (cities.length === 0) {
        toast.error("La IA no devolvió ciudades válidas. Intenta de nuevo.");
        return;
      }
      setStops(cities);
      markTyped(...cities);
      setDraft("");
      toast.success(`IATOS AI actualizó tu ruta · ${cities.length} ciudades`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pude editar la ruta con IA");
    } finally {
      setEditingWithAI(false);
    }
  };

  const removeStop = (i: number) => setStops((s) => s.filter((_, idx) => idx !== i));


  const validStops = stops.map((s) => s.trim()).filter(Boolean);
  // País / región / carretera que la tabla no conoce → "Francia → París · Lyon" (Google + Wikidata).
  const { places, lookup: placeRegion } = usePlaceResolve(validStops.filter((s) => typedKeys.has(placeKey(s))));
  const pickPlace = (input: string, label: string) => {
    setStops((arr) => arr.map((x) => (placeKey(x) === placeKey(input) ? label : x)));
    markTyped(label);
  };

  // Noches por ciudad (?noches=3|3|3 desde el planeador o "Convertir en ruta"): siempre suman las noches
  // del viaje; si cambian las fechas o las ciudades, se vuelven a repartir como el servidor.
  const [nightsSel, setNightsSel] = useState<number[] | null>(() => nightsFromQuery(params.get("noches")));
  // La ventana de "Planear viaje" puede volver a mandar aquí estando ya en esta página (misma ruta, no se
  // vuelve a montar): con su marca nueva se toma lo que trae la URL (ciudades, fechas, noches, viajeros).
  const location = useLocation();
  const ventana = (location.state as { ventana?: number } | null)?.ventana;
  const ventanaVista = useRef(ventana);
  useEffect(() => {
    if (!ventana || ventana === ventanaVista.current) return;
    ventanaVista.current = ventana;
    const dest = (params.get("destinos") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
    if (dest.length) setStops(dest);
    const o = params.get("origin");
    if (o) setOrigin(o);
    setFechaSalida(params.get("fecha_salida") ?? "");
    setFechaRegreso(params.get("fecha_regreso") ?? "");
    setViajeros(Number(params.get("viajeros") ?? "2") || 2);
    setNightsSel(nightsFromQuery(params.get("noches")));
  }, [ventana]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalNights = fechaSalida && fechaRegreso ? diffLocalDays(fechaSalida, fechaRegreso) : 0;
  const nightsPerCity = useMemo(
    () => fitNights(nightsSel, validStops.length, totalNights),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nightsSel, validStops.length, totalNights],
  );
  const fromTripId = params.get("desde_viaje");
  // Regiones (Toscana) → bases de la tabla; lo que la persona quite o sume aquí viaja al servidor.
  const [regionBases, setRegionBases] = useState<Record<string, string[]>>({});
  const regionBasesSent = useMemo(() => {
    const present = new Set(validStops.map((s) => (findRegion(s) ?? placeRegion(s))?.name).filter(Boolean));
    return Object.fromEntries(Object.entries(regionBases).filter(([k]) => present.has(k)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionBases, validStops.join("|"), placeRegion]);
  // Un país o una región que se recorre por 2+ ciudades ya es una ruta de varias paradas.
  const expandedCount = useMemo(
    () => expandRegions(validStops, nightsPerCity, regionBasesSent, placeRegion).destinations.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validStops.join("|"), nightsPerCity, regionBasesSent, placeRegion],
  );
  const canStart = origin.trim().length > 1 && (validStops.length >= 2 || expandedCount >= 2);

  // roadtrip: modo por tramo efectivo y vista previa ESTIMADA (sin llamadas de API).
  const legModes = useMemo(
    () => (transportMode ? resolveLegModes(validStops.length, transportMode, legModesSel, "tren") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transportMode, legModesSel, validStops.join("|")],
  );
  const roadPreview = useMemo(
    () => (legModes.includes("coche") ? buildRoadTripPlan({ stops: validStops, legModes }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legModes, validStops.join("|")],
  );

  const handleStart = () => {
    if (!canStart) {
      toast.error("Agrega un origen y al menos 2 destinos");
      return;
    }
    if (isVeteran) {
      generateRoute(DEFAULT_PREFS, true);
    } else {
      setConfigOpen(true);
    }
  };




  const generateRoute = async (pIn: RoutePrefs, autonomous: boolean) => {
    const emocionParts = [...emociones, emocionTexto.trim()].filter(Boolean);
    const p: RoutePrefs = emocionParts.length
      ? { ...pIn, aiNotes: [pIn.aiNotes, `Emoción del viaje: ${emocionParts.join(", ")}. Acopla experiencias, ritmo y restaurantes a esta emoción.`].filter(Boolean).join("\n") }
      : pIn;
    setConfigOpen(false);
    setGenerating(true);
    // Llegó desde el texto de Planear (como antes del 28-oct): el texto original y lo entendido se
    // guardan en el viaje (¿No entendimos bien tu viaje?) y sus preferencias van al plan.
    const fromText = routeConsultaFor(validStops);
    try {
      // Logística real (logistics-plan), filas del viaje y trips.insert: lib compartida con el planeador
      // normal (una ruta escrita en "Planear" sale igual que una armada aquí).
      const { logistics, tripId } = await generateMultiDestTrip(supabase, {
        userId: user?.id ?? null,
        origin,
        stops: validStops,
        fechaSalida,
        fechaRegreso,
        viajeros,
        presupuesto,
        prefs: transportMode ? { ...p, transport_mode: transportMode, leg_modes: legModes } : p,
        nightsPerCity: nightsPerCity,
        regionBases: regionBasesSent,
        telemetry: { autonomous },
        ...(fromText ? { consulta: fromText.consulta, travelerNotes: fromText.notas || null } : {}),
      });
      if (fromText) clearRouteConsulta();

      setGenerated({ logistics, autonomous, tripId });
      toast.success("Travesía lista. Abriendo tu viaje completo…");
      if (tripId) {
        navigate(`/dashboard/viajes/${tripId}`);
      }
    } catch (e: any) {
      console.error(e);
      // Límite del plan → diálogo con "Conocer IATOS PRO"; fallo técnico → "intenta de nuevo".
      await toastFunctionError(e, "No pudimos generar la ruta");
    } finally {
      setGenerating(false);
    }
  };


  // El globo 3D de la ruta (perezoso: three.js baja aparte). Un solo lugar a la vez (ver useLgUp).
  const routeGlobe = (height?: number) => (
    <Suspense fallback={<SlowLoading active size="md" className="h-64 items-center rounded-xl bg-surface" label="Cargando el mapa de tu ruta…"><div className="h-64 rounded-xl bg-surface animate-pulse" /></SlowLoading>}>
      <RouteGlobe3D origin={origin} destinations={validStops} height={height} />
    </Suspense>
  );

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <header className="space-y-2">
          <p className="text-primary text-xs tracking-[0.25em] uppercase">Ruta multi-destino</p>
          <h1 className="font-display text-3xl md:text-5xl">Diseña tu próxima travesía.</h1>
          <p className="text-muted-foreground">
            Encadena 2 o más destinos. IATOS AI optimiza conexiones, paradas y logística.
          </p>
        </header>

        {/* Celular: el globo de la ruta arriba, lo primero que se ve después del título. */}
        {!lgUp && <div data-testid="ruta-globo-arriba">{routeGlobe(300)}</div>}

        {/* grid-cols-1 (minmax(0,1fr)) en móvil: sin él la columna implícita crecía al ancho del contenido
            y la tarjeta quedaba cortada a la derecha (390 px de pantalla, 634 px de columna). */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
          <div className="space-y-8 min-w-0">

        {/* Stops builder */}
        <section className="rounded-3xl border border-border bg-card p-6 md:p-8 space-y-5 premium-shadow">
          <div>
            <label id="ruta-origen" className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">Ciudad de origen</label>
            <OriginPicker labelId="ruta-origen" value={origin} onChange={setOrigin} />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">
              Destinos en orden
            </label>

            <div className="space-y-2">
              {stops.map((s, i) =>
                s.trim() ? (
                  <motion.div
                    key={`${s}-${i}`}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl bg-surface border border-border px-4 py-3"
                  >
                    <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-medium">
                      {i + 1}
                    </span>
                    <MapPin className="w-4 h-4 text-primary/70" />
                    <Input
                      aria-label={`Parada ${i + 1}`}
                      value={s}
                      onChange={(e) => {
                        setStops((arr) => arr.map((x, idx) => (idx === i ? e.target.value : x)));
                        markTyped(e.target.value);
                      }}
                      className="flex-1 bg-transparent border-0 h-auto p-0 focus-visible:ring-0"
                    />
                    <button
                      onClick={() => removeStop(i)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      aria-label="Eliminar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                ) : null,
              )}
            </div>

            <RegionBases stops={validStops} nights={nightsPerCity} choices={regionBases} onChange={setRegionBases} places={places} onPick={pickPlace} />

            <form
              onSubmit={(e) => { e.preventDefault(); addStop(); }}
              className="flex flex-col sm:flex-row gap-2 mt-3"
            >
              <div className="relative flex-1">
                <Input
                  aria-label="Agregar ciudad o pedir un cambio a la IA"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder='Agrega una ciudad (ej. "Kioto") o pide a IA: "quita Praga y agrega Roma"'
                  className="h-12 bg-input border-border pr-12 w-full"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <VoiceInput
                    size="sm"
                    onTranscript={(t) => setDraft((prev) => (prev ? prev + " " : "") + t)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="outline" className="h-12 border-border" disabled={!draft.trim()}>
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
                <Button
                  type="button"
                  onClick={editStopsWithAI}
                  disabled={editingWithAI || !draft.trim()}
                  className="h-12 bg-gradient-gold text-primary-foreground hover:opacity-90"
                >
                  {editingWithAI ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Editando…</>
                  ) : (
                    <><Wand2 className="w-4 h-4 mr-1.5" /> Editar con IA</>
                  )}
                </Button>
              </div>
            </form>
            <SlowLoading active={editingWithAI} size="sm" className="justify-start" label="IATOS AI está editando tu ruta…" />
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              Tip: con "Editar con IA" puedes decir cosas como <span className="text-foreground">"quita Berlín"</span>,
              <span className="text-foreground"> "agrega 2 días en la Toscana"</span> o
              <span className="text-foreground"> "reordena empezando por París"</span>.
            </p>

          </div>

          {validStops.length >= 2 && nightsPerCity && (
            <CityNightsEditor cities={validStops} nights={nightsPerCity} onChange={setNightsSel} />
          )}
          {fromTripId && (
            <p className="text-xs text-muted-foreground" data-testid="ruta-desde-viaje">
              Armamos la ruta con las ciudades de tu viaje. Se guarda como un viaje nuevo; el anterior se queda en Mis viajes.
            </p>
          )}

          {/* roadtrip: modo de transporte entre paradas (avión, tren, coche o mezcla por tramo) */}
          {validStops.length >= 2 && (
            <TransportModePicker stops={validStops} mode={transportMode} legModes={legModes}
              onChange={(m, lm) => { setTransportMode(m); setLegModesSel(lm); }} />
          )}

          {/* Status pill — phase indicator */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isVeteran ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary">
                  <Sparkles className="w-3 h-3" aria-hidden="true" /> {tripsCount ? `Perfil aprendido de ${tripsCount} ${tripsCount === 1 ? "viaje" : "viajes"}` : "Perfil aprendido de tu actividad"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border">
                  Control manual · {tripsCount ?? "–"} / 3 viajes para autonomía
                </span>
              )}
            </div>

            {fechaSalida && fechaRegreso && diffLocalDays(fechaSalida, fechaRegreso) > 0 && (
              <p className="w-full text-xs text-muted-foreground sm:w-auto" data-testid="ruta-fechas-confirmacion">
                Se cotiza del {formatLocalDate(fechaSalida, { day: "numeric", month: "short" })} al {formatLocalDate(fechaRegreso, { day: "numeric", month: "short" })}
                {" "}· {diffLocalDays(fechaSalida, fechaRegreso)} noches · {viajeros} {viajeros === 1 ? "viajero" : "viajeros"}
              </p>
            )}
            <Button
              onClick={handleStart}
              disabled={!canStart || generating}
              className="h-12 bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizando…</>
              ) : isVeteran ? (
                <><Sparkles className="w-4 h-4 mr-2" /> Generar ruta automáticamente</>
              ) : (
                <><RouteIcon className="w-4 h-4 mr-2" /> Configurar y generar</>
              )}
            </Button>
          </div>
          {/* Generar la travesía consulta vuelos y trayectos reales: pasados 5 s, el globo IATOS. */}
          <SlowLoading active={generating} size="md" label="Optimizando tu ruta: vuelos, trayectos y hospedaje…" />
        </section>

        {/* roadtrip: vista previa estimada de los tramos en coche, costos y avisos por país */}
        {roadPreview && !generated && <RoadTripPanel plan={roadPreview} preview />}

        {/* Emoción del viaje — IATOS AI acopla a esta emoción */}
        <section className="rounded-2xl border border-border bg-background p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-primary">♡</span>
            <h3 className="font-display text-xs md:text-sm uppercase tracking-[0.2em] text-primary">
              ¿Cuál es tu emoción del viaje?
            </h3>
          </div>
          <Input
            aria-label="Emoción del viaje"
            value={emocionTexto}
            onChange={(e) => setEmocionTexto(e.target.value)}
            placeholder='ej. quiero sentir libertad total y aventura'
            className="bg-transparent border-border h-12"
          />
          <div className="flex flex-wrap gap-2">
            {[
              "Aventura adrenalina","Romance y conexión","Lujo y descanso","Cultura profunda",
              "Naturaleza y desconexión","Fiesta y vida nocturna","Gastronomía","Espiritual / mindfulness",
            ].map((em) => {
              const active = emociones.includes(em);
              return (
                <button
                  key={em}
                  type="button"
                  onClick={() => setEmociones((prev) => prev.includes(em) ? prev.filter(x => x !== em) : [...prev, em])}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {em}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Puedes elegir varias emociones · IATOS AI las mezcla y reorganiza experiencias, restaurantes y ritmo.
          </p>
        </section>

        {/* Generated output */}
        <AnimatePresence>
          {generated && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {generated.autonomous && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4 gold-glow"
                >
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm md:text-base">
                        <span className="gold-text font-medium">IATOS AI</span> ha optimizado automáticamente esta ruta
                        (trenes escénicos y logística de equipaje resuelta) basándose en tu estilo de viaje histórico.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfigOpen(true)}
                      className="text-xs text-primary hover:bg-primary/10 shrink-0"
                    >
                      <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                      Ajustar
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Vuelos */}
              {generated.logistics.flights?.length > 0 && (
                <div className="rounded-3xl border border-border bg-card overflow-hidden">
                  <div className="px-5 md:px-6 py-3 border-b border-border flex items-center gap-2 text-sm">
                    <Plane className="w-4 h-4 text-primary" />
                    <span className="text-primary tracking-[0.25em] uppercase text-xs">Vuelos</span>
                  </div>
                  {generated.logistics.flights.map((f: any, i: number) => (
                    <div key={i} className="p-5 md:p-6 border-b border-border last:border-0">
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
                        <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                        <span>{f.from}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span className="text-foreground font-medium">{f.to}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {f.airline_suggested && (
                          <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{f.airline_suggested}</span>
                        )}
                        {f.duration && (
                          <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{f.duration}</span>
                        )}
                        {f.stops && (
                          <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{f.stops}</span>
                        )}
                        {f.price_per_person_usd != null && (
                          <span className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary">
                            ${Math.round(f.price_per_person_usd)} USD / persona
                          </span>
                        )}
                        <PriceSourceBadge source={f.fuente_precio} estado={f.estado_dato} consultadoAt={f.consultado_at} approximateDates={f.approximate_dates} />

                      </div>
                      {f.notes && <p className="text-xs text-muted-foreground mt-2">{f.notes}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Transporte interno */}
              {generated.logistics.internal_transport?.length > 0 && (
                <div className="rounded-3xl border border-border bg-card overflow-hidden">
                  <div className="px-5 md:px-6 py-3 border-b border-border flex items-center gap-2 text-sm">
                    <Train className="w-4 h-4 text-primary" />
                    <span className="text-primary tracking-[0.25em] uppercase text-xs">Transporte interno</span>
                  </div>
                  {generated.logistics.internal_transport.map((leg: any, i: number) => {
                    const Icon = leg.mode === "tren" ? Train
                      : leg.mode === "roadtrip" ? Car
                      : leg.mode === "vuelo_interno" ? Plane
                      : Mountain;
                    return (
                      <div key={i} className="p-5 md:p-6 border-b border-border last:border-0">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
                          <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                          <span>{leg.from}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span className="text-foreground font-medium">{leg.to}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2 text-xs">
                          <span className="px-2.5 py-1 rounded-full bg-surface border border-border inline-flex items-center gap-1.5">
                            <Icon className="w-3 h-3 text-primary" />
                            {leg.provider || leg.mode}
                            {leg.scenic ? " · escénico" : ""}
                          </span>
                          {leg.duration && (
                            <span className="px-2.5 py-1 rounded-full bg-surface border border-border">{leg.duration}</span>
                          )}
                          {leg.price_per_person_usd != null && (
                            <span className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary">
                              ${Math.round(leg.price_per_person_usd)} USD / persona
                            </span>
                          )}
                          <PriceSourceBadge source={leg.fuente_precio} estado={leg.estado_dato} consultadoAt={leg.consultado_at} approximateDates={leg.approximate_dates} />

                          {leg.luggage_note && (
                            <span className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary inline-flex items-center gap-1.5">
                              <Luggage className="w-3 h-3" /> {leg.luggage_note}
                            </span>
                          )}
                        </div>
                        {leg.suggested_stops?.length > 0 && (
                          <div className="mt-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Car className="w-3 h-3" /> Paradas sugeridas:
                            </div>
                            <ul className="pl-5 list-disc space-y-0.5">
                              {leg.suggested_stops.map((s: any, j: number) => (
                                <li key={j}>
                                  <span className="text-foreground">{s.name}</span>
                                  {s.why ? ` — ${s.why}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* roadtrip: tramos en coche con distancias de Google Maps, costos y renta del auto */}
              <RoadTripPanel plan={generated.logistics.road_trip} tripId={generated.tripId ?? null} returnCity={validStops[0]} />

              {/* Transporte local */}
              {generated.logistics.local_transport_tips?.length > 0 && (
                <div className="rounded-3xl border border-border bg-card p-5 md:p-6">
                  <div className="flex items-center gap-2 text-xs text-primary tracking-[0.25em] uppercase mb-3">
                    <MapPin className="w-3.5 h-3.5" /> Transporte local
                  </div>
                  <ul className="space-y-2 text-sm">
                    {generated.logistics.local_transport_tips.map((t: any, i: number) => (
                      <li key={i} className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-foreground">{t.city}</p>
                          <p className="text-xs text-muted-foreground">{t.recommendation}</p>
                        </div>
                        {t.est_daily_usd != null && (
                          <span className="text-xs text-primary whitespace-nowrap">
                            ~${Math.round(t.est_daily_usd)} USD / día
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Costos obligatorios */}
              {generated.logistics.mandatory_costs && (
                <div className="rounded-3xl border border-primary/30 bg-card p-5 md:p-6">
                  <div className="flex items-center gap-2 text-xs text-primary tracking-[0.25em] uppercase mb-3">
                    <Receipt className="w-3.5 h-3.5" /> Costos obligatorios
                  </div>
                  <ul className="text-sm space-y-1.5 text-muted-foreground">
                    <li className="flex justify-between"><span>City taxes</span><span className="text-foreground">${Math.round(generated.logistics.mandatory_costs.city_taxes_usd || 0)} USD</span></li>
                    <li className="flex justify-between"><span>Visados</span><span className="text-foreground">${Math.round(generated.logistics.mandatory_costs.visa_fees_usd || 0)} USD</span></li>
                    <li className="flex justify-between">
                      <span>Buffer cambiario ({generated.logistics.mandatory_costs.currency_buffer_pct ?? 3}%)</span>
                      <span className="text-foreground">${Math.round(generated.logistics.mandatory_costs.currency_buffer_usd || 0)} USD</span>
                    </li>
                  </ul>
                  {generated.logistics.mandatory_costs.notes && (
                    <p className="text-xs text-muted-foreground mt-3">{generated.logistics.mandatory_costs.notes}</p>
                  )}
                </div>
              )}

              {/* Hospedaje y experiencias por ciudad */}
              {generated.logistics.per_destination?.length > 0 && (
                <div className="rounded-3xl border border-border bg-card overflow-hidden">
                  <div className="px-5 md:px-6 py-3 border-b border-border flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="text-primary tracking-[0.25em] uppercase text-xs">Hospedaje y experiencias</span>
                  </div>
                  {generated.logistics.per_destination.map((pd: any, i: number) => (
                    <div key={i} className="p-5 md:p-6 border-b border-border last:border-0 space-y-3">
                      <p className="text-sm text-foreground font-medium">
                        {pd.city}
                        <span className="text-xs text-muted-foreground ml-2">{pd.nights} noche(s)</span>
                      </p>
                      <ul className="space-y-2 text-sm">
                        {(pd.hospedaje ?? []).map((h: any, j: number) => (
                          <li key={j} className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs uppercase tracking-widest text-muted-foreground">{h.tier}</span>
                              <span className="text-foreground">{h.nombre}</span>
                              <PriceSourceBadge source={h.fuente_precio} estado={h.estado_dato} consultadoAt={h.consultado_at} approximateDates={h.approximate_dates} />
                            </div>
                            {h.price_per_night_usd != null && (
                              <span className="text-xs text-primary whitespace-nowrap">
                                ${Math.round(h.price_per_night_usd)} USD / noche
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {(pd.experiencias ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {pd.experiencias.map((e: any, j: number) => (
                            <span
                              key={j}
                              className="px-2.5 py-1 rounded-full bg-surface border border-border text-xs inline-flex items-center gap-1.5"
                            >
                              {e.nombre}
                              <PriceSourceBadge source={e.fuente} estado={e.estado_dato} consultadoAt={e.consultado_at} approximateDates={e.approximate_dates} />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Total + CTA al detalle */}
              {generated.logistics.total_estimado_mxn != null && (
                <div className="rounded-3xl border border-border bg-card p-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs tracking-[0.25em] uppercase text-primary mb-1">
                      Total estimado · nivel {generated.logistics.selected_tier ?? "equilibrio"}
                    </p>
                    <p className="font-display text-3xl md:text-4xl gold-text">
                      ${Math.round(generated.logistics.total_estimado_mxn).toLocaleString("es-MX")} MXN
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ≈ ${Math.round(generated.logistics.total_estimado_usd ?? 0).toLocaleString("en-US")} USD
                      {generated.logistics.fx_usd_mxn
                        ? ` · TC ${Number(generated.logistics.fx_usd_mxn).toFixed(2)} MXN/USD`
                        : ""}
                    </p>
                    {generated.logistics.desglose_presupuesto && (
                      <ul className="mt-3 text-xs text-muted-foreground space-y-1 max-w-xs">
                        {Object.entries(generated.logistics.desglose_presupuesto).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-6">
                            <span className="capitalize">{k === "casetas" ? "Casetas · en vivo (Google Maps)" : k.replace("_", " ")}</span>
                            <span className="text-foreground">
                              ${Math.round(Number(v) || 0).toLocaleString("es-MX")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {generated.logistics.resumen && (
                      <p className="text-xs text-muted-foreground mt-2 max-w-md">{generated.logistics.resumen}</p>
                    )}
                  </div>
                  {generated.tripId && (
                    <Button
                      onClick={() => navigate(`/dashboard/viajes/${generated.tripId}`)}
                      className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
                    >
                      Ver viaje completo <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  )}
                </div>
              )}


            </motion.section>
          )}
        </AnimatePresence>
          </div>

          <div className="lg:sticky lg:top-10 space-y-5">
            <TripBuildPreview
              origin={origin}
              destinations={validStops}
              fechaSalida={fechaSalida}
              fechaRegreso={fechaRegreso}
              viajeros={viajeros}
              presupuesto={presupuesto ? Number(presupuesto) : null}
              onChangeFechas={(fs, fr) => { setFechaSalida(fs); setFechaRegreso(fr); }}
              onChangeViajeros={(n) => setViajeros(n)}
            />
            {lgUp && routeGlobe()}
          </div>
        </div>
      </div>

      {/* PHASE 1 — Configuración modal */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Configuración de Ruta</DialogTitle>
            <DialogDescription>
              Personaliza cómo IATOS AI debe optimizar tu travesía multi-destino.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2 max-h-[60vh] overflow-y-auto pr-1">



            {/* Estilo de Conexión */}
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Estilo de conexión</p>
              <div className="grid gap-2">
                {CONNECTION_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = prefs.connection === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPrefs((p) => ({ ...p, connection: opt.id }))}
                      className={`flex items-start gap-3 text-left rounded-xl border px-4 py-3 transition ${
                        active
                          ? "border-primary/60 bg-primary/10"
                          : "border-border bg-surface hover:border-primary/30"
                      }`}
                    >
                      <Icon className={`w-5 h-5 mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{opt.title}</p>
                        <p className="text-xs text-muted-foreground">{opt.sub}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Roadtrips & Pueblos Mágicos */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Car className="w-4 h-4 text-primary" /> Roadtrips & Pueblos Mágicos
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Agregar paradas sugeridas (restaurantes, miradores, pueblos) si viajas en auto.
                </p>
              </div>
              <Switch
                checked={prefs.roadtripStops}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, roadtripStops: v }))}
              />
            </div>

            {/* Logística de Equipaje */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Luggage className="w-4 h-4 text-primary" /> Logística de equipaje
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Coordinar tiempos muertos: sugerir luggage storage entre check-out y siguiente conexión.
                </p>
              </div>
              <Switch
                checked={prefs.luggageLogistics}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, luggageLogistics: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfigOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => generateRoute(prefs, false)}
              className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generar ruta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default MultiDestRoute;
