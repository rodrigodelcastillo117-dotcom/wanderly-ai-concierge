import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMetForecast, MET_ATTRIBUTION, nowFromMet } from "@/lib/metNorway";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Send, Sparkles, MapPin, Utensils, Car, Siren,
  Plane, Luggage, Crown, RefreshCw, Check, AlertCircle, Loader2, Info, Compass, Zap, X, Inbox,
} from "lucide-react";
import { GlobeLoader } from "@/components/brand/GlobeLoader";
import { useSlowLoading } from "@/hooks/useSlowLoading";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConciergeActions } from "@/components/ConciergeActions";
import { FlightStatusDialog } from "@/components/FlightStatusDialog";
import { TravelerAvatar } from "@/components/TravelerAvatar";
import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";
import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";
import { FixerButton } from "@/components/FixerButton";
import { supabase } from "@/integrations/supabase/client";
import { sessionTrulyExpired } from "@/lib/authRestore";
import { useAuth } from "@/contexts/AuthContext";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RichCard, type ConciergeCard } from "@/components/concierge/ConciergeCards";
import { TakeMeFromContext } from "@/components/concierge/TakeMeThereButton";
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
import { incompleteReplyText, streamConcierge } from "@/lib/conciergeStream";
import { buildChips, welcomeText, type Chip, type ChipIcon } from "@/lib/conciergeChips";
import { ActionCard } from "@/components/concierge/ActionCard";
import { AiReservationsLinkNote } from "@/components/reservas/AiReservationsPanel";
import type { ProposedAction } from "../../supabase/functions/concierge-chat/actions.ts";
import { conciergeLocationLabel, GEO_GIVE_UP_MS, type LocationState } from "@/lib/conciergeLocation";
import { tripPhaseLabel, tripSituation } from "../../supabase/functions/concierge-chat/location.ts";
import { answerPlaceLabel, type PlaceScope } from "../../supabase/functions/concierge-chat/turnPlace.ts";

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
  /** El usuario estaba fuera de los destinos del viaje: la respuesta es local, no "sobre tu viaje". */
  local?: boolean;
  /** De qué lugar es la respuesta (servidor, turnPlace.ts): "cerca de ti", "en Delhi" o el viaje. */
  placeScope?: PlaceScope | null;
  placeLabel?: string | null;
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
  // Pestañas: Concierge (chat), Solo para miembros y Mis solicitudes (lo que atiende una persona del
  // equipo, con su avance y respuesta: mesa de operaciones). ?tab=members | ?tab=solicitudes.
  type Tab = "chat" | "members" | "solicitudes";
  const tabFrom = (t: string | null): Tab => (t === "members" || t === "solicitudes" ? t : "chat");
  const [tab, setTab] = useState<Tab>(tabFrom(searchParams.get("tab")));
  useEffect(() => {
    const t = tabFrom(searchParams.get("tab"));
    if (t !== tab) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const switchTab = (next: Tab) => {
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    if (next === "chat") sp.delete("tab"); else sp.set("tab", next);
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
  // Pregunta escrita desde otra pantalla, NUNCA enviada sola (la persona la revisa y la envía):
  // ?ask=… (IATOS Privé: "Pregúntale a Iato", The Privé Key) o state.prefill (The Private Edition).
  const [input, setInput] = useState(() => {
    const p = (location.state as { prefill?: unknown } | null)?.prefill;
    if (typeof p === "string" && p.trim()) return p.slice(0, 1000);
    return (searchParams.get("ask") ?? "").slice(0, 400);
  });
  const [sending, setSending] = useState(false);
  // Modo exigente: apagado por omisión (usa el modelo más capaz: tarda un poco más y cuesta más).
  const [godMode, setGodMode] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("iatos_god_mode") === "1"; } catch { return false; }
  });
  const [showExigenteInfo, setShowExigenteInfo] = useState(false);
  // Atajos con conversación: lista vertical que se abre con "Atajos" (sin conversación van en el hilo).
  const [showShortcuts, setShowShortcuts] = useState(false);
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
  // Mensaje escrito en la caja "CONCIERGE IATO" de Inicio (?enviar=…): se envía solo, una vez, cuando ya
  // se sabe el viaje en contexto y se cargó la conversación (así no la pisa ni se pierde el contexto).
  const autoSend = useRef<string | null>((searchParams.get("enviar") ?? "").slice(0, 1000).trim() || null);
  const [historyReady, setHistoryReady] = useState(false);
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
  // Dónde está el usuario frente al viaje: el día de salida, aún en su ciudad, el viaje "sale hoy"
  // (no "en curso") y "Cena cerca" es cerca de donde está, no del hotel del viaje (22-oct-2026).
  const situation = useMemo(
    () => tripSituation(trip, todayLocal, { coords: currentCoords, place: weather?.place && weather.place !== "Tu ubicación" ? weather.place : null }),
    [trip, todayLocal, currentCoords, weather?.place],
  );
  const away = situation?.position === "away";
  const phaseHint = trip && situation && (situation.phase === "por_salir" || tripContext.reason === "in_progress")
    ? tripPhaseLabel(situation.phase, trip, todayLocal) || null
    : null;
  const chips = useMemo(() => buildChips(trip as any, todayLocal, { away }), [trip, todayLocal, away]);

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
      setHistoryReady(true);
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

  // Ubicación + clima en tiempo real (MET Norway, CC BY 4.0, sin llave; ver src/lib/metNorway.ts). Se
  // actualiza con el tick; la caché de metNorway respeta el Expires de MET (no se pide cada minuto).
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
          // Dos decimales (≈1 km): basta para el clima y no manda la ubicación exacta.
          const r2 = (v: number) => Math.round(v * 100) / 100;
          const [met, gRes] = await Promise.all([
            fetchMetForecast(r2(latitude), r2(longitude)),
            fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`),
          ]);
          const w = nowFromMet(met);
          if (!w) throw new Error("sin clima");
          const g = await gRes.json();
          setWeather({
            temp: w.tempC,
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

  // "Tu ubicación" es el respaldo del texto, no un lugar: no se manda como si lo fuera.
  const realPlace = weather?.place && weather.place !== "Tu ubicación" ? weather.place : undefined;
  const takeMeFrom = useMemo(() => ({ coords: currentCoords, city: realPlace ?? trip?.destino ?? null }), [currentCoords, realPlace, trip?.destino]);
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
        // Sin sesión guardada: a iniciar sesión (cierre local; nunca cierra otros dispositivos).
        await supabase.auth.signOut({ scope: "local" });
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
          context: { coords: currentCoords, place: realPlace },
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
          local: data._user_position === "away",
          placeScope: typeof data._place_scope === "string" ? data._place_scope as PlaceScope : null,
          placeLabel: typeof data._place_label === "string" ? data._place_label : null,
        })),
      });
    } catch (e: any) {
      // Se decide por el código del servidor, no por el texto (IATOS-P1-FREE-01).
      const { readFunctionError, toastFunctionError } = await import("@/lib/functionErrors");
      const info = await readFunctionError(e, "El concierge no respondió");
      if ((info.status === 401 || info.code === "UNAUTHENTICATED") && (await sessionTrulyExpired(supabase.auth))) {
        await supabase.auth.signOut({ scope: "local" });
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
          text: incompleteReplyText(m.text, info.message),
        }));
      }
    } finally {
      setSending(false);
      // El encabezado ("te quedan N de 3 mensajes") se lee del servidor: tras cada mensaje (o un
      // límite alcanzado) se vuelve a leer para que no se quede en "3 de 3" (hallazgo R10).
      notifyAccessChanged();
    }
  };

  useEffect(() => {
    const text = autoSend.current;
    if (!text || !user || !allowed || !tripsLoaded || sending) return;
    // Si la conversación tarda, no se espera para siempre: el mensaje sale igual.
    if (!historyReady) {
      const t = window.setTimeout(() => setHistoryReady(true), 4000);
      return () => window.clearTimeout(t);
    }
    autoSend.current = null;
    // Se quita de la URL: recargar o volver atrás no lo reenvía.
    const sp = new URLSearchParams(searchParams);
    sp.delete("enviar");
    setSearchParams(sp, { replace: true });
    void sendText(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, allowed, tripsLoaded, historyReady, sending]);

  const onChip = (c: Chip) => {
    setShowShortcuts(false);
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

  // Sin conversación (solo el saludo): los atajos van en el hilo, en lista vertical. Con conversación
  // se abren con el botón "Atajos", también en vertical (antes: una fila horizontal que se cortaba).
  const chatEmpty = !messages.some((m) => m.role === "user");

  // Modo exigente (god_mode en el servidor): modelo más capaz, compara más opciones y deja el plan
  // A/B/C con fuentes. No reserva por sí solo y no promete disponibilidad.
  const exigenteControls = (
    <>
      <button
        type="button"
        onClick={() => setShowExigenteInfo((v) => !v)}
        aria-label="¿Qué hace el Modo exigente?"
        aria-expanded={showExigenteInfo}
        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <Info className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setGodMode(g => !g)}
        aria-pressed={godMode}
        className={`relative flex shrink-0 items-center gap-1.5 px-3 min-h-[32px] rounded-full border transition text-xs ${
          godMode
            ? "border-primary bg-gradient-gold text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--primary)/0.7)]"
            : "border-border text-muted-foreground hover:border-primary/40"
        }`}
      >
        <Crown className="w-3.5 h-3.5" aria-hidden="true" />
        Modo exigente
        {godMode && <span className="ml-0.5 rounded-full bg-black/20 px-1.5 text-[10px]">ON</span>}
      </button>
    </>
  );

  return (
    // "Llévame" elige a pie / transporte / coche con la ubicación que esta pantalla ya tiene (sin permisos nuevos).
    <TakeMeFromContext.Provider value={takeMeFrom}>
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen">
        {/* ENCABEZADO compacto del chat (en Members Only se oculta para que la curaduría quepa sin bajar):
            título en una línea y, debajo, ubicación · viaje en contexto · actualizar · memoria, todo en
            un renglón que se recorta en vez de desbordarse. */}
        <div className={`px-3 md:px-6 lg:pr-28 pt-2 pb-2 border-b border-border bg-gradient-to-b from-surface/80 to-transparent backdrop-blur ${tab !== "chat" ? "hidden" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {/* Encabezado según el plan real: a cuentas gratis ya no les dice "Concierge PRO". */}
              <ConciergeHeading compact />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <TravelerAvatar compact />
              <FixerButton
                trip={trip}
                ultimosTurnos={messages.slice(-6).map((m) => ({ role: m.role, content: m.text }))}
              />
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground" data-testid="concierge-context">
            <span className="flex min-w-0 max-w-[40%] items-center gap-1" title={conciergeLocationLabel(geoState, weather)}>
              <MapPin className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">{conciergeLocationLabel(geoState, weather)}</span>
              {/* MET Norway (CC BY 4.0) pide atribución donde se muestra su clima. */}
              {weather && <a href={MET_ATTRIBUTION.href} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[10px] underline underline-offset-2">Datos: MET Norway</a>}
            </span>
            <TripContextSelector
              trips={trips}
              todayLocal={todayLocal}
              pinnedId={pinnedId}
              resolved={tripContext}
              onChange={(id) => void pinTrip(id)}
              phaseHint={phaseHint}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => setRefreshTick(t => t + 1)}
              aria-label="Actualizar ubicación y viajes (se actualiza solo cada minuto)"
              title={`Se actualiza solo cada minuto · última vez ${lastRefresh.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`}
              className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-primary/80 hover:text-primary hover:bg-primary/10 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            {user && <IatoMemoryPanel compact userId={user.id} trips={trips} />}
          </div>
        </div>

        {/* TABS: Chat / Members Only */}
        <div className="px-2 sm:px-3 md:px-6 border-b border-border bg-background/60 backdrop-blur flex gap-1">
          <button
            onClick={() => switchTab("chat")}
            className={`relative shrink-0 whitespace-nowrap px-2 sm:px-3 py-2 text-sm tracking-wide transition ${
              tab === "chat" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-2"><Crown className="hidden sm:block w-3.5 h-3.5" />Concierge</span>
            {tab === "chat" && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-gradient-gold rounded-full" />}
          </button>
          <button
            onClick={() => switchTab("members")}
            className={`relative shrink-0 whitespace-nowrap px-2 sm:px-3 py-2 text-sm tracking-wide transition ${
              tab === "members" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-2"><Sparkles className="hidden sm:block w-3.5 h-3.5" />Solo para miembros</span>
            {tab === "members" && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-gradient-gold rounded-full" />}
          </button>
          <button
            onClick={() => switchTab("solicitudes")}
            className={`relative shrink-0 whitespace-nowrap px-2 sm:px-3 py-2 text-sm tracking-wide transition ${
              tab === "solicitudes" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-2"><Inbox className="hidden sm:block w-3.5 h-3.5" /><span className="sm:hidden">Solicitudes</span><span className="hidden sm:inline">Mis solicitudes</span></span>
            {tab === "solicitudes" && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-gradient-gold rounded-full" />}
          </button>
        </div>

        {tab === "solicitudes" ? (
          <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4">
            <AiReservationsLinkNote />
            <MyTeamRequests />
          </div>
        ) : tab === "members" ? (
          <div className="flex-1 overflow-y-auto">
            <MembersOnlyPanel
              preferredCities={[weather?.place, trip?.destino]}
              onReserve={(v) => {
                switchTab("chat");
                setTimeout(() => {
                  sendText(
                    `Ya pedí mesa en ${v.nombre} (${v.ciudad_display}) — ${v.categoria} desde «Solo para miembros». ` +
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
        {/* HILO estilo WhatsApp: Iato a la izquierda, tú a la derecha, con hora. Se desplaza solo al
            último mensaje. */}
        <div ref={scrollRef} tabIndex={0} role="region" aria-label="Conversación con Iato" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 md:px-6 py-3 space-y-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">

          {messages.map(m => (
            <MessageBubble key={m.id} msg={m.id === "welcome" ? { ...m, text: welcomeText(trip as any) } : m} trips={trips}
              onChooseTrip={chooseTripAndRetry} disabled={sending} onOpenEmergency={() => setLiveAction("emergency")} />
          ))}
          {chatEmpty && (
            <div className="flex justify-start">
              <div className="w-full max-w-[85%] sm:max-w-sm">
                <ShortcutList chips={chips} onChip={onChip} sending={sending} title="Atajos" />
              </div>
            </div>
          )}
        </div>

        {/* COMPOSITOR fijo abajo: atajos (con conversación) y Modo exigente en un renglón; caja de texto
            con micrófono y enviar. */}
        <div className="relative px-3 md:px-6 pb-2 sm:pb-4 pt-2 border-t border-border bg-background/80 backdrop-blur">
          {showShortcuts && !chatEmpty && (
            <div
              id="concierge-shortcuts-panel"
              className="absolute bottom-full left-3 right-3 md:left-6 md:right-auto md:w-80 mb-2 z-20 max-h-[min(60vh,420px)] overflow-y-auto rounded-2xl shadow-2xl"
            >
              <ShortcutList chips={chips} onChip={onChip} sending={sending} title="Atajos" onClose={() => setShowShortcuts(false)} />
            </div>
          )}
          {showExigenteInfo && (
            <div className={`mb-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${godMode ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`} role="note">
              <strong className="text-primary">Modo exigente{godMode ? " activado" : ""}:</strong> Iato usa su modelo más capaz, compara más opciones en paralelo
              y te da <em>la mejor, la alternativa y el plan B</em> con fuentes y contras, más acciones listas para confirmar.
              Tarda unos segundos más y cada mensaje cuenta igual que uno normal.
            </div>
          )}
          <div className="flex items-center justify-between gap-2 mb-1.5" data-testid="composer-tools">
            {chatEmpty ? (
              <p className="hidden sm:block min-w-0 truncate text-[11px] text-muted-foreground">Iato propone; tú confirmas. Nada se reserva sin ti.</p>
            ) : (
              <button
                type="button"
                onClick={() => setShowShortcuts((v) => !v)}
                aria-expanded={showShortcuts}
                aria-controls="concierge-shortcuts-panel"
                className={`flex shrink-0 items-center gap-1.5 px-3 min-h-[32px] rounded-full border text-xs transition ${showShortcuts ? "border-primary bg-primary/10 text-foreground" : "border-primary/30 text-foreground hover:bg-primary/10"}`}
              >
                <Zap className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> Atajos
              </button>
            )}
            <div className="flex items-center gap-1 ml-auto">
              {exigenteControls}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0 rounded-3xl border border-primary/30 bg-card px-2 focus-within:border-primary transition">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText(input);
                  }
                }}
                rows={1}
                placeholder={listening ? "Escuchando…" : "Escribe o dicta lo que necesitas…"}
                aria-label="Mensaje para Iato"
                className="min-h-[44px] max-h-32 border-0 bg-transparent resize-none py-3 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <button
              onClick={toggleMic}
              className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition ${
                listening
                  ? "bg-destructive text-destructive-foreground animate-pulse"
                  : "bg-gradient-gold text-primary-foreground gold-glow hover:opacity-90"
              }`}
              title="Toca para dictar"
              aria-label={listening ? "Detener dictado" : "Dictar por voz"}
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              onClick={() => sendText(input)}
              disabled={!input.trim() || sending}
              aria-label="Enviar mensaje"
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
          </>
        )}

        <ConciergeActions open={!!liveAction} kind={liveAction} onClose={() => setLiveAction(null)} />
        <FlightStatusDialog open={showFlight} onClose={() => setShowFlight(false)} />
      </div>
    </DashboardLayout>
    </TakeMeFromContext.Provider>
  );
};

/** Atajos en lista vertical, de arriba hacia abajo: nada queda cortado en el celular. */
function ShortcutList({ chips, onChip, sending, title, onClose }: {
  chips: Chip[]; onChip: (c: Chip) => void; sending: boolean; title: string; onClose?: () => void;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-2 ${onClose ? "" : "rounded-tl-md"}`} data-testid="concierge-shortcuts">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[10px] tracking-[0.2em] uppercase text-primary">{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Cerrar atajos" className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1" aria-label={title}>
        {chips.map((c) => {
          const Icon = CHIP_ICONS[c.icon];
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChip(c)}
                disabled={sending && !c.opens}
                className="flex w-full items-center gap-2.5 px-3 min-h-[40px] rounded-xl border border-primary/20 text-left text-xs text-foreground hover:bg-primary/10 hover:border-primary transition disabled:opacity-50"
              >
                <Icon className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 break-words">{c.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepList({ steps, streaming, hasText }: { steps: Step[]; streaming?: boolean; hasText: boolean }) {
  // Iato tarda más de 5 s en empezar a responder → globo IATOS con el paso en curso como texto.
  const slow = useSlowLoading(!!streaming && !hasText);
  if (!steps.length && !(streaming && !hasText)) return null;
  const running = steps.find((x) => x.state === "running");
  return (
    <>
    {slow && <GlobeLoader size="sm" className="mb-1.5" label={running?.text ?? "Iato está escribiendo…"} />}
    <ul className="space-y-1 text-xs" aria-live="polite" data-testid="iato-steps">
      {/* Con el globo, el paso en curso ya es su texto: no se repite en la lista. */}
      {steps.filter((st) => !(slow && st === running)).map((st) => (
        <li key={st.id} className={`flex items-center gap-1.5 ${st.state === "running" ? "text-foreground" : "text-muted-foreground"}`}>
          {st.state === "running" ? <Loader2 className="w-3 h-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
            : st.state === "done" ? <Check className="w-3 h-3 shrink-0 text-primary" aria-hidden="true" />
              : <AlertCircle className="w-3 h-3 shrink-0 text-amber-500" aria-hidden="true" />}
          <span>{st.text}</span>
        </li>
      ))}
      {streaming && !hasText && !slow && !steps.some((x) => x.state === "running") && (
        <li className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin text-primary" aria-hidden="true" /> Iato está escribiendo…
        </li>
      )}
    </ul>
    </>
  );
}

/** Hora del mensaje ("20:31"); si no es de hoy, con fecha ("22 oct, 20:31"). Sin hora conocida, nada. */
function bubbleTime(ts: number, now: Date = new Date()): string {
  if (!ts || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "")}, ${hm}`;
}

const MessageBubble = ({ msg, trips, onChooseTrip, disabled, onOpenEmergency }: {
  msg: Msg; trips: ContextTrip[]; onChooseTrip: (id: string) => void; disabled?: boolean; onOpenEmergency?: () => void;
}) => {
  const isUser = msg.role === "user";
  const aboutPlace = !isUser ? answerPlaceLabel(msg, trips) : null;
  const time = bubbleTime(msg.ts);
  const showSteps = !isUser && ((msg.steps?.length ?? 0) > 0 || (msg.streaming && !msg.text.trim()));
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={isUser ? "bubble-user" : "bubble-iato"}
    >
      <div className={`flex min-w-0 flex-col gap-1.5 max-w-[85%] md:max-w-[70%] ${isUser ? "items-end" : "items-start"}`}>
        {(msg.text || showSteps) && (
          <div className={
            isUser
              ? "rounded-2xl rounded-br-md px-3 py-2 bg-primary text-primary-foreground text-sm leading-snug break-words"
              : "rounded-2xl rounded-tl-md px-3 py-2 border border-border bg-card text-foreground text-sm leading-snug break-words min-w-0"
          }>
            {!isUser && msg.exigente && (
              <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-primary/50 px-1.5 text-[10px] text-primary">
                <Crown className="w-2.5 h-2.5" aria-hidden="true" /> Modo exigente
              </span>
            )}
            {showSteps && <StepList steps={msg.steps ?? []} streaming={msg.streaming} hasText={!!msg.text.trim()} />}
            {/* Iato responde en Markdown: se interpreta un subconjunto seguro (N-05). */}
            {msg.text && (isUser ? <span className="whitespace-pre-wrap">{msg.text}</span> : <SafeMarkdown text={msg.text} />)}
            {(time || aboutPlace) && (
              <p className={`mt-0.5 flex justify-end gap-1 text-[10px] leading-none ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {aboutPlace && <span className="truncate max-w-[12rem]" data-testid="answer-place">{aboutPlace} ·</span>}
                {time && <time dateTime={new Date(msg.ts).toISOString()}>{time}</time>}
              </p>
            )}
          </div>
        )}
        {/* Elegir viaje solo si la pregunta era SOBRE un viaje: "tours en Lisboa" o "cerca de mí" ya se
            contestaron sobre el lugar (caso E2E 28-oct-2026: 11 botones de viajes debajo de la respuesta). */}
        {!isUser && msg.tripReason === "ambiguous" && msg.placeScope !== "requested" && msg.placeScope !== "here" && (msg.tripCandidates?.length ?? 0) > 0 && (
          <div className="flex flex-col items-start gap-1.5" role="group" aria-label="Elige el viaje">
            {msg.tripCandidates!.map((t) => (
              <button
                key={t.id}
                disabled={disabled}
                onClick={() => onChooseTrip(t.id)}
                className="flex items-center gap-1.5 px-3 min-h-[36px] rounded-full border border-primary/40 text-xs hover:bg-primary/10 hover:border-primary transition disabled:opacity-40"
              >
                <Plane className="w-3.5 h-3.5 text-primary" /> {tripLabel(t)}
              </button>
            ))}
          </div>
        )}
        {!!msg.cards?.length && (
          <div className="flex w-full flex-col gap-1.5 sm:max-w-sm" data-testid="bubble-cards">
            {msg.cards.map((c, i) => <RichCard key={i} card={c} tripId={msg.tripId ?? null} />)}
          </div>
        )}
        {!!msg.actions?.length && (
          <div className="flex w-full flex-col gap-1.5 sm:max-w-sm" data-testid="bubble-actions">
            {msg.actions.map((a) => <ActionCard key={a.id} action={a} tripId={msg.tripId ?? null} onOpenEmergency={onOpenEmergency} />)}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Concierge;
