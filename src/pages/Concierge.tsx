import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Send, Sparkles, MapPin, Utensils, Car, Siren,
  Plane, Luggage, Crown, RefreshCw, Check, AlertCircle, Loader2, Info, Compass,
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
import { ConciergeHeading } from "@/components/concierge/ConciergeHeading";
import { notifyAccessChanged } from "@/hooks/useSubscription";
import { readPinnedTrip, savePinnedTrip } from "@/lib/profileActiveTrip";
import { loadConversation } from "@/lib/conciergeHistory";
import { readPriveSession } from "@/lib/priveSession";
import { streamConcierge } from "@/lib/conciergeStream";
import { buildChips, welcomeText, type Chip, type ChipIcon } from "@/lib/conciergeChips";
import { ActionCard } from "@/components/concierge/ActionCard";
import type { ProposedAction } from "../../supabase/functions/concierge-chat/actions.ts";
import { conciergeLocationLabel, GEO_GIVE_UP_MS, type LocationState } from "@/lib/conciergeLocation";

type LiveAction = "transport" | "dining" | "emergency" | null;

/** Paso en vivo mientras Iato trabaja ("Consultando tu vuelo AF179…"). */
type Step = { id: string; text: string; state: string };

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
  /** Acciones propuestas (se confirman con un toque). */
  actions?: ProposedAction[];
  /** Pasos en vivo y si la respuesta sigue llegando. */
  steps?: Step[];
  streaming?: boolean;
  exigente?: boolean;
};

const PIN_KEY = "iatos_concierge_trip";
const browserTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

