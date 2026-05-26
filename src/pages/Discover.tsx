import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { logInsight } from "@/lib/insights";
import { toast } from "sonner";
import { useAIRecommendations, type AIRecommendation } from "@/hooks/useAIRecommendations";

import santorini from "@/assets/hero-santorini.jpg";

const Discover = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const { recos, loading, error, refresh } = useAIRecommendations();

  useEffect(() => {
    if (!user) return;
    supabase.from("recomendaciones").select("titulo").eq("user_id", user.id).eq("guardado", true)
      .then(({ data }) => setSaved(new Set((data ?? []).map((r: any) => r.titulo))));
  }, [user]);

  const toggleSave = async (d: AIRecommendation) => {
    if (!user) return;
    const isSaved = saved.has(d.name);
    if (isSaved) {
      await supabase.from("recomendaciones").update({ guardado: false })
        .eq("user_id", user.id).eq("titulo", d.name);
      await logInsight("removed", "destination", d.name);
      setSaved((s) => { const n = new Set(s); n.delete(d.name); return n; });
    } else {
      const { data: existing } = await supabase.from("recomendaciones").select("id")
        .eq("user_id", user.id).eq("titulo", d.name).maybeSingle();
      if (existing) {
        await supabase.from("recomendaciones").update({ guardado: true }).eq("id", existing.id);
      } else {
        await supabase.from("recomendaciones").insert([{
          user_id: user.id, titulo: d.name, tipo: "destination_ai",
          descripcion: d.country, match_score: d.score, guardado: true,
          metadata: { reason: d.reason, image_query: d.image_query, trip_type: d.trip_type, best_months: d.best_months },
        }]);
      }
      await logInsight("saved", "destination", d.name, { country: d.country, score: d.score });
      setSaved((s) => new Set(s).add(d.name));
      toast.success(`${d.name} guardado en favoritos`);
    }
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10">
        <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
          <div>
            <p className="text-primary text-[11px] tracking-[0.35em] uppercase mb-2 flex items-center gap-2">
              <Sparkles className="w-3 h-3" /> Curados por IATOS AI · 100% personalizado
            </p>
            <h1 className="font-display text-3xl md:text-5xl mb-2">Descubre</h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              Destinos generados <span className="text-foreground">específicamente para tu perfil de viajero</span> — basados en tus intereses, ritmo, gastronomía, presupuesto y viajes anteriores.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-xs transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Regenerar
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && !recos && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] rounded-2xl bg-surface/50 animate-pulse" />
            ))}
          </div>
        )}

        {recos && recos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5">
            {recos.map((d, i) => {
              const isSaved = saved.has(d.name);
              return (
                <motion.div
                  key={`${d.name}-${i}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  whileHover={{ y: -4 }}
                  className="cursor-pointer group relative"
                >
                  <div onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}`)}
                    className="relative aspect-[4/5] rounded-2xl overflow-hidden mb-3">
                    <DestinationVideo query={d.image_query} fallbackImage={santorini} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    <div className="absolute inset-0 bg-gradient-overlay" />
                    <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium">
                      {d.score}% match
                    </div>
                    {d.trip_type && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white/90 text-[10px] tracking-wider uppercase">
                        {d.trip_type}
                      </div>
                    )}
                    <div className="absolute bottom-4 left-4 right-4">
                      <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{d.country}</p>
                      <h3 className="font-display text-2xl mb-2">{d.name}</h3>
                      {d.reason && (
                        <p className="text-[11px] text-white/75 leading-snug line-clamp-3 italic">
                          {d.reason}
                        </p>
                      )}
                      {d.best_months && (
                        <p className="text-[10px] text-primary/80 mt-1.5 tracking-wide">
                          Mejor época: {d.best_months}
                        </p>
                      )}
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
        )}
      </div>
    </DashboardLayout>
  );
};

export default Discover;
