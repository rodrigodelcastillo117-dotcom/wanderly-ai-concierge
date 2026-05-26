import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, MapPin, Plus, X, Sparkles, Train, Mountain, Wallet,
  Car, Luggage, Settings2, Route as RouteIcon, Loader2, Plane, Receipt,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OriginPicker } from "@/components/OriginPicker";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";


type ConnStyle = "tiempo" | "paisaje" | "smart";

type RoutePrefs = {
  connection: ConnStyle;
  roadtripStops: boolean;
  luggageLogistics: boolean;
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
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Seeds desde la URL (cuando llega desde PlanTrip por detección automática)
  const seedDestinos = useMemo(
    () => (params.get("destinos") ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    [params],
  );
  const seedOrigin = params.get("origin") ?? "";
  const fechaSalida = params.get("fecha_salida") ?? "";
  const fechaRegreso = params.get("fecha_regreso") ?? "";
  const viajeros = Number(params.get("viajeros") ?? "2");
  const presupuesto = params.get("presupuesto");
  const autoStart = params.get("auto") === "1" && seedDestinos.length >= 1;

  const [origin, setOrigin] = useState(seedOrigin);
  const [stops, setStops] = useState<string[]>(seedDestinos.length ? seedDestinos : ["", ""]);
  const [draft, setDraft] = useState("");
  const [resolvingPrompt, setResolvingPrompt] = useState(false);

  const [tripsCount, setTripsCount] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [prefs, setPrefs] = useState<RoutePrefs>(DEFAULT_PREFS);

  const [configOpen, setConfigOpen] = useState(false);
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

  // Autostart cuando venimos con destinos pre-cargados, ya resueltos, y user listo
  useEffect(() => {
    if (!autoStart || !user || tripsCount === null || generated || generating || resolvingPrompt) return;
    if (stopsLookLikePhrases) return; // espera a que se resuelvan
    if (stops.filter(Boolean).length < 2) return;
    if (isVeteran) {
      void generateRoute(DEFAULT_PREFS, true);
    } else {
      setConfigOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, user, tripsCount, isVeteran, resolvingPrompt, stopsLookLikePhrases, stops]);

  const addStop = () => {
    const v = draft.trim();
    if (!v) return;
    setStops((s) => [...s.filter(Boolean), v]);
    setDraft("");
  };

  const removeStop = (i: number) => setStops((s) => s.filter((_, idx) => idx !== i));

  const validStops = stops.map((s) => s.trim()).filter(Boolean);

  const canStart = origin.trim().length > 1 && validStops.length >= 2;

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

  const generateRoute = async (p: RoutePrefs, autonomous: boolean) => {
    setConfigOpen(false);
    setGenerating(true);
    try {
      // Telemetría
      if (user) {
        await supabase.from("behavioral_insights").insert([{
          user_id: user.id,
          action: "planned",
          target_type: "multi_destination",
          target_label: validStops.join(" → "),
          metadata: { autonomous, prefs: p as any, origin } as any,
        }]);
      }

      // Logística real via edge function
      const { data, error } = await supabase.functions.invoke("logistics-plan", {
        body: {
          origin,
          destinations: validStops,
          fecha_salida: fechaSalida || undefined,
          fecha_regreso: fechaRegreso || undefined,
          num_viajeros: viajeros,
          prefs: p,
        },
      });
      if (error) throw error;
      if (!data?.logistics) throw new Error("La IA no devolvió logística");

      const logistics = data.logistics;
      const USD_MXN = 17;

      // Aplanar per_destination → vuelos_json (incluye vuelos + trenes + buses + roadtrips por ciudad),
      // hospedaje_json / restaurantes_json / tours_json para que TripDetail los agrupe por ciudad.
      const vuelos_json: any[] = [];

      // Vuelos internacionales (origen ↔ primera/última) primero, marcados con su ciudad destino
      (logistics.flights ?? []).forEach((f: any, i: number) => {
        const ciudad = f.to && validStops.includes(f.to) ? f.to : validStops[i === 0 ? 0 : validStops.length - 1];
        vuelos_json.push({
          tier: f.tier || "equilibrio",
          mode: "vuelo",
          aerolinea: f.airline_suggested || "Por confirmar",
          duracion: f.duration || "",
          escalas: f.stops || "Directo",
          precio_por_persona: Math.round(Number(f.price_per_person_usd ?? 0) * USD_MXN),
          notas: f.notes ? `${f.from} → ${f.to} · ${f.notes}` : `${f.from} → ${f.to}`,
          ciudad,
          from: f.from,
          to: f.to,
        });
      });

      const hospedaje_json: any[] = [];
      const restaurantes_json: any[] = [];
      const tours_json: any[] = [];
      (logistics.per_destination ?? []).forEach((pd: any) => {
        // Arrival options para esta ciudad → entran a vuelos_json tagueados
        (pd.arrival_options ?? []).forEach((opt: any) => {
          vuelos_json.push({
            tier: opt.tier || "equilibrio",
            mode: opt.mode || "vuelo",
            aerolinea: opt.provider || (opt.mode === "tren" ? "Tren de alta velocidad" : opt.mode),
            duracion: opt.duration || "",
            escalas: opt.scenic ? "Ruta escénica" : (opt.mode === "vuelo" ? "Directo" : opt.mode),
            precio_por_persona: Math.round(Number(opt.price_per_person_usd ?? 0) * USD_MXN),
            notas: opt.notes ? `${opt.from} → ${pd.city} · ${opt.notes}` : `${opt.from} → ${pd.city}`,
            ciudad: pd.city,
            from: opt.from,
            to: pd.city,
          });
        });
        (pd.hospedaje ?? []).forEach((h: any) => {
          hospedaje_json.push({
            tipo: h.tipo || h.tier || "Hospedaje",
            nombre: h.nombre,
            barrio: h.barrio || pd.city,
            rating: h.rating ?? 4.5,
            precio_por_noche: Math.round(Number(h.price_per_night_usd ?? 0) * USD_MXN),
            por_que: h.por_que || "",
            ciudad: pd.city,
            tier: h.tier,
          });
        });
        (pd.restaurantes ?? []).forEach((r: any) => {
          restaurantes_json.push({
            nombre: r.nombre,
            cocina: r.cocina,
            rango_precio: r.rango_precio || "$$",
            por_que: r.por_que || "",
            ciudad: pd.city,
          });
        });
        (pd.experiencias ?? []).forEach((t: any) => {
          tours_json.push({
            nombre: t.nombre,
            duracion: t.duracion || "",
            precio_por_persona: Math.round(Number(t.price_per_person_usd ?? 0) * USD_MXN),
            por_que: t.por_que || "",
            ciudad: pd.city,
          });
        });
      });

      // itinerario_json: TripDetail espera un array de días.
      const itinerarioDays = (logistics.days ?? []).map((d: any) => ({
        dia: d.dia,
        titulo: d.ciudad ? `${d.ciudad} — ${d.titulo}` : d.titulo,
        ciudad: d.ciudad,
        "mañana": d["mañana"] ?? d.manana ?? "",
        tarde: d.tarde ?? "",
        noche: d.noche ?? "",
      }));

      // Persistir como trip
      let tripId: string | undefined;
      if (user) {
        const { data: trip, error: tErr } = await supabase
          .from("trips")
          .insert({
            user_id: user.id,
            destino: validStops.join(" → "),
            pais_destino: validStops[validStops.length - 1],
            ciudad_origen: origin,
            fecha_salida: fechaSalida || null,
            fecha_regreso: fechaRegreso || null,
            num_viajeros: viajeros,
            presupuesto_objetivo: presupuesto ? Number(presupuesto) : null,
            total_estimado: logistics.total_estimado_usd
              ? Math.round(Number(logistics.total_estimado_usd) * USD_MXN)
              : null,
            moneda: "MXN",
            status: "listo",
            analisis_ai: logistics.resumen ?? null,
            vuelos_json,
            hospedaje_json,
            restaurantes_json,
            tours_json,
            itinerario_json: {
              multi: true,
              destinations: validStops,
              logistics,
              days: itinerarioDays,
            },
            // Guardamos logistics completa dentro de tips para no perderla
            tips_personalizados: logistics.resumen ? [logistics.resumen] : null,
          })
          .select("id")
          .single();
        if (tErr) console.error(tErr);
        else tripId = trip?.id;
      }

      setGenerated({ logistics, autonomous, tripId });
      toast.success("Travesía multi-destino generada");
      if (tripId) {
        // Llevamos al usuario a la vista detallada con toda la curaduría
        setTimeout(() => navigate(`/dashboard/viajes/${tripId}`), 400);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos generar la ruta");
    } finally {
      setGenerating(false);
    }
  };


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

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
          <div className="space-y-8 min-w-0">

        {/* Stops builder */}
        <section className="rounded-3xl border border-border bg-card p-6 md:p-8 space-y-5 premium-shadow">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">Ciudad de origen</label>
            <OriginPicker value={origin} onChange={setOrigin} />
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
                      value={s}
                      onChange={(e) =>
                        setStops((arr) => arr.map((x, idx) => (idx === i ? e.target.value : x)))
                      }
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

            <form
              onSubmit={(e) => { e.preventDefault(); addStop(); }}
              className="flex gap-2 mt-3"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Añadir destino (ej. Kioto)"
                className="h-12 bg-input border-border"
              />
              <Button type="submit" variant="outline" className="h-12 border-border">
                <Plus className="w-4 h-4 mr-1" /> Agregar
              </Button>
            </form>
          </div>

          {/* Status pill — phase indicator */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isVeteran ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary">
                  <Sparkles className="w-3 h-3" /> God Mode activado · {tripsCount} viajes aprendidos
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border">
                  Control manual · {tripsCount ?? "–"} / 3 viajes para autonomía
                </span>
              )}
            </div>

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

              {/* Total + CTA al detalle */}
              {generated.logistics.total_estimado_usd != null && (
                <div className="rounded-3xl border border-border bg-card p-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs tracking-[0.25em] uppercase text-primary mb-1">Total estimado</p>
                    <p className="font-display text-3xl md:text-4xl gold-text">
                      ${Math.round(generated.logistics.total_estimado_usd).toLocaleString("en-US")} USD
                    </p>
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

          <div className="lg:sticky lg:top-10">
            <TripBuildPreview
              origin={origin}
              destinations={validStops}
              fechaSalida={fechaSalida}
              fechaRegreso={fechaRegreso}
              viajeros={viajeros}
              presupuesto={presupuesto ? Number(presupuesto) : null}
            />
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

          <div className="space-y-6 py-2">
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