const CHIP_ICONS: Record<ChipIcon, typeof Utensils> = {
  dining: Utensils, transport: Car, emergency: Siren, flight: Plane, luggage: Luggage, trip: Compass,
};
const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/concierge-chat`;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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
    text: welcomeText(null),
  }]);
  const [liveAction, setLiveAction] = useState<LiveAction>(null);
  const [showFlight, setShowFlight] = useState(false);
  const location = useLocation();
  // "Pregúntale a Iato" desde otra pantalla (p. ej. un artículo de The Private Edition) llega con el texto en
  // state.prefill: se escribe en la caja para que la persona lo revise y lo envíe ella (nunca se envía solo).
  const [input, setInput] = useState(() => {
    const p = (location.state as { prefill?: unknown } | null)?.prefill;
    return typeof p === "string" ? p.slice(0, 1000) : "";
  });
  const [sending, setSending] = useState(false);
  // Modo exigente: apagado por omisión (usa el modelo más capaz: tarda un poco más y cuesta más).
  const [godMode, setGodMode] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("iatos_god_mode") === "1"; } catch { return false; }
  });
  const [showExigenteInfo, setShowExigenteInfo] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("iatos_god_mode", godMode ? "1" : "0"); } catch { /* modo privado */ }
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
  const [geoState, setGeoState] = useState<LocationState>("pending");
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
      .select("id, destino, pais_destino, fecha_salida, fecha_regreso, created_at, vuelos_json, hospedaje_json")
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
  const chips = useMemo(() => buildChips(trip as any, todayLocal), [trip, todayLocal]);

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
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoState("unavailable"); return; }
    // Si nadie contesta el aviso de permiso, el navegador no llama a ningún callback (el timeout
    // de abajo solo corre con permiso): pasado un rato se dice "no disponible". Si luego llega la
    // ubicación, el clima la reemplaza.
    const giveUp = window.setTimeout(() => setGeoState((s) => (s === "pending" ? "unavailable" : s)), GEO_GIVE_UP_MS);
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
          setGeoState("ok");
        } catch { setGeoState((s) => (s === "ok" ? s : "unavailable")); }
      },
      // Permiso negado o sin señal: se dice, en vez de "Detectando…" para siempre.
      () => setGeoState((s) => (s === "ok" ? s : "unavailable")),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
    return () => window.clearTimeout(giveUp);
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

  const patchMsg = (id: string, fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

  const sendText = async (text: string, opts: { tripId?: string | null; intent?: string } = {}) => {
    if (!text.trim() || sending) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text, ts: Date.now() };
    const next = [...messages, userMsg];
    const replyId = crypto.randomUUID();
    setMessages([...next, { id: replyId, role: "assistant", text: "", ts: Date.now(), steps: [], streaming: true, exigente: godMode }]);
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
      // Sesión Privé (si está desbloqueada): Iato la usa para search_prive; el servidor la valida.
      const ps = readPriveSession(sess.session?.user?.id)?.token;
      await streamConcierge({
        url: FUNCTIONS_URL,
        accessToken: sess.session.access_token,
        apiKey: PUBLISHABLE_KEY,
        headers: ps ? { "x-prive-session": ps } : undefined,
        body: {
          messages: next.filter((m) => m.id !== "welcome" && m.text.trim()).map((m) => ({ role: m.role, content: m.text })),
          god_mode: godMode,
          trip_id: opts.tripId !== undefined ? opts.tripId : pinnedId,
          intent: opts.intent,
          client_date: localISODate(),
          tz: browserTimeZone(),
          context: { coords: currentCoords, place: weather?.place },
        },
      }, {
        onMeta: (d) => patchMsg(replyId, (m) => ({ ...m, tripId: (d._trip_id as string) ?? null, exigente: d._exigente === true })),
        onStatus: (st) => patchMsg(replyId, (m) => {
          const steps = [...(m.steps ?? [])];
          const i = steps.findIndex((x) => x.id === st.id);
          if (i >= 0) steps[i] = st; else steps.push(st);
          return { ...m, steps };
        }),
        onDelta: (t) => patchMsg(replyId, (m) => ({ ...m, text: m.text + t })),
        onReset: () => patchMsg(replyId, (m) => ({ ...m, text: "" })),
        onFinal: (data) => patchMsg(replyId, (m) => ({
          ...m,
          streaming: false,
          text: typeof data.text === "string" && data.text ? data.text : m.text || "…",
          cards: Array.isArray(data.cards) ? data.cards : [],
          actions: Array.isArray(data.actions) ? data.actions : [],
          tripId: data._trip_id ?? null,
          tripReason: data._trip_reason,
          tripCandidates: Array.isArray(data._trip_candidates) ? data._trip_candidates : [],
        })),
      });
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
      if (info.freeLimit) setMessages((prev) => prev.filter((m) => m.id !== replyId));
      else {
        patchMsg(replyId, (m) => ({
          ...m, streaming: false, steps: m.steps?.map((x) => (x.state === "running" ? { ...x, state: "error" } : x)),
          text: m.text.trim() ? m.text : `${info.message} Puedes intentarlo de nuevo o tocar **Contactar Fixer**.`,
        }));
      }
    } finally {
      setSending(false);
      // El encabezado ("te quedan N de 3 mensajes") se lee del servidor: tras cada mensaje (o un
      // límite alcanzado) se vuelve a leer para que no se quede en "3 de 3" (hallazgo R10).
      notifyAccessChanged();
    }
  };

  const onChip = (c: Chip) => {
    if (c.opens === "emergency") { setLiveAction("emergency"); return; }
    if (c.text) void sendText(c.text, { intent: c.intent });
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

  // Modo exigente: mismo control en dos lugares. En sm+ va en su renglón; en móvil es el primer
  // atajo de la fila (un renglón propio restaba 40 px y el compositor quedaba bajo la barra inferior).
  const exigenteControls = (
    <>
      <button
        type="button"
        onClick={() => setShowExigenteInfo((v) => !v)}
        aria-label="¿Qué hace el Modo exigente?"
        className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <Info className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setGodMode(g => !g)}
        aria-pressed={godMode}
        className={`relative flex items-center gap-2 px-3 min-h-[36px] rounded-full border transition text-xs ${
          godMode
            ? "border-primary bg-gradient-gold text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--primary)/0.7)]"
            : "border-border text-muted-foreground hover:border-primary/40"
        }`}
      >
        <Crown className="w-3.5 h-3.5" aria-hidden="true" />
        Modo exigente <span className="hidden sm:inline">· lo mejor de lo mejor</span>
        {godMode && <span className="ml-1 rounded-full bg-black/20 px-1.5 text-[10px]">ON</span>}
      </button>
    </>
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen">
        {/* CONTEXT HEADER */}
        <div className="px-4 md:px-8 pt-6 pb-3 border-b border-border bg-gradient-to-b from-surface/80 to-transparent backdrop-blur">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              {/* Encabezado según el plan real: a cuentas gratis ya no les dice "Concierge PRO". */}
              <ConciergeHeading />
              <div className="flex items-center gap-3 mt-2 text-xs md:text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary" />
                  {conciergeLocationLabel(geoState, weather)}
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
                    `Ya pedí mesa en ${v.nombre} (${v.ciudad_display}) — ${v.categoria} desde Members Only. ` +
                    (v.dress_code ? `Dress code: ${v.dress_code}. ` : "") +
                    `¿Qué necesito saber para ir y qué alternativa tengo si no hay mesa?`,
                    { intent: "members_followup" },
                  );
                }, 250);
              }}
            />
          </div>
        ) : (
          <>
        {/* CHAT STREAM */}
        <div ref={scrollRef} tabIndex={0} role="region" aria-label="Conversación con Iato" className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">

          {messages.map(m => (
            <MessageBubble key={m.id} msg={m.id === "welcome" ? { ...m, text: welcomeText(trip as any) } : m} trips={trips}
              onChooseTrip={chooseTripAndRetry} disabled={sending} onOpenEmergency={() => setLiveAction("emergency")} />
          ))}
        </div>

        {/* SMART CHIPS + INPUT */}
        <div className="px-4 md:px-8 pb-3 sm:pb-6 pt-3 border-t border-border bg-background/80 backdrop-blur">
          {/* Modo exigente (god_mode en el servidor): modelo más capaz, compara más opciones y deja el
              plan A/B/C con fuentes. No reserva por sí solo y no promete disponibilidad. */}
          <div className="hidden sm:flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] text-muted-foreground">Iato propone; tú confirmas. Nada se reserva sin ti.</p>
            <div className="flex items-center gap-1 ml-auto">
              {exigenteControls}
            </div>
          </div>
          {(showExigenteInfo || godMode) && (
            // En móvil la nota solo aparece si la piden (ⓘ): siempre visible empujaba el compositor bajo la barra.
            <div className={`mb-3 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${godMode ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground"} ${showExigenteInfo ? "" : "hidden sm:block"}`} role="note">
              <strong className="text-primary">Modo exigente{godMode ? " activado" : ""}:</strong> Iato usa su modelo más capaz, compara más opciones en paralelo
              y te da <em>la mejor, la alternativa y el plan B</em> con fuentes y contras, más acciones listas para confirmar.
              Tarda unos segundos más y cada mensaje cuenta igual que uno normal.
            </div>
          )}

          {/* Botones rápidos con el viaje activo (vuelo de hoy, hotel, destino). En móvil una sola fila
              con desplazamiento horizontal: en varias filas empujaban el compositor debajo de la barra
              inferior en pantallas de 667 px de alto (iPhone SE/8). */}
          <div className="flex flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible items-center gap-2 mb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="sm:hidden flex shrink-0 items-center gap-1">
              {exigenteControls}
            </div>
            {chips.map((c) => {
              const Icon = CHIP_ICONS[c.icon];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChip(c)}
                  disabled={sending && !c.opens}
                  className="flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 min-h-[36px] rounded-full border border-primary/30 text-xs text-foreground hover:bg-primary/10 hover:border-primary transition disabled:opacity-50"
                >
                  <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  {c.label}
                </button>
              );
            })}
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
              aria-label="Mensaje para Iato"
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
              aria-label={listening ? "Detener dictado" : "Dictar por voz"}
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              onClick={() => sendText(input)}
              disabled={!input.trim() || sending}
              aria-label="Enviar mensaje"
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

