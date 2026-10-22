import { canonicalCategory, categoryColor } from "@/lib/expenseCategories";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles, Heart, Bell, Settings, Send, ChevronRight, Scale, ArrowLeftRight, Crown, MapPin, Plane, Hotel, Shield, Gift, Car, Wifi, Compass, Ship, UtensilsCrossed, TrainFront, Anchor, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { useAIRecommendations } from "@/hooks/useAIRecommendations";
import { useSavedDestinations } from "@/hooks/useSavedDestinations";
import { homeTrips } from "@/lib/homeTrips";
import { VoiceInput } from "@/components/VoiceInput";
import tileTrenes from "@/assets/tools/tile-trenes.jpg";
import tileFerries from "@/assets/tools/tile-ferries.jpg";
// JPG de 600 px (~9 kB) en lugar de PNG de 800 px (~250 kB cada uno).
import tileReservas from "@/assets/tools/tile-reservas.jpg";
import { TripFileUpload } from "@/components/TripFileUpload";


import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import patagonia from "@/assets/destination-patagonia.jpg";
import tulum from "@/assets/destination-tulum.jpg";
import santorini from "@/assets/hero-santorini.jpg";
import { daysFromToday, formatLocalDate, localISODate } from "@/lib/localDate";
import { convert, fetchFxTable, fxLabel } from "@/lib/fx";
import { ACTIVE_TRIP_COLUMNS, useActiveTrip } from "@/hooks/useActiveTrip";
import { ActiveTripPicker } from "@/components/ActiveTripPicker";
import { withTripParam } from "@/lib/tripLink";
import { isTripEnded } from "@/lib/activeTrip";
import { TripCommandCenter } from "@/components/TripCommandCenter";
import { FirstTripGuide } from "@/components/FirstTripGuide";
import { EXAMPLE_PROMPTS } from "@/lib/planDefaults";




