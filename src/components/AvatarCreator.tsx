import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Wand2, RefreshCw, Check, Sparkles, ArrowLeft, ImageIcon, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyAvatarUpdated } from "@/hooks/useMyAvatar";
import { useCameraCapture } from "@/components/camera/CameraCapture";
import { SlowLoading } from "@/components/brand/SlowLoading";

export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
/** Hasta 3 fotos de la misma persona (de frente + otros ángulos) = mejor parecido. */
export const MAX_SELFIES = 3;

/** Motivo para rechazar una foto de avatar, o null si es válida. */
export function avatarFileError(f: { size: number; type: string }): string | null {
  if (!AVATAR_TYPES.includes(f.type)) return "Formato no admitido: usa una foto JPG, PNG o WebP";
  if (f.size > AVATAR_MAX_BYTES) return "Imagen muy grande (máx 8 MB)";
  return null;
}

/** Etiqueta honesta del parecido medido por el juez (0-100) o null si no se pudo medir. */
export function likenessLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "Parecido sin verificar";
  if (score >= 85) return `Parecido alto · ${score}/100`;
  if (score >= 72) return `Se parece · ${score}/100`;
  return `Parecido bajo · ${score}/100`;
}

/**
 * Selfie lista para enviar: orientación correcta (EXIF), lado mayor de 1024 px y JPEG 0.9.
 * Antes se mandaba la foto original (hasta 8 MB, a veces de lado): la cara llegaba girada o el
 * servicio la recortaba.
 */
export async function prepareSelfie(file: File, max = 1024): Promise<string> {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    const url = URL.createObjectURL(file);
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
  }
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Mensaje del servidor en un error de functions.invoke (cuerpo {error}). */
export async function invokeErrorMessage(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } })?.context;
    const body = ctx?.clone ? await ctx.clone().json() : ctx?.json ? await ctx.json() : null;
    const msg = (body as { error?: unknown } | null)?.error;
    return typeof msg === "string" && msg.trim() ? msg : fallback;
  } catch {
    return fallback;
  }
}

