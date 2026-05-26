import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Languages, Volume2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { toast } from "sonner";

const ESSENTIALS = [
  "Hola", "Gracias", "Por favor", "¿Cuánto cuesta?", "¿Dónde está el baño?",
  "La cuenta, por favor", "No entiendo", "Ayuda", "¿Habla inglés?", "Disculpe"
];

const TripTranslator = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [phrases, setPhrases] = useState<{ es: string; local: string; phon: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(data);
    })();
  }, [id]);

  const generate = async (list: string[]) => {
    if (!trip) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-tool", {
        body: {
          json: true,
          prompt: `Para un viaje a ${trip.destino}, traduce estas frases al idioma local con pronunciación fonética en español. Devuelve un array JSON exactamente así: [{"es":"...","local":"...","phon":"..."}]. Frases: ${list.join(" | ")}`
        }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Error IA");
      const arr = Array.isArray(data.data) ? data.data : [];
      if (arr.length === 0) toast.error("No se pudieron traducir las frases");
      else setPhrases(prev => list.length === 1 ? [...arr, ...prev] : arr);
    } catch (e: any) {
      toast.error(e?.message || "Error al traducir");
    }
    setLoading(false);
  };

  const speak = (txt: string) => {
    try {
      const u = new SpeechSynthesisUtterance(txt);
      window.speechSynthesis.speak(u);
    } catch {}
  };

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="mb-6 flex items-center gap-3">
          <Languages className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Traductor</p>
            <h1 className="font-display text-3xl">{trip?.destino}</h1>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button onClick={() => generate(ESSENTIALS)} disabled={loading} className="flex-1">
            <Sparkles className="w-4 h-4 mr-2" /> {loading ? "Generando..." : "Frases esenciales"}
          </Button>
        </div>

        <div className="flex gap-2 mb-6">
          <Input placeholder="Escribe una frase en español..." value={customInput} onChange={e => setCustomInput(e.target.value)} />
          <Button variant="outline" onClick={() => { if (customInput.trim()) { generate([customInput]); setCustomInput(""); } }}>Traducir</Button>
        </div>

        <div className="space-y-2">
          {phrases.map((p, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="glass-card rounded-2xl p-4">
              <div className="text-xs text-muted-foreground mb-1">{p.es}</div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-medium">{p.local}</div>
                  <div className="text-xs text-primary italic">/{p.phon}/</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => speak(p.local)}>
                  <Volume2 className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripTranslator;
