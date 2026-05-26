import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Send, Phone, Sparkles, Cloud, MapPin, Utensils, Car, Siren,
  Plane, Luggage, Star, AlertTriangle, X, Crown, RefreshCw
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConciergeActions } from "@/components/ConciergeActions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type LiveAction = "transport" | "dining" | "emergency" | null;

type Card =
  | { type: "restaurant"; title: string; subtitle?: string; image_prompt?: string; rating?: number; cta_label: string; cta_action?: string; meta?: string }
  | { type: "transport"; title: string; subtitle?: string; cta_label: string; meta?: string }
  | { type: "alert"; title: string; body: string; cta_label?: string }
  | { type: "luggage"; title: string; from: string; to: string; status: string; cta_label: string }
  | { type: "jet"; title: string; route: string; price_usd: number; fbo: string; cta_label: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: Card[];
  ts: number;
};

const QUICK_CHIPS: Array<{ icon: any; label: string; action?: LiveAction }> = [
  { icon: Utensils, label: "Cena cerca", action: "dining" },
  { icon: Car, label: "Pedir transporte", action: "transport" },
  { icon: Siren, label: "Emergencia local", action: "emergency" },
  { icon: Plane, label: "¿Mi vuelo va a tiempo?" },
  { icon: Luggage, label: "Equipaje Invisible" },
];

// SpeechRecognition typing
declare global {
  interface Window { webkitSpeechRecognition?: any; SpeechRecognition?: any; }
}

