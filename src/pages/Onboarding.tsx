import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Answers = {
  ciudad_origen: string;
  estilo_viaje: string[];
  presupuesto_rango: string;
  ritmo_viaje: string;
  preferencias_comida: string[];
  alergias_restricciones: string[];
  intereses: string[];
  tipo_alojamiento_preferido: string[];
  duracion_viaje_ideal: string;
  acompanantes_tipico: string;
  destinos_visitados: string[];
  destinos_pendientes: string[];
  idiomas_hablados: string[];
  notas_adicionales: string;
};

const initial: Answers = {
  ciudad_origen: "",
  estilo_viaje: [],
  presupuesto_rango: "",
  ritmo_viaje: "",
  preferencias_comida: [],
  alergias_restricciones: [],
  intereses: [],
  tipo_alojamiento_preferido: [],
  duracion_viaje_ideal: "",
  acompanantes_tipico: "",
  destinos_visitados: [],
  destinos_pendientes: [],
  idiomas_hablados: [],
  notas_adicionales: "",
};

const ESTILOS = [
  { id: "aventura", label: "Aventurero", emoji: "🏔️" },
  { id: "lujo", label: "De lujo", emoji: "✨" },
  { id: "cultural", label: "Cultural", emoji: "🏛️" },
  { id: "playa", label: "Playa", emoji: "🌊" },
  { id: "gastronomico", label: "Gastronómico", emoji: "🍷" },
  { id: "wellness", label: "Wellness", emoji: "🧘" },
  { id: "familiar", label: "Familiar", emoji: "👨‍👩‍👧" },
  { id: "romantico", label: "Romántico", emoji: "💫" },
  { id: "mochilero", label: "Mochilero", emoji: "🎒" },
];

const COMIDAS = ["Local", "Gourmet", "Street food", "Vegetariano", "Vegano", "Sin gluten", "Mariscos"];
const INTERESES = ["Arte", "Historia", "Música", "Deportes", "Naturaleza", "Vida nocturna", "Arquitectura", "Fotografía"];
const ALOJAMIENTOS = ["Hotel boutique", "Resort", "Airbnb", "Hostel", "Glamping"];
const IDIOMAS = ["Español", "Inglés", "Francés", "Italiano", "Portugués", "Alemán", "Japonés", "Mandarín"];

const Onboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(initial);
  const [saving, setSaving] = useState(false);

  // Pre-cargar nombre y datos previos si existen
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("travel_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (data) {
        setA({
          ciudad_origen: "",
          estilo_viaje: data.estilo_viaje ?? [],
          presupuesto_rango: data.presupuesto_rango ?? "",
          ritmo_viaje: data.ritmo_viaje ?? "",
          preferencias_comida: data.preferencias_comida ?? [],
          alergias_restricciones: data.alergias_restricciones ?? [],
          intereses: data.intereses ?? [],
          tipo_alojamiento_preferido: data.tipo_alojamiento_preferido ?? [],
          duracion_viaje_ideal: data.duracion_viaje_ideal ?? "",
          acompanantes_tipico: data.acompanantes_tipico ?? "",
          destinos_visitados: data.destinos_visitados ?? [],
          destinos_pendientes: data.destinos_pendientes ?? [],
          idiomas_hablados: data.idiomas_hablados ?? [],
          notas_adicionales: data.notas_adicionales ?? "",
        });
      }
    })();
  }, [user]);

  const toggle = (key: keyof Answers, val: string) => {
    setA((prev) => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  const steps: { title: string; subtitle?: string; canNext: () => boolean; render: () => JSX.Element }[] = [
    {
      title: "¿De dónde partes?",
      subtitle: "Para calcular distancias y vuelos reales.",
      canNext: () => a.ciudad_origen.trim().length > 1,
      render: () => (
        <Input
          autoFocus
          placeholder="Ciudad de México, Monterrey, Guadalajara..."
          value={a.ciudad_origen}
          onChange={(e) => setA({ ...a, ciudad_origen: e.target.value })}
          className="h-16 text-lg bg-input border-border"
        />
      ),
    },
    {
      title: "¿Qué tipo de viajero eres?",
      subtitle: "Elige todos los que te describan.",
      canNext: () => a.estilo_viaje.length > 0,
      render: () => (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {ESTILOS.map((s) => {
            const sel = a.estilo_viaje.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle("estilo_viaje", s.id)}
                className={`relative p-5 rounded-xl border text-left transition-all duration-300 ${
                  sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <div className="text-3xl mb-2">{s.emoji}</div>
                <div className="font-medium">{s.label}</div>
                {sel && <Check className="absolute top-3 right-3 w-4 h-4 text-primary" />}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Cuál es tu rango de presupuesto típico?",
      subtitle: "La experiencia es premium en cualquier rango.",
      canNext: () => !!a.presupuesto_rango,
      render: () => (
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "economico", label: "Económico", desc: "Smart spending" },
            { id: "medio", label: "Medio", desc: "Balance" },
            { id: "alto", label: "Alto", desc: "Comfort" },
            { id: "lujo", label: "Lujo", desc: "Sin límites" },
          ].map((p) => {
            const sel = a.presupuesto_rango === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setA({ ...a, presupuesto_rango: p.id })}
                className={`p-6 rounded-xl border text-left transition-all duration-300 ${
                  sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <div className="font-display text-xl mb-1">{p.label}</div>
                <div className="text-xs text-muted-foreground tracking-wider uppercase">{p.desc}</div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Ritmo de viaje?",
      canNext: () => !!a.ritmo_viaje,
      render: () => (
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: "relajado", label: "Relajado" },
            { id: "equilibrado", label: "Equilibrado" },
            { id: "intenso", label: "Intenso" },
          ].map((r) => {
            const sel = a.ritmo_viaje === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setA({ ...a, ritmo_viaje: r.id })}
                className={`p-5 rounded-xl border transition-all duration-300 ${
                  sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <div className="font-medium">{r.label}</div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Cuéntanos de tu paladar",
      subtitle: "Selecciona todo lo que te apetezca.",
      canNext: () => a.preferencias_comida.length > 0,
      render: () => (
        <div className="flex flex-wrap gap-2">
          {COMIDAS.map((c) => {
            const sel = a.preferencias_comida.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle("preferencias_comida", c)}
                className={`px-5 py-3 rounded-full border transition-all duration-300 ${
                  sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Qué te apasiona descubrir?",
      canNext: () => a.intereses.length > 0,
      render: () => (
        <div className="flex flex-wrap gap-2">
          {INTERESES.map((c) => {
            const sel = a.intereses.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle("intereses", c)}
                className={`px-5 py-3 rounded-full border transition-all duration-300 ${
                  sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Dónde te gusta dormir?",
      canNext: () => a.tipo_alojamiento_preferido.length > 0,
      render: () => (
        <div className="flex flex-wrap gap-2">
          {ALOJAMIENTOS.map((c) => {
            const sel = a.tipo_alojamiento_preferido.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle("tipo_alojamiento_preferido", c)}
                className={`px-5 py-3 rounded-full border transition-all duration-300 ${
                  sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Duración típica de tus viajes",
      canNext: () => !!a.duracion_viaje_ideal,
      render: () => (
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "fin_semana", label: "Fin de semana" },
            { id: "1_semana", label: "1 semana" },
            { id: "2_semanas", label: "2 semanas" },
            { id: "mas", label: "Más de 2 semanas" },
          ].map((d) => {
            const sel = a.duracion_viaje_ideal === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setA({ ...a, duracion_viaje_ideal: d.id })}
                className={`p-5 rounded-xl border text-left transition-all duration-300 ${
                  sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <div className="font-medium">{d.label}</div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Normalmente viajas...",
      canNext: () => !!a.acompanantes_tipico,
      render: () => (
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "solo", label: "Solo" },
            { id: "pareja", label: "En pareja" },
            { id: "amigos", label: "Con amigos" },
            { id: "familia", label: "En familia" },
          ].map((d) => {
            const sel = a.acompanantes_tipico === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setA({ ...a, acompanantes_tipico: d.id })}
                className={`p-5 rounded-xl border text-left transition-all duration-300 ${
                  sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <div className="font-medium">{d.label}</div>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "Idiomas que hablas",
      canNext: () => a.idiomas_hablados.length > 0,
      render: () => (
        <div className="flex flex-wrap gap-2">
          {IDIOMAS.map((c) => {
            const sel = a.idiomas_hablados.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle("idiomas_hablados", c)}
                className={`px-5 py-3 rounded-full border transition-all duration-300 ${
                  sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      title: "¿Algo más que debamos saber?",
      subtitle: "Alergias, restricciones, manías. Lo que sea, opcional.",
      canNext: () => true,
      render: () => (
        <Textarea
          placeholder="Soy alérgico al maní, prefiero hoteles con gimnasio, no me gusta madrugar..."
          value={a.notas_adicionales}
          onChange={(e) => setA({ ...a, notas_adicionales: e.target.value })}
          className="min-h-[140px] bg-input border-border resize-none"
        />
      ),
    },
  ];

  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;

  const next = async () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      // Guardar
      if (!user) return;
      setSaving(true);
      try {
        // Guardar ciudad de origen también en profiles
        await supabase.from("profiles").update({ ciudad_origen: a.ciudad_origen }).eq("id", user.id);
        const { error } = await supabase
          .from("travel_profiles")
          .upsert(
            {
              user_id: user.id,
              estilo_viaje: a.estilo_viaje,
              presupuesto_rango: a.presupuesto_rango,
              ritmo_viaje: a.ritmo_viaje,
              preferencias_comida: a.preferencias_comida,
              alergias_restricciones: a.alergias_restricciones,
              intereses: a.intereses,
              tipo_alojamiento_preferido: a.tipo_alojamiento_preferido,
              duracion_viaje_ideal: a.duracion_viaje_ideal,
              acompanantes_tipico: a.acompanantes_tipico,
              destinos_visitados: a.destinos_visitados,
              destinos_pendientes: a.destinos_pendientes,
              idiomas_hablados: a.idiomas_hablados,
              notas_adicionales: a.notas_adicionales,
              completado: true,
            },
            { onConflict: "user_id" }
          );
        if (error) throw error;
        toast.success("¡Tu perfil de viajero está listo!");
        navigate("/dashboard");
      } catch (e: any) {
        toast.error(e?.message ?? "No se pudo guardar tu perfil");
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/40">
        <div className="container mx-auto py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-gold flex items-center justify-center">
              <Compass className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-display text-lg">Wanderly</span>
          </div>
          <span className="text-xs text-muted-foreground tracking-wider uppercase">
            Paso {step + 1} de {steps.length}
          </span>
        </div>
        <div className="h-0.5 bg-border/40">
          <motion.div
            className="h-full bg-gradient-gold"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
            >
              <h2 className="font-display text-3xl md:text-5xl mb-3 leading-tight">{current.title}</h2>
              {current.subtitle && (
                <p className="text-muted-foreground mb-10 text-lg">{current.subtitle}</p>
              )}
              <div className="mb-12">{current.render()}</div>
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => step > 0 && setStep(step - 1)}
              disabled={step === 0}
              className="text-muted-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Atrás
            </Button>
            <Button
              onClick={next}
              disabled={!current.canNext() || saving}
              className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12 px-8"
            >
              {saving ? "Guardando..." : step === steps.length - 1 ? "Construir mi perfil" : "Continuar"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Onboarding;
