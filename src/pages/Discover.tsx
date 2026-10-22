import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { IllustrativeCaption } from "@/components/media/SmartImage";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import { useAIRecommendations } from "@/hooks/useAIRecommendations";
import { useSavedDestinations } from "@/hooks/useSavedDestinations";

import santorini from "@/assets/hero-santorini.jpg";
// roadtrip: ideas de road trips curadas (fuente oficial por ruta).
import { RoadTripIdeas } from "@/components/roadtrip/RoadTripIdeas";

const Discover = () => {
  const navigate = useNavigate();
  const { recos, loading, error, refresh } = useAIRecommendations();
  const { saved, pending: pendingSave, toggle: toggleSave } = useSavedDestinations();

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
                    <IllustrativeCaption className="top-[3.25rem] left-4" />
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
                    disabled={pendingSave.has(d.name)}
                    aria-label={isSaved ? `Quitar ${d.name} de favoritos` : `Guardar ${d.name} en favoritos`}
                    aria-pressed={isSaved}
                    className="absolute top-4 right-4 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-background/90 transition"
                  >
                    <Heart className={`w-4 h-4 ${isSaved ? "fill-primary text-primary" : "text-foreground"}`} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        <RoadTripIdeas className="mt-12" title="Road trips por Europa" />
      </div>
    </DashboardLayout>
  );
};

export default Discover;
