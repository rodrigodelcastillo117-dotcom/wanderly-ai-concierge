import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Compass, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Answers = {
  ritmo_viaje: string;
  hospedaje_preferencias: string[];
  nivel_presupuesto: string;
  estilo_comida: string[];
  restricciones_alimentarias: string[];
  actividades_tarde: string[];
  deal_breakers: string[];
  companeros_viaje: string;
  mejor_viaje_descripcion: string;
  nivel_planificacion: string;
  proposito_viaje: string;
};

const initial: Answers = {
  ritmo_viaje: "",
  hospedaje_preferencias: [],
  nivel_presupuesto: "",
  estilo_comida: [],
  restricciones_alimentarias: [],
  actividades_tarde: [],
  deal_breakers: [],
  companeros_viaje: "",
  mejor_viaje_descripcion: "",
  nivel_planificacion: "",
  proposito_viaje: "",
};

const RESTRICCIONES = ["Vegetariano", "Vegano", "Sin gluten", "Sin lactosa", "Kosher", "Halal", "Alergias a mariscos", "Alergias a frutos secos"];

const Onboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(initial);
  const [saving, setSaving] = useState(false);
  const [showRestricciones, setShowRestricciones] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any).from("ai_user_preferences").select("*").eq("user_id", user.id).maybeSingle();
      if (data) {
        setA({
          ritmo_viaje: data.ritmo_viaje ?? "",
          hospedaje_preferencias: data.hospedaje_preferencias ?? [],
          nivel_presupuesto: data.nivel_presupuesto ?? "",
          estilo_comida: data.estilo_comida ?? [],
          restricciones_alimentarias: data.restricciones_alimentarias ?? [],
          actividades_tarde: data.actividades_tarde ?? [],
          deal_breakers: data.deal_breakers ?? [],
          companeros_viaje: data.companeros_viaje ?? "",
          mejor_viaje_descripcion: data.mejor_viaje_descripcion ?? "",
          nivel_planificacion: data.nivel_planificacion ?? "",
          proposito_viaje: data.proposito_viaje ?? "",
        });
        if ((data.restricciones_alimentarias ?? []).length) setShowRestricciones(true);
      }
    })();
  }, [user]);

  const toggle = (key: keyof Answers, val: string, max?: number) => {
    setA((prev) => {
      const arr = prev[key] as string[];
      if (arr.includes(val)) return { ...prev, [key]: arr.filter((x) => x !== val) };
      if (max && arr.length >= max) {
        toast.info(`Máximo ${max} opciones`);
        return prev;
      }
      return { ...prev, [key]: [...arr, val] };
    });
  };

  // Componentes de UI reutilizables ------------------------------------------------
  const SingleCards = ({ field, options }: { field: keyof Answers; options: { id: string; label: string; desc?: string; emoji?: string }[] }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {options.map((o) => {
        const sel = a[field] === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setA({ ...a, [field]: o.id })}
            className={`relative p-5 rounded-xl border text-left transition-all duration-300 ${
              sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
            }`}
          >
            {o.emoji && <div className="text-2xl mb-2">{o.emoji}</div>}
            <div className="font-display text-lg">{o.label}</div>
            {o.desc && <div className="text-xs text-muted-foreground mt-1">{o.desc}</div>}
            {sel && <Check className="absolute top-3 right-3 w-4 h-4 text-primary" />}
          </button>
        );
      })}
    </div>
  );

  const MultiCards = ({ field, options, max }: { field: keyof Answers; options: { id: string; label: string; desc?: string; emoji?: string }[]; max?: number }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {options.map((o) => {
        const sel = (a[field] as string[]).includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(field, o.id, max)}
            className={`relative p-5 rounded-xl border text-left transition-all duration-300 ${
              sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"
            }`}
          >
            {o.emoji && <div className="text-2xl mb-2">{o.emoji}</div>}
            <div className="font-display text-lg">{o.label}</div>
            {o.desc && <div className="text-xs text-muted-foreground mt-1">{o.desc}</div>}
            {sel && <Check className="absolute top-3 right-3 w-4 h-4 text-primary" />}
          </button>
        );
      })}
    </div>
  );

  const steps: { title: string; subtitle?: string; canNext: () => boolean; render: () => JSX.Element }[] = [
    {
      title: "¿Cuál es tu ritmo ideal cuando viajas?",
      subtitle: "No hay respuesta correcta, solo la tuya.",
      canNext: () => !!a.ritmo_viaje,
      render: () => <SingleCards field="ritmo_viaje" options={[
        { id: "explorador", label: "Explorador Imparable", desc: "Todo el día activo", emoji: "🔥" },
        { id: "equilibrado", label: "Equilibrado", desc: "1-2 actividades y fluir", emoji: "⚖️" },
        { id: "slow", label: "Slow Travel", desc: "Sin prisas, disfrutar y relajar", emoji: "🌿" },
      ]} />,
    },
    {
      title: 'Cuando piensas en "hospedaje", ¿qué te hace feliz?',
      subtitle: "Elige todos los que aplican.",
      canNext: () => a.hospedaje_preferencias.length > 0,
      render: () => <MultiCards field="hospedaje_preferencias" options={[
        { id: "resort_ai", label: "Resorts Todo Incluido", desc: "Comodidad sin pensar", emoji: "🏖️" },
        { id: "boutique", label: "Hoteles Boutique", desc: "Diseño y carácter", emoji: "🎨" },
        { id: "departamento", label: "Departamentos céntricos", desc: "Como un local", emoji: "🏙️" },
        { id: "glamping", label: "Glamping o Naturaleza", desc: "Bajo las estrellas", emoji: "⛺" },
      ]} />,
    },
    {
      title: "¿Cómo defines tu presupuesto o nivel de confort?",
      canNext: () => !!a.nivel_presupuesto,
      render: () => <SingleCards field="nivel_presupuesto" options={[
        { id: "smart", label: "Smart", desc: "Ahorrar en lo básico" },
        { id: "estandar", label: "Estándar", desc: "Balance precio-comodidad" },
        { id: "premium", label: "Premium", desc: "Hoteles top, vuelos cómodos" },
        { id: "ultra", label: "Ultra-Lujo", desc: "VIP, privado, sin techo" },
      ]} />,
    },
    {
      title: "¿Cuál es tu relación con la comida al viajar?",
      subtitle: "Elige las que te describan.",
      canNext: () => a.estilo_comida.length > 0,
      render: () => (
        <div className="space-y-4">
          <MultiCards field="estilo_comida" options={[
            { id: "foodie", label: "Foodie Aventurero", desc: "Street food y mercados", emoji: "🌮" },
            { id: "michelin", label: "Coleccionista Michelin", desc: "Fine dining", emoji: "⭐" },
            { id: "practico", label: "Práctico", desc: "Rápido y limpio", emoji: "🥗" },
            { id: "restricciones", label: "Tengo restricciones", desc: "Vegano, gluten-free, etc.", emoji: "🌱" },
          ]} />
          {(a.estilo_comida.includes("restricciones") || showRestricciones) && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-5 rounded-xl border border-border bg-surface/60">
              <p className="text-sm text-muted-foreground mb-3">Selecciona tus restricciones:</p>
              <div className="flex flex-wrap gap-2">
                {RESTRICCIONES.map((r) => {
                  const sel = a.restricciones_alimentarias.includes(r);
                  return (
                    <button key={r} type="button" onClick={() => toggle("restricciones_alimentarias", r)}
                      className={`px-4 py-2 rounded-full border text-sm transition ${sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"}`}>
                      {r}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>
      ),
    },
    {
      title: "Si tuvieras una tarde libre, ¿dónde te encontraríamos?",
      subtitle: "Elige hasta 3.",
      canNext: () => a.actividades_tarde.length > 0,
      render: () => <MultiCards field="actividades_tarde" max={3} options={[
        { id: "museos", label: "Museos e Historia", emoji: "🏛️" },
        { id: "naturaleza", label: "Naturaleza y Senderismo", emoji: "🥾" },
        { id: "compras", label: "Compras", emoji: "🛍️" },
        { id: "nocturna", label: "Vida nocturna", emoji: "🍸" },
        { id: "playas", label: "Playas", emoji: "🌊" },
        { id: "talleres", label: "Talleres locales", emoji: "🎭" },
      ]} />,
    },
    {
      title: "¿Qué es lo que más ODIAS o arruinaría tu viaje?",
      subtitle: "Tus deal-breakers nos ayudan a filtrar lo que NO te ofrecemos.",
      canNext: () => a.deal_breakers.length > 0,
      render: () => <MultiCards field="deal_breakers" options={[
        { id: "escalas_largas", label: "Escalas muy largas", emoji: "✈️" },
        { id: "masificados", label: "Lugares ultra-masificados", emoji: "👥" },
        { id: "sin_transporte", label: "Falta de transporte público", emoji: "🚇" },
        { id: "clima_extremo", label: "Climas extremos", emoji: "🥵" },
        { id: "mal_internet", label: "Mal internet", emoji: "📶" },
      ]} />,
    },
    {
      title: "¿Quién suele ser tu compañero de aventuras?",
      canNext: () => !!a.companeros_viaje,
      render: () => <SingleCards field="companeros_viaje" options={[
        { id: "solo", label: "Viajo solo", emoji: "🧍" },
        { id: "pareja", label: "En pareja", emoji: "💑" },
        { id: "amigos", label: "Con amigos", emoji: "👯" },
        { id: "familia_ninos", label: "Familia (niños pequeños)", emoji: "👨‍👩‍👧" },
        { id: "familia_adolescentes", label: "Familia (adolescentes)", emoji: "👨‍👩‍👦‍👦" },
      ]} />,
    },
    {
      title: "Cuéntame, ¿cuál ha sido el mejor viaje de tu vida y por qué?",
      subtitle: "La IA analizará tu respuesta para entender qué te emociona.",
      canNext: () => a.mejor_viaje_descripcion.trim().length >= 15,
      render: () => (
        <div className="space-y-3">
          <Textarea
            placeholder="Ej: Tres semanas mochileando por Vietnam — la comida callejera de Hanoi, durmiendo en juncos en Halong Bay, perderme en Hoi An al atardecer. Me sentí completamente vivo y libre."
            value={a.mejor_viaje_descripcion}
            onChange={(e) => setA({ ...a, mejor_viaje_descripcion: e.target.value })}
            className="min-h-[200px] bg-input border-border resize-none"
            maxLength={1500}
          />
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary" />
            La IA analizará tu respuesta para entender qué te emociona.
          </p>
        </div>
      ),
    },
    {
      title: "¿Qué tan planificado te gusta tu itinerario?",
      canNext: () => !!a.nivel_planificacion,
      render: () => <SingleCards field="nivel_planificacion" options={[
        { id: "minuto", label: "Minuto a minuto", desc: "Itinerario completo y agendado", emoji: "📋" },
        { id: "flexible", label: "Estructura flexible", desc: "Mañana planeada, tarde libre", emoji: "🎯" },
        { id: "cero", label: "Cero planes", desc: "Decido al despertar", emoji: "🎲" },
      ]} />,
    },
    {
      title: "¿Cuál es tu propósito principal al viajar?",
      canNext: () => !!a.proposito_viaje,
      render: () => <SingleCards field="proposito_viaje" options={[
        { id: "desconexion", label: "Desconexión total y descanso", emoji: "🧘" },
        { id: "cultura", label: "Inmersión cultural profunda", emoji: "🏯" },
        { id: "aventura", label: "Aventura y adrenalina", emoji: "🪂" },
        { id: "celebracion", label: "Celebrar una ocasión especial", emoji: "🥂" },
      ]} />,
    },
  ];

  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;

  const next = async () => {
    if (step < steps.length - 1) { setStep(step + 1); return; }
    if (!user) return;
    setSaving(true);
    try {
      let perfil_ia: any = null;
      try {
        const { data: audit } = await supabase.functions.invoke("auditar-perfil", {
          body: { descripcion: a.mejor_viaje_descripcion, contexto: a },
        });
        perfil_ia = audit?.perfil ?? null;
      } catch (e) { console.warn("auditar-perfil falló:", e); }

      const { error } = await (supabase as any).from("ai_user_preferences").upsert(
        { user_id: user.id, ...a, perfil_ia, completado: true },
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
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/40">
        <div className="container mx-auto py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-gold flex items-center justify-center">
              <Compass className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-display text-lg">IATOS</span>
          </div>
          <span className="text-xs text-muted-foreground tracking-wider uppercase">
            Paso {step + 1} de {steps.length}
          </span>
        </div>
        <div className="h-0.5 bg-border/40">
          <motion.div className="h-full bg-gradient-gold" initial={false}
            animate={{ width: `${progress}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}>
              <h2 className="font-display text-3xl md:text-5xl mb-3 leading-tight">{current.title}</h2>
              {current.subtitle && <p className="text-muted-foreground mb-10 text-lg">{current.subtitle}</p>}
              <div className="mb-12">{current.render()}</div>
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Atrás
            </Button>
            <Button onClick={next} disabled={!current.canNext() || saving}
              className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12 px-8">
              {saving ? "Auditando con IA..." : step === steps.length - 1 ? "Construir mi perfil" : "Continuar"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Onboarding;
