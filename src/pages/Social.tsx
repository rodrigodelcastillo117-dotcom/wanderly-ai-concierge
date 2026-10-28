import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Users, Copy, Share2, Lock, Check, Trophy, Sparkles, ChevronRight, Plane, UserPlus, RefreshCw, Ban, X } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { PriveSeal } from "@/components/PriveSeal";
import { supabase } from "@/integrations/supabase/client";
import { fetchFriendProfiles } from "@/lib/friendProfiles";
import {
  blockUser, cancelFriendRequest, connectMessage, loadFriendRequests, respondFriendRequest, rotateInviteCode,
  sendFriendRequest, unblockUser, type FriendRequests,
} from "@/lib/friendRequests";
import { firstName, parseFriendSummaries, showAfinidad, summaryLine, type FriendSummary } from "@/lib/social";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityGrid } from "@/components/social/FriendActivity";
import { useFriendAvatars } from "@/hooks/useFriendAvatars";
import { loadFriendsFeed, type ActivityItem } from "@/lib/friendActivity";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";

type Amigo = {
  amigo_id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
};

type Badge = {
  id: string; nombre: string; descripcion: string | null; icono: string | null;
  meta_tipo: string | null; meta_valor: number | null;
};
type UserBadge = { badge_id: string; unlocked_at: string };
type Mision = {
  id: string; titulo: string; icono: string | null;
  progreso: number; meta: number; completada: boolean; recien_completada?: boolean;
};

const CompatRing = ({ score }: { score: number }) => {
  const r = 22, c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg viewBox="0 0 52 52" className="w-14 h-14 -rotate-90">
        <circle cx="26" cy="26" r={r} stroke="hsl(var(--border))" strokeWidth="3" fill="none" />
        <circle cx="26" cy="26" r={r} stroke="hsl(var(--primary))" strokeWidth="3" fill="none"
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          className="drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-primary">
        {score}%
      </div>
    </div>
  );
};

