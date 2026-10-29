import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Heart, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { favoriteHref, favoriteKindLabel } from "@/lib/favorites";
import { logInsight } from "@/lib/insights";
import { motion } from "framer-motion";
import { SmartImage } from "@/components/media/SmartImage";
import { destinationQuery } from "@/lib/categoryImagery";
import { destinationPhotoFallbackQuery } from "@/lib/compareCost";
import { isSafeStockUrl } from "@/lib/stockPhoto";
import { IatoName } from "@/lib/iatoMark";

type Reco = {
  id: string;
  titulo: string | null;
  descripcion: string | null;
  tipo: string | null;
  imagen_url: string | null;
  match_score: number | null;
  metadata?: Record<string, unknown> | null;
};

const Favoritos = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Reco[]>([]);
  // Mientras llega la lista no se dice «Aún no has guardado nada» (antes aparecía un instante aunque tuvieras favoritos).
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("recomendaciones")
      .select("*")
      .eq("user_id", user.id)
      .eq("guardado", true)
      .order("created_at", { ascending: false });
    setItems((data as Reco[]) ?? []);
    setLoaded(true);
  };

  useEffect(() => { load(); }, [user]);

  const unsave = async (it: Reco) => {
    await supabase.from("recomendaciones").update({ guardado: false }).eq("id", it.id);
    await logInsight("removed", (it.tipo as any) ?? "destination", it.titulo ?? "");
    setItems((s) => s.filter((x) => x.id !== it.id));
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-[1400px] mx-auto space-y-7 md:space-y-10">
        <section className="relative rounded-[24px] md:rounded-[28px] overflow-hidden ring-1 ring-white/[0.05] premium-shadow">
          <div className="h-[160px] md:h-[220px] bg-gradient-to-br from-primary/30 via-primary/10 to-background">
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <Heart className="w-40 h-40 md:w-56 md:h-56 text-primary fill-primary" />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
          <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-9">
            <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase mb-2">Curaduría personal</p>
            <h1 className="font-display text-3xl md:text-5xl leading-[1.05] text-white">Favoritos</h1>
            <p className="text-xs md:text-sm text-white/70 mt-1.5">Tus destinos y lugares guardados. <IatoName /> los toma en cuenta para recomendarte.</p>
          </div>
        </section>

        {!loaded ? (
          <div aria-busy="true" aria-label="Cargando tus favoritos" data-testid="favoritos-cargando" className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5">
            {[0, 1].map((i) => <div key={i} className="aspect-[4/5] rounded-3xl bg-white/[0.04] motion-safe:animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="glass-card rounded-3xl p-8 md:p-12 text-center" data-testid="favoritos-vacio">
            <Heart className="w-10 h-10 text-primary/40 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm md:text-base">Aún no has guardado nada. Toca el corazón en cualquier destino para empezar.</p>
            <Link to="/dashboard/descubre" className="mt-5 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-2xl bg-gradient-gold text-primary-foreground px-5 text-sm font-medium hover:opacity-90 transition">
              <Heart className="w-4 h-4" aria-hidden="true" /> Ver destinos para ti
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5">
            {items.map((it, i) => {
              const href = favoriteHref(it);
              const label = favoriteKindLabel(it.tipo);
              const body = (
                <>
                  {/* La imagen guardada; si no hay, una ilustrativa del destino. Las de Pexels van marcadas. */}
                  <SmartImage
                    alt={it.titulo ?? ""}
                    imageUrl={it.imagen_url}
                    imageKind={isSafeStockUrl(it.imagen_url) ? "stock" : "real"}
                    stockQuery={it.titulo ? destinationQuery(it.titulo) : null}
                    // Segunda búsqueda si la primera no trae foto (ronda 4, P2-4: Madrid se quedaba sin foto).
                    stockFallbackQuery={it.titulo ? destinationPhotoFallbackQuery(it.titulo) : null}
                    icon={Heart}
                    className="!absolute inset-0"
                    imgClassName="group-hover:scale-105"
                    captionClassName={it.match_score ? "top-12 left-3" : "top-3 left-3"}
                  />
                  <div className="absolute inset-0 bg-gradient-overlay" />
                  {it.match_score ? (
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium">
                      {it.match_score}% afín a ti
                    </div>
                  ) : null}
                  <div className="absolute bottom-4 left-4 right-4">
                    {label && <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{label}</p>}
                    <h3 className="font-display text-xl md:text-2xl break-words">{it.titulo}</h3>
                    {it.descripcion && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.descripcion}</p>}
                  </div>
                </>
              );
              return (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="relative glass-card rounded-2xl overflow-hidden group"
                >
                  {/* La tarjeta abre el destino (planear un viaje ahí) o el lugar en Google Maps. */}
                  {href?.internal ? (
                    <Link to={href.url} className="relative block aspect-[4/5]" aria-label={href.label} data-testid="favorito-abrir">{body}</Link>
                  ) : href ? (
                    <a href={href.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/5]" aria-label={href.label} data-testid="favorito-abrir">{body}</a>
                  ) : (
                    <div className="relative aspect-[4/5]">{body}</div>
                  )}
                  <button onClick={() => unsave(it)} aria-label={it.titulo ? `Quitar ${it.titulo} de favoritos` : "Quitar de favoritos"}
                    className="absolute top-3 right-3 z-10 p-2 rounded-full bg-background/70 backdrop-blur hover:bg-destructive/80 transition">
                    <Trash2 className="w-3.5 h-3.5" />
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

export default Favoritos;