// Donut chart for Smart Spend (renders empty ring when there's no data)
const SpendDonut = ({ segments }: { segments: { label: string; pct: number; color: string }[] }) => {
  const radius = 42;
  const C = 2 * Math.PI * radius;
  let offset = 0;
  const hasData = segments.some((s) => s.pct > 0);
  return (
    <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(0 0% 14%)" strokeWidth="14" />
      {hasData && segments.map((s) => {
        if (s.pct <= 0) return null;
        const len = (s.pct / 100) * C;
        const el = (
          <circle
            key={s.label}
            cx="60" cy="60" r={radius}
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

// Unsplash sirve el ancho que se pide: en móvil (2 columnas) basta 320 px.
const tileSrcSet = (img: string) =>
  img.startsWith("https://images.unsplash.com/")
    ? `${img.replace(/([?&])w=\d+/, "$1w=320")} 320w, ${img} 600w`
    : undefined;

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
  const { recos: aiRecos, loading: recosLoading } = useAIRecommendations();
  const [name, setName] = useState("");

  // Viaje activo único (el mismo que Iato, Cercanos y Gastos): viajes propios y compartidos +
  // profiles.active_trip_id. Antes eran "los 2 últimos creados".
  const active = useActiveTrip<any>({ columns: `${ACTIVE_TRIP_COLUMNS}, cover_image_url` });
  // Favoritos persistidos (los mismos de Descubre y Favoritos), no un estado local.
  const { saved: favorites, pending: favPending, toggle: toggleFav } = useSavedDestinations();
  const [concierge, setConcierge] = useState("");
  // La tarjeta del Concierge tiene su propio texto: compartía el estado con el buscador de
  // arriba y escribir aquí abría el panel "Tu idea de viaje".
  const [conciergeCard, setConciergeCard] = useState("");
  const [tick, setTick] = useState(0);
  const [reelIdx, setReelIdx] = useState(0);
  const [reelFading, setReelFading] = useState(false);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const REEL_DURATION = 10_000;
  const [spendUsd, setSpendUsd] = useState(0);
  const [spendDeltaPct, setSpendDeltaPct] = useState<number | null>(null);
  const [spendCats, setSpendCats] = useState<{ label: string; pct: number; color: string }[]>([]);
  // De dónde salió el tipo de cambio y de cuándo es; y gastos que no se pudieron convertir.
  const [spendFxLabel, setSpendFxLabel] = useState<string | null>(null);
  const [spendUnconverted, setSpendUnconverted] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setName(profile?.full_name?.split(" ")[0] ?? "viajero");

      // ───── Smart Spend real (gastos del mes actual vs mes anterior) ─────
      const now = new Date();
      const startThis = localISODate(new Date(now.getFullYear(), now.getMonth(), 1));
      const startPrev = localISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const { data: exps } = await supabase
        .from("expenses")
        .select("amount, currency, category, expense_date")
        .eq("user_id", user.id)
        .gte("expense_date", startPrev);

      // Tipo de cambio en vivo (open.er-api.com) o, si no responde, uno de respaldo con su fecha.
      // Una moneda sin tasa no se toma 1:1: se deja fuera y se avisa.
      const fx = await fetchFxTable();
      setSpendFxLabel(exps && exps.length ? fxLabel(fx) : null);
      const missing = new Set<string>();
      const toUsd = (a: number, c: string) => {
        const v = convert(a, c || "MXN", "USD", fx);
        if (v == null) { missing.add(String(c || "").toUpperCase()); return 0; }
        return v;
      };

      const thisMonth = (exps ?? []).filter((e) => e.expense_date >= startThis);
      const prevMonth = (exps ?? []).filter((e) => e.expense_date < startThis);

      const totalUsd = thisMonth.reduce((s, e) => s + toUsd(Number(e.amount) || 0, e.currency || "MXN"), 0);
      const prevUsd = prevMonth.reduce((s, e) => s + toUsd(Number(e.amount) || 0, e.currency || "MXN"), 0);
      setSpendUsd(totalUsd);
      setSpendDeltaPct(prevUsd > 0 ? Math.round(((totalUsd - prevUsd) / prevUsd) * 100) : null);

      // Mismas categorías y colores que Smart Spend (las filas viejas caen en su categoría nueva).
      const groups: Record<string, number> = {};
      for (const e of thisMonth) {
        const key = canonicalCategory(e.category);
        groups[key] = (groups[key] ?? 0) + toUsd(Number(e.amount) || 0, e.currency || "MXN");
      }
      const sum = Object.values(groups).reduce((a, b) => a + b, 0);
      const cats = Object.entries(groups)
        .map(([k, v]) => ({ label: k, pct: sum > 0 ? Math.round((v / sum) * 100) : 0, color: categoryColor(k) }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 5);
      setSpendCats(cats);
      setSpendUnconverted([...missing]);
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
    // Sin rotate() inmediato: saltaba el primer reel a los 600 ms.
    reelTimer.current = setInterval(rotate, REEL_DURATION);
    return () => {
      if (reelTimer.current) clearInterval(reelTimer.current);
    };
  }, []);


  const now = new Date();
  const today = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = now.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase().replace(/\./g, "");

  // Viaje activo / próximo / lista: homeTrips reparte lo que decide resolveActiveTrip con
  // profiles.active_trip_id (un solo selector en toda la app). Con empate, el selector pide escoger.
  const todayLocal = localISODate(now);
  const { list: upcomingList } = homeTrips(active.trips, todayLocal, active.pinnedId);
  // Centro de mando: el viaje activo único (el mismo de Iato) mientras no haya terminado.
  const commandTrip = active.trip && !isTripEnded(active.trip, todayLocal) ? active.trip : null;
  const hasTrips = active.trips.length > 0;
  const ambiguous = !commandTrip && active.resolved.reason === "ambiguous";
  const conciergeInputRef = useRef<HTMLInputElement>(null);
  const pickExample = (text: string) => {
    setConcierge(text);
    conciergeInputRef.current?.focus();
  };




  return (
    <DashboardLayout>
      <div className="px-4 md:px-10 pt-2 md:pt-10 pb-7 md:pb-10 space-y-5 md:space-y-12 max-w-[1400px] mx-auto overflow-x-hidden">
        {/* Top header */}
        <header className="hidden md:flex items-center gap-4">
          <p className="text-[11px] md:text-xs text-muted-foreground capitalize tracking-wide">
            {today} <span className="mx-2 text-primary/40">|</span> <span className="text-foreground/80 normal-case">{time}</span>
          </p>
        </header>


        {/* Saludo + búsqueda inline */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = concierge.trim();
            if (q.length < 5) return;
            navigate(`/dashboard/planear?q=${encodeURIComponent(q)}`);
          }}
          className="animate-fade-up space-y-4"
        >
          <div className="flex flex-row items-center gap-2 md:gap-5">
            <h1 className="font-display text-xl md:text-4xl leading-[1.1] tracking-tight shrink-0">
              <span className="capitalize">{name || "Viajero"}</span>.
            </h1>
            <div className="relative flex-1 min-w-0">
              <div className="relative flex items-center gap-2 md:gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-xl pl-2.5 md:pl-4 pr-1.5 py-1.5 focus-within:border-primary/40 transition">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <input
                  ref={conciergeInputRef}
                  type="text"
                  value={concierge}
                  onChange={(e) => setConcierge(e.target.value)}
                  placeholder="Platícame tu viaje…"
                  aria-label="Platícame tu viaje"
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none font-display italic text-sm md:text-2xl leading-tight placeholder:text-primary/70 placeholder:italic text-foreground py-1"
                />
                <TripFileUpload size="sm" />
                <VoiceInput
                  onTranscript={(t) => setConcierge((prev) => (prev ? prev + " " : "") + t)}
                  size="sm"
                />
                <Button
                  type="submit"
                  disabled={concierge.trim().length < 5}
                  className="h-8 md:h-10 px-2.5 md:px-5 rounded-xl bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow disabled:opacity-40 text-[11px] md:text-sm tracking-wide shrink-0"
                >
                  Analizar
                </Button>
              </div>

              {/* Despliegue en vivo de lo que el usuario escribe (editable) */}
              {concierge.trim().length > 0 && (
                <div
                  className="animate-fade-in absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl border border-primary/20 bg-background/30 backdrop-blur-md shadow-2xl p-4 md:p-5"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-[10px] tracking-[0.3em] uppercase text-primary/80">Tu idea de viaje</p>
                    <span className="text-[10px] text-muted-foreground">{concierge.trim().length} caracteres</span>
                  </div>
                  <textarea
                    value={concierge}
                    onChange={(e) => setConcierge(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const q = concierge.trim();
                        if (q.length >= 5) navigate(`/dashboard/planear?q=${encodeURIComponent(q)}`);
                      }
                    }}
                    rows={Math.min(6, Math.max(2, Math.ceil(concierge.length / 60)))}
                    aria-label="Editar idea de viaje"
                    className="w-full resize-none bg-transparent border-0 outline-none font-display italic text-base md:text-xl leading-snug text-foreground whitespace-pre-wrap break-words placeholder:text-muted-foreground/50"
                  />
                  {concierge.trim().length < 5 ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Sigue escribiendo… mínimo 5 caracteres para analizar.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-primary/80">
                      Toca cualquier parte del texto para editar. Presiona <span className="text-primary">Analizar</span> o Enter.
                    </p>
                  )}
                </div>
              )}

            </div>
          </div>
          {/* Ejemplos de un toque: solo llenan el campo (nada se analiza sin "Analizar"). */}
          {concierge.trim().length === 0 && hasTrips && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap" aria-label="Ejemplos para escribir tu viaje">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button key={ex} type="button" onClick={() => pickExample(ex)}
                  className="shrink-0 min-h-[36px] rounded-full border border-white/[0.08] bg-white/[0.02] px-3 text-[11px] md:text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  “{ex}”
                </button>
              ))}
            </div>
          )}
        </form>


        {/* Centro de mando del viaje activo, guía del primer viaje o selector si hay empate. */}
        {active.loading ? (
          <div aria-busy="true" aria-label="Cargando tu viaje" className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5 md:p-8 space-y-3">
            <div className="h-3 w-28 rounded bg-white/[0.06] motion-safe:animate-pulse" />
            <div className="h-10 w-2/3 rounded-xl bg-white/[0.06] motion-safe:animate-pulse" />
            <div className="h-6 w-40 rounded-lg bg-white/[0.05] motion-safe:animate-pulse" />
            <div className="h-12 w-full md:w-1/2 rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
          </div>
        ) : commandTrip ? (
          <TripCommandCenter trip={commandTrip} today={todayLocal} />
        ) : !hasTrips ? (
          <FirstTripGuide onPickExample={pickExample} />
        ) : ambiguous ? (
          <section aria-labelledby="pick-trip-title" className="rounded-3xl border border-primary/25 bg-white/[0.02] p-5 md:p-7">
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary font-semibold">Tu viaje activo</p>
            <h2 id="pick-trip-title" className="font-display text-2xl md:text-3xl mt-1">¿Cuál es tu próximo viaje?</h2>
            <p className="text-sm text-muted-foreground mt-1">Tienes varios viajes en fechas parecidas. Elige uno y aquí verás cuánto falta y qué sigue.</p>
            <ActiveTripPicker trips={active.trips} pinnedId={active.pinnedId} resolved={active.resolved}
              onChange={(id) => { void active.pin(id); }} className="mt-4 flex-wrap" />
          </section>
        ) : null}

        {/* HERO — cinematic Santorini-style sunset */}
        {/* Para quien aún no tiene viajes la guía de arriba ya es la portada: sin video duplicado. */}
        {hasTrips && (
        <section
          className="animate-fade-up"
        >
          <div
            className="relative rounded-[28px] overflow-hidden premium-shadow group cursor-pointer ring-1 ring-white/[0.05]"
            onClick={() => navigate("/dashboard/planear?mode=emocion")}
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
            {/* Destination label — top-right on mobile (next to dots), top-left on desktop */}
            <div className={`absolute top-5 right-5 md:top-7 md:right-auto md:left-7 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[11px] text-white/90 tracking-wider flex items-center transition-opacity duration-[600ms] z-10 ${reelFading ? "opacity-0" : "opacity-100"}`}>
              <span className="text-primary mr-1.5">&#9679;</span>
              {HERO_REELS[reelIdx].label}
            </div>


            {/* Reel progress dots — bottom-center on mobile, top-right on desktop */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 md:bottom-auto md:left-auto md:translate-x-0 md:top-7 md:right-7 flex items-center gap-1.5 z-10">
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
              <Button
                onClick={() => navigate("/dashboard/planear?mode=emocion")}
                className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow self-start h-12 px-6 rounded-2xl text-sm tracking-wide"
              >
                <Plus className="w-4 h-4 mr-2" strokeWidth={2.25} />
                Empezar análisis
              </Button>
            </div>
          </div>
        </section>
        )}

        {/* CURADO PARA TI */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Curado por IATOS AI para ti
              </p>
              <h2 className="font-display text-2xl md:text-3xl">Destinos que matchean tu perfil</h2>
            </div>
            <Link to="/dashboard/descubre" className="text-xs text-primary/80 hover:text-primary transition flex items-center gap-1 whitespace-nowrap tracking-wide">
              Ver todos <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {!recosLoading && (aiRecos ?? []).length === 0 && (
              <div className="col-span-full rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
                <p className="text-sm text-muted-foreground flex-1">
                  Por ahora no pudimos preparar tus recomendaciones. Mientras tanto, explora destinos o cuéntanos tu idea arriba.
                </p>
                <Link to="/dashboard/descubre" className="inline-flex items-center justify-center gap-1 min-h-[44px] rounded-2xl border border-primary/40 px-4 text-sm text-primary hover:bg-primary/10 transition">
                  Explorar destinos <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
              </div>
            )}
            {(recosLoading && !aiRecos)
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="aspect-[4/5] rounded-3xl bg-surface/40 animate-pulse" />
                ))
              : (aiRecos ?? []).slice(0, 4).map((d, i) => (
                <div
                  key={`${d.name}-${i}`}
                  onClick={() => navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}${d.country ? `&pais=${encodeURIComponent(d.country)}` : ""}&autoCheapest=1`)}
                  role="link"
                  tabIndex={0}
                  aria-label={`Planear viaje a ${d.name}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    navigate(`/dashboard/planear?destino=${encodeURIComponent(d.name)}${d.country ? `&pais=${encodeURIComponent(d.country)}` : ""}&autoCheapest=1`);
                  }}
                  className="animate-fade-up hover:-translate-y-1 transition-transform duration-300 cursor-pointer group rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="relative aspect-[4/5] rounded-3xl overflow-hidden ring-1 ring-white/[0.05]">
                    <DestinationVideo query={d.image_query} fallbackImage={santorini} alt={d.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1100ms]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-primary/30 text-primary text-[10px] font-medium tracking-wider">
                      {d.score}% MATCH
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFav(d); }}
                      disabled={favPending.has(d.name)}
                      aria-label={favorites.has(d.name) ? `Quitar ${d.name} de favoritos` : `Guardar ${d.name} en favoritos`}
                      aria-pressed={favorites.has(d.name)}
                      className="absolute top-3 right-3 p-2 rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition"
                    >
                      <Heart className={`w-3.5 h-3.5 ${favorites.has(d.name) ? "fill-primary text-primary" : "text-white/90"}`} />
                    </button>
                    <div className="absolute bottom-3 left-3 right-3">
                      <p className="font-display text-base md:text-lg text-white/95 leading-tight">{d.name}</p>
                      <p className="text-[11px] text-white/60 tracking-wide">{d.country}</p>
                      {d.reason && (
                        <p className="text-[10px] text-white/55 leading-snug mt-1 line-clamp-2 italic hidden md:block">
                          {d.reason}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>





        {/* MIS PRÓXIMOS VIAJES + SMART SPEND */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0 w-full max-w-full">
          {/* Próximos viajes */}
          <section className="glass-card rounded-3xl p-4 md:p-7 overflow-hidden min-w-0">

            <div className="flex items-center justify-between gap-2 mb-5">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase truncate">Mis próximos viajes</p>
              <Link to="/dashboard/viajes" className="text-[11px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                Ver todos <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {active.trips.length > 1 && (
              <ActiveTripPicker trips={active.trips} pinnedId={active.pinnedId} resolved={active.resolved}
                onChange={(id) => { void active.pin(id); }} className="mb-4 flex-wrap" />
            )}
            {upcomingList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Aún no tienes viajes planeados.</p>
            ) : (
              <div className="space-y-2.5 mb-5">
                {upcomingList.map((t) => {
                  // Días de calendario locales (new Date("YYYY-MM-DD") es UTC y corría un día).
                  // Un viaje en curso o pasado ya no dice "EN 0D".
                  const days = daysFromToday(t.fecha_salida);
                  const endDays = daysFromToday(t.fecha_regreso ?? t.fecha_salida);
                  const badge = days == null ? "SIN FECHA"
                    : days > 0 ? (days === 1 ? "MAÑANA" : `EN ${days} DÍAS`)
                    : days === 0 ? "HOY"
                    : endDays != null && endDays >= 0 ? "EN CURSO"
                    : "TERMINADO";
                  return (
                    <Link to={`/dashboard/viajes/${t.id}`} key={t.id} className="flex items-center gap-3 p-2 -mx-2 rounded-2xl hover:bg-white/[0.04] transition group min-w-0">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl overflow-hidden bg-surface flex-shrink-0 ring-1 ring-white/[0.06]">
                        {t.cover_image_url ? (
                          <img src={t.cover_image_url} alt={t.destino} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                        ) : (
                          <DestinationVideo query={`${t.destino} ${t.pais_destino ?? ""} travel`} fallbackImage={santorini} alt={t.destino} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm md:text-base truncate">{t.destino}{t.pais_destino ? `, ${t.pais_destino}` : ""}</p>
                        <p className="text-[11px] text-muted-foreground tracking-wide">
                          {formatLocalDate(t.fecha_salida, { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <span className="text-[10px] px-2 md:px-3 py-1 rounded-full border border-primary/30 text-primary whitespace-nowrap tracking-wider shrink-0">
                        {badge}
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
          <section className="glass-card rounded-3xl p-4 md:p-7 relative overflow-hidden min-w-0">
            <div aria-hidden className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase truncate">Smart Spend</p>
                <Link to="/dashboard/smart-spend" className="text-[11px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                  Ver reportes <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Sin gastos no se pinta un "$0.00" gigante con una dona vacía: se explica qué hacer. */}
              {spendUsd <= 0 && spendCats.length === 0 ? (
                <div className="py-4">
                  <p className="font-display text-xl md:text-2xl">Aún no registras gastos este mes</p>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-sm">
                    Anota lo que gastas en tu viaje (comidas, transporte, compras) y aquí verás cuánto llevas y en qué se va.
                  </p>
                </div>
              ) : (<>
              <p className="text-[11px] text-muted-foreground mb-1 tracking-wide">Este mes</p>
              <p className="font-display text-4xl md:text-5xl mb-1 gold-text">
                ${spendUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-muted-foreground mb-5">
                {spendDeltaPct !== null ? (
                  <><span className={spendDeltaPct >= 0 ? "text-primary" : "text-emerald-400"}>{spendDeltaPct >= 0 ? "+" : ""}{spendDeltaPct}%</span> vs mes anterior · USD</>
                ) : spendUsd > 0 ? "USD · primer mes con gastos" : "Aún sin gastos registrados · USD"}
              </p>
              {spendFxLabel && (
                <p className="text-[10px] text-muted-foreground/80 -mt-4 mb-4">
                  {spendFxLabel}
                  {spendUnconverted.length > 0 && ` · sin convertir (sin tasa): ${spendUnconverted.join(", ")}`}
                </p>
              )}
              <div className="flex items-center gap-5 min-w-0">
                <SpendDonut segments={spendCats.length ? spendCats : [{ label: "Sin datos", pct: 0, color: "hsl(0 0% 25%)" }]} />
                <ul className="flex-1 space-y-2 text-sm">
                  {spendCats.length === 0 && (
                    <li className="text-xs text-muted-foreground italic">
                      Registra gastos en tus viajes y aquí verás tu desglose real por categoría.
                    </li>
                  )}
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
              </>)}
              <Button
                onClick={() => navigate("/dashboard/smart-spend")}
                className="w-full mt-6 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-foreground hover:bg-white/[0.08] text-sm tracking-wide"
              >
                {spendUsd <= 0 && spendCats.length === 0 ? "Registrar un gasto" : "Ver detalles y análisis"}
              </Button>
            </div>
          </section>
        </div>

        {/* AI CONCIERGE + INSPIRACIÓN */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0 w-full max-w-full">
          <section className="glass-card rounded-3xl p-3.5 md:p-7 overflow-hidden min-w-0 w-full max-w-full">

            <div className="flex items-center justify-between gap-2 mb-4">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.25em] md:tracking-[0.35em] uppercase truncate min-w-0">CONCIERGE IATO</p>
              <Link to="/dashboard/concierge" className="text-[10px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                Ver historial <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="flex items-start gap-3 mb-4 min-w-0">
              <div className="w-10 h-10 rounded-full bg-gradient-gold flex items-center justify-center flex-shrink-0 shadow-[0_8px_24px_-6px_hsl(41_47%_59%/0.5)]">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base md:text-lg mb-0.5">¿En qué puedo ayudarte hoy?</p>
                <p className="text-[11px] md:text-xs text-muted-foreground leading-relaxed">
                  Busco opciones, comparo precios y te dejo los enlaces para reservar.
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); if (conciergeCard.trim()) navigate(`/dashboard/planear?q=${encodeURIComponent(conciergeCard)}`); }}
              className="relative w-full"
            >
              <Input
                value={conciergeCard}
                onChange={(e) => setConciergeCard(e.target.value)}
                aria-label="Escribe tu solicitud al Concierge"
                placeholder="Escribe tu solicitud…"
                className="pr-12 h-11 md:h-12 rounded-2xl bg-white/[0.03] border-white/[0.08] focus-visible:ring-primary/40 text-sm w-full"
              />
              <button type="submit" aria-label="Enviar" className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-gradient-gold flex items-center justify-center text-primary-foreground hover:opacity-90 transition">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </section>

          <section className="glass-card rounded-3xl p-3.5 md:p-7 overflow-hidden min-w-0 w-full max-w-full">
            <div className="flex items-center justify-between gap-2 mb-4">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.25em] md:tracking-[0.35em] uppercase truncate min-w-0">Inspiración para ti</p>
              <Link to="/dashboard/descubre" className="text-[10px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                Ver más <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="relative rounded-2xl overflow-hidden h-[170px] md:h-[320px] group cursor-pointer ring-1 ring-white/[0.05] w-full" onClick={() => navigate("/dashboard/descubre")}>
              <DestinationVideo query="romantic beach sunset travel cinematic" fallbackImage={tulum} alt="Escapadas románticas" className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1100ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              {/* Antes era un botón "Siguiente" sin acción; la tarjeta entera abre Descubre. */}
              <span aria-hidden="true" className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center">
                <ChevronRight className="w-4 h-4" />
              </span>
              <div className="absolute bottom-3 left-3 right-3">
                <h3 className="font-display text-xl md:text-2xl mb-0.5 leading-tight">Escapadas <span className="italic gold-text font-light">románticas</span></h3>
                <p className="text-[10px] md:text-[11px] text-white/70 tracking-wide">Destinos perfectos para conectar</p>
              </div>
            </div>

          </section>
        </div>

          {/* HERRAMIENTAS — ancho completo (antes quedaba dentro de la rejilla de 2 columnas y
              ocupaba solo la mitad izquierda en escritorio). */}
          <section aria-labelledby="tools-title">
            <div className="flex items-center justify-between mb-3">
              <h2 id="tools-title" className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase font-normal">Herramientas</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
              {[
                { icon: Plane, label: "Vuelos", sub: "En vivo", to: "/dashboard/vuelos", img: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&q=70&auto=format&fit=crop" },
                { icon: Hotel, label: "Hoteles", sub: "Reales", to: "/dashboard/hoteles", img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=70&auto=format&fit=crop" },
                { icon: Car, label: "Autos", sub: "Renta", to: "/dashboard/autos", img: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&q=70&auto=format&fit=crop" },
                { icon: Wifi, label: "eSIM", sub: "Datos", to: "/dashboard/esim", img: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=600&q=70&auto=format&fit=crop" },
                { icon: Compass, label: "Tours", sub: "Experiencias", to: "/dashboard/actividades", img: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=70&auto=format&fit=crop" },
                { icon: Shield, label: "Seguros", sub: "Viaje", to: "/dashboard/seguros", img: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=600&q=70&auto=format&fit=crop" },
                { icon: Gift, label: "Beneficios", sub: "PRO", to: "/dashboard/beneficios", img: "https://images.unsplash.com/photo-1513151233558-d860c5398176?w=600&q=70&auto=format&fit=crop" },
                { icon: Scale, label: "Comparar", sub: "Destinos", to: "/dashboard/comparar", img: "https://images.unsplash.com/photo-1488085061387-422e29b40080?w=600&q=70&auto=format&fit=crop" },
                { icon: ArrowLeftRight, label: "Conversor", sub: "Moneda", to: "/dashboard/convertidor", img: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=600&q=70&auto=format&fit=crop" },
                { icon: Crown, label: "Concierge", sub: "Tu concierge IA", to: "/dashboard/concierge", img: "https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=600&q=70&auto=format&fit=crop" },
                { icon: MapPin, label: "Cerca", sub: "De mí", to: "/dashboard/cercanos", img: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&q=70&auto=format&fit=crop" },
                { icon: Ship, label: "Cruceros", sub: "Islas", to: "/dashboard/cruceros", img: "https://images.unsplash.com/photo-1548574505-5e239809ee19?w=600&q=70&auto=format&fit=crop" },
                { icon: UtensilsCrossed, label: "Restaurantes", sub: "Mesas", to: "/dashboard/restaurantes", img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=70&auto=format&fit=crop" },
                { icon: TrainFront, label: "Trenes", sub: "Europa+", to: "/dashboard/trenes", img: tileTrenes },
                { icon: Anchor, label: "Ferries", sub: "Islas", to: "/dashboard/ferries", img: tileFerries },
                { icon: Receipt, label: "Mis reservas", sub: "Historial", to: "/dashboard/reservas", img: tileReservas },
              ].map(({ icon: Icon, label, sub, to, img }) => (
                <button
                  key={label}
                  onClick={() => navigate(withTripParam(to, active.trip?.id))}
                  className="relative overflow-hidden aspect-[4/3] rounded-xl border border-white/[0.08] hover:border-primary/50 transition-all text-left group"
                >
                  <img
                    src={img}
                    srcSet={tileSrcSet(img)}
                    sizes="(min-width: 768px) 25vw, 50vw"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={600}
                    height={450}
                    className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
                  <div className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-background/70 backdrop-blur flex items-center justify-center border border-primary/30">
                    <Icon className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="absolute bottom-2.5 left-2.5 right-2.5">
                    <div className="text-[13px] font-semibold leading-tight text-white">{label}</div>
                    <div className="text-[9px] text-primary/80 tracking-[0.2em] uppercase mt-0.5">{sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
      </div>
    </DashboardLayout>
  );
};

export default DashboardHome;
