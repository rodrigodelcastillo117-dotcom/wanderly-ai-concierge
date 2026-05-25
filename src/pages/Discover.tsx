import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { logInsight } from "@/lib/insights";
import { toast } from "sonner";

import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import patagonia from "@/assets/destination-patagonia.jpg";
import tulum from "@/assets/destination-tulum.jpg";
import santorini from "@/assets/hero-santorini.jpg";

const RECOS = [
  { name: "Kioto", country: "Japón", img: kyoto, score: 97 },
  { name: "Bora Bora", country: "Polinesia", img: bora, score: 94 },
  { name: "Marrakech", country: "Marruecos", img: marrakech, score: 91 },
  { name: "Patagonia", country: "Chile", img: patagonia, score: 89 },
  { name: "Tulum", country: "México", img: tulum, score: 88 },
  { name: "Santorini", country: "Grecia", img: santorini, score: 86 },
];

const Discover = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    supabase.from("recomendaciones").select("titulo").eq("user_id", user.id).eq("guardado", true)
      .then(({ data }) => setSaved(new Set((data ?? []).map((r: any) => r.titulo))));
  }, [user]);

  const toggleSave = async (d: typeof RECOS[number]) => {
    if (!user) return;
    const isSaved = saved.has(d.name);
    if (isSaved) {
      await supabase.from("recomendaciones").update({ guardado: false })
        .eq("user_id", user.id).eq("titulo", d.name);
      await logInsight("removed", "destination", d.name);
      setSaved((s) => { const n = new Set(s); n.delete(d.name); return n; });
    } else {
      // upsert-style: try update first, then insert
      const { data: existing } = await supabase.from("recomendaciones").select("id")
        .eq("user_id", user.id).eq("titulo", d.name).maybeSingle();
      if (existing) {
        await supabase.from("recomendaciones").update({ guardado: true }).eq("id", existing.id);
      } else {
        await supabase.from("recomendaciones").insert([{
          user_id: user.id, titulo: d.name, tipo: "destination",
          descripcion: d.country, imagen_url: d.img, match_score: d.score, guardado: true,
        }]);
      }
      await logInsight("saved", "destination", d.name, { country: d.country, score: d.score });
      setSaved((s) => new Set(s).add(d.name));
      toast.success(`${d.name} guardado en favoritos`);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10">
        <h1 className="font-display text-4xl md:text-5xl mb-3">Descubre</h1>
        <p className="text-muted-foreground mb-10">Destinos curados según tu perfil de viajero.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {RECOS.map((d, i) => {
            const isSaved = saved.has(d.name);
            return (
              <motion.div
                key={d.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                whileHover={{ y: -4 }}
                className="cursor-pointer group relative"
              >
                <div onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}`)}
                  className="relative aspect-[4/5] rounded-2xl overflow-hidden mb-3">
                  <DestinationVideo query={`${d.name} ${d.country} travel`} fallbackImage={d.img} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-overlay" />
                  <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium">
                    {d.score}% match
                  </div>
                  <div className="absolute bottom-4 left-4">
                    <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{d.country}</p>
                    <h3 className="font-display text-2xl">{d.name}</h3>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSave(d); }}
                  aria-label={isSaved ? "Quitar de favoritos" : "Guardar"}
                  className="absolute top-4 right-4 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-background/90 transition"
                >
                  <Heart className={`w-4 h-4 ${isSaved ? "fill-primary text-primary" : "text-foreground"}`} />
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Discover;
