import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Plus, Sparkles, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import patagonia from "@/assets/destination-patagonia.jpg";
import tulum from "@/assets/destination-tulum.jpg";
import santorini from "@/assets/hero-santorini.jpg";

const MOCK_RECOS = [
  { name: "Kioto", country: "Japón", img: kyoto, score: 97, desc: "Templos en niebla, ryokans tradicionales y kaiseki estacional." },
  { name: "Bora Bora", country: "Polinesia", img: bora, score: 94, desc: "Bungalows sobre laguna turquesa con vista al Monte Otemanu." },
  { name: "Marrakech", country: "Marruecos", img: marrakech, score: 91, desc: "Riads escondidos, tagines bajo lámparas y desierto del Sahara." },
  { name: "Patagonia", country: "Chile", img: patagonia, score: 89, desc: "Torres del Paine, glaciares vivos y lodges al borde del fin del mundo." },
  { name: "Tulum", country: "México", img: tulum, score: 88, desc: "Playa caribeña, cenotes místicos y eco-resorts entre la jungla." },
  { name: "Santorini", country: "Grecia", img: santorini, score: 86, desc: "Caldera al atardecer, vinos volcánicos y arquitectura cicládica." },
];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
};

const DashboardHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [trips, setTrips] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setName(profile?.full_name?.split(" ")[0] ?? "viajero");

      const { data: t } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6);
      setTrips(t ?? []);
    })();
  }, [user]);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 space-y-12">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between flex-wrap gap-4"
        >
          <div>
            <p className="text-sm text-muted-foreground mb-2">{greeting()},</p>
            <h1 className="font-display text-4xl md:text-5xl">
              {name}. <span className="text-muted-foreground italic">¿A dónde soñamos hoy?</span>
            </h1>
          </div>
        </motion.header>

        {/* Hero CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="relative rounded-3xl overflow-hidden premium-shadow group cursor-pointer"
          onClick={() => navigate("/dashboard/planear")}
        >
          <img src={santorini} alt="Planea tu próximo viaje" className="w-full h-72 md:h-80 object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" width={1920} height={800} />
          <div className="absolute inset-0 bg-gradient-overlay" />
          <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-card text-xs mb-4 self-start">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>IA personalizada</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl mb-4 max-w-xl leading-tight">Planea un nuevo viaje</h2>
            <Button className="bg-gradient-gold text-primary-foreground hover:opacity-90 self-start gold-glow">
              <Plus className="w-4 h-4 mr-2" />
              Empezar análisis
            </Button>
          </div>
        </motion.div>

        {/* Para ti */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">Curado para ti</p>
              <h2 className="font-display text-3xl">Destinos que matchean tu perfil</h2>
            </div>
          </div>
          <div className="flex gap-5 overflow-x-auto pb-4 scroll-fade-x snap-x snap-mandatory">
            {MOCK_RECOS.map((d, i) => (
              <motion.div
                key={d.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                whileHover={{ y: -4 }}
                onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}`)}
                className="snap-start flex-shrink-0 w-72 cursor-pointer group"
              >
                <div className="relative aspect-[3/4] rounded-2xl overflow-hidden mb-4">
                  <img src={d.img} alt={d.name} loading="lazy" width={1024} height={1280} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-overlay opacity-80" />
                  <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium">
                    {d.score}% match
                  </div>
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{d.country}</p>
                    <h3 className="font-display text-2xl">{d.name}</h3>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 px-1">{d.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Tus viajes */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-display text-3xl">Tus viajes</h2>
            <Link to="/dashboard/viajes" className="text-sm text-muted-foreground hover:text-primary transition flex items-center gap-1">
              Ver todos <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {trips.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <p className="text-muted-foreground mb-4">Aún no has planeado ningún viaje.</p>
              <Button onClick={() => navigate("/dashboard/planear")} className="bg-gradient-gold text-primary-foreground hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                Planea tu primero
              </Button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {trips.map((t) => (
                <div
                  key={t.id}
                  className="relative glass-card rounded-2xl p-6 hover:gold-border transition-all duration-300 group"
                >
                  <Link
                    to={`/dashboard/viajes/${t.id}/editar`}
                    aria-label="Editar viaje"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-3 right-3 z-10 p-2 rounded-full bg-surface/60 hover:bg-primary/20 text-muted-foreground hover:text-primary transition"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Link>
                  <Link to={`/dashboard/viajes/${t.id}`} className="block">
                    <div className="flex items-start justify-between mb-4 pr-8">
                      <div>
                        <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{t.pais_destino}</p>
                        <h3 className="font-display text-2xl group-hover:text-primary transition">{t.destino}</h3>
                      </div>
                      {t.match_score && (
                        <div className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary">
                          {t.match_score}%
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{new Date(t.fecha_salida).toLocaleDateString("es-MX", { day: "numeric", month: "short" })} · {t.num_viajeros} {t.num_viajeros === 1 ? "viajero" : "viajeros"}</span>
                      <span className="text-foreground font-medium">${Number(t.total_estimado).toLocaleString("es-MX")} MXN</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
};

export default DashboardHome;
