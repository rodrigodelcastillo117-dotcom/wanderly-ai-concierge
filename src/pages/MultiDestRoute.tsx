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
  const autoStart = params.get("auto") === "1" && seedDestinos.length >= 2;

  const [origin, setOrigin] = useState(seedOrigin);
  const [stops, setStops] = useState<string[]>(seedDestinos.length ? seedDestinos : ["", ""]);
  const [draft, setDraft] = useState("");

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

  // Autostart cuando venimos con destinos pre-cargados y user listo
  useEffect(() => {
    if (!autoStart || !user || tripsCount === null || generated || generating) return;
    // Veterano → directo. Novato → modal.
    if (isVeteran) {
      void generateRoute(DEFAULT_PREFS, true);
    } else {
      setConfigOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, user, tripsCount, isVeteran]);

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
              ? Math.round(Number(logistics.total_estimado_usd) * 17) // USD → MXN aprox
              : null,
            moneda: "MXN",
            status: "listo",
            itinerario_json: { multi: true, logistics, destinations: validStops },
          })
          .select("id")
          .single();
        if (tErr) console.error(tErr);
        else tripId = trip?.id;
      }

      setGenerated({ logistics, autonomous, tripId });
      toast.success("Travesía multi-destino generada");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos generar la ruta");
    } finally {
      setGenerating(false);
    }
  };


  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <p className="text-primary text-xs tracking-[0.25em] uppercase">Ruta multi-destino</p>
          <h1 className="font-display text-3xl md:text-5xl">Diseña tu próxima travesía.</h1>
          <p className="text-muted-foreground">
            Encadena 2 o más destinos. IATOS AI optimiza conexiones, paradas y logística.
          </p>
        </header>

        {/* Stops builder */}
        <section className="rounded-3xl border border-border bg-card p-6 md:p-8 space-y-5 premium-shadow">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">Ciudad de origen</label>
            <Input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="Ciudad de México"
              className="h-12 bg-input border-border"
            />
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

              <div className="rounded-3xl border border-border bg-card overflow-hidden">
                {generated.itinerary.map((leg, i) => (
                  <div key={i} className="p-5 md:p-6 border-b border-border last:border-0">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
                      <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                      <span>{leg.from}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span className="text-foreground font-medium">{leg.to}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border inline-flex items-center gap-1.5">
                        <Train className="w-3 h-3 text-primary" /> {leg.mode}
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border">
                        {leg.duration}
                      </span>
                      {leg.luggage && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary inline-flex items-center gap-1.5">
                          <Luggage className="w-3 h-3" /> {leg.luggage}
                        </span>
                      )}
                    </div>
                    {leg.stopovers?.length > 0 && (
                      <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <Car className="w-3 h-3" />
                        Paradas sugeridas: {leg.stopovers.join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
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
