import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Wand2, Upload, RefreshCw, Check, Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Mode = "choose" | "photo" | "builder" | "preview";

type Builder = {
  gender: string;
  skin: string;
  hair_style: string;
  hair_color: string;
  outfit_style: string;
  accessory: string;
  dream_destination: string;
  vibe: string;
};

const DEFAULT_BUILDER: Builder = {
  gender: "",
  skin: "",
  hair_style: "",
  hair_color: "",
  outfit_style: "",
  accessory: "",
  dream_destination: "",
  vibe: "",
};

const GENDERS = [
  { id: "feminine woman", label: "Mujer", emoji: "👩" },
  { id: "masculine man", label: "Hombre", emoji: "👨" },
  { id: "androgynous person", label: "Andrógino", emoji: "🧑" },
];

const SKINS = [
  { id: "porcelain fair skin", label: "Muy clara", color: "#F5DDC8" },
  { id: "light beige skin", label: "Clara", color: "#E8C39E" },
  { id: "warm tan medium skin", label: "Media", color: "#C68B5C" },
  { id: "rich golden brown skin", label: "Morena", color: "#8C5A37" },
  { id: "deep dark brown skin", label: "Oscura", color: "#4B2A17" },
];

const HAIRS = [
  { id: "short pixie cut", label: "Corto", emoji: "💇" },
  { id: "medium wavy hair", label: "Medio ondulado", emoji: "🌊" },
  { id: "long straight flowing hair", label: "Largo liso", emoji: "💁" },
  { id: "curly afro hair", label: "Rizado", emoji: "🌀" },
  { id: "modern undercut with longer top", label: "Undercut", emoji: "✂️" },
  { id: "bald clean shaven head", label: "Calvo", emoji: "🥚" },
];

const HAIR_COLORS = [
  { id: "jet black", label: "Negro", color: "#1a1a1a" },
  { id: "rich chocolate brown", label: "Castaño", color: "#5a3a1f" },
  { id: "warm honey blonde", label: "Rubio", color: "#d6b06a" },
  { id: "fiery auburn red", label: "Rojo", color: "#a14a2a" },
  { id: "silver platinum", label: "Plateado", color: "#c8c8d0" },
  { id: "vibrant pastel pink", label: "Fantasía", color: "#e2a4d4" },
];

const OUTFITS = [
  { id: "tailored beige trench coat over cashmere knit, leather loafers", label: "Elegante europeo", emoji: "🧥" },
  { id: "crisp linen white shirt, beige trousers, designer sunglasses, sandals", label: "Mediterráneo", emoji: "👕" },
  { id: "sleek black technical jacket, minimalist sneakers, modern Tokyo street style", label: "Tech minimal", emoji: "🖤" },
  { id: "flowing linen kaftan, mala beads, sandals, boho wellness", label: "Boho wellness", emoji: "🧘" },
  { id: "premium technical adventure parka, hiking boots, explorer gear", label: "Aventurero", emoji: "🥾" },
  { id: "luxe silk shirt, tailored suit, polished oxford shoes, old-money elegance", label: "Old money", emoji: "🥂" },
];

const ACCESSORIES = [
  { id: "vintage leather travel journal", label: "Diario de viaje", emoji: "📓" },
  { id: "professional camera around neck", label: "Cámara", emoji: "📷" },
  { id: "glass of champagne", label: "Copa de champaña", emoji: "🥂" },
  { id: "steaming coffee cup", label: "Café", emoji: "☕" },
  { id: "designer luggage tag", label: "Maleta de diseño", emoji: "🧳" },
  { id: "fresh tropical coconut", label: "Coco tropical", emoji: "🥥" },
];

const VIBES = [
  { id: "joyful and confident, warm smile, sun-kissed glow", label: "Feliz & soleado", emoji: "☀️" },
  { id: "mysterious sophisticated, subtle smirk, cinematic mood", label: "Misterioso", emoji: "🌙" },
  { id: "adventurous and energetic, dynamic pose, wind in hair", label: "Aventurero", emoji: "🌪️" },
  { id: "serene and zen, peaceful expression, soft glow", label: "Sereno", emoji: "🪷" },
];

type Props = {
  onComplete: (url: string | null) => void;
  onSkip: () => void;
};

