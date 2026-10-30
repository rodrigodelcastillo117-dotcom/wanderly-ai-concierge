import { homeSpendCard, loadMySpend, mergeMySpend } from "@/lib/mySpend";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles, Heart, Send, ChevronRight, Scale, ArrowLeftRight, Crown, MapPin, Plane, Hotel, Shield, Car, Wifi, Compass, Ship, UtensilsCrossed, TrainFront, Anchor, Receipt, Vault, Backpack, Cloud, Radio, Map as MapIcon, Languages, LifeBuoy, BookHeart, Images, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { IllustrativeCaption, SmartImage } from "@/components/media/SmartImage";
import { useAIRecommendations } from "@/hooks/useAIRecommendations";
import { useSavedDestinations } from "@/hooks/useSavedDestinations";
import { homeCommandTrip, homeTrips } from "@/lib/homeTrips";
import { conciergeBoxHref } from "@/lib/conciergeBoxRoute";
import { recoPlanHref, sortRecosByMatch } from "@/lib/homeRecos";
import { destinationPhotoQuery } from "@/lib/compareCost";
import { VoiceInput } from "@/components/VoiceInput";
import { TripFileUpload } from "@/components/TripFileUpload";


import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import patagonia from "@/assets/destination-patagonia.jpg";
import tulum from "@/assets/destination-tulum.jpg";
import santorini from "@/assets/hero-santorini.jpg";
import santorini960 from "@/assets/hero-santorini-960.jpg";
import { daysFromToday, formatLocalDate, localISODate } from "@/lib/localDate";
import { fetchFxTable, fxLabel } from "@/lib/fx";
import { ACTIVE_TRIP_COLUMNS, useActiveTrip } from "@/hooks/useActiveTrip";
import { ActiveTripPicker } from "@/components/ActiveTripPicker";
import { withTripParam } from "@/lib/tripLink";
import { TripCommandCenter } from "@/components/TripCommandCenter";
import { FirstTripGuide } from "@/components/FirstTripGuide";
import { EXAMPLE_PROMPTS } from "@/lib/planDefaults";
import { DashboardWrappedPromo } from "@/components/wrapped/WrappedPromo";
import { loadProfileBasics } from "@/lib/profileBasics";
import { afterCritical, beginCritical } from "@/lib/idleGate";
import { shortTripName } from "@/lib/tripName";
import { savedCoverUrl, tripPhotoQuery } from "@/lib/tripImagery";
import { openPlanWindow, PLAN_CTA } from "@/lib/planBus";
import { INCIDENT_CTA, openIncident } from "@/lib/incidentBus";




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

// La foto de respaldo de Santorini existe también a 960 px (la usa la landing): el móvil no baja la
// de 1920 px (207 KB) para una caja de 390.
const SANTORINI_SRCSET = `${santorini960} 960w, ${santorini} 1920w`;
const fallbackSrcSet = (img: string) => (img === santorini ? SANTORINI_SRCSET : undefined);
// En el teléfono el hero va detrás de un degradado oscuro: con "320px" un teléfono de densidad 2–3
// elige la de 960 px (65 KB) y no la de 1920 (207 KB). En tableta/escritorio, ancho completo.
// vite.routePreload.ts precarga la misma imagen con estos mismos sizes (deben coincidir).
const HERO_SIZES = "(min-width: 768px) 100vw, 320px";

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

