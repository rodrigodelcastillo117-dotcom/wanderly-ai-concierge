import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Users, Copy, Share2, Lock, Check, Trophy, Target, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Amigo = {
  amigo_id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  compat?: { score: number; detalles: string[] } | null;
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
  const [perfilOpen, setPerfilOpen] = useState<Amigo | null>(null);

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
    loadGamification();
  }, [user]);

  async function loadAmigos() {
    setLoadingAmigos(true);
    const { data: rows } = await supabase.from("mis_amigos").select("amigo_id");
    const ids = (rows ?? []).map((r: any) => r.amigo_id);
    if (ids.length === 0) { setAmigos([]); setLoadingAmigos(false); return; }
    const { data: profs } = await supabase
      .from("profiles").select("id, full_name, avatar_url, username").in("id", ids);
    const base: Amigo[] = (profs ?? []).map((p: any) => ({
      amigo_id: p.id, full_name: p.full_name, avatar_url: p.avatar_url, username: p.username, compat: null,
    }));
    setAmigos(base);
    setLoadingAmigos(false);
    // compat en paralelo
    base.forEach(async (a) => {
      const { data } = await supabase.rpc("compatibilidad_viaje", { p_otro: a.amigo_id });
      const r: any = data;
      if (r?.ok) {
        setAmigos((prev) => prev.map((x) =>
          x.amigo_id === a.amigo_id ? { ...x, compat: { score: r.score ?? 0, detalles: r.detalles ?? [] } } : x
        ));
      }
    });
  }

  async function loadGamification() {
    const { data: bdg } = await supabase.from("badges").select("*");
    setBadges((bdg ?? []) as any);
    const { data: ub } = await supabase.from("user_badges").select("badge_id");
    setUnlocked(new Set((ub ?? []).map((x: any) => x.badge_id)));

    const { data: ev, error } = await supabase.functions.invoke("evaluar-logros");
    if (error) return;
    const payload: any = ev;
    if (payload?.nuevas_medallas?.length) {
      payload.nuevas_medallas.forEach((m: any) =>
        toast.success(`🎉 ¡Desbloqueaste: ${m.nombre}!`, { description: m.descripcion ?? "" })
      );
      const { data: ub2 } = await supabase.from("user_badges").select("badge_id");
      setUnlocked(new Set((ub2 ?? []).map((x: any) => x.badge_id)));
    }
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
    const { data, error } = await supabase.rpc("agregar_amigo_por_codigo", { p_codigo: codigo });
    setConnecting(false);
    if (error) { toast.error("No se pudo conectar"); return; }
    const r: any = data;
    if (r?.ok) {
      toast.success("¡Conectados!");
      setCodeInput("");
      loadAmigos();
      loadGamification();
    } else {
      const msgs: Record<string, string> = {
        codigo_invalido: "Código inválido",
        es_tu_propio_codigo: "Ese es tu propio código",
        no_autenticado: "Inicia sesión primero",
      };
      toast.error(msgs[r?.error] ?? "No se pudo conectar");
    }
  }

  const copy = (txt: string, label: string) => {
    navigator.clipboard.writeText(txt);
    toast.success(`${label} copiado`);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-6 md:space-y-8 animate-fade-up">
        <header className="flex items-center gap-3">
          <Users className="w-6 h-6 md:w-7 md:h-7 text-primary" />
          <div>
            <h1 className="font-display text-3xl md:text-5xl">Social</h1>
            <p className="text-muted-foreground text-xs md:text-sm">Conecta, compite y descubre con tu tribu.</p>
          </div>
        </header>

        <Tabs defaultValue="amigos" className="w-full">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl bg-card/40 backdrop-blur-md border border-white/[0.04] h-10 md:h-11">
            <TabsTrigger value="amigos" className="text-[10px] md:text-sm px-1 md:px-3">Amigos</TabsTrigger>
            <TabsTrigger value="conectar" className="text-[10px] md:text-sm px-1 md:px-3">Conectar</TabsTrigger>
            <TabsTrigger value="medallas" className="text-[10px] md:text-sm px-1 md:px-3">Medallas</TabsTrigger>
            <TabsTrigger value="misiones" className="text-[10px] md:text-sm px-1 md:px-3">Misiones</TabsTrigger>
          </TabsList>

          {/* AMIGOS */}
          <TabsContent value="amigos" className="mt-6 space-y-3">
            {loadingAmigos ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="h-20 rounded-2xl bg-card/40 border border-white/[0.04] animate-pulse" />
              ))
            ) : amigos.length === 0 ? (
              <div className="glass-card rounded-3xl p-12 text-center border border-primary/10">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-4 opacity-70" />
                <p className="font-display text-2xl mb-2">Aún no conectas con nadie</p>
                <p className="text-muted-foreground text-sm">Invita a tu primer compañero de viaje desde la pestaña "Conectar".</p>
              </div>
            ) : (
              amigos.map((a) => (
                <div key={a.amigo_id}
                  className="glass-card rounded-2xl p-4 flex items-center gap-4 border border-white/[0.04] hover:border-primary/20 transition">
                  <div className="w-12 h-12 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-medium shrink-0 overflow-hidden">
                    {a.avatar_url
                      ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" />
                      : (a.full_name?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.full_name ?? a.username ?? "Viajero"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {a.compat?.detalles?.[0] ?? (a.compat ? "Sin coincidencias aún" : "Calculando compatibilidad…")}
                    </p>
                  </div>
                  {a.compat && <CompatRing score={a.compat.score} />}
                  <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10"
                    onClick={() => setPerfilOpen(a)}>
                    Ver perfil
                  </Button>
                </div>
              ))
            )}
          </TabsContent>

          {/* CONECTAR */}
          <TabsContent value="conectar" className="mt-6 space-y-6">
            <div className="glass-card rounded-3xl p-8 border border-primary/20 text-center">
              <p className="text-xs text-primary tracking-[0.3em] uppercase mb-3">Tu código de invitación</p>
              <p className="font-display text-5xl md:text-6xl tracking-[0.4em] gold-text mb-6 select-all">
                {myCode || "—"}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button onClick={() => copy(myCode, "Código")} disabled={!myCode}
                  className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
                  <Copy className="w-4 h-4 mr-2" /> Copiar mi código
                </Button>
                <Button variant="outline" onClick={() => copy(shareLink, "Link")} disabled={!shareLink}
                  className="border-primary/30 text-primary hover:bg-primary/10">
                  <Share2 className="w-4 h-4 mr-2" /> Compartir link
                </Button>
              </div>
            </div>

            <div className="glass-card rounded-3xl p-8 border border-white/[0.04]">
              <p className="font-display text-2xl mb-4">Conecta con un amigo</p>
              <p className="text-sm text-muted-foreground mb-4">Pega su código de 8 caracteres.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="EJ. A3K9PQ7M"
                  maxLength={8}
                  className="tracking-[0.3em] text-center font-mono uppercase bg-background/40"
                />
                <Button onClick={handleConnect} disabled={connecting || !codeInput.trim()}
                  className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
                  {connecting ? "Conectando…" : "Conectar"}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* MEDALLAS */}
          <TabsContent value="medallas" className="mt-6">
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <Trophy className="w-4 h-4 text-primary" />
              {unlocked.size} de {badges.length} desbloqueadas
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {badges.map((b) => {
                const has = unlocked.has(b.id);
                return (
                  <div key={b.id}
                    className={`rounded-2xl p-5 text-center border transition ${
                      has
                        ? "glass-card border-primary/30 gold-glow"
                        : "bg-card/30 border-white/[0.04] opacity-50"
                    }`}>
                    <div className="text-4xl mb-2 relative">
                      {has ? (b.icono ?? "🏅") : <Lock className="w-7 h-7 mx-auto text-muted-foreground" />}
                    </div>
                    <p className={`font-medium text-sm mb-1 ${has ? "gold-text" : ""}`}>{b.nombre}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{b.descripcion}</p>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* MISIONES */}
          <TabsContent value="misiones" className="mt-6 space-y-3">
            {misiones.length === 0 ? (
              <div className="glass-card rounded-2xl p-8 text-center text-muted-foreground text-sm">
                Cargando misiones…
              </div>
            ) : (
              misiones.map((m) => {
                const pct = m.meta > 0 ? Math.min(100, (m.progreso / m.meta) * 100) : 0;
                return (
                  <div key={m.id}
                    className={`glass-card rounded-2xl p-5 border ${
                      m.completada ? "border-primary/30 opacity-80" : "border-white/[0.04]"
                    }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{m.icono ?? "🎯"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{m.titulo}</p>
                        <p className="text-xs text-muted-foreground">{m.progreso} / {m.meta}</p>
                      </div>
                      {m.completada && (
                        <span className="w-7 h-7 rounded-full bg-gradient-gold flex items-center justify-center">
                          <Check className="w-4 h-4 text-primary-foreground" />
                        </span>
                      )}
                    </div>
                    <div className="h-2 rounded-full bg-background/60 overflow-hidden">
                      <div className="h-full bg-gradient-gold transition-all duration-700"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!perfilOpen} onOpenChange={(o) => !o && setPerfilOpen(null)}>
        <DialogContent className="bg-card border-primary/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground overflow-hidden">
                {perfilOpen?.avatar_url
                  ? <img src={perfilOpen.avatar_url} alt="" className="w-full h-full object-cover" />
                  : (perfilOpen?.full_name?.[0] ?? "?").toUpperCase()}
              </div>
              {perfilOpen?.full_name ?? perfilOpen?.username ?? "Viajero"}
            </DialogTitle>
          </DialogHeader>
          {perfilOpen?.compat && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <CompatRing score={perfilOpen.compat.score} />
                <div>
                  <p className="font-medium gold-text">{perfilOpen.compat.score}% compatibles</p>
                  <p className="text-xs text-muted-foreground">Basado en tu perfil de viaje</p>
                </div>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                {perfilOpen.compat.detalles.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
