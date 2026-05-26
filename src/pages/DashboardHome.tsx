import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Sparkles, Heart, Bell, Settings, Send, ChevronRight } from "lucide-react";
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
            strokeLinecap="round"
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
};

const HERO_REELS = [
  { query: "santorini sunset cinematic luxury travel aerial", fallback: santorini, label: "Santorini" },
  { query: "kyoto japan cherry blossom cinematic travel aerial", fallback: kyoto, label: "Kyoto" },
  { query: "maldives overwater villa turquoise ocean cinematic", fallback: bora, label: "Maldivas" },
  { query: "marrakech morocco medina sunset cinematic travel", fallback: marrakech, label: "Marrakech" },
  { query: "patagonia argentina mountains cinematic aerial", fallback: patagonia, label: "Patagonia" },
  { query: "tulum mexico beach cenote cinematic travel", fallback: tulum, label: "Tulum" },
  { query: "dubai skyline fountain night cinematic luxury", fallback: santorini, label: "Dubai" },
  { query: "bali rice terraces temple cinematic aerial", fallback: kyoto, label: "Bali" },
  { query: "amalfi coast italy sunset cliff cinematic", fallback: bora, label: "Amalfi" },
  { query: "iceland northern lights waterfall cinematic", fallback: patagonia, label: "Islandia" },
  { query: "capetown south africa table mountain cinematic", fallback: marrakech, label: "Ciudad del Cabo" },
  { query: "tokyo japan neon shibuya night cinematic", fallback: kyoto, label: "Tokio" },
];

const DashboardHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [trips, setTrips] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [concierge, setConcierge] = useState("");
  const [tick, setTick] = useState(0);
  const [reelIdx, setReelIdx] = useState(0);
  const [reelFading, setReelFading] = useState(false);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const REEL_DURATION = 10_000;

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

  // Live clock (refresh every minute)
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Hero reel carousel — rotates every 10s with crossfade
  useEffect(() => {
    const rotate = () => {
      setReelFading(true);
      setTimeout(() => {
        setReelIdx((i) => (i + 1) % HERO_REELS.length);
        setReelFading(false);
      }, 600);
    };
    rotate(); // start immediately so first change is at 10s
    reelTimer.current = setInterval(rotate, REEL_DURATION);
    return () => {
      if (reelTimer.current) clearInterval(reelTimer.current);
    };
  }, []);

  const toggleFav = (n: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  const now = new Date();
  const today = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = now.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase().replace(/\./g, "");

  const spendCats = [
    { label: "Alojamiento", pct: 42, color: "hsl(41 47% 59%)" },
    { label: "Gastronomía", pct: 28, color: "hsl(41 60% 70%)" },
    { label: "Experiencias", pct: 18, color: "hsl(36 30% 60%)" },
    { label: "Transporte", pct: 7, color: "hsl(0 0% 45%)" },
    { label: "Otros", pct: 5, color: "hsl(0 0% 35%)" },
  ];

  return (
    <DashboardLayout>
      <div className="px-5 md:px-10 py-7 md:py-10 space-y-12 max-w-[1400px] mx-auto">
        {/* Top header */}
        <header className="flex items-center justify-between gap-4">
          <p className="text-[11px] md:text-xs text-muted-foreground capitalize tracking-wide">
            {today} <span className="mx-2 text-primary/40">|</span> <span className="text-foreground/80 normal-case">{time}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button className="relative p-2.5 rounded-full hover:bg-white/[0.04] transition" aria-label="Notificaciones">
              <Bell className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.75} />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(41_47%_59%)]" />
            </button>
            <button onClick={() => navigate("/dashboard/perfil")} className="p-2.5 rounded-full hover:bg-white/[0.04] transition" aria-label="Ajustes">
              <Settings className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        {/* Saludo + búsqueda inline */}
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
          className="space-y-4"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
            <h1 className="font-display text-2xl md:text-4xl leading-[1.1] tracking-tight shrink-0">
              <span className="capitalize">{name || "Viajero"}</span>.
            </h1>
            <div className="relative flex items-center gap-2 md:gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-xl pl-3 md:pl-4 pr-2 py-2 focus-within:border-primary/40 transition flex-1 min-w-0">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <input
                type="text"
                value={concierge}
                onChange={(e) => setConcierge(e.target.value)}
                placeholder="Platícame tu viaje…"
                aria-label="Platícame tu viaje"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none font-display italic text-lg md:text-2xl leading-tight placeholder:text-primary/70 placeholder:italic text-foreground py-1"
              />
              <Button
                type="submit"
                disabled={concierge.trim().length < 5}
                className="h-10 px-3 md:px-5 rounded-xl bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow disabled:opacity-40 text-xs md:text-sm tracking-wide shrink-0"
              >
                Analizar
              </Button>
            </div>
          </div>
        </motion.form>


        {/* HERO — cinematic Santorini-style sunset */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <div
            className="relative rounded-[28px] overflow-hidden premium-shadow group cursor-pointer ring-1 ring-white/[0.05]"
            onClick={() => navigate("/dashboard/planear")}
          >
            <div
              className={`w-full h-[340px] md:h-[460px] transition-opacity duration-[600ms] ease-out ${reelFading ? "opacity-0" : "opacity-100"}`}
            >
              <DestinationVideo
                query={HERO_REELS[reelIdx].query}
                fallbackImage={HERO_REELS[reelIdx].fallback}
                alt={`Inicia tu travesía en ${HERO_REELS[reelIdx].label}`}
                className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-[1200ms]"
              />
            </div>
            {/* Destination label */}
            <div className={`absolute top-5 left-5 md:top-7 md:left-7 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[11px] text-white/90 tracking-wider transition-opacity duration-[600ms] ${reelFading ? "opacity-0" : "opacity-100"}`}>
              <span className="text-primary mr-1.5">&#9679;</span>
              {HERO_REELS[reelIdx].label}
            </div>
            {/* Reel progress dots */}
            <div className="absolute top-5 right-5 md:top-7 md:right-7 flex items-center gap-1.5">
              {HERO_REELS.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setReelFading(true); setTimeout(() => { setReelIdx(i); setReelFading(false); }, 600); }}
                  className={`h-1 rounded-full transition-all duration-300 ${i === reelIdx ? "w-5 bg-primary" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
                  aria-label={`Reel ${i + 1}`}
                />
              ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

            <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-12">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md text-[11px] mb-5 self-start border border-primary/25 text-foreground/90 tracking-wider">
                <Sparkles className="w-3 h-3 text-primary" />
                <span>IA personalizada</span>
              </div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.02] mb-3 max-w-2xl">
                Planea un <span className="italic gold-text font-light">nuevo</span> viaje
              </h2>
              <p className="text-sm md:text-base text-white/70 mb-6 max-w-xl leading-relaxed">
                IATOS detecta single o multi-destino, arma vuelos, hospedaje y experiencias según tu ADN de viaje.
              </p>
              <Button className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow self-start h-12 px-6 rounded-2xl text-sm tracking-wide">
                <Plus className="w-4 h-4 mr-2" strokeWidth={2.25} />
                Empezar análisis
              </Button>
            </div>
          </div>
        </motion.section>

        {/* CURADO PARA TI */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase mb-2">Curado para ti</p>
              <h2 className="font-display text-2xl md:text-3xl">Destinos que matchean tu perfil</h2>
            </div>
            <Link to="/dashboard/descubre" className="text-xs text-primary/80 hover:text-primary transition flex items-center gap-1 whitespace-nowrap tracking-wide">
              Ver todos <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {MOCK_RECOS.slice(0, 4).map((d, i) => (
              <motion.div
                key={d.name}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                whileHover={{ y: -4 }}
                onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}`)}
                className="cursor-pointer group"
              >
                <div className="relative aspect-[4/5] rounded-3xl overflow-hidden ring-1 ring-white/[0.05]">
                  <DestinationVideo query={`${d.name} ${d.country} travel cinematic`} fallbackImage={d.img} alt={d.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1100ms]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-primary/30 text-primary text-[10px] font-medium tracking-wider">
                    {d.score}% MATCH
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFav(d.name); }}
                    aria-label="Favorito"
                    className="absolute top-3 right-3 p-2 rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition"
                  >
                    <Heart className={`w-3.5 h-3.5 ${favorites.has(d.name) ? "fill-primary text-primary" : "text-white/90"}`} />
                  </button>
                  <div className="absolute bottom-3 left-3 right-3">
                    <p className="font-display text-base md:text-lg text-white/95 leading-tight">{d.name}</p>
                    <p className="text-[11px] text-white/60 tracking-wide">{d.country}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* MIS PRÓXIMOS VIAJES + SMART SPEND */}
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Próximos viajes */}
          <section className="glass-card rounded-3xl p-6 md:p-7">
            <div className="flex items-center justify-between mb-6">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase">Mis próximos viajes</p>
              <Link to="/dashboard/viajes" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1 tracking-wide">
                Ver todos <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {trips.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Aún no tienes viajes planeados.</p>
            ) : (
              <div className="space-y-2.5 mb-5">
                {trips.map((t) => {
                  const days = Math.max(0, Math.ceil((new Date(t.fecha_salida).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  return (
                    <Link to={`/dashboard/viajes/${t.id}`} key={t.id} className="flex items-center gap-4 p-2 -mx-2 rounded-2xl hover:bg-white/[0.04] transition group">
                      <div className="w-14 h-14 rounded-2xl overflow-hidden bg-surface flex-shrink-0 ring-1 ring-white/[0.06]">
                        <DestinationVideo query={`${t.destino} ${t.pais_destino ?? ""} travel`} fallbackImage={santorini} alt={t.destino} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-base truncate">{t.destino}{t.pais_destino ? `, ${t.pais_destino}` : ""}</p>
                        <p className="text-[11px] text-muted-foreground tracking-wide">
                          {t.fecha_salida ? new Date(t.fecha_salida).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                        </p>
                      </div>
                      <span className="text-[10px] px-3 py-1 rounded-full border border-primary/30 text-primary whitespace-nowrap tracking-wider">
                        EN {days}D
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <Button
              onClick={() => navigate("/dashboard/planear")}
              className="w-full h-11 rounded-2xl bg-gradient-gold text-primary-foreground hover:opacity-90 text-sm tracking-wide"
            >
              <Plus className="w-4 h-4 mr-2" />
              Crear nuevo viaje
            </Button>
          </section>

          {/* Smart Spend */}
          <section className="glass-card rounded-3xl p-6 md:p-7 relative overflow-hidden">
            <div aria-hidden className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase">Smart Spend</p>
                <Link to="/dashboard/smart-spend" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1 tracking-wide">
                  Ver reportes <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
              <p className="text-[11px] text-muted-foreground mb-1 tracking-wide">Este mes</p>
              <p className="font-display text-4xl md:text-5xl mb-1 gold-text">$2,540</p>
              <p className="text-[11px] text-muted-foreground mb-5"><span className="text-primary">+12%</span> vs mayo · USD</p>
              <div className="flex items-center gap-5">
                <SpendDonut />
                <ul className="flex-1 space-y-2 text-sm">
                  {spendCats.map((c) => (
                    <li key={c.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-muted-foreground text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                        {c.label}
                      </span>
                      <span className="text-foreground text-xs">{c.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                onClick={() => navigate("/dashboard/smart-spend")}
                className="w-full mt-6 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-foreground hover:bg-white/[0.08] text-sm tracking-wide"
              >
                Ver detalles y análisis
              </Button>
            </div>
          </section>
        </div>

        {/* AI CONCIERGE + INSPIRACIÓN */}
        <div className="grid lg:grid-cols-2 gap-5">
          <section className="glass-card rounded-3xl p-6 md:p-7">
            <div className="flex items-center justify-between mb-6">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase">AI Concierge</p>
              <Link to="/dashboard/concierge" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1 tracking-wide">
                Ver historial <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex items-start gap-4 mb-5">
              <div className="w-11 h-11 rounded-full bg-gradient-gold flex items-center justify-center flex-shrink-0 shadow-[0_8px_24px_-6px_hsl(41_47%_59%/0.5)]">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <p className="font-display text-lg mb-1">¿En qué puedo ayudarte hoy?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Planeo, reservo, descubro y optimizo cada detalle de tu viaje.
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
                placeholder="Escribe tu solicitud…"
                className="pr-12 h-12 rounded-2xl bg-white/[0.03] border-white/[0.08] focus-visible:ring-primary/40"
              />
              <button type="submit" aria-label="Enviar" className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-gradient-gold flex items-center justify-center text-primary-foreground hover:opacity-90 transition">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </section>

          <section className="glass-card rounded-3xl p-6 md:p-7">
            <div className="flex items-center justify-between mb-6">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase">Inspiración para ti</p>
              <Link to="/dashboard/descubre" className="text-xs text-primary/80 hover:text-primary flex items-center gap-1 tracking-wide">
                Ver más <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="relative rounded-2xl overflow-hidden aspect-[16/10] group cursor-pointer ring-1 ring-white/[0.05]" onClick={() => navigate("/dashboard/descubre")}>
              <DestinationVideo query="romantic beach sunset travel cinematic" fallbackImage={tulum} alt="Escapadas románticas" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1100ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center hover:bg-black/75 transition" aria-label="Siguiente">
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="absolute bottom-4 left-4 right-4">
                <h3 className="font-display text-2xl mb-1">Escapadas <span className="italic gold-text font-light">románticas</span></h3>
                <p className="text-[11px] text-white/70 tracking-wide">Destinos perfectos para conectar</p>
              </div>
            </div>
            <div className="flex justify-center gap-1.5 mt-4">
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