// Herramientas de Inicio agrupadas por MOMENTO DEL VIAJE (propuesta «Inicio sencillo», 30-oct-2026). Antes eran
// 16 mosaicos sueltos (8 a la vista y el resto tras «Ver las 16») más 5 accesos dentro del centro de mando; ahora
// todas a la vista y a UN toque, en tres grupos. Ninguna se quita: las 16 de antes siguen aquí, y se suman las
// del viaje (equipaje, clima, en vivo, mapa, traductor, diario), Recuerdos, «Tu resumen del año» y «Tengo un
// problema». `viaje`: herramienta de un viaje concreto (/dashboard/viajes/:id/<viaje>); sin viaje no se pinta.
type HomeTool = { icon: LucideIcon; label: string; to?: string; viaje?: string; accion?: "problema" };
const HOME_TOOL_GROUPS: { id: "antes" | "durante" | "despues"; title: string; tools: HomeTool[] }[] = [
  { id: "antes", title: "Antes de viajar", tools: [
    { icon: Plane, label: "Vuelos", to: "/dashboard/vuelos" },
    { icon: Hotel, label: "Hoteles", to: "/dashboard/hoteles" },
    { icon: Car, label: "Autos", to: "/dashboard/autos" },
    { icon: Ship, label: "Cruceros", to: "/dashboard/cruceros" },
    { icon: Shield, label: "Seguros", to: "/dashboard/seguros" },
    { icon: Wifi, label: "eSIM", to: "/dashboard/esim" },
    { icon: Vault, label: "Documentos y tarjetas", to: "/dashboard/beneficios" },
    { icon: Backpack, label: "Equipaje", viaje: "packing" },
    { icon: Cloud, label: "Clima", viaje: "clima" },
    { icon: ArrowLeftRight, label: "Convertidor de moneda", to: "/dashboard/convertidor" },
    { icon: Scale, label: "Comparar destinos", to: "/dashboard/comparar" },
    { icon: Receipt, label: "Mis reservas", to: "/dashboard/reservas" },
  ] },
  { id: "durante", title: "Durante el viaje", tools: [
    { icon: Radio, label: "En vivo", viaje: "live" },
    { icon: MapPin, label: "Cerca de ti", to: "/dashboard/cercanos" },
    { icon: MapIcon, label: "Mapa", viaje: "mapa" },
    { icon: UtensilsCrossed, label: "Restaurantes", to: "/dashboard/restaurantes" },
    { icon: Compass, label: "Actividades", to: "/dashboard/actividades" },
    { icon: TrainFront, label: "Trenes", to: "/dashboard/trenes" },
    { icon: Anchor, label: "Ferries", to: "/dashboard/ferries" },
    { icon: Languages, label: "Traductor", viaje: "traductor" },
    { icon: Crown, label: "Concierge", to: "/dashboard/concierge" },
    { icon: LifeBuoy, label: INCIDENT_CTA, accion: "problema" },
  ] },
  { id: "despues", title: "Después", tools: [
    { icon: BookHeart, label: "Diario", viaje: "diario" },
    { icon: Images, label: "Recuerdos", to: "/dashboard/recuerdos" },
    { icon: Sparkles, label: "Tu resumen del año", to: "/wrapped" },
  ] },
];

const DashboardHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { recos: aiRecos, profileless: recosProfileless, loading: recosLoading } = useAIRecommendations();
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
  // 1–4 letras y «Planear un viaje»: se pide un poco más en vez de mandar una frase que no se entiende.
  const [planHint, setPlanHint] = useState(false);
  const [tick, setTick] = useState(0);
  const [reelIdx, setReelIdx] = useState(0);
  const [reelFading, setReelFading] = useState(false);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const REEL_DURATION = 10_000;
  const [spendMxn, setSpendMxn] = useState(0);
  const [spendDeltaPct, setSpendDeltaPct] = useState<number | null>(null);
  const [spendCats, setSpendCats] = useState<{ label: string; pct: number; color: string }[]>([]);
  // De dónde salió el tipo de cambio y de cuándo es; y gastos que no se pudieron convertir.
  const [spendFxLabel, setSpendFxLabel] = useState<string | null>(null);
  const [spendUnconverted, setSpendUnconverted] = useState<string[]>([]);

  // Nombre: crítico (es el saludo). Una sola consulta a profiles compartida con el menú y el avatar
  // (antes se pedía en serie ANTES de los gastos y tres veces en total).
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const end = beginCritical();
    void loadProfileBasics(user.id).then((profile) => {
      if (alive) setName(profile?.full_name?.split(" ")[0] ?? "viajero");
    }).finally(end);
    return () => { alive = false; end(); };
  }, [user]);

  // Smart Spend: secundario (está abajo del pliegue). Se pide cuando ya llegaron el viaje y el nombre.
  useEffect(() => {
    if (!user) return;
    return afterCritical(() => void (async () => {
      // ───── Tus gastos: el mismo cálculo que Gastos › Resumen ─────
      // Mis gastos + mi parte de lo compartido, en pesos, con summarizeSpend y las mismas categorías
      // (antes Inicio convertía a USD y no contaba la parte compartida: decía otra cifra que Gastos).
      const [{ own, shared }, fx] = await Promise.all([loadMySpend(supabase, user.id), fetchFxTable()]);
      const items = mergeMySpend(own, shared);
      const card = homeSpendCard(items, fx);
      setSpendFxLabel(items.length ? fxLabel(fx) : null);
      setSpendMxn(card.thisMonth);
      setSpendDeltaPct(card.deltaPct);
      setSpendCats(card.cats);
      setSpendUnconverted(card.unconvertedCurrencies);
    })());
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
  // "Martes, 27 de octubre de 2026" (con CSS capitalize salía "27 De Octubre De 2026").
  const todayRaw = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const today = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1);
  const time = now.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase().replace(/\./g, "");

  // Viaje activo / próximo / lista: homeTrips reparte lo que decide resolveActiveTrip con
  // profiles.active_trip_id (un solo selector en toda la app). Con empate, el selector pide escoger.
  const todayLocal = localISODate(now);
  const { list: upcomingList } = homeTrips(active.trips, todayLocal, active.pinnedId);
  // Centro de mando: el viaje activo (el mismo de Iato) si está en curso; si no, "Próximo viaje" es el de
  // salida futura más cercana, aunque Iato tenga fijado otro (homeCommandTrip).
  const commandTrip = homeCommandTrip(active.trips, todayLocal, active.trip);
  const hasTrips = active.trips.length > 0;
  const ambiguous = !commandTrip && active.resolved.reason === "ambiguous";
  const conciergeInputRef = useRef<HTMLTextAreaElement>(null);
  const pickExample = (text: string) => {
    setConcierge(text);
    setPlanHint(false);
    conciergeInputRef.current?.focus();
  };
  // Herramientas de un viaje (equipaje, clima, mapa…): el de «Tu próximo viaje»; si no hay, el activo.
  const toolTrip = commandTrip ?? active.trip ?? null;
  // «Planear un viaje»: con texto, directo al plan con esa idea (/dashboard/planear?q=, como siempre); sin texto,
  // la ventana del «+» (si no está montada, su misma ruta).
  const submitPlan = () => {
    const q = concierge.trim();
    if (q.length >= 5) { navigate(`/dashboard/planear?q=${encodeURIComponent(q)}`); return; }
    if (q.length > 0) { setPlanHint(true); conciergeInputRef.current?.focus(); return; }
    if (!openPlanWindow()) navigate("/dashboard/planear");
  };

  return (
    <DashboardLayout>
      <div className="px-4 md:px-10 pt-2 md:pt-10 pb-7 md:pb-10 space-y-5 md:space-y-10 max-w-[1400px] mx-auto overflow-x-hidden">
        {/* Top header */}
        <header className="hidden md:flex items-center gap-4">
          <p className="text-[11px] md:text-xs text-muted-foreground tracking-wide">
            {today} <span className="mx-2 text-primary/40">|</span> <span className="text-foreground/80 normal-case">{time}</span>
          </p>
        </header>

        {/* El saludo va en «¿A dónde quieres ir?» (antes era una fila sola): en el celular la acción principal queda
            a la vista sin bajar. */}
        <h1 className="sr-only">Inicio</h1>

        {/* 1 · Tu próximo viaje (foto, fechas y lo que falta), guía del primer viaje o selector si hay empate. */}
        {active.loading ? (
          // Alto reservado ≈ el del centro de mando ya cargado (CLS: antes el esqueleto medía ~180 px y la
          // tarjeta real ~470 en el móvil, y todo lo de abajo saltaba al llegar el viaje).
          <div aria-busy="true" aria-label="Cargando tu viaje" className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5 md:p-8 space-y-3 min-h-[460px] md:min-h-[340px]">
            <div className="h-3 w-28 rounded bg-white/[0.06] motion-safe:animate-pulse" />
            <div className="h-10 w-2/3 rounded-xl bg-white/[0.06] motion-safe:animate-pulse" />
            <div className="h-6 w-40 rounded-lg bg-white/[0.05] motion-safe:animate-pulse" />
            <div className="h-12 w-full md:w-1/2 rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
          </div>
        ) : commandTrip ? (
          <TripCommandCenter trip={commandTrip} today={todayLocal} accesos={false} />
        ) : !hasTrips ? (
          <FirstTripGuide onPickExample={pickExample} conBoton={false} />
        ) : ambiguous ? (
          <section aria-labelledby="pick-trip-title" className="rounded-3xl border border-primary/25 bg-white/[0.02] p-5 md:p-7">
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary font-semibold">Tu viaje activo</p>
            <h2 id="pick-trip-title" className="font-display text-2xl md:text-3xl mt-1">¿Cuál es tu próximo viaje?</h2>
            <p className="text-sm text-muted-foreground mt-1">Tienes varios viajes próximos. Elige uno y aquí verás cuánto falta y qué sigue.</p>
            <ActiveTripPicker trips={active.trips} pinnedId={active.pinnedId} resolved={active.resolved}
              onChange={(id) => { void active.pin(id); }} className="mt-4 flex-wrap" />
          </section>
        ) : null}

        {/* 2 · UNA acción principal: «Planear un viaje». Es la MISMA que el «+» de la barra y el botón dorado del
            menú lateral (abre su ventana); con texto escrito, va directo al plan con esa idea, igual que la página
            Planear. Antes Inicio tenía 4 entradas distintas (Analizar, Planear por emoción, Crear nuevo viaje,
            Planear mi primer viaje); «Planear por emoción» sigue más abajo, en «¿Aún sin destino?». */}
        <section aria-labelledby="home-plan-title" data-testid="home-plan" className="glass-card rounded-3xl p-4 md:p-7">
          <form onSubmit={(e) => { e.preventDefault(); submitPlan(); }} className="space-y-3">
            <h2 id="home-plan-title" className="font-display text-2xl md:text-3xl leading-tight">
              {/* Mientras llega el nombre, un espacio reservado (antes "Viajero." y luego "Sofía."). */}
              {name
                ? <><span className="capitalize">{name}</span>, ¿a dónde quieres ir?</>
                : <><span aria-hidden="true" data-testid="home-name-loading" className="inline-block h-[0.9em] w-20 md:w-36 rounded-lg bg-white/[0.06] motion-safe:animate-pulse align-middle" />, ¿a dónde quieres ir?</>}
            </h2>
            <div className="relative flex items-start gap-2 md:gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-xl pl-3 md:pl-4 pr-1.5 py-1.5 focus-within:border-primary/40 transition">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-2.5" aria-hidden="true" />
              {/* Un solo campo que crece con el texto (antes un campo de una línea + un panel encima que lo repetía). */}
              <textarea
                ref={conciergeInputRef}
                value={concierge}
                onChange={(e) => { setConcierge(e.target.value); setPlanHint(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPlan(); }
                }}
                rows={Math.min(5, Math.max(1, Math.ceil(concierge.length / 34)))}
                placeholder="Platícame tu viaje…"
                aria-label="Platícame tu viaje"
                className="flex-1 min-w-0 resize-none bg-transparent border-0 outline-none font-display italic text-base md:text-xl leading-snug placeholder:text-primary/70 placeholder:italic text-foreground py-1.5"
              />
              <TripFileUpload size="sm" />
              <VoiceInput
                onTranscript={(t) => setConcierge((prev) => (prev ? prev + " " : "") + t)}
                size="sm"
              />
            </div>
            <Button
              type="submit"
              data-testid="home-plan-cta"
              className="w-full h-12 rounded-2xl bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow text-sm tracking-wide"
            >
              <Plus className="w-4 h-4 mr-2" strokeWidth={2.25} aria-hidden="true" />
              {PLAN_CTA}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed" aria-live="polite" data-testid="home-plan-ayuda">
              {planHint
                ? "Escribe un poco más (mínimo 5 letras), o borra el texto para elegir ruta y fechas."
                : concierge.trim().length > 0
                  ? "Armamos el plan con lo que escribiste; si falta un dato, solo te preguntamos ese."
                  : "Escribe tu idea con tus palabras, o toca el botón para elegir ruta y fechas."}
            </p>
            {/* Ejemplos de un toque: solo llenan el campo (nada se analiza sin pedirlo). También mientras
                cargan los viajes: si aparecieran después empujarían toda la página (CLS). */}
            {concierge.trim().length === 0 && (hasTrips || active.loading) && (
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
        </section>

        {/* IATOS Wrapped destacado (diciembre y enero). El resto del año, «Tu resumen del año» está en Herramientas › Después. */}
        {!active.loading && <DashboardWrappedPromo trips={active.trips} today={todayLocal} soloDestacado />}

        {/* 3 · HERRAMIENTAS por momento del viaje: todas a la vista y a un toque (antes 8 + «Ver las 16»). */}
        <section aria-labelledby="tools-title" data-testid="home-tools">
          <h2 id="tools-title" className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase font-normal">Herramientas</h2>
          <p className="text-[11px] md:text-xs text-muted-foreground mt-1.5" data-testid="home-tools-viaje">
            {toolTrip
              ? <>Equipaje, Clima, En vivo, Mapa, Traductor y Diario son de tu viaje a <span className="text-foreground">{shortTripName(toolTrip)}</span>.</>
              : "Equipaje, Clima, En vivo, Mapa, Traductor y Diario aparecen aquí cuando tengas un viaje."}
          </p>
          <div className="mt-4 space-y-5 md:space-y-4">
            {HOME_TOOL_GROUPS.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`tools-${g.id}`} data-testid={`home-tools-${g.id}`} className="md:grid md:grid-cols-[160px_1fr] md:gap-6 md:items-start">
                <h3 id={`tools-${g.id}`} className="font-display text-base md:text-lg mb-2 md:mb-0 md:pt-4">{g.title}</h3>
                <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-1.5">
                  {g.tools.filter((t) => !t.viaje || toolTrip).map(({ icon: Icon, label, to, viaje, accion }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        if (accion === "problema") { openIncident({ tripId: toolTrip?.id ?? null }); return; }
                        navigate(viaje && toolTrip ? `/dashboard/viajes/${toolTrip.id}/${viaje}` : withTripParam(to!, active.trip?.id));
                      }}
                      aria-haspopup={accion ? "dialog" : undefined}
                      className="flex flex-col items-center justify-center gap-1.5 min-h-[72px] rounded-2xl border border-white/[0.06] bg-white/[0.02] px-1 py-2 text-[11px] text-foreground/85 hover:border-primary/40 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Icon className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                      <span className="leading-tight text-center">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4 · MIS PRÓXIMOS VIAJES + TUS GASTOS + CONCIERGE. Sin viajes, Gastos y Concierge comparten fila. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-w-0 w-full max-w-full">
          {/* Próximos viajes. Sin viajes no se pinta: la guía del primer viaje de arriba ya dice qué hacer
              (antes repetía "Aún no tienes viajes planeados" + otro botón dorado de crear viaje). */}
          {(hasTrips || active.loading) && (
          <section className="glass-card rounded-3xl p-4 md:p-7 overflow-hidden min-w-0" data-testid="home-upcoming">

            <div className="flex items-center justify-between gap-2 mb-5">
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase truncate">Mis próximos viajes</p>
              <Link to="/dashboard/viajes" className="text-[11px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                Ver todos <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            {/* Con empate el selector ya está arriba (tarjeta "¿Cuál es tu próximo viaje?"): no se repite. */}
            {active.trips.length > 1 && !ambiguous && (
              <ActiveTripPicker trips={active.trips} pinnedId={active.pinnedId} resolved={active.resolved}
                onChange={(id) => { void active.pin(id); }} className="mb-4 flex-wrap" />
            )}
            {upcomingList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Aún no tienes viajes planeados.</p>
            ) : (
              <div className="space-y-2.5">
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
                      {/* Portada real del viaje; si no hay, foto ilustrativa del destino (marcada). */}
                      <SmartImage
                        alt={t.destino}
                        imageUrl={savedCoverUrl(t.cover_image_url)}
                        stockQuery={tripPhotoQuery(t)}
                        size="thumb"
                        icon={MapPin}
                        className="w-14 h-14 md:w-16 md:h-16 rounded-2xl flex-shrink-0 ring-1 ring-white/[0.06]"
                        imgClassName="group-hover:scale-110"
                        captionPosition="bottom-left"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm md:text-base truncate">{shortTripName(t)}{t.pais_destino && shortTripName(t) !== t.pais_destino ? `, ${t.pais_destino}` : ""}</p>
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
            {/* Sin «Crear nuevo viaje»: repetía «Planear un viaje», que está arriba. */}
          </section>
          )}


          {/* Tus gastos (antes "Smart Spend") */}
          <section className="glass-card rounded-3xl p-4 md:p-7 relative overflow-hidden min-w-0">
            <div aria-hidden className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-primary text-[10px] md:text-[11px] tracking-[0.3em] md:tracking-[0.35em] uppercase truncate">Tus gastos</p>
                <Link to="/dashboard/gastos?tab=resumen" className="text-[11px] md:text-xs text-primary/80 hover:text-primary flex items-center gap-0.5 tracking-wide whitespace-nowrap shrink-0">
                  Ver resumen <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Sin gastos no se pinta un "$0.00" gigante con una dona vacía: se explica qué hacer. */}
              {spendMxn <= 0 && spendCats.length === 0 ? (
                <div className="py-4">
                  <p className="font-display text-xl md:text-2xl">Aún no registras gastos este mes</p>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-sm">
                    Anota lo que gastas en tu viaje (comidas, transporte, compras) y aquí verás cuánto llevas y en qué se va.
                  </p>
                </div>
              ) : (<>
              <p className="text-[11px] text-muted-foreground mb-1 tracking-wide">Este mes</p>
              <p className="font-display text-4xl md:text-5xl mb-1 gold-text">
                {`$${Math.round(spendMxn).toLocaleString("es-MX")}\u00A0`}<span className="text-[0.4em] text-muted-foreground font-sans tracking-wide">MXN</span>
              </p>
              <p className="text-[11px] text-muted-foreground mb-5">
                {spendDeltaPct !== null ? (
                  <><span className={spendDeltaPct >= 0 ? "text-primary" : "text-emerald-400"}>{spendDeltaPct >= 0 ? "+" : ""}{spendDeltaPct}%</span> vs mes anterior · en pesos</>
                ) : spendMxn > 0 ? "En pesos · sin gastos el mes pasado" : "Sin gastos este mes · en pesos"}
              </p>
              {spendFxLabel && (
                <p className="text-[10px] text-muted-foreground/80 -mt-4 mb-4">
                  {spendFxLabel}
                  {spendUnconverted.length > 0 && ` · sin convertir (sin tasa): ${spendUnconverted.join(", ")}`}
                </p>
              )}
              <div className="flex items-center gap-5 min-w-0">
                <SpendDonut segments={spendCats.length ? spendCats : [{ label: "Sin datos", pct: 0, color: "hsl(0 0% 25%)" }]} />
                <ul className="flex-1 space-y-2 text-sm" aria-label="Por categoría, todos tus gastos">
                  {spendCats.length > 0 && <li className="text-[10px] text-muted-foreground/80 tracking-wide">Por categoría · todos tus gastos</li>}
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
                {spendMxn <= 0 && spendCats.length === 0 ? "Registrar un gasto" : "Ver detalles y análisis"}
              </Button>
            </div>
          </section>
        <section className={`glass-card rounded-3xl p-3.5 md:p-7 overflow-hidden min-w-0 w-full max-w-full ${hasTrips || active.loading ? "lg:col-span-2" : ""}`}>

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
                // Preguntas ("¿qué clima hará en mi viaje?") van al chat de Iato ya enviadas; solo lo que pide
                // armar un viaje nuevo ("quiero ir a…", "arma un viaje…") abre el planificador.
                onSubmit={(e) => { e.preventDefault(); if (conciergeCard.trim()) navigate(conciergeBoxHref(conciergeCard)); }}
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
        </div>


        {/* 5 · CURADO PARA TI */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> {recosProfileless ? "Para empezar" : "Curado por IATOS AI para ti"}
              </p>
              <h2 className="font-display text-2xl md:text-3xl">{recosProfileless ? "Destinos para inspirarte" : "Destinos afines a ti"}</h2>
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
              : sortRecosByMatch(aiRecos ?? []).slice(0, 4).map((d, i) => (
                <div
                  key={`${d.name}-${i}`}
                  onClick={() => navigate(recoPlanHref(d))}
                  role="link"
                  tabIndex={0}
                  aria-label={`Planear viaje a ${d.name}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    navigate(recoPlanHref(d));
                  }}
                  className="animate-fade-up hover:-translate-y-1 transition-transform duration-300 cursor-pointer group rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="relative aspect-[4/5] rounded-3xl overflow-hidden ring-1 ring-white/[0.05]">
                    {/* Foto ilustrativa DE ESTE destino mientras llega el video (antes: la misma de Santorini en las 4). */}
                    <SmartImage alt={d.name} stockQuery={destinationPhotoQuery(d.country ? `${d.name}, ${d.country}` : d.name)} className="!absolute inset-0 w-full h-full" captionClassName="hidden" />
                    <DestinationVideo query={d.image_query} lowPriority alt={d.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1100ms]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                    <IllustrativeCaption className={recosProfileless ? "top-3 left-3" : "top-11 left-3"} />
                    {/* Sin perfil todavía no hay con qué calcular un "% afín": no se muestra. */}
                    {!recosProfileless && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-primary/30 text-primary text-[10px] font-medium tracking-wider">
                      {d.score}% afín a ti
                    </div>
                    )}
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






        {/* 6 · ¿AÚN SIN DESTINO? Planear por emoción (antes arriba, justo después del viaje: repetía la acción de planear). */}
        {/* Para quien aún no tiene viajes la guía de arriba ya es la portada: sin video duplicado. */}
        {/* Mientras carga se reserva su lugar: si apareciera después empujaría 340 px todo lo de abajo. */}
        {/* Sin animación de entrada: es la imagen principal (LCP). Con opacidad 0 al inicio el navegador
            la contaba 0.7 s tarde, y desplazada 20 px se medía más chica que la del siguiente reel. */}
        {(hasTrips || active.loading) && (
        <section>
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
                fallbackSrcSet={fallbackSrcSet(HERO_REELS[reelIdx].fallback)}
                sizes={HERO_SIZES}
                priority
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
                ¿Aún sin <span className="italic gold-text font-light">destino</span>?
              </h2>
              {/* Abre el modo emoción ("¿Cuál es tu emoción del viaje?"): el título, el texto y el botón dicen eso, para
                  no confundirlo con «Planear un viaje» (arriba), que parte de un destino. */}
              <p className="text-sm md:text-base text-white/70 mb-6 max-w-xl leading-relaxed" data-testid="home-hero-texto">
                Dinos qué quieres sentir (descanso, aventura, romance…) y IATOS te propone a dónde ir, con vuelos, hospedaje y experiencias.
              </p>
              <Button
                onClick={() => navigate("/dashboard/planear?mode=emocion")}
                className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow self-start h-12 px-6 rounded-2xl text-sm tracking-wide"
              >
                <Sparkles className="w-4 h-4 mr-2" strokeWidth={2.25} />
                Planear por emoción
              </Button>
            </div>
          </div>
        </section>
        )}

      </div>
    </DashboardLayout>
  );
};

export default DashboardHome;
