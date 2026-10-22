import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Send, Sparkles, MapPin, Utensils, Car, Siren,
  Plane, Luggage, Crown, RefreshCw
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConciergeActions } from "@/components/ConciergeActions";
import { FlightStatusDialog } from "@/components/FlightStatusDialog";
import { TravelerAvatar } from "@/components/TravelerAvatar";
import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";
import { FixerButton } from "@/components/FixerButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RichCard, type ConciergeCard } from "@/components/concierge/ConciergeCards";
import { IatoMemoryPanel } from "@/components/concierge/IatoMemoryPanel";
import { SafeMarkdown } from "@/components/concierge/SafeMarkdown";
import { TripContextSelector, type ContextTrip } from "@/components/concierge/TripContextSelector";
import { resolveActiveTrip, tripLabel, type ActiveTripReason } from "@/lib/activeTrip";
import { localISODate } from "@/lib/localDate";
import { readPinnedTrip, savePinnedTrip } from "@/lib/profileActiveTrip";
import { loadConversation } from "@/lib/conciergeHistory";

type LiveAction = "transport" | "dining" | "emergency" | null;

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: ConciergeCard[];
  ts: number;
  /** Viaje sobre el que respondió el servidor y por qué (B-08). */
  tripId?: string | null;
  tripReason?: ActiveTripReason;
  /** Con tripReason "ambiguous": viajes entre los que el usuario debe elegir. */
  tripCandidates?: ContextTrip[];
};

const PIN_KEY = "iatos_concierge_trip";
const browserTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

type QuickAction = LiveAction | "flight" | "luggage";
const QUICK_CHIPS: Array<{ icon: any; label: string; action?: QuickAction }> = [
  { icon: Utensils, label: "Cena cerca", action: "dining" },
  { icon: Car, label: "Pedir transporte", action: "transport" },
  { icon: Siren, label: "Emergencia local", action: "emergency" },
  { icon: Plane, label: "¿Mi vuelo va a tiempo?", action: "flight" },
  { icon: Luggage, label: "Equipaje Invisible", action: "luggage" },
];

// SpeechRecognition typing
declare global {
  interface Window { webkitSpeechRecognition?: any; SpeechRecognition?: any; }
}