function StepList({ steps, streaming, hasText }: { steps: Step[]; streaming?: boolean; hasText: boolean }) {
  if (!steps.length && !(streaming && !hasText)) return null;
  return (
    <ul className="space-y-1 text-xs" aria-live="polite" data-testid="iato-steps">
      {steps.map((st) => (
        <li key={st.id} className={`flex items-center gap-1.5 ${st.state === "running" ? "text-foreground" : "text-muted-foreground"}`}>
          {st.state === "running" ? <Loader2 className="w-3 h-3 animate-spin text-primary" aria-hidden="true" />
            : st.state === "done" ? <Check className="w-3 h-3 text-primary" aria-hidden="true" />
              : <AlertCircle className="w-3 h-3 text-amber-500" aria-hidden="true" />}
          <span>{st.text}</span>
        </li>
      ))}
      {streaming && !hasText && !steps.some((x) => x.state === "running") && (
        <li className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin text-primary" aria-hidden="true" /> Iato está revisando tu viaje…
        </li>
      )}
    </ul>
  );
}

const MessageBubble = ({ msg, trips, onChooseTrip, disabled, onOpenEmergency }: {
  msg: Msg; trips: ContextTrip[]; onChooseTrip: (id: string) => void; disabled?: boolean; onOpenEmergency?: () => void;
}) => {
  const isUser = msg.role === "user";
  const aboutTrip = !isUser && msg.tripId ? trips.find((t) => t.id === msg.tripId) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[92%] md:max-w-[75%] space-y-3 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && <StepList steps={msg.steps ?? []} streaming={msg.streaming} hasText={!!msg.text.trim()} />}
        {msg.text && (
          <div className={
            isUser
              ? "rounded-2xl rounded-br-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm"
              : "text-foreground text-sm md:text-base leading-relaxed"
          }>
            {!isUser && (
              <div className="flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-primary uppercase mb-1">
                <Sparkles className="w-3 h-3" /> Iato
                {msg.exigente && <span className="ml-1 rounded-full border border-primary/50 px-1.5 normal-case tracking-normal">Modo exigente</span>}
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
        {msg.actions?.map((a) => <ActionCard key={a.id} action={a} tripId={msg.tripId ?? null} onOpenEmergency={onOpenEmergency} />)}
      </div>
    </motion.div>
  );
};

export default Concierge;
