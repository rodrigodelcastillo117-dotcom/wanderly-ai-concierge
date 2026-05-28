import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, MapPin, Calendar, Users, Wallet, Sparkles, Route as RouteIcon, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { detectRouteIntent } from "@/lib/detectRouteIntent";
import { OriginPicker } from "@/components/OriginPicker";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { VoiceInput } from "@/components/VoiceInput";

const EMOCIONES = [
  "Aventura adrenalina",
  "Romance y conexión",
  "Lujo y descanso",
  "Cultura profunda",
  "Naturaleza y desconexión",
  "Fiesta y vida nocturna",
  "Gastronomía",
  "Espiritual / mindfulness",
];


const LOADING_MESSAGES = [
  "Buscando vuelos óptimos…",
  "Identificando hoteles que matchean tu estilo…",
  "Curando restaurantes para tu paladar…",
  "Diseñando tu itinerario día por día…",
  "Calculando presupuesto real en MXN…",
];

const PlanTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const mode = params.get("mode"); // "emocion" => IATOS elige destino
  const isEmocionMode = mode === "emocion";
  const [destino, setDestino] = useState(params.get("destino") ?? "");
  const [ciudadOrigen, setCiudadOrigen] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [numViajeros, setNumViajeros] = useState(2);
  const [grupoPreset, setGrupoPreset] = useState<"solo" | "pareja" | "amigos" | "familia" | "custom">("pareja");
  const [presupuesto, setPresupuesto] = useState<number | null>(null);
  const [budgetMode, setBudgetMode] = useState<"flexible" | "balanceado" | "premium" | "luxury">("balanceado");
  const [surpriseDates, setSurpriseDates] = useState(false);
  const [emociones, setEmociones] = useState<string[]>([]);
  const [emocionLibre, setEmocionLibre] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [eligiendoDestino, setEligiendoDestino] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("ciudad_origen")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.ciudad_origen) setCiudadOrigen(data.ciudad_origen);
      });
  }, [user]);

  // Auto-cheapest: si llega ?destino=X&autoCheapest=1, prellena fechas heurísticas
  // (martes a martes, ~60 días fuera — ventana históricamente más barata) y dispara análisis.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (params.get("autoCheapest") !== "1") return;
    if (!destino || !ciudadOrigen) return;

    // Próximo martes ~60 días a futuro (martes/miércoles suelen ser los más baratos)
    const out = new Date();
    out.setDate(out.getDate() + 60);
    while (out.getDay() !== 2) out.setDate(out.getDate() + 1);
    const ret = new Date(out);
    ret.setDate(ret.getDate() + 7);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const fs = fmt(out);
    const fr = fmt(ret);
    setFechaSalida(fs);
    setFechaRegreso(fr);
    autoFiredRef.current = true;
    runAnalisis({
      destino,
      ciudad_origen: ciudadOrigen,
      fecha_salida: fs,
      fecha_regreso: fr,
      num_viajeros: 2,
      presupuesto_objetivo: null,
    });
  }, [destino, ciudadOrigen, params]);



  useEffect(() => {
    if (!analizando) return;
    const i = setInterval(() => setLoadingMsg((m) => (m + 1) % LOADING_MESSAGES.length), 2400);
    return () => clearInterval(i);
  }, [analizando]);

  const runAnalisis = async (args: {
    destino: string;
    ciudad_origen: string;
    fecha_salida: string;
    fecha_regreso: string;
    num_viajeros: number;
    presupuesto_objetivo?: number | null;
    notas_usuario?: string | null;
  }) => {
    setDestino(args.destino);
    setAnalizando(true);
    try {
      const { data, error } = await supabase.functions.invoke("analizar-viaje", { body: args });
      if (error) throw error;
      if (!data?.trip?.id) throw new Error("Sin resultado");
      navigate(`/dashboard/viajes/${data.trip.id}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos generar el análisis. Intenta de nuevo.");
      setAnalizando(false);
    }
  };

  const analizar = () => {
    if (!destino || !fechaSalida || !fechaRegreso || !ciudadOrigen) return;

    // Detección single vs multi al confirmar.
    const intent = detectRouteIntent(destino);
    if (intent.mode === "multi" && intent.destinations.length >= 2) {
      const qs = new URLSearchParams({
        origin: ciudadOrigen,
        destinos: intent.destinations.join("|"),
        fecha_salida: fechaSalida,
        fecha_regreso: fechaRegreso,
        viajeros: String(numViajeros),
        auto: "1",
      });
      if (presupuesto != null) qs.set("presupuesto", String(presupuesto));
      navigate(`/dashboard/ruta?${qs.toString()}`);
      return;
    }

    return runAnalisis({
      destino,
      ciudad_origen: ciudadOrigen,
      fecha_salida: fechaSalida,
      fecha_regreso: fechaRegreso,
      num_viajeros: numViajeros,
      presupuesto_objetivo: presupuesto,
    });
  };

  // Modo emoción: IATOS elige el destino según la emoción + parámetros
  const elegirDestinoYAnalizar = async () => {
    if (!ciudadOrigen) {
      toast.error("Necesitamos tu ciudad de origen.");
      return;
    }
    const emocionList = [...emociones, emocionLibre.trim()].filter(Boolean);
    if (emocionList.length === 0) {
      toast.error("Elige al menos una emoción para tu viaje.");
      return;
    }
    const usarFechas = !surpriseDates && fechaSalida && fechaRegreso;
    setEligiendoDestino(true);
    try {
      const dias = usarFechas
        ? Math.max(1, Math.round((new Date(fechaRegreso).getTime() - new Date(fechaSalida).getTime()) / 86400000))
        : null;
      const presupuestoTxt =
        presupuesto != null
          ? `Presupuesto total objetivo: ${presupuesto} MXN.`
          : `Estilo de presupuesto: ${budgetMode} (sin tope rígido — IATOS optimiza).`;
      const prompt = `Quiero que elijas el MEJOR destino para mí (UNA sola ciudad o región concreta, no varias opciones).
Emociones / estilo que busco: ${emocionList.join(", ")}.
Viajamos ${numViajeros} persona(s) desde ${ciudadOrigen}.
${usarFechas ? `Fechas: del ${fechaSalida} al ${fechaRegreso} (${dias} días).` : `Fechas flexibles — elige tú la mejor temporada para esa emoción y destino.`}
${presupuestoTxt}
Devuelve el destino ideal en el campo "destino" y "destinations" con esa única ciudad.`;

      const { data, error } = await supabase.functions.invoke("parsear-viaje", { body: { prompt } });
      if (error) throw error;
      const destinoElegido: string = data?.destino || (Array.isArray(data?.destinations) ? data.destinations[0] : "") || "";
      if (!destinoElegido) throw new Error("IATOS no pudo elegir un destino.");
      setEligiendoDestino(false);
      await runAnalisis({
        destino: destinoElegido,
        ciudad_origen: ciudadOrigen,
        fecha_salida: usarFechas ? fechaSalida : (null as any),
        fecha_regreso: usarFechas ? fechaRegreso : (null as any),
        num_viajeros: numViajeros,
        presupuesto_objetivo: presupuesto,
        notas_usuario: `Emociones: ${emocionList.join(", ")}. Estilo presupuesto: ${budgetMode}.`,
      });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No pudimos elegir un destino. Intenta de nuevo.");
      setEligiendoDestino(false);
    }
  };



  // Flujo de búsqueda en lenguaje natural: ?q=... viene del Inicio
  useEffect(() => {
    const q = params.get("q");
    if (!q || !user) return;
    let cancelled = false;
    (async () => {
      setInterpretando(true);
      try {
        // Trae ciudad_origen del perfil para fallback
        const { data: prof } = await supabase
          .from("profiles")
          .select("ciudad_origen")
          .eq("id", user.id)
          .maybeSingle();

        // Detección rápida cliente — si parece multi, vamos directo al builder de ruta.
        const fastIntent = detectRouteIntent(q);
        if (fastIntent.mode === "multi" && fastIntent.destinations.length >= 2) {
          const hoy = new Date();
          const defaultSalida = new Date(hoy.getTime() + 30 * 86400000).toISOString().slice(0, 10);
          const defaultRegreso = new Date(hoy.getTime() + 37 * 86400000).toISOString().slice(0, 10);
          const qs = new URLSearchParams({
            origin: prof?.ciudad_origen || "Ciudad de México",
            destinos: fastIntent.destinations.join("|"),
            fecha_salida: defaultSalida,
            fecha_regreso: defaultRegreso,
            viajeros: "2",
            auto: "1",
          });
          if (!cancelled) navigate(`/dashboard/ruta?${qs.toString()}`, { replace: true });
          return;
        }

        const { data, error } = await supabase.functions.invoke("parsear-viaje", {
          body: { prompt: q },
        });
        if (cancelled) return;
        if (error) throw error;

        const origen = data?.ciudad_origen || prof?.ciudad_origen || "Ciudad de México";
        const hoy = new Date();
        const defaultSalida = new Date(hoy.getTime() + 30 * 86400000).toISOString().slice(0, 10);
        const defaultRegreso = new Date(hoy.getTime() + 37 * 86400000).toISOString().slice(0, 10);

        // Si la IA detectó multi-destino (>=2 ciudades reales), redirigir al builder de ruta.
        const aiDestinations: string[] = Array.isArray(data?.destinations) ? data.destinations.filter(Boolean) : [];
        if (data?.is_multi && aiDestinations.length >= 2) {
          const qs = new URLSearchParams({
            origin: origen,
            destinos: aiDestinations.join("|"),
            fecha_salida: data?.fecha_salida || defaultSalida,
            fecha_regreso: data?.fecha_regreso || defaultRegreso,
            viajeros: String(Number(data?.num_viajeros) || 2),
            auto: "1",
          });
          if (data?.presupuesto_objetivo) qs.set("presupuesto", String(data.presupuesto_objetivo));
          if (!cancelled) navigate(`/dashboard/ruta?${qs.toString()}`, { replace: true });
          return;
        }

        setInterpretando(false);
        await runAnalisis({
          destino: data?.destino || q.slice(0, 60),
          ciudad_origen: origen,
          fecha_salida: data?.fecha_salida || defaultSalida,
          fecha_regreso: data?.fecha_regreso || defaultRegreso,
          num_viajeros: Number(data?.num_viajeros) || 2,
          presupuesto_objetivo: data?.presupuesto_objetivo ?? null,
          notas_usuario: q,
        });
      } catch (e: any) {
        if (cancelled) return;
        console.error(e);
        toast.error("No pudimos interpretar tu solicitud. Llena el formulario.");
        setInterpretando(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);


  if (interpretando) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="w-14 h-14 rounded-full border-2 border-primary/30 border-t-primary mb-8"
          />
          <h2 className="font-display text-3xl md:text-4xl mb-3">Interpretando tu viaje</h2>
          <p className="text-muted-foreground max-w-md">
            Leyendo tu descripción, identificando destino, fechas y viajeros…
          </p>
        </div>
      </DashboardLayout>
    );
  }

  if (eligiendoDestino) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.2, repeat: Infinity }}
            className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
          >
            <Heart className="w-7 h-7 text-primary-foreground" />
          </motion.div>
          <h2 className="font-display text-3xl md:text-5xl mb-3">
            IATOS AI está eligiendo tu <span className="gold-text italic">próximo destino</span>
          </h2>
          <p className="text-muted-foreground max-w-md">
            Cruzando tus emociones, fechas, viajeros y presupuesto con tu ADN de viaje…
          </p>
        </div>
      </DashboardLayout>
    );
  }





  if (analizando) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity }}
            className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
          >
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </motion.div>
          <h2 className="font-display text-3xl md:text-5xl mb-6">
            Analizando tu viaje a <span className="gold-text italic">{destino}</span>
          </h2>
          <AnimatePresence mode="wait">
            <motion.p
              key={loadingMsg}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-muted-foreground text-lg"
            >
              {LOADING_MESSAGES[loadingMsg]}
            </motion.p>
          </AnimatePresence>
          <div className="mt-12 flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
                className="w-2 h-2 rounded-full bg-primary"
              />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const toggleEmocion = (e: string) =>
    setEmociones((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const firstStep = isEmocionMode
    ? {
        icon: Heart,
        title: "¿Cuál es tu emoción del viaje?",
        sub: "Elige una o varias. IATOS AI las mezcla con tu ADN para escoger el destino perfecto.",
        canNext: () => emociones.length > 0 || emocionLibre.trim().length > 2,
        render: () => (
          <div className="space-y-4">
            <Input
              autoFocus
              placeholder="ej. quiero sentir libertad total y aventura"
              value={emocionLibre}
              onChange={(e) => setEmocionLibre(e.target.value)}
              className="h-14 bg-input border-border"
            />
            <div className="flex flex-wrap gap-2">
              {EMOCIONES.map((e) => {
                const active = emociones.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleEmocion(e)}
                    className={`px-4 py-2 rounded-full border text-sm transition ${
                      active
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-surface border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground italic">
              Puedes elegir varias emociones · IATOS AI las mezcla y elige tu próximo destino.
            </p>
          </div>
        ),
      }
    : {
        icon: MapPin,
        title: "¿A dónde quieres ir?",
        sub: "Un destino ('Tokio') o una travesía ('México → Madrid → París'). IATOS AI detecta el modo.",
        canNext: () => destino.trim().length > 1,
        render: () => {
          const intent = detectRouteIntent(destino);
          const isMulti = intent.mode === "multi" && intent.destinations.length >= 2;
          return (
            <div className="space-y-3">
              <div className="relative">
                <Input
                  autoFocus
                  placeholder="París · o · Roma → Florencia → Venecia"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  className="h-16 text-lg bg-input border-border pr-14"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <VoiceInput
                    onTranscript={(t) => setDestino((prev) => (prev ? prev + " " : "") + t)}
                  />
                </div>
              </div>
              {destino.trim().length > 1 && (
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
                  isMulti
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-surface border-border text-muted-foreground"
                }`}>
                  {isMulti ? <RouteIcon className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                  {isMulti
                    ? `Travesía multi-destino · ${intent.destinations.length} ciudades`
                    : "Viaje a un solo destino"}
                </div>
              )}
            </div>
          );
        },
      };

  const stepsConfig = [
    firstStep,

    {
      icon: Calendar,
      title: "¿Cuándo y con quién?",
      sub: "Las fechas exactas y cuántos viajan.",
      canNext: () => !!fechaSalida && !!fechaRegreso && fechaRegreso > fechaSalida && !!ciudadOrigen,
      render: () => (
        <div className="space-y-5">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Ciudad de salida</label>
            <OriginPicker value={ciudadOrigen} onChange={setCiudadOrigen} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Salida</label>
              <Input type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} className="bg-input border-border h-12" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Regreso</label>
              <Input type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} className="bg-input border-border h-12" />
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-3 block">Número de viajeros: <span className="text-foreground font-medium">{numViajeros}</span></label>
            <Slider value={[numViajeros]} onValueChange={(v) => setNumViajeros(v[0])} min={1} max={10} step={1} />
          </div>
        </div>
      ),
    },
    {
      icon: Wallet,
      title: "Presupuesto objetivo",
      sub: "Opcional. Si lo dejas, ajustamos las recomendaciones.",
      canNext: () => true,
      render: () => (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground text-sm">{presupuesto === null ? "Sin presupuesto fijo" : "Presupuesto"}</span>
            {presupuesto !== null && (
              <span className="font-display text-4xl gold-text">${presupuesto.toLocaleString("es-MX")}<span className="text-base text-muted-foreground ml-1">MXN</span></span>
            )}
          </div>
          <Slider
            value={[presupuesto ?? 30000]}
            onValueChange={(v) => setPresupuesto(v[0])}
            min={5000}
            max={200000}
            step={1000}
          />
          <button
            type="button"
            onClick={() => setPresupuesto(presupuesto === null ? 30000 : null)}
            className="text-sm text-primary hover:underline"
          >
            {presupuesto === null ? "Establecer un presupuesto" : "Quitar presupuesto fijo"}
          </button>
        </div>
      ),
    },
  ];

  const current = stepsConfig[step];
  const Icon = current.icon;

  return (
    <DashboardLayout>
      <div className="min-h-screen flex flex-col">
        {step > 0 && (
          <header className="px-6 md:px-10 py-6">
            <button
              onClick={() => setStep(step - 1)}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Atrás
            </button>
          </header>
        )}

        <main className="flex-1 px-4 md:px-6 py-6 md:py-10">
          <div className="w-full max-w-6xl mx-auto grid lg:grid-cols-[1fr_360px] gap-6 md:gap-10 items-start">
            <div className="w-full max-w-xl mx-auto lg:mx-0">
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-6">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="font-display text-3xl md:text-5xl mb-3">{current.title}</h2>
                  <p className="text-muted-foreground mb-6 md:mb-10">{current.sub}</p>
                  <div className="mb-12">{current.render()}</div>
                </motion.div>
              </AnimatePresence>

              <Button
                onClick={() =>
                  step === stepsConfig.length - 1
                    ? isEmocionMode
                      ? elegirDestinoYAnalizar()
                      : analizar()
                    : setStep(step + 1)
                }
                disabled={!current.canNext()}
                className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-14"
              >
                {step === stepsConfig.length - 1 ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {isEmocionMode ? "Elegir mi destino con IATOS AI" : "Generar análisis"}
                  </>
                ) : (
                  <>
                    Continuar
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <div className="flex justify-center gap-2 mt-8">
                {stepsConfig.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === step ? "w-8 bg-primary" : "w-2 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="lg:sticky lg:top-10">
              <TripBuildPreview
                origin={ciudadOrigen}
                destinoRaw={destino}
                fechaSalida={fechaSalida}
                fechaRegreso={fechaRegreso}
                viajeros={numViajeros}
                presupuesto={presupuesto}
              />
            </div>
          </div>
        </main>
      </div>
    </DashboardLayout>
  );
};

export default PlanTrip;