type Variant = { id: string; url: string; score: number | null };

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
  const [selfies, setSelfies] = useState<string[]>([]);
  const [builder, setBuilder] = useState<Builder>(DEFAULT_BUILDER);
  const [builderStep, setBuilderStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSource, setLastSource] = useState<"selfie" | "builder">("selfie");
  // Dos entradas separadas: la galería no lleva `capture` (en iPhone y Android forzaba la cámara
  // y no dejaba elegir una selfie existente); la cámara es una opción explícita aparte.
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // "Tomar una foto": en el celular, el input con capture (cámara del sistema); en la computadora,
  // `capture` no hace nada y se abría el selector de archivos: ahí se abre la cámara en vivo.
  const camera = useCameraCapture({
    facing: "user",
    inputRef: cameraRef,
    title: "Tómate una selfie",
    onFile: (f) => { void handleFileRef.current(f); },
    onPickGallery: () => fileRef.current?.click(),
  });

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

  const handleFile = async (f: File) => {
    const err = avatarFileError(f);
    if (err) {
      toast.error(err);
      return;
    }
    if (selfies.length >= MAX_SELFIES) {
      toast.error(`Máximo ${MAX_SELFIES} fotos`);
      return;
    }
    try {
      const dataUrl = await prepareSelfie(f);
      setSelfies((prev) => [...prev, dataUrl].slice(0, MAX_SELFIES));
    } catch {
      toast.error("No pudimos abrir esa foto. Prueba con otra.");
    }
  };

  const handleFileRef = useRef(handleFile);
  handleFileRef.current = handleFile;

  const create = async (source: "selfie" | "builder") => {
    setLoading(true);
    setLastSource(source);
    setVariants([]);
    setPicked(null);
    setMode("preview");
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", {
        body: source === "selfie" ? { action: "crear", selfies } : { action: "crear", builder },
      });
      if (error) throw new Error(await invokeErrorMessage(error, "No se pudo crear tu avatar. Intenta de nuevo."));
      const list: Variant[] = Array.isArray(data?.variants) ? data.variants : [];
      if (!list.length) throw new Error(data?.error ?? "No se pudo crear tu avatar. Intenta de nuevo.");
      setVariants(list);
      setPicked(list[0].id);
    } catch (e) {
      toast.error((e as Error).message);
      setMode(source === "selfie" ? "photo" : "builder");
    } finally {
      setLoading(false);
    }
  };
  const generateFromSelfie = () => create("selfie");
  const generateFromBuilder = () => create("builder");

  const choose = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", { body: { action: "elegir", variant_id: picked } });
      if (error) throw new Error(await invokeErrorMessage(error, "No se pudo guardar tu avatar."));
      if (!data?.url) throw new Error(data?.error ?? "No se pudo guardar tu avatar.");
      // La selfie ya no se necesita: se borra de la memoria de esta pantalla.
      setSelfies([]);
      notifyAvatarUpdated(data.url);
      if (data.reaplicando) toast.message("Estamos agregando a tu avatar los recuerdos de tus viajes; aparecerán en unos minutos.");
      onComplete(data.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
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
            <p className="text-sm text-muted-foreground mb-4">La IA convierte tu selfie en un retrato ilustrado premium que se parece a ti.</p>
            <div className="inline-flex items-center gap-1 text-xs text-primary"><Sparkles className="w-3 h-3" /> Recomendado</div>
          </button>
          <button
            type="button"
            onClick={() => setMode("builder")}
            className="group relative overflow-hidden p-8 rounded-2xl border border-border bg-surface hover:border-primary/60 transition-all text-left"
          >
            <Wand2 className="w-10 h-10 text-primary mb-4" />
            <div className="font-display text-2xl mb-2">Diséñalo tú</div>
            <p className="text-sm text-muted-foreground">Elige piel, pelo, outfit y accesorio.</p>
          </button>
        </div>
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition">Saltar por ahora →</button>
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
            La IA conserva tu cara, tono de piel, pelo, barba y lentes, y verifica el parecido antes de mostrártelo. Te damos 2 versiones para elegir.
          </p>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-primary/50 bg-surface/50 p-6 sm:p-8 text-center">
          {selfies.length ? (
            <div className="flex flex-wrap justify-center gap-3 mb-2" aria-label="Fotos elegidas">
              {selfies.map((s, i) => (
                <div key={i} className="relative">
                  <img src={s} alt={`Foto ${i + 1}`} className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border border-primary/50" />
                  <button
                    type="button"
                    onClick={() => setSelfies((prev) => prev.filter((_, k) => k !== i))}
                    aria-label={`Quitar foto ${i + 1}`}
                    className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center hover:border-destructive"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  {i === 0 && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider bg-primary text-primary-foreground rounded-full px-2 py-0.5">Principal</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 py-4">
              <Camera className="w-12 h-12 text-primary mx-auto" aria-hidden="true" />
              <p className="font-display text-lg">Elige una foto clara de tu cara</p>
              <p className="text-xs text-muted-foreground">JPG, PNG o WebP · máx 8 MB · de frente, sin lentes oscuros y con buena luz = mejor parecido</p>
            </div>
          )}
          {selfies.length > 0 && selfies.length < MAX_SELFIES && (
            <p className="text-xs text-muted-foreground mt-3">Opcional: agrega {MAX_SELFIES - selfies.length === 1 ? "1 foto más" : `hasta ${MAX_SELFIES - selfies.length} fotos más`} desde otro ángulo para que se parezca todavía más.</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4">
            <Button type="button" onClick={() => fileRef.current?.click()} disabled={selfies.length >= MAX_SELFIES} className="bg-gradient-gold text-primary-foreground gold-glow h-11">
              <ImageIcon className="w-4 h-4 mr-2" aria-hidden="true" /> {selfies.length ? "Agregar otra foto" : "Elegir de mi galería"}
            </Button>
            <Button type="button" variant="outline" onClick={camera.openCamera} disabled={selfies.length >= MAX_SELFIES} className="h-11">
              <Camera className="w-4 h-4 mr-2" aria-hidden="true" /> Tomar una foto
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_TYPES.join(",")}
            className="hidden"
            aria-label="Elegir foto de la galería"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept={AVATAR_TYPES.join(",")}
            capture="user"
            className="hidden"
            aria-label="Tomar una foto con la cámara"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }}
          />
          {camera.dialog}
        </div>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          Tu selfie solo se usa para crear el avatar: no se guarda ni se publica. Las versiones que no elijas se borran.
        </p>

        {selfies.length > 0 && (
          <Button onClick={generateFromSelfie} disabled={loading} className="w-full h-12 bg-gradient-gold text-primary-foreground gold-glow">
            <Sparkles className="w-4 h-4 mr-2" /> Crear mi avatar con mi cara
          </Button>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <button
            onClick={() => { setSelfies([]); setMode("builder"); }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Wand2 className="w-3 h-3" /> Prefiero diseñarlo por rasgos
          </button>
          <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition">Saltar por ahora →</button>
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
                  aria-label={step.title}
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


  // preview: 2 versiones para elegir
  return (
    <div className="space-y-6 text-center">
      {loading || !variants.length ? (
        <div className="relative mx-auto w-56 h-56 sm:w-64 sm:h-64 rounded-full overflow-hidden border border-primary/40 bg-surface flex flex-col items-center justify-center gap-3" aria-busy="true">
          <div className="absolute inset-0 bg-gradient-gold opacity-10 animate-pulse" />
          {/* A los 5 s el globo IATOS reemplaza el ícono y la estimación de tiempo. */}
          <SlowLoading active size="md" className="relative px-6" label="Creando y verificando tu parecido…">
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
            <p className="text-sm text-muted-foreground px-6">Creando y verificando tu parecido…</p>
            <p className="text-xs text-muted-foreground">Toma alrededor de 1 minuto</p>
          </SlowLoading>
        </div>
      ) : (
        <>
          <div>
            <h3 className="font-display text-2xl mb-1">Elige tu versión</h3>
            <p className="text-sm text-muted-foreground">
              {lastSource === "selfie" ? "Comparamos cada versión con tu foto para que se parezca a ti." : "Elige la que más te guste."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto" role="radiogroup" aria-label="Versiones de tu avatar">
            {variants.map((v, i) => {
              const sel = picked === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => setPicked(v.id)}
                  className="flex flex-col items-center gap-2 focus:outline-none group"
                >
                  <span className={`relative block w-full aspect-square rounded-full p-[3px] transition ${sel ? "avatar-ring shadow-[0_0_24px_-4px_rgba(212,175,55,0.7)]" : "bg-white/10 group-hover:bg-primary/40"}`}>
                    <motion.img
                      src={v.url}
                      alt={`Versión ${i + 1} de tu avatar`}
                      initial={{ opacity: 0, filter: "blur(12px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      transition={{ duration: 0.6 }}
                      className="w-full h-full rounded-full object-cover bg-[#0b0806]"
                      style={{ objectPosition: "50% 18%" }}
                    />
                    {sel && <Check className="absolute top-1 right-1 w-6 h-6 p-1 rounded-full bg-primary text-primary-foreground" aria-hidden="true" />}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {lastSource === "selfie" ? likenessLabel(v.score) : `Versión ${i + 1}`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="outline" disabled={saving} onClick={() => (lastSource === "selfie" ? generateFromSelfie() : generateFromBuilder())}>
              <RefreshCw className="w-4 h-4 mr-2" /> Volver a generar
            </Button>
            <Button onClick={choose} disabled={!picked || saving} className="bg-gradient-gold text-primary-foreground gold-glow">
              <Check className="w-4 h-4 mr-2" /> {saving ? "Guardando…" : "Usar esta versión"}
            </Button>
          </div>
          {lastSource === "selfie" && (
            <button type="button" onClick={() => setMode("photo")} className="text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-3 h-3 inline mr-1" aria-hidden="true" /> Cambiar mis fotos
            </button>
          )}
        </>
      )}
    </div>
  );
}