export default function AvatarCreator({ onComplete, onSkip }: Props) {
  // La ruta principal es la selfie: el avatar debe PARECERSE al usuario.
  const [mode, setMode] = useState<Mode>("photo");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [builder, setBuilder] = useState<Builder>(DEFAULT_BUILDER);
  const [builderStep, setBuilderStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const builderSteps: { key: keyof Builder; title: string; options: { id: string; label: string; emoji?: string; color?: string }[]; type: "grid" | "swatch" | "text" }[] = [
    { key: "gender", title: "¿Cómo te identificas?", options: GENDERS, type: "grid" },
    { key: "skin", title: "Tono de piel", options: SKINS, type: "swatch" },
    { key: "hair_style", title: "Estilo de pelo", options: HAIRS, type: "grid" },
    { key: "hair_color", title: "Color de pelo", options: HAIR_COLORS, type: "swatch" },
    { key: "outfit_style", title: "Tu outfit de viajero", options: OUTFITS, type: "grid" },
    { key: "accessory", title: "Tu accesorio favorito", options: ACCESSORIES, type: "grid" },
    { key: "vibe", title: "¿Cuál es tu vibe?", options: VIBES, type: "grid" },
    { key: "dream_destination", title: "Tu destino soñado de fondo", options: [], type: "text" },
  ];

  const handleFile = (f: File) => {
    if (f.size > 8 * 1024 * 1024) {
      toast.error("Imagen muy grande (máx 8MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSelfie(reader.result as string);
    reader.readAsDataURL(f);
  };

  const generateFromSelfie = async () => {
    if (!selfie) return;
    setLoading(true);
    setMode("preview");
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", {
        body: { selfie },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Sin imagen");
      setGenerated(data.url);
    } catch (e: any) {
      toast.error("No se pudo crear tu avatar. Intenta de nuevo.");
      console.error(e);
      setMode("photo");
    } finally {
      setLoading(false);
    }
  };

  const generateFromBuilder = async () => {
    setLoading(true);
    setMode("preview");
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", {
        body: { builder },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Sin imagen");
      setGenerated(data.url);
    } catch (e: any) {
      toast.error("No se pudo crear tu avatar. Intenta de nuevo.");
      console.error(e);
      setMode("builder");
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------ Render ------------------------------ */

  if (mode === "choose") {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setMode("photo")}
            className="group relative overflow-hidden p-8 rounded-2xl border border-border bg-surface hover:border-primary/60 transition-all text-left gold-glow-hover"
          >
            <Camera className="w-10 h-10 text-primary mb-4" />
            <div className="font-display text-2xl mb-2">Sube una foto</div>
            <p className="text-sm text-muted-foreground mb-4">
              La IA convierte tu selfie en una caricatura premium estilo Pixar en 15 segundos.
            </p>
            <div className="inline-flex items-center gap-1 text-xs text-primary">
              <Sparkles className="w-3 h-3" /> Recomendado
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode("builder")}
            className="group relative overflow-hidden p-8 rounded-2xl border border-border bg-surface hover:border-primary/60 transition-all text-left"
          >
            <Wand2 className="w-10 h-10 text-primary mb-4" />
            <div className="font-display text-2xl mb-2">Diséñalo tú</div>
            <p className="text-sm text-muted-foreground">
              Elige cara, pelo, outfit, accesorio y fondo. Como un Mii, pero de lujo.
            </p>
          </button>
        </div>
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition">
          Saltar por ahora →
        </button>
      </div>
    );
  }

  if (mode === "photo") {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-primary">
            <Sparkles className="w-3 h-3" /> Recomendado
          </div>
          <h3 className="font-display text-2xl">Crea tu avatar a partir de tu selfie</h3>
          <p className="text-sm text-muted-foreground">
            La IA conserva tus rasgos reales y los convierte en un retrato premium estilo Pixar. Se parecerá a ti de verdad.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => !selfie && fileRef.current?.click()}
          onKeyDown={(e) => { if (!selfie && (e.key === "Enter" || e.key === " ")) fileRef.current?.click(); }}
          className="rounded-2xl border-2 border-dashed border-primary/50 bg-surface/50 p-8 text-center cursor-pointer hover:border-primary transition"
        >
          {selfie ? (
            <div className="space-y-4">
              <img src={selfie} alt="Tu foto" className="mx-auto max-h-80 rounded-xl object-cover" />
              <button onClick={() => fileRef.current?.click()} className="text-xs text-primary hover:underline">
                Cambiar foto
              </button>
            </div>
          ) : (
            <div className="space-y-3 py-8">
              <Camera className="w-12 h-12 text-primary mx-auto" />
              <p className="font-display text-lg">Sube o toma una foto clara de tu cara</p>
              <p className="text-xs text-muted-foreground">JPG o PNG · máx 8MB · de frente y bien iluminada = mejor parecido</p>
              <Button className="bg-gradient-gold text-primary-foreground gold-glow">
                <Upload className="w-4 h-4 mr-2" /> Seleccionar foto
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {selfie && (
          <Button onClick={generateFromSelfie} disabled={loading} className="w-full h-12 bg-gradient-gold text-primary-foreground gold-glow">
            <Sparkles className="w-4 h-4 mr-2" /> Crear mi avatar con mi cara
          </Button>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <button
            onClick={() => { setSelfie(null); setMode("builder"); }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Wand2 className="w-3 h-3" /> Prefiero diseñarlo por rasgos
          </button>
          <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition">
            Saltar por ahora →
          </button>
        </div>
      </div>
    );
  }


  if (mode === "builder") {
    const step = builderSteps[builderStep];
    const isLast = builderStep === builderSteps.length - 1;
    const value = builder[step.key];
    const canNext = (step.type === "text" ? value.trim().length > 1 : !!value);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button onClick={() => builderStep === 0 ? setMode("photo") : setBuilderStep(builderStep - 1)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Volver
          </button>
          <span className="text-xs text-muted-foreground">{builderStep + 1} / {builderSteps.length}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={builderStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="space-y-4">
            <h3 className="font-display text-2xl">{step.title}</h3>

            {step.type === "swatch" && (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {step.options.map((o) => {
                  const sel = value === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setBuilder({ ...builder, [step.key]: o.id })}
                      className={`p-3 rounded-xl border transition-all ${sel ? "border-primary gold-glow" : "border-border hover:border-primary/40"}`}
                    >
                      <div className="w-full aspect-square rounded-lg mb-2 border border-border/40" style={{ background: o.color }} />
                      <div className="text-xs">{o.label}</div>
                    </button>
                  );
                })}
              </div>
            )}

            {step.type === "grid" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {step.options.map((o) => {
                  const sel = value === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setBuilder({ ...builder, [step.key]: o.id })}
                      className={`relative p-4 rounded-xl border text-left transition-all ${sel ? "border-primary bg-primary/10 gold-glow" : "border-border bg-surface hover:border-primary/40"}`}
                    >
                      {o.emoji && <div className="text-2xl mb-2">{o.emoji}</div>}
                      <div className="text-sm font-medium">{o.label}</div>
                      {sel && <Check className="absolute top-2 right-2 w-4 h-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}

            {step.type === "text" && (
              <div className="space-y-2">
                <Input
                  autoFocus
                  placeholder="Ej: Santorini al atardecer, Tokio neón, Patagonia..."
                  value={value}
                  onChange={(e) => setBuilder({ ...builder, [step.key]: e.target.value })}
                  className="bg-input border-border h-12 text-base"
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">El fondo del avatar será este lugar.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <Button
          onClick={() => isLast ? generateFromBuilder() : setBuilderStep(builderStep + 1)}
          disabled={!canNext}
          className="w-full h-12 bg-gradient-gold text-primary-foreground gold-glow"
        >
          {isLast ? <><Sparkles className="w-4 h-4 mr-2" /> Crear mi avatar</> : "Continuar"}
        </Button>
      </div>
    );
  }

  // preview
  return (
    <div className="space-y-6 text-center">
      <div className="relative mx-auto w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden border border-border bg-surface">
        {loading || !generated ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="absolute inset-0 bg-gradient-gold opacity-10 animate-pulse" />
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
            <p className="text-sm text-muted-foreground">Creando tu avatar único...</p>
            <p className="text-xs text-muted-foreground">Esto toma unos 15-30 segundos</p>
          </div>
        ) : (
          <motion.img
            key={generated}
            src={generated}
            alt="Tu Travel Avatar"
            initial={{ opacity: 0, scale: 1.05, filter: "blur(20px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
      </div>

      {generated && !loading && (
        <>
          <div>
            <h3 className="font-display text-2xl mb-1">¡Te ves increíble!</h3>
            <p className="text-sm text-muted-foreground">Este será tu Travel Avatar en IATOS.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="outline"
              onClick={() => {
                setGenerated(null);
                selfie ? generateFromSelfie() : generateFromBuilder();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Regenerar
            </Button>
            <Button onClick={() => onComplete(generated)} className="bg-gradient-gold text-primary-foreground gold-glow">
              <Check className="w-4 h-4 mr-2" /> Usar este avatar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
