import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Languages, Volume2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { toast } from "sonner";

const ESSENTIALS = [
  "Hola", "Gracias", "Por favor", "¿Cuánto cuesta?", "¿Dónde está el baño?",
  "La cuenta, por favor", "No entiendo", "Ayuda", "¿Habla inglés?", "Disculpe"
];

type Phrase = {
  es: string;
  destino: string;
  idioma: string;       // ej. "Francés"
  bcp47?: string;       // ej. "fr-FR" para SpeechSynthesis
  local: string;
  phon: string;
};

const TripTranslator = () => {
  const { id } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const tipTrad = useTooltipShown("traductor");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(data);
    })();
  }, [id]);

  // Lista de destinos del viaje (multi o single)
  const destinations: string[] = useMemo(() => {
    if (!trip) return [];
    const itin = trip.itinerario_json;
    const multi = !Array.isArray(itin) && Array.isArray(itin?.destinations)
      ? itin.destinations.filter(Boolean)
      : null;
    return multi && multi.length ? multi : (trip.destino ? [trip.destino] : []);
  }, [trip]);

  const generate = async (list: string[]) => {
    if (!trip || destinations.length === 0) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-tool", {
        body: {
          json: true,
          prompt: `Para un viaje que incluye estos destinos: ${destinations.join(", ")}. ` +
            `Traduce cada frase al idioma LOCAL de cada destino (uno por destino, en el orden dado). ` +
            `Incluye pronunciación fonética en español castellano y el código BCP47 del idioma (ej. fr-FR, el-GR, es-ES, en-US). ` +
            `Devuelve SOLO un array JSON con esta forma EXACTA, una entrada por destino y por frase: ` +
            `[{"es":"...","destino":"<destino>","idioma":"<nombre del idioma en español>","bcp47":"xx-XX","local":"...","phon":"..."}]. ` +
            `Si un destino comparte idioma con el origen español, igual inclúyelo. Frases a traducir: ${list.join(" | ")}`
        }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Error IA");
      const arr: Phrase[] = Array.isArray(data.data) ? data.data : [];
      if (arr.length === 0) toast.error("No se pudieron traducir las frases");
      else setPhrases(prev => list.length === 1 ? [...arr, ...prev] : arr);
    } catch (e: any) {
      toast.error(e?.message || "Error al traducir");
    }
    setLoading(false);
  };

  // Cargar voces del navegador (algunas se cargan asíncronamente)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices?.() ?? []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);

  const pickVoice = (lang?: string): SpeechSynthesisVoice | undefined => {
    if (!lang || voices.length === 0) return undefined;
    const target = lang.toLowerCase();
    const prefix = target.split("-")[0];
    return (
      voices.find(v => v.lang?.toLowerCase() === target) ||
      voices.find(v => v.lang?.toLowerCase().startsWith(prefix + "-")) ||
      voices.find(v => v.lang?.toLowerCase().startsWith(prefix))
    );
  };

  const speak = (txt: string, lang?: string) => {
    if (!txt) return;
    try {
      if (!("speechSynthesis" in window)) {
        toast.error("Tu navegador no soporta audio de voz");
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      const v = pickVoice(lang);
      if (v) { u.voice = v; u.lang = v.lang; }
      else if (lang) u.lang = lang;
      u.rate = 0.95;
      u.onerror = () => toast.error("No se pudo reproducir el audio");
      window.speechSynthesis.speak(u);
    } catch {
      toast.error("Error al reproducir audio");
    }
  };


  // Agrupar por frase original (es) → varias traducciones por idioma
  const grouped = useMemo(() => {
    const map = new Map<string, Phrase[]>();
    for (const p of phrases) {
      const key = p.es ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [phrases]);

  return (
    <DashboardLayout>
      <FeatureTooltip id="traductor" icon="🌐" text="Traductor offline para tu destino. Iato sugiere frases clave del país." shouldShow={tipTrad.shouldShow} onDismiss={tipTrad.dismiss} />
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <Languages className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Traductor</p>
            <h1 className="font-display text-3xl">{destinations.join(" → ") || trip?.destino}</h1>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button onClick={() => generate(ESSENTIALS)} disabled={loading} className="flex-1">
            <Sparkles className="w-4 h-4 mr-2" /> {loading ? "Generando..." : "Frases esenciales"}
          </Button>
        </div>

        <div className="flex gap-2 mb-6">
          <Input
            placeholder="Escribe una frase en español..."
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && customInput.trim()) { generate([customInput]); setCustomInput(""); } }}
          />
          <Button variant="outline" onClick={() => { if (customInput.trim()) { generate([customInput]); setCustomInput(""); } }}>Traducir</Button>
        </div>

        <div className="space-y-4">
          {grouped.map(([es, items], i) => (
            <motion.div
              key={es + i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-card rounded-2xl p-4"
            >
              <div className="text-xs text-muted-foreground mb-3">{es}</div>
              <div className="space-y-2">
                {items.map((p, j) => (
                  <div key={j} className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/40 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary mb-0.5">
                        <span>{p.destino}</span>
                        <span className="text-foreground/30">·</span>
                        <span className="text-foreground/60">{p.idioma}</span>
                      </div>
                      <div className="text-lg font-medium truncate">{p.local}</div>
                      <div className="text-xs text-primary/80 italic">/{p.phon}/</div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => speak(p.local, p.bcp47)} className="shrink-0">
                      <Volume2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripTranslator;
