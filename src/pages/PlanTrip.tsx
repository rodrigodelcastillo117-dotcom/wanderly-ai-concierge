import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, MapPin, Calendar, Users, Wallet, Sparkles, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { detectRouteIntent } from "@/lib/detectRouteIntent";


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
  const [destino, setDestino] = useState(params.get("destino") ?? "");
  const [ciudadOrigen, setCiudadOrigen] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [numViajeros, setNumViajeros] = useState(2);
  const [presupuesto, setPresupuesto] = useState<number | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
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

        setInterpretando(false);
        await runAnalisis({
          destino: data?.destino || q.slice(0, 60),
          ciudad_origen: origen,
          fecha_salida: data?.fecha_salida || defaultSalida,
          fecha_regreso: data?.fecha_regreso || defaultRegreso,
          num_viajeros: Number(data?.num_viajeros) || 2,
          presupuesto_objetivo: data?.presupuesto_objetivo ?? null,
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

  const stepsConfig = [
    {
      icon: MapPin,
      title: "¿A dónde quieres ir?",
      sub: "Un destino ('Tokio') o una travesía ('México → Madrid → París'). IATOS AI detecta el modo.",
      canNext: () => destino.trim().length > 1,
      render: () => {
        const intent = detectRouteIntent(destino);
        const isMulti = intent.mode === "multi" && intent.destinations.length >= 2;
        return (
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="París · o · Roma → Florencia → Venecia"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="h-16 text-lg bg-input border-border"
            />
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
    },

    {
      icon: Calendar,
      title: "¿Cuándo y con quién?",
      sub: "Las fechas exactas y cuántos viajan.",
      canNext: () => !!fechaSalida && !!fechaRegreso && fechaRegreso > fechaSalida && !!ciudadOrigen,
      render: () => (
        <div className="space-y-5">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Ciudad de salida</label>
            <Input value={ciudadOrigen} onChange={(e) => setCiudadOrigen(e.target.value)} className="bg-input border-border h-12" placeholder="Ciudad de México" />
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
        <header className="px-6 md:px-10 py-6">
          <button
            onClick={() => (step > 0 ? setStep(step - 1) : navigate("/dashboard"))}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {step > 0 ? "Atrás" : "Volver"}
          </button>
        </header>
        <main className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-xl">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-6">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h2 className="font-display text-3xl md:text-5xl mb-3">{current.title}</h2>
                <p className="text-muted-foreground mb-10">{current.sub}</p>
                <div className="mb-12">{current.render()}</div>
              </motion.div>
            </AnimatePresence>

            <Button
              onClick={() => (step === stepsConfig.length - 1 ? analizar() : setStep(step + 1))}
              disabled={!current.canNext()}
              className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-14"
            >
              {step === stepsConfig.length - 1 ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generar análisis
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
        </main>
      </div>
    </DashboardLayout>
  );
};

export default PlanTrip;