const Concierge = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([{
    id: "welcome", role: "assistant", ts: Date.now(),
    text: "Bienvenido. Estoy listo para anticiparme a cualquier capricho o emergencia de tu viaje.",
    cards: [PROACTIVE_ALERT],
  }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [godMode, setGodMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [showFixer, setShowFixer] = useState(false);
  const [trip, setTrip] = useState<any>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [weather, setWeather] = useState<{ temp: number; place: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  // PRO gating with allowlist (rodelcast, Carlo)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tier, full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      const name = (profile?.full_name ?? "").toLowerCase();
      const email = (profile?.email ?? user.email ?? "").toLowerCase();
      const allowlisted =
        name.includes("rodelcast") || name.includes("carlo") ||
        email.includes("rodelcast") || email.includes("carlo");
      const isPro = profile?.tier === "pro";
      if (isPro || allowlisted) {
        setAllowed(true);
      } else {
        setAllowed(false);
        toast.error("Concierge Pro está disponible solo para miembros IATOS Pro.");
        navigate("/dashboard/pro", { replace: true });
      }
    })();
  }, [user, navigate]);

  // Load active trip for header — auto-refresh every minute
  useEffect(() => {
    if (!user || !allowed) return;
    supabase.from("trips")
      .select("destino, pais_destino, fecha_salida, fecha_regreso")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setTrip(data);
        setLastRefresh(new Date());
      });
  }, [user, allowed, refreshTick]);

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

  const sendText = async (text: string) => {
    if (!text.trim() || sending) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const { data, error } = await supabase.functions.invoke("concierge-chat", {
        body: {
          messages: next.filter(m => m.id !== "welcome").map(m => ({ role: m.role, content: m.text })),
          god_mode: godMode,
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
      }]);
    } catch (e: any) {
      toast.error(e?.message ?? "El concierge no respondió");
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: "assistant", ts: Date.now(),
        text: "Disculpa, hubo un tropiezo. Inténtalo de nuevo en un momento.",
      }]);
    } finally {
      setSending(false);
    }
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
          Verificando acceso a Concierge Pro…
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
                <Crown className="w-3 h-3" /> IATOS · Concierge Pro
              </p>
              <h1 className="font-display text-2xl md:text-3xl leading-tight">IATOS AI te escucha</h1>
              <div className="flex items-center gap-3 mt-2 text-xs md:text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary" />
                  {trip?.destino ?? "Sin viaje activo"}{trip?.pais_destino ? `, ${trip.pais_destino}` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-primary" />
                  {weather ? `${weather.place} · ${weather.temp}°C` : "Detectando ubicación…"}
                </span>
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
              </div>
            </div>

            <button
              onClick={() => setShowFixer(true)}
              className="group relative flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl bg-white/5 border border-primary/30 hover:border-primary hover:bg-primary/10 transition text-sm"
              title="Para caprichos imposibles o emergencias extremas, un humano VIP local tomará el control."
            >
              <Phone className="w-4 h-4 text-primary" />
              <span className="hidden sm:inline">Contactar Fixer</span>
              <span className="sm:hidden">Fixer</span>
            </button>
          </div>
        </div>

        {/* CHAT STREAM */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">
          {messages.map(m => (
            <MessageBubble key={m.id} msg={m} />
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
          {/* God Mode toggle on its own row */}
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
              God Mode <span className="hidden sm:inline">· Caza-Reservas VIP</span>
            </button>
          </div>

          {/* Quick chips — wrap to show all options at once */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {QUICK_CHIPS.map((c) => (
              <button
                key={c.label}
                onClick={() => sendText(c.label)}
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

        {/* FIXER MODAL */}
        <AnimatePresence>
          {showFixer && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-6"
              onClick={() => setShowFixer(false)}
            >
              <motion.div
                initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="max-w-md w-full rounded-3xl border border-primary/40 bg-card p-8 relative"
              >
                <button onClick={() => setShowFixer(false)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
                <div className="w-14 h-14 rounded-full bg-gradient-gold flex items-center justify-center mb-4 gold-glow">
                  <Phone className="w-6 h-6 text-primary-foreground" />
                </div>
                <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2">The Fixer</p>
                <h3 className="font-display text-2xl mb-3">Un humano VIP toma el control</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Para caprichos imposibles o emergencias extremas. Te conectamos en menos de 5 minutos con un fixer local de confianza.
                </p>
                <Button className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
                  <Phone className="w-4 h-4 mr-2" /> Llamar ahora
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
};

const MessageBubble = ({ msg }: { msg: Msg }) => {
  const isUser = msg.role === "user";
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
              </div>
            )}
            {msg.text}
          </div>
        )}
        {msg.cards?.map((c, i) => <RichCard key={i} card={c} />)}
      </div>
    </motion.div>
  );
};

type CardStatus = "idle" | "loading" | "confirmed" | "error";

const useConciergeAction = () => {
  const [status, setStatus] = useState<CardStatus>("idle");
  const run = async (payload: { type: string; title: string; payload?: any }) => {
    setStatus("loading");
    try {
      const { data, error } = await supabase.functions.invoke("concierge-action", {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStatus("confirmed");
      toast.success("Solicitud enviada", { description: payload.title });
    } catch (e: any) {
      setStatus("error");
      toast.error(e?.message ?? "No pudimos procesar la solicitud");
    }
  };
  return { status, run };
};

const ActionButton = ({
  status, label, onClick, className = "",
}: { status: CardStatus; label: string; onClick: () => void; className?: string }) => (
  <Button
    onClick={onClick}
    disabled={status === "loading" || status === "confirmed"}
    className={`bg-gradient-gold text-primary-foreground hover:opacity-90 ${className}`}
  >
    {status === "loading" && "Procesando…"}
    {status === "confirmed" && "✓ Confirmado"}
    {status === "idle" && label}
    {status === "error" && "Reintentar"}
  </Button>
);

const RichCard = ({ card }: { card: Card }) => {
  const { status, run } = useConciergeAction();

  if (card.type === "alert") {
    return (
      <motion.div
        animate={{ boxShadow: ["0 0 0 hsl(var(--primary)/0)", "0 0 24px hsl(var(--primary)/0.35)", "0 0 0 hsl(var(--primary)/0)"] }}
        transition={{ duration: 3, repeat: Infinity }}
        className="rounded-2xl border border-primary/60 bg-primary/5 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-display text-base mb-1">{card.title}</p>
            <p className="text-sm text-muted-foreground mb-3">{card.body}</p>
            {card.cta_label && (
              <ActionButton
                status={status}
                label={card.cta_label}
                onClick={() => run({ type: "alert", title: card.title, payload: { body: card.body } })}
                className="h-9 px-3 text-sm"
              />
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  if (card.type === "restaurant") {
    return (
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="h-32 bg-gradient-to-br from-amber-900/40 via-stone-800 to-stone-900 flex items-center justify-center relative">
          <Utensils className="w-10 h-10 text-primary/40" />
          {card.rating && (
            <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur text-xs">
              <Star className="w-3 h-3 fill-primary text-primary" /> {card.rating.toFixed(1)}
            </span>
          )}
        </div>
        <div className="p-4">
          <h4 className="font-display text-lg leading-tight">{card.title}</h4>
          {card.subtitle && <p className="text-sm text-muted-foreground mb-1">{card.subtitle}</p>}
          {card.meta && <p className="text-xs text-primary mb-3">{card.meta}</p>}
          <ActionButton
            status={status}
            label={card.cta_label}
            onClick={() => run({ type: "reservation", title: card.title, payload: { subtitle: card.subtitle, meta: card.meta, rating: card.rating } })}
            className="w-full gold-glow"
          />
        </div>
      </div>
    );
  }

  if (card.type === "transport") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Car className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="font-display text-base leading-tight">{card.title}</h4>
            {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
          </div>
        </div>
        {card.meta && <p className="text-xs text-muted-foreground mb-3">{card.meta}</p>}
        <ActionButton
          status={status}
          label={card.cta_label}
          onClick={() => run({ type: "transport", title: card.title, payload: { subtitle: card.subtitle, meta: card.meta } })}
          className="w-full h-9 text-sm"
        />
      </div>
    );
  }

  if (card.type === "luggage") {
    return (
      <div className="rounded-2xl border border-primary/30 bg-card overflow-hidden">
        <div className="relative h-28 bg-gradient-to-r from-stone-900 via-stone-800 to-stone-900 flex items-center px-5">
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: "radial-gradient(circle at 10% 50%, hsl(var(--primary)/0.4), transparent 30%), radial-gradient(circle at 90% 50%, hsl(var(--primary)/0.4), transparent 30%)",
          }} />
          <div className="relative flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground">
              <p className="uppercase tracking-widest text-[10px] text-primary">Origen</p>
              <p>{card.from}</p>
            </div>
            <div className="flex-1 mx-3 relative h-px bg-primary/30">
              <motion.div
                animate={{ left: ["0%", "100%"] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                className="absolute -top-2 w-4 h-4 rounded-full bg-primary"
                style={{ boxShadow: "0 0 12px hsl(var(--primary))" }}
              />
            </div>
            <div className="text-xs text-muted-foreground text-right">
              <p className="uppercase tracking-widest text-[10px] text-primary">Destino</p>
              <p>{card.to}</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Luggage className="w-4 h-4 text-primary" />
            <h4 className="font-display text-base">{card.title}</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{card.status}</p>
          <ActionButton
            status={status}
            label={card.cta_label}
            onClick={() => run({ type: "pickup", title: card.title, payload: { from: card.from, to: card.to, status: card.status } })}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  if (card.type === "jet") {
    return (
      <div className="rounded-2xl border border-primary/50 bg-gradient-to-br from-stone-950 via-stone-900 to-black overflow-hidden gold-glow">
        <div className="relative h-32 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          <Plane className="w-16 h-16 text-primary relative" />
          <span className="absolute top-3 left-3 px-2 py-1 rounded-full bg-primary text-primary-foreground text-[10px] tracking-widest uppercase font-medium">
            Empty Leg
          </span>
        </div>
        <div className="p-4">
          <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1">Upgrade exclusivo</p>
          <h4 className="font-display text-lg mb-1">{card.title}</h4>
          <p className="text-sm text-muted-foreground">{card.route}</p>
          <p className="text-xs text-muted-foreground mb-3">FBO: {card.fbo}</p>
          <div className="flex items-end justify-between mb-3">
            <span className="text-xs text-muted-foreground">Costo adicional</span>
            <span className="font-display text-2xl text-primary">+${card.price_usd.toLocaleString()} USD</span>
          </div>
          <ActionButton
            status={status}
            label={card.cta_label}
            onClick={() => run({ type: "jet", title: card.title, payload: { route: card.route, fbo: card.fbo, price_usd: card.price_usd } })}
            className="w-full gold-glow"
          />
        </div>
      </div>
    );
  }

  return null;
};

export default Concierge;