export default function Social() {
  const { user } = useAuth();
  const [params] = useSearchParams();



  const [myCode, setMyCode] = useState<string>("");
  const [codeInput, setCodeInput] = useState<string>(params.get("codigo")?.toUpperCase() ?? "");
  const [amigos, setAmigos] = useState<Amigo[]>([]);
  const [loadingAmigos, setLoadingAmigos] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [misiones, setMisiones] = useState<Mision[]>([]);
  const [loadingMisiones, setLoadingMisiones] = useState(true);
  const [resumen, setResumen] = useState<Map<string, FriendSummary>>(new Map());
  const [requests, setRequests] = useState<FriendRequests>({ recibidas: [], enviadas: [], bloqueados: [] });
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const navigate = useNavigate();
  const tipSocial = useTooltipShown("social");
  // "Lo que hacen tus amigos" (lo que cada quien decidió compartir) y avatares firmados.
  const [feed, setFeed] = useState<ActivityItem[] | null>(null);
  const friendIds = useMemo(() => amigos.map((a) => a.amigo_id), [amigos]);
  const signedAvatars = useFriendAvatars(friendIds);
  const avatarOf = (id: string, fallback: string | null) => signedAvatars.get(id) ?? fallback;
  const feedAvatars = useMemo(() => new Map(amigos.map((a) => [a.amigo_id, avatarOf(a.amigo_id, a.avatar_url)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [amigos, signedAvatars]);

  const shareLink = useMemo(
    () => myCode ? `${window.location.origin}/dashboard/social?codigo=${myCode}` : "",
    [myCode]
  );

  // Carga inicial
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles").select("invite_code").eq("id", user.id).maybeSingle();
      setMyCode(data?.invite_code ?? "");
    })();
    loadAmigos();
    loadRequests();
    loadGamification();
  }, [user]);

  async function loadRequests() {
    setRequests(await loadFriendRequests(supabase as never));
  }

  // Aceptar, rechazar o bloquear una solicitud recibida (la amistad solo existe si la aceptas).
  async function answerRequest(otro: string, action: "aceptar" | "rechazar" | "bloquear") {
    if (busyReq) return;
    setBusyReq(otro);
    const r = action === "bloquear" ? await blockUser(supabase as never, otro)
      : await respondFriendRequest(supabase as never, otro, action === "aceptar");
    setBusyReq(null);
    if (!r?.ok) { toast.error("No se pudo responder la solicitud. Intenta de nuevo."); return; }
    toast.success(action === "aceptar" ? "¡Ahora son amigos!" : action === "bloquear" ? "Bloqueaste a esta persona." : "Solicitud rechazada.");
    await loadRequests();
    if (action === "aceptar") { loadAmigos(); loadGamification(); }
  }

  async function cancelRequest(otro: string) {
    if (busyReq) return;
    setBusyReq(otro);
    const r = await cancelFriendRequest(supabase as never, otro);
    setBusyReq(null);
    if (!r?.ok) { toast.error("No se pudo cancelar la solicitud."); return; }
    await loadRequests();
  }

  async function unblock(otro: string) {
    if (busyReq) return;
    setBusyReq(otro);
    const r = await unblockUser(supabase as never, otro);
    setBusyReq(null);
    if (!r?.ok) { toast.error("No se pudo desbloquear."); return; }
    await loadRequests();
  }

  // Cambiar el código: el anterior (y el enlace que ya compartiste) deja de servir.
  async function rotateCode() {
    setRotating(true);
    const r = await rotateInviteCode(supabase as never);
    setRotating(false);
    setConfirmRotate(false);
    if (!r?.ok || !r.codigo) {
      toast.error(r?.error === "demasiados_intentos" ? "Ya cambiaste tu código varias veces hoy. Intenta mañana." : "No se pudo cambiar tu código.");
      return;
    }
    setMyCode(r.codigo);
    toast.success("Listo: tu código anterior ya no funciona.");
  }

  async function loadAmigos() {
    setLoadingAmigos(true);
    // Solo nombre, usuario y avatar de amistades aceptadas (RPC friend_profiles, F-10).
    const profs = await fetchFriendProfiles(supabase);
    if (profs.length === 0) { setAmigos([]); setLoadingAmigos(false); return; }
    const base: Amigo[] = profs.map((p) => ({
      amigo_id: p.id, full_name: p.full_name, avatar_url: p.avatar_url, username: p.username,
    }));
    setAmigos(base);
    setLoadingAmigos(false);
    // Viajes juntos, lo que tienen en común y saludos por devolver: una sola llamada (amigos_resumen).
    const { data } = await supabase.rpc("amigos_resumen");
    setResumen(parseFriendSummaries(data));
    const f = await loadFriendsFeed(supabase as never);
    setFeed(f.status === "ok" ? f.items : []);
  }

  async function loadGamification() {
    const { data: bdg } = await supabase.from("badges").select("*");
    setBadges((bdg ?? []) as any);
    const { data: ub } = await supabase.from("user_badges").select("badge_id");
    setUnlocked(new Set((ub ?? []).map((x: any) => x.badge_id)));

    const { data: ev, error } = await supabase.functions.invoke("evaluar-logros");
    if (error) { setLoadingMisiones(false); return; }
    const payload: any = ev;
    if (payload?.nuevas_medallas?.length) {
      payload.nuevas_medallas.forEach((m: any) =>
        toast.success(`🎉 ¡Desbloqueaste: ${m.nombre}!`, { description: m.descripcion ?? "" })
      );
      const { data: ub2 } = await supabase.from("user_badges").select("badge_id");
      setUnlocked(new Set((ub2 ?? []).map((x: any) => x.badge_id)));
    }
    setLoadingMisiones(false);
    if (payload?.misiones) {
      setMisiones(payload.misiones);
      payload.misiones.forEach((m: Mision) => {
        if (m.recien_completada) toast.success(`🎯 ¡Misión cumplida: ${m.titulo}!`);
      });
    }
  }

  async function handleConnect() {
    const codigo = codeInput.trim().toUpperCase();
    if (!codigo) { toast.error("Ingresa un código"); return; }
    setConnecting(true);
    // Manda una SOLICITUD: la otra persona la acepta o la rechaza (si ella ya te había pedido, quedan amigos).
    const r = await sendFriendRequest(supabase as never, codigo);
    setConnecting(false);
    const msg = connectMessage(r);
    if (!msg.ok) { toast.error(msg.text); return; }
    toast.success(msg.text);
    setCodeInput("");
    loadRequests();
    if (r?.estado === "amigos") { loadAmigos(); loadGamification(); }
  }

  // writeText es una promesa: sin permiso (o en http) falla y antes igual decía "copiado".
  const copy = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success(`${label} copiado`);
    } catch {
      toast.error(`No se pudo copiar. Mantén presionado el ${label.toLowerCase()} para copiarlo.`);
    }
  };

  return (
    <DashboardLayout>
      <FeatureTooltip id="social" icon="👥" text="Compara tu perfil de viajero con amigos, gana medallas, completa misiones de viajero." shouldShow={tipSocial.shouldShow} onDismiss={tipSocial.dismiss} />
      <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-6 md:space-y-8 animate-fade-up">
        <header className="flex items-center gap-3">
          <Users className="w-6 h-6 md:w-7 md:h-7 text-primary" />
          <div>
            <h1 className="font-display text-3xl md:text-5xl">Social</h1>
            <p className="text-muted-foreground text-xs md:text-sm">Conecta, compite y descubre con tu tribu.</p>
          </div>
        </header>

        <Tabs defaultValue="amigos" className="w-full">
          <TabsList className="grid grid-cols-3 w-full max-w-2xl bg-card/40 backdrop-blur-md border border-white/[0.04] h-10 md:h-11">
            <TabsTrigger value="amigos" className="text-[10px] md:text-sm px-1 md:px-3">Amigos</TabsTrigger>
            <TabsTrigger value="logros" className="text-[10px] md:text-sm px-1 md:px-3">Logros</TabsTrigger>
            <TabsTrigger value="conectar" className="text-[10px] md:text-sm px-1 md:px-3">Conectar</TabsTrigger>
          </TabsList>






          {/* AMIGOS */}
          <TabsContent value="amigos" className="mt-4 md:mt-6 space-y-3">
            {requests.recibidas.length > 0 && (
              <section aria-labelledby="solicitudes-title" className="glass-card rounded-2xl p-3 md:p-4 border border-primary/25 space-y-3">
                <h2 id="solicitudes-title" className="text-sm font-medium flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" aria-hidden="true" /> Solicitudes de amistad
                </h2>
                <p className="text-[11px] text-muted-foreground">Solo si aceptas podrá ver tu perfil de viajero, tus lugares y saludarte.</p>
                {requests.recibidas.map((q) => {
                  const nombre = q.full_name ?? q.username ?? "Viajero";
                  return (
                    <div key={q.id} className="flex flex-wrap items-center gap-3" data-testid="friend-request">
                      <FriendAvatar name={nombre} url={q.avatar_url} className="w-10 h-10 text-sm" />
                      <p className="flex-1 min-w-0 text-sm truncate">{nombre}</p>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busyReq === q.id} onClick={() => answerRequest(q.id, "aceptar")}
                          className="bg-gradient-gold text-primary-foreground hover:opacity-90 text-xs">Aceptar</Button>
                        <Button size="sm" variant="outline" disabled={busyReq === q.id} onClick={() => answerRequest(q.id, "rechazar")}
                          className="text-xs">Rechazar</Button>
                        <Button size="sm" variant="ghost" disabled={busyReq === q.id} onClick={() => answerRequest(q.id, "bloquear")}
                          aria-label={`Bloquear a ${nombre}`} className="text-xs text-muted-foreground hover:text-destructive">
                          <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
            {requests.enviadas.length > 0 && (
              <section aria-label="Solicitudes enviadas" className="rounded-2xl p-3 md:p-4 border border-white/[0.06] space-y-2">
                <p className="text-xs text-muted-foreground">
                  {requests.enviadas.length === 1 ? "1 solicitud enviada" : `${requests.enviadas.length} solicitudes enviadas`} · esperando respuesta
                </p>
                {requests.enviadas.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex-1">Enviada el {new Date(q.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                    <Button size="sm" variant="ghost" disabled={busyReq === q.id} onClick={() => cancelRequest(q.id)} className="text-xs h-7">
                      <X className="w-3 h-3 mr-1" aria-hidden="true" /> Cancelar
                    </Button>
                  </div>
                ))}
              </section>
            )}
            {loadingAmigos ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="h-20 rounded-2xl bg-card/40 border border-white/[0.04] animate-pulse" />
              ))
            ) : amigos.length === 0 ? (
              <div className="glass-card rounded-3xl p-8 md:p-12 text-center border border-primary/10">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-4 opacity-70" />
                <p className="font-display text-xl md:text-2xl mb-2">Aún no conectas con nadie</p>
                <p className="text-muted-foreground text-sm">Invita a tu primer compañero de viaje desde "Conectar".</p>
              </div>
            ) : (
              amigos.map((a) => {
                const r = resumen.get(a.amigo_id);
                const nombre = a.full_name ?? a.username ?? "Viajero";
                const open = () => navigate(`/dashboard/social/amigo/${a.amigo_id}`);
                return (
                  // Toda la tarjeta abre el perfil con el mouse o el dedo; con teclado, el botón "Ver".
                  <div key={a.amigo_id} onClick={open}
                    className="group cursor-pointer glass-card rounded-2xl p-3 md:p-4 flex items-center gap-3 md:gap-4 border border-white/[0.04] hover:border-primary/25 transition">
                    <div className="relative">
                      <FriendAvatar name={nombre} url={avatarOf(a.amigo_id, a.avatar_url)} className="w-12 h-12 md:w-14 md:h-14 text-base md:text-lg" />
                      {r?.saludo_por_devolver && (
                        <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-[11px] flex items-center justify-center shadow ring-2 ring-background" aria-label="Te mandó un saludo">👋</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm md:text-base flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{nombre}</span>
                        {r?.is_prive && <PriveSeal size="sm" />}
                      </p>
                      <p className={`text-[11px] md:text-xs truncate ${r?.saludo_por_devolver ? "text-primary" : "text-muted-foreground"}`}>
                        {summaryLine(r, firstName(a))}
                      </p>
                    </div>
                    {r && r.viajes_juntos > 0 && (
                      <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary" title="Viajes juntos">
                        <Plane className="w-3 h-3" /> {r.viajes_juntos}
                      </span>
                    )}
                    {r && showAfinidad(r.afinidad) && <div className="hidden sm:block"><CompatRing score={r.afinidad} /></div>}
                    <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10 text-xs md:text-sm px-2 md:px-3"
                      aria-label={`Ver perfil de ${nombre}`}
                      onClick={(e) => { e.stopPropagation(); open(); }}>
                      Ver <ChevronRight className="w-3.5 h-3.5 ml-0.5 transition group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                );
              })
            )}
            {!loadingAmigos && amigos.length > 0 && (
              <section aria-labelledby="feed-amigos" className="pt-4 md:pt-6 space-y-3" data-testid="friends-feed">
                <div>
                  <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1">Actividad</p>
                  <h2 id="feed-amigos" className="font-display text-2xl md:text-3xl">Lo que hacen tus amigos</h2>
                </div>
                {feed === null ? (
                  <div className="h-40 rounded-2xl bg-card/40 border border-white/[0.04] animate-pulse" />
                ) : feed.length === 0 ? (
                  <div className="glass-card rounded-2xl p-5 border border-white/[0.04]">
                    <p className="text-sm">Aún no hay actividad compartida.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Cuando tus amigos prendan «Qué ven mis amigos», aquí verás a dónde fueron, qué reservaron y qué recomiendan.
                      <Link to="/dashboard/perfil#que-ven-mis-amigos" className="text-primary hover:underline ml-1">Comparte lo tuyo</Link>
                    </p>
                  </div>
                ) : (
                  <ActivityGrid items={feed} avatars={feedAvatars}
                    onChange={(n) => setFeed((xs) => (xs ?? []).map((x) => (x.clave === n.clave && x.amigo?.id === n.amigo?.id ? n : x)))} />
                )}
              </section>
            )}
          </TabsContent>

          {/* CONECTAR */}
          <TabsContent value="conectar" className="mt-4 md:mt-6 space-y-4 md:space-y-6">
            <div className="glass-card rounded-3xl p-6 md:p-8 border border-primary/20 text-center">
              <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] md:tracking-[0.3em] uppercase mb-2 md:mb-3">Tu código de invitación</p>
              <p className="font-display text-3xl sm:text-5xl md:text-6xl tracking-[0.3em] md:tracking-[0.4em] gold-text mb-4 md:mb-6 select-all">
                {myCode || "—"}
              </p>
              <div className="flex flex-wrap justify-center gap-2 md:gap-3">
                <Button onClick={() => copy(myCode, "Código")} disabled={!myCode}
                  className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow text-xs md:text-sm">
                  <Copy className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" /> Copiar
                </Button>
                <Button variant="outline" onClick={() => copy(shareLink, "Link")} disabled={!shareLink}
                  className="border-primary/30 text-primary hover:bg-primary/10 text-xs md:text-sm">
                  <Share2 className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" /> Compartir
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-4">
                Quien use tu código o tu enlace te manda una solicitud: tú decides si la aceptas.
              </p>
              {confirmRotate ? (
                <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2 text-xs">
                  <span className="text-muted-foreground">Tu código y tu enlace actuales dejarán de funcionar.</span>
                  <Button size="sm" variant="destructive" disabled={rotating} onClick={rotateCode} className="text-xs">
                    {rotating ? "Cambiando…" : "Sí, cambiar mi código"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={rotating} onClick={() => setConfirmRotate(false)} className="text-xs">Cancelar</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" disabled={!myCode} onClick={() => setConfirmRotate(true)}
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Cambiar mi código
                </Button>
              )}
            </div>

            <div className="glass-card rounded-3xl p-6 md:p-8 border border-white/[0.04]">
              <p className="font-display text-xl md:text-2xl mb-3 md:mb-4">Conecta con un amigo</p>
              <p className="text-xs md:text-sm text-muted-foreground mb-3 md:mb-4">Pega su código de 8 caracteres.</p>
              <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                <Input
                  aria-label="Código de tu amigo"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="EJ. A3K9PQ7M"
                  maxLength={8}
                  className="tracking-[0.2em] md:tracking-[0.3em] text-center font-mono uppercase bg-background/40 text-sm md:text-base h-10 md:h-11"
                />
                <Button onClick={handleConnect} disabled={connecting || !codeInput.trim()}
                  className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-10 md:h-11 text-sm md:text-base">
                  {connecting ? "Enviando…" : "Mandar solicitud"}
                </Button>
              </div>
            </div>

            {requests.bloqueados.length > 0 && (
              <div className="glass-card rounded-3xl p-6 md:p-8 border border-white/[0.04] space-y-3">
                <p className="font-display text-lg md:text-xl">Personas bloqueadas</p>
                <p className="text-xs text-muted-foreground">No pueden mandarte solicitudes ni invitarte a viajes.</p>
                {requests.bloqueados.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{b.nombre}</span>
                    <Button size="sm" variant="outline" disabled={busyReq === b.id} onClick={() => unblock(b.id)} className="text-xs">Desbloquear</Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* LOGROS — Medallas + Misiones */}
          <TabsContent value="logros" className="mt-4 md:mt-6 space-y-6 md:space-y-8">
            {/* Medallas */}
            <div>
              <div className="flex items-center gap-2 mb-3 md:mb-4 text-xs md:text-sm text-muted-foreground">
                <Trophy className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                <span className="font-medium text-foreground">Medallas</span>
                <span>· {unlocked.size} de {badges.length} desbloqueadas</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 md:gap-3">
                {badges.map((b) => {
                  const has = unlocked.has(b.id);
                  return (
                    <div key={b.id}
                      className={`rounded-2xl p-3 md:p-5 text-center border transition ${
                        has
                          ? "glass-card border-primary/30 gold-glow"
                          : "bg-card/30 border-white/[0.04] opacity-50"
                      }`}>
                      <div className="text-2xl md:text-4xl mb-1.5 md:mb-2 relative">
                        {has ? (b.icono ?? "🏅") : <Lock className="w-5 h-5 md:w-7 md:h-7 mx-auto text-muted-foreground" />}
                      </div>
                      <p className={`font-medium text-xs md:text-sm mb-0.5 md:mb-1 ${has ? "gold-text" : ""}`}>{b.nombre}</p>
                      <p className="text-[10px] md:text-[11px] text-muted-foreground leading-snug">{b.descripcion}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Misiones */}
            <div>
              <div className="flex items-center gap-2 mb-3 md:mb-4 text-xs md:text-sm text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
                <span className="font-medium text-foreground">Misiones activas</span>
              </div>
              <div className="space-y-2 md:space-y-3">
                {loadingMisiones ? (
                  <div className="glass-card rounded-2xl p-6 md:p-8 text-center text-muted-foreground text-sm">
                    Cargando misiones…
                  </div>
                ) : misiones.length === 0 ? (
                  <div className="glass-card rounded-2xl p-6 md:p-8 text-center text-muted-foreground text-sm">
                    Aún no tienes misiones activas. Sigue usando IATOS para desbloquearlas.
                  </div>
                ) : (
                  misiones.map((m) => {
                    const pct = m.meta > 0 ? Math.min(100, (m.progreso / m.meta) * 100) : 0;
                    return (
                      <div key={m.id}
                        className={`glass-card rounded-2xl p-4 md:p-5 border ${
                          m.completada ? "border-primary/30 opacity-80" : "border-white/[0.04]"
                        }`}>
                        <div className="flex items-center gap-2.5 md:gap-3 mb-2 md:mb-3">
                          <span className="text-xl md:text-2xl">{m.icono ?? "🎯"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm md:text-base truncate">{m.titulo}</p>
                            <p className="text-[11px] md:text-xs text-muted-foreground">{m.progreso} / {m.meta}</p>
                          </div>
                          {m.completada && (
                            <span className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-gradient-gold flex items-center justify-center shrink-0">
                              <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary-foreground" />
                            </span>
                          )}
                        </div>
                        <div className="h-1.5 md:h-2 rounded-full bg-background/60 overflow-hidden">
                          <div className="h-full bg-gradient-gold transition-all duration-700"
                            style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>


    </DashboardLayout>
  );
}
