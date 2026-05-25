import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Plus, Sparkles, Heart, Bell, Settings, Send, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";

import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import patagonia from "@/assets/destination-patagonia.jpg";
import tulum from "@/assets/destination-tulum.jpg";
import santorini from "@/assets/hero-santorini.jpg";

const MOCK_RECOS = [
  { name: "Bali", country: "Indonesia", img: kyoto, score: 97 },
  { name: "Maldivas", country: "Maldivas", img: bora, score: 94 },
  { name: "Marrakech", country: "Marruecos", img: marrakech, score: 91 },
  { name: "Islandia", country: "Islandia", img: patagonia, score: 89 },
  { name: "Tulum", country: "México", img: tulum, score: 88 },
  { name: "Santorini", country: "Grecia", img: santorini, score: 86 },
];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
};

// Donut chart for Smart Spend
const SpendDonut = () => {
  const segments = [
    { label: "Alojamiento", pct: 42, color: "hsl(41 47% 59%)" },
    { label: "Gastronomía", pct: 28, color: "hsl(41 60% 70%)" },
    { label: "Experiencias", pct: 18, color: "hsl(36 30% 60%)" },
    { label: "Transporte", pct: 7, color: "hsl(0 0% 35%)" },
    { label: "Otros", pct: 5, color: "hsl(0 0% 25%)" },
  ];
  const radius = 42;
  const C = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(0 0% 14%)" strokeWidth="14" />
      {segments.map((s) => {
        const len = (s.pct / 100) * C;
        const el = (
          <circle
            key={s.label}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
};

const DashboardHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [trips, setTrips] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [concierge, setConcierge] = useState("");

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
        .limit(2);
      setTrips(t ?? []);
    })();
  }, [user]);

  const toggleFav = (name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const today = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const now = new Date().toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: true });

  const spendCats = [
    { label: "Alojamiento", pct: 42, color: "hsl(41 47% 59%)" },
    { label: "Gastronomía", pct: 28, color: "hsl(41 60% 70%)" },
    { label: "Experiencias", pct: 18, color: "hsl(36 30% 60%)" },
    { label: "Transporte", pct: 7, color: "hsl(0 0% 45%)" },
    { label: "Otros", pct: 5, color: "hsl(0 0% 35%)" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 space-y-10">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground capitalize">
            {today} <span className="mx-2 opacity-50">|</span> {now}
          </p>
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-full hover:bg-surface transition" aria-label="Notificaciones">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
            </button>
            <button onClick={() => navigate("/dashboard/perfil")} className="p-2 rounded-full hover:bg-surface transition" aria-label="Ajustes">
              <Settings className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </header>

        {/* Saludo + buscador en un mismo renglón */}
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          onSubmit={(e) => {
            e.preventDefault();
            const q = concierge.trim();
            if (q.length < 5) return;
            navigate(`/dashboard/planear?q=${encodeURIComponent(q)}`);
          }}
          className="flex items-center gap-3 flex-wrap"
        >
          <h1 className="font-display text-xl md:text-3xl whitespace-nowrap">{name}.</h1>
          <input
            type="text"
            value={concierge}
            onChange={(e) => setConcierge(e.target.value)}
            placeholder="Platicame tu viaje…"
            aria-label="Platicame tu viaje"
            className="flex-1 min-w-[240px] bg-transparent border-0 border-b border-primary/30 focus:border-primary outline-none font-display italic text-xl md:text-3xl leading-tight placeholder:text-primary/70 placeholder:italic text-foreground py-1"
          />
          <Button
            type="submit"
            disabled={concierge.trim().length < 5}
            className="h-12 px-5 bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow disabled:opacity-40"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Analizar viaje
          </Button>
        </motion.form>



        {/* Hero CTA secundario (planeación guiada paso a paso) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative rounded-3xl overflow-hidden premium-shadow group cursor-pointer"
          onClick={() => navigate("/dashboard/planear")}
        >
          <DestinationVideo query="travel landscape cinematic" fallbackImage={santorini} alt="Planea tu próximo viaje" className="w-full h-56 md:h-64 object-cover group-hover:scale-105 transition-transform duration-700" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-9">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur text-xs mb-3 self-start border border-white/10">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>Planeación guiada</span>
            </div>
            <h2 className="font-display text-2xl md:text-4xl mb-3 leading-tight">¿Prefieres paso a paso?</h2>
            <Button className="bg-white/10 backdrop-blur border border-white/20 text-foreground hover:bg-white/20 self-start">
              <Plus className="w-4 h-4 mr-2" />
              Planeación guiada
            </Button>
          </div>
        </motion.div>


        {/* Curado para ti */}
        <section>
          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="text-primary text-xs tracking-[0.25em] uppercase mb-1.5">Curado para ti</p>
              <h2 className="font-display text-2xl md:text-3xl">Destinos que matchean tu perfil</h2>
            </div>
            <Link to="/dashboard/descubre" className="text-sm text-primary/80 hover:text-primary transition flex items-center gap-1 whitespace-nowrap">
              Ver todos <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {MOCK_RECOS.slice(0, 4).map((d, i) => (
              <motion.div
                key={d.name}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                whileHover={{ y: -3 }}
                onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}`)}
                className="cursor-pointer group"
              >
                <div className="relative aspect-square rounded-2xl overflow-hidden mb-3">
                  <DestinationVideo query={`${d.name} ${d.country} travel`} fallbackImage={d.img} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-[11px] font-medium">
                    {d.score}% match
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFav(d.name); }}
                    aria-label="Favorito"
                    className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/50 backdrop-blur hover:bg-black/70 transition"
                  >
                    <Heart className={`w-4 h-4 ${favorites.has(d.name) ? "fill-primary text-primary" : "text-white"}`} />
                  </button>
                  <div className="absolute bottom-3 left-3">
                    <p className="text-sm text-white/95 font-medium">{d.name}, {d.country}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Two-column: Próximos viajes + Smart Spend */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Próximos viajes */}
          <section className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-primary text-xs tracking-[0.25em] uppercase">Mis próximos viajes</p>
              <Link to="/dashboard/viajes" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1">
                Ver todos <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {trips.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Aún no tienes viajes planeados.</p>
            ) : (
              <div className="space-y-3 mb-4">
                {trips.map((t) => {
                  const days = Math.max(0, Math.ceil((new Date(t.fecha_salida).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  return (
                    <Link to={`/dashboard/viajes/${t.id}`} key={t.id} className="flex items-center gap-4 p-2 -mx-2 rounded-xl hover:bg-surface/60 transition">
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface flex-shrink-0">
                        <DestinationVideo query={`${t.destino} ${t.pais_destino ?? ""} travel`} fallbackImage={santorini} alt={t.destino} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{t.destino}, {t.pais_destino}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(t.fecha_salida).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <span className="text-xs px-3 py-1 rounded-full border border-primary/30 text-primary whitespace-nowrap">
                        En {days} días
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <Button
              onClick={() => navigate("/dashboard/planear")}
              className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90"
            >
              <Plus className="w-4 h-4 mr-2" />
              Crear nuevo viaje
            </Button>
          </section>

          {/* Smart Spend */}
          <section className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-primary text-xs tracking-[0.25em] uppercase">Smart Spend</p>
              <Link to="/dashboard/smart-spend" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1">
                Ver reportes <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mb-1">Este mes has gastado</p>
            <p className="font-display text-4xl mb-1">$2,540 <span className="text-base text-muted-foreground">USD</span></p>
            <p className="text-xs text-primary mb-4">+12% vs mayo</p>
            <div className="flex items-center gap-5">
              <SpendDonut />
              <ul className="flex-1 space-y-1.5 text-sm">
                {spendCats.map((c) => (
                  <li key={c.label} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                      {c.label}
                    </span>
                    <span className="text-foreground">{c.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              onClick={() => navigate("/dashboard/smart-spend")}
              className="w-full mt-5 bg-gradient-gold text-primary-foreground hover:opacity-90"
            >
              Ver detalles y análisis
            </Button>
          </section>
        </div>

        {/* AI Concierge + Inspiración */}
        <div className="grid lg:grid-cols-2 gap-6">
          <section className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-primary text-xs tracking-[0.25em] uppercase">AI Concierge</p>
              <Link to="/dashboard/concierge" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1">
                Ver historial <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full border border-primary/40 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium mb-1">¿En qué puedo ayudarte hoy?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Puedo ayudarte a planear, reservar, descubrir y optimizar cada detalle de tu viaje.
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (concierge.trim()) navigate(`/dashboard/planear?q=${encodeURIComponent(concierge)}`); }}
              className="relative"
            >
              <Input
                value={concierge}
                onChange={(e) => setConcierge(e.target.value)}
                placeholder="Escribe tu solicitud..."
                className="pr-12 bg-surface/60 border-border/60"
              />
              <button type="submit" aria-label="Enviar" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-primary/10 text-primary transition">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </section>

          <section className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-primary text-xs tracking-[0.25em] uppercase">Inspiración para ti</p>
              <Link to="/dashboard/descubre" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1">
                Ver más <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="relative rounded-xl overflow-hidden aspect-[16/9] group cursor-pointer" onClick={() => navigate("/dashboard/descubre")}>
              <DestinationVideo query="romantic beach sunset travel" fallbackImage={tulum} alt="Escapadas románticas" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center hover:bg-black/70" aria-label="Siguiente">
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="absolute bottom-4 left-4 right-4">
                <h3 className="font-display text-xl mb-1">Escapadas románticas</h3>
                <p className="text-xs text-white/80">Destinos perfectos para conectar</p>
              </div>
            </div>
            <div className="flex justify-center gap-1.5 mt-3">
              <span className="w-6 h-1 rounded-full bg-primary" />
              <span className="w-1 h-1 rounded-full bg-muted" />
              <span className="w-1 h-1 rounded-full bg-muted" />
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default DashboardHome;