const Concierge = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"chat" | "members">(
    searchParams.get("tab") === "members" ? "members" : "chat",
  );
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "members" && tab !== "members") setTab("members");
    if (t !== "members" && tab === "members") setTab("chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const switchTab = (next: "chat" | "members") => {
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    if (next === "members") sp.set("tab", "members"); else sp.delete("tab");
    setSearchParams(sp, { replace: true });
  };
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([{
    id: "welcome", role: "assistant", ts: Date.now(),
    text: "Bienvenido. Estoy listo para anticiparme a cualquier capricho o emergencia de tu viaje. Usa los botones rápidos abajo para acciones reales en vivo, o escríbeme cualquier petición.",
  }]);
  const [liveAction, setLiveAction] = useState<LiveAction>(null);
  const [showFlight, setShowFlight] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [godMode, setGodMode] = useState(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("iatos_god_mode");
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    try { localStorage.setItem("iatos_god_mode", godMode ? "1" : "0"); } catch {}
  }, [godMode]);
  const [listening, setListening] = useState(false);
  
  const [trips, setTrips] = useState<ContextTrip[]>([]);
  // Viaje elegido por el usuario (profiles.active_trip_id). null = Iato decide.
  const [pinnedId, setPinnedId] = useState<string | null>(() => {
    try { return localStorage.getItem(PIN_KEY) || null; } catch { return null; }
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  // E-13: viaje cuyo historial ya se cargó (undefined = ninguno todavía; null = "sin viaje").
  const historyFor = useRef<string | null | undefined>(undefined);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [weather, setWeather] = useState<{ temp: number; place: string } | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  // PRO access: abierto a todos los usuarios registrados
  useEffect(() => {
    if (!user) return;
    setAllowed(true);
  }, [user]);


  // Viajes del usuario (propios y compartidos, vía RLS) y viaje fijado — auto-refresh cada minuto.
  // Antes el encabezado mostraba el viaje creado más recientemente, aunque Iato hablara de otro.
  useEffect(() => {
    if (!user || !allowed) return;
    supabase.from("trips")
      .select("id, destino, pais_destino, fecha_salida, fecha_regreso, created_at")
      .order("fecha_salida", { ascending: true })
      .limit(50)
      .then(({ data }) => {
        setTrips((data as ContextTrip[]) ?? []);
        setTripsLoaded(true);
        setLastRefresh(new Date());
      });
    // Si la columna aún no existe (migración pendiente) se conserva la elección local y no se
    // vuelve a consultar en esta sesión (N-03).
    void readPinnedTrip(user.id).then((pinned) => {
      if (pinned !== undefined) setPinnedId(pinned);
    });
  }, [user, allowed, refreshTick]);

  const todayLocal = localISODate();
  const tripContext = useMemo(
    () => resolveActiveTrip(trips, { pinnedId, todayLocal }),
    [trips, pinnedId, todayLocal],
  );
  const trip = tripContext.trip;

  // E-13: al abrir (o recargar) el chat se muestra la última conversación del viaje activo, que
  // concierge-chat ya guarda en concierge_conversations. Solo si el usuario aún no escribió nada.
  useEffect(() => {
    if (!user || !allowed || !tripsLoaded) return;
    const key = trip?.id ?? null;
    if (historyFor.current === key) return;
    historyFor.current = key;
    loadConversation(supabase, user.id, key).then((restored) => {
      // Si mientras tanto cambió el viaje en contexto, esta respuesta ya no aplica.
      if (historyFor.current !== key) return;
      // Al cambiar de viaje se reemplaza el historial mostrado; nunca se pisa lo que el usuario ya escribió.
      setMessages((prev) => (prev.some((m) => m.role === "user" && !m.id.startsWith("hist-"))
        ? prev
        : [...prev.filter((m) => m.id === "welcome"), ...restored]));
    });
  }, [user?.id, allowed, tripsLoaded, trip?.id]);

  const pinTrip = async (id: string | null) => {
    setPinnedId(id);
    try { if (id) localStorage.setItem(PIN_KEY, id); else localStorage.removeItem(PIN_KEY); } catch { /* modo privado */ }
    if (!user) return;
    const code = await savePinnedTrip(user.id, id);
    if (code === "42501") toast.error("No tienes acceso a ese viaje");
  };

  // Auto-refresh tick every 60s
  useEffect(() => {
    if (!allowed) return;
    const id = setInterval(() => setRefreshTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [allowed]);

  // Real-time geolocation + weather (Open-Meteo, no key). Refresh on tick.
  useEffect(() => {
    if (!allowed) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCurrentCoords({ lat: latitude, lng: longitude });
        try {
          const [wRes, gRes] = await Promise.all([
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m`),
            fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`),
          ]);
          const w = await wRes.json();
          const g = await gRes.json();
          setWeather({
            temp: Math.round(w?.current?.temperature_2m ?? 0),
            place: g?.city || g?.locality || g?.principalSubdivision || "Tu ubicación",
          });
        } catch {/* noop */}
      },
      () => {/* permission denied — silent */},
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }, [allowed, refreshTick]);

  // Realtime in-app notifications
  useEffect(() => {
    if (!user || !allowed) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        const n = payload.new;
        toast.success(n.title, { description: n.body });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, allowed]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const localTimeContext = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Mañana libre";
    if (h < 18) return "Tarde libre en tu itinerario";
    return "Noche disponible";
  }, []);

  const sendText = async (text: string, opts: { tripId?: string | null } = {}) => {
    if (!text.trim() || sending) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      // Validar sesión antes de invocar el edge function (evita 401 "Sesión inválida")
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        await supabase.auth.signOut();
        toast.error("Tu sesión expiró. Vuelve a iniciar sesión.");
        window.location.href = "/auth";
        return;
      }

      const { data, error } = await supabase.functions.invoke("concierge-chat", {
        body: {
          messages: next.filter(m => m.id !== "welcome").map(m => ({ role: m.role, content: m.text })),
          god_mode: godMode,
          trip_id: opts.tripId !== undefined ? opts.tripId : pinnedId,
          client_date: localISODate(),
          tz: browserTimeZone(),
          context: {
            coords: currentCoords,
            place: weather?.place,
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: data.text ?? "…",
        cards: Array.isArray(data.cards) ? data.cards : [],
        ts: Date.now(),
        tripId: data._trip_id ?? null,
        tripReason: data._trip_reason,
        tripCandidates: Array.isArray(data._trip_candidates) ? data._trip_candidates : [],
      }]);
    } catch (e: any) {
      // Se decide por el código del servidor, no por el texto (IATOS-P1-FREE-01).
      const { readFunctionError, toastFunctionError } = await import("@/lib/functionErrors");
      const info = await readFunctionError(e, "El concierge no respondió");
      if (info.status === 401 || info.code === "UNAUTHENTICATED") {
        await supabase.auth.signOut();
        toast.error("Tu sesión expiró. Vuelve a iniciar sesión.");
        window.location.href = "/auth";
        return;
      }
      await toastFunctionError(e, "El concierge no respondió");
      // Límite del plan: el diálogo lo explica; no se agrega "hubo un tropiezo" al chat.
      if (!info.freeLimit) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: "assistant", ts: Date.now(),
          text: "Disculpa, hubo un tropiezo. Inténtalo de nuevo en un momento.",
        }]);
      }
    } finally {
      setSending(false);
    }
  };


  // El usuario eligió un viaje cuando Iato preguntó "¿a cuál te refieres?": se fija y se repite
  // la última pregunta sobre ese viaje.
  const chooseTripAndRetry = (id: string) => {
    void pinTrip(id);
    const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text;
    if (lastQuestion) void sendText(lastQuestion, { tripId: id });
  };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast.error("Tu navegador no soporta dictado por voz");
      return;
    }
    if (listening && recRef.current) {
      recRef.current.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "es-MX";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const t = Array.from(e.results).map((r: any) => r[0].transcript).join("");
      setInput(t);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  if (allowed === null) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh] text-muted-foreground text-sm">
          Verificando acceso a Concierge PRO…
        </div>
      </DashboardLayout>
    );
  }
  if (!allowed) return null;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen">
        {/* CONTEXT HEADER */}
        <div className="px-4 md:px-8 pt-6 pb-3 border-b border-border bg-gradient-to-b from-surface/80 to-transparent backdrop-blur">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-2">
                <Crown className="w-3 h-3" /> CONCIERGE PRO
              </p>
              <h1 className="font-display text-2xl md:text-3xl leading-tight">Concierge PRO te escucha</h1>
              <div className="flex items-center gap-3 mt-2 text-xs md:text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary" />
                  {weather ? `${weather.place} · ${weather.temp}°C` : "Detectando tu ubicación real…"}
                </span>
                <TripContextSelector
                  trips={trips}
                  todayLocal={todayLocal}
                  pinnedId={pinnedId}
                  resolved={tripContext}
                  onChange={(id) => void pinTrip(id)}
                />
                <span className="hidden sm:inline">|</span>
                <span>{localTimeContext}</span>
                <span className="hidden sm:inline">|</span>
                <button
                  onClick={() => setRefreshTick(t => t + 1)}
                  className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition"
                  title={`Actualizado ${lastRefresh.toLocaleTimeString()}`}
                >
                  <RefreshCw className="w-3 h-3" /> Auto-refresh 60s
                </button>
                {user && (
                  <>
                    <span className="hidden sm:inline">|</span>
                    <IatoMemoryPanel userId={user.id} trips={trips} />
                  </>
                )}
              </div>

            </div>

            <div className="flex items-center gap-2 shrink-0">
              <TravelerAvatar compact />
              <FixerButton
                trip={trip}
                ultimosTurnos={messages.slice(-6).map((m) => ({ role: m.role, content: m.text }))}
              />
            </div>

          </div>
        </div>

        {/* TABS: Chat / Members Only */}
        <div className="px-4 md:px-8 pt-3 border-b border-border bg-background/60 backdrop-blur flex gap-1">
          <button
            onClick={() => switchTab("chat")}
            className={`relative px-4 py-2.5 text-sm tracking-wide transition ${
              tab === "chat" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-2"><Crown className="w-3.5 h-3.5" />Concierge</span>
            {tab === "chat" && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-gradient-gold rounded-full" />}
          </button>
          <button
            onClick={() => switchTab("members")}
            className={`relative px-4 py-2.5 text-sm tracking-wide transition ${
              tab === "members" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" />Members Only</span>
            {tab === "members" && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-gradient-gold rounded-full" />}
          </button>
        </div>

        {tab === "members" ? (
          <div className="flex-1 overflow-y-auto">
            <MembersOnlyPanel
              onReserve={(v) => {
                switchTab("chat");
                setTimeout(() => {
                  sendText(
                    `Quiero reservar en ${v.nombre} (${v.ciudad_display}) — ${v.categoria}. ` +
                    (v.dress_code ? `Dress code: ${v.dress_code}. ` : "") +
                    (v.precio_estimado ? `Rango: ${v.precio_estimado}. ` : "") +
                    `Ayúdame a encontrar la mejor mesa u horario para esta semana: dame opciones con enlace para reservar o dime si conviene pedírselo a un humano.`,
                  );
                }, 250);
              }}
            />
          </div>
        ) : (
          <>
        {/* CHAT STREAM */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">

          {messages.map(m => (
            <MessageBubble key={m.id} msg={m} trips={trips} onChooseTrip={chooseTripAndRetry} disabled={sending} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-primary text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
              <span className="ml-1 italic text-muted-foreground">Concierge pensando…</span>
            </div>
          )}
        </div>

        {/* SMART CHIPS + INPUT */}
        <div className="px-4 md:px-8 pb-6 pt-3 border-t border-border bg-background/80 backdrop-blur">
          {/* Modo exigente (god_mode en el servidor): prioriza opciones premium; no reserva por sí solo */}
          <div className="flex items-center justify-end mb-2">
            <button
              onClick={() => setGodMode(g => !g)}
              className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full border transition text-xs ${
                godMode
                  ? "border-primary bg-gradient-gold text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--primary)/0.7)]"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Crown className={`w-3.5 h-3.5 ${godMode ? "animate-pulse" : ""}`} />
              Modo exigente <span className="hidden sm:inline">· opciones VIP</span>
            </button>
          </div>

          {/* Quick chips — wrap to show all options at once */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {QUICK_CHIPS.map((c) => (
              <button
                key={c.label}
                onClick={() => {
                  if (c.action === "flight") sendText("¿Mi vuelo de hoy va a tiempo? Dame estatus real, terminal, puerta y posibles retrasos.");
                  else if (c.action === "luggage") sendText("Quiero activar Equipaje Invisible: recolección en mi ubicación actual y entrega en mi siguiente hospedaje. Dame opciones reales (Luggage Forward, AirPortr, LugLess) con precio y link directo.");
                  else if (c.action === "dining") sendText("Recomiéndame cenas premium cerca de mi hotel para hoy, con rating real y link de reserva.");
                  else if (c.action === "transport") sendText("Necesito transfer/taxi premium ahora. Propón opciones con tiempo estimado y link de reserva.");
                  else if (c.action) setLiveAction(c.action as LiveAction);
                  else sendText(c.label);
                }}
                disabled={sending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 text-xs text-foreground hover:bg-primary/10 hover:border-primary transition"
              >
                <c.icon className="w-3.5 h-3.5 text-primary" />
                {c.label}
              </button>
            ))}
          </div>


          <div className="flex items-end gap-2 rounded-2xl border border-primary/30 bg-card p-2 focus-within:border-primary transition">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText(input);
                }
              }}
              placeholder={listening ? "Escuchando…" : "Háblame o escribe lo que necesitas…"}
              className="flex-1 min-h-[44px] max-h-32 border-0 bg-transparent resize-none focus-visible:ring-0"
            />
            <button
              onClick={toggleMic}
              className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition ${
                listening
                  ? "bg-destructive text-destructive-foreground animate-pulse"
                  : "bg-gradient-gold text-primary-foreground gold-glow hover:opacity-90"
              }`}
              title="Mantén pulsado para dictar"
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              onClick={() => sendText(input)}
              disabled={!input.trim() || sending}
              className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
          </>
        )}



        {/* FIXER MODAL — ahora dentro de <FixerButton /> */}

        <ConciergeActions open={!!liveAction} kind={liveAction} onClose={() => setLiveAction(null)} />
        <FlightStatusDialog open={showFlight} onClose={() => setShowFlight(false)} />
      </div>
    </DashboardLayout>
  );
};

const MessageBubble = ({ msg, trips, onChooseTrip, disabled }: {
  msg: Msg; trips: ContextTrip[]; onChooseTrip: (id: string) => void; disabled?: boolean;
}) => {
  const isUser = msg.role === "user";
  const aboutTrip = !isUser && msg.tripId ? trips.find((t) => t.id === msg.tripId) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] md:max-w-[75%] space-y-3 ${isUser ? "items-end" : "items-start"}`}>
        {msg.text && (
          <div className={
            isUser
              ? "rounded-2xl rounded-br-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm"
              : "text-foreground text-sm md:text-base leading-relaxed"
          }>
            {!isUser && (
              <div className="flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-primary uppercase mb-1">
                <Sparkles className="w-3 h-3" /> Concierge
                {aboutTrip?.destino && (
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground">· sobre tu viaje a {aboutTrip.destino}</span>
                )}
              </div>
            )}
            {/* Iato responde en Markdown: se interpreta un subconjunto seguro (N-05). */}
            {isUser ? msg.text : <SafeMarkdown text={msg.text} />}
          </div>
        )}
        {!isUser && msg.tripReason === "ambiguous" && (msg.tripCandidates?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Elige el viaje">
            {msg.tripCandidates!.map((t) => (
              <button
                key={t.id}
                disabled={disabled}
                onClick={() => onChooseTrip(t.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/40 text-xs hover:bg-primary/10 hover:border-primary transition disabled:opacity-40"
              >
                <Plane className="w-3.5 h-3.5 text-primary" /> {tripLabel(t)}
              </button>
            ))}
          </div>
        )}
        {msg.cards?.map((c, i) => <RichCard key={i} card={c} tripId={msg.tripId ?? null} />)}
      </div>
    </motion.div>
  );
};

export default Concierge;
