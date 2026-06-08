import { useEffect, useState } from "react";
import { Crown, Sparkles, RefreshCw, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Perfil = {
  resumen?: string;
  rasgos?: string[];
  motivaciones?: string[];
  evitar?: string[];
  destinos_sugeridos?: string[];
  estilo_dominante?: string;
  divergencias_detectadas?: string[];
  confianza?: number;
};

export const TravelerAvatar = ({ compact = false }: { compact?: boolean }) => {
  const { user } = useAuth();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [nombre, setNombre] = useState<string>("Viajero");
  const [version, setVersion] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [evolving, setEvolving] = useState(false);
  const [open, setOpen] = useState(false);

  const cargar = async () => {
    if (!user) return;
    const [{ data: prefs }, { data: tp }, { data: prof }] = await Promise.all([
      supabase.from("ai_user_preferences").select("perfil_ia, dna_version").eq("user_id", user.id).maybeSingle(),
      supabase.from("travel_profiles").select("perfil_ia").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("full_name, avatar_url").eq("id", user.id).maybeSingle(),
    ]);
    setPerfil((prefs?.perfil_ia as Perfil) ?? (tp?.perfil_ia as Perfil) ?? null);
    setVersion((prefs?.dna_version as number) ?? null);
    if (prof?.full_name) setNombre(prof.full_name.split(" ")[0]);
    setAvatarUrl((prof as any)?.avatar_url ?? null);
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [user]);

  const evolucionar = async () => {
    setEvolving(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolucionar-dna", { body: {} });
      if (error) throw error;
      if (data?.dna) {
        setPerfil(data.dna);
        setVersion(data.version ?? null);
        toast.success("Avatar evolucionado con tus últimos viajes");
        setOpen(true);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo evolucionar tu avatar");
    } finally {
      setEvolving(false);
    }
  };

  const inicial = nombre.charAt(0).toUpperCase();
  const estilo = perfil?.estilo_dominante ?? "Perfil en construcción";
  const resumen = perfil?.resumen ?? "Aún no tengo suficientes señales. Crea o termina un viaje y evolucionaré tu avatar automáticamente.";
  const conf = typeof perfil?.confianza === "number" ? Math.round(perfil!.confianza! * 100) : null;

  const AvatarCircle = ({ size = "md" }: { size?: "sm" | "md" }) => (
    <div className="relative shrink-0">
      <div className={`${size === "sm" ? "w-9 h-9" : "w-16 h-16 md:w-20 md:h-20"} rounded-full bg-gradient-gold flex items-center justify-center shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.6)] overflow-hidden`}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={nombre} className="w-full h-full object-cover" />
        ) : (
          <span className={`font-display ${size === "sm" ? "text-sm" : "text-2xl md:text-3xl"} text-primary-foreground`}>{inicial}</span>
        )}
      </div>
      <div className={`absolute -top-0.5 -right-0.5 ${size === "sm" ? "w-3.5 h-3.5" : "w-6 h-6"} rounded-full bg-background border border-primary flex items-center justify-center`}>
        <Crown className={size === "sm" ? "w-2 h-2 text-primary" : "w-3 h-3 text-primary"} />
      </div>
    </div>
  );

  const DetailPanel = () =>
    perfil ? (
      <div className="mt-4 pt-4 border-t border-border grid gap-3 text-xs md:text-sm">
        {!!perfil.rasgos?.length && (
          <div>
            <p className="text-[10px] tracking-[0.25em] text-primary uppercase mb-1.5">Rasgos</p>
            <div className="flex flex-wrap gap-1.5">
              {perfil.rasgos.map((r, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px]">{r}</span>
              ))}
            </div>
          </div>
        )}
        {!!perfil.motivaciones?.length && (
          <div>
            <p className="text-[10px] tracking-[0.25em] text-primary uppercase mb-1.5">Motivaciones</p>
            <p className="text-muted-foreground">{perfil.motivaciones.join(" · ")}</p>
          </div>
        )}
        {!!perfil.destinos_sugeridos?.length && (
          <div>
            <p className="text-[10px] tracking-[0.25em] text-primary uppercase mb-1.5">Próximos destinos para ti</p>
            <p className="text-muted-foreground">{perfil.destinos_sugeridos.join(" · ")}</p>
          </div>
        )}
        {!!perfil.evitar?.length && (
          <div>
            <p className="text-[10px] tracking-[0.25em] text-primary uppercase mb-1.5">Evitar</p>
            <p className="text-muted-foreground">{perfil.evitar.join(" · ")}</p>
          </div>
        )}
        {!!perfil.divergencias_detectadas?.length && (
          <div>
            <p className="text-[10px] tracking-[0.25em] text-primary uppercase mb-1.5">Cómo has evolucionado</p>
            <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
              {perfil.divergencias_detectadas.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>
    ) : null;

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 px-2 py-1 rounded-full border border-primary/30 bg-white/5 hover:bg-primary/10 transition"
          title={`${nombre} — ${estilo}`}
        >
          <AvatarCircle size="sm" />
          <span className="hidden sm:flex flex-col items-start leading-tight pr-2">
            <span className="text-xs font-medium text-foreground">{nombre}</span>
            <span className="text-[9px] text-primary/80 uppercase tracking-wider">
              {estilo}{version != null ? ` · v${version}` : ""}
            </span>
          </span>
          <ChevronDown className={`w-3 h-3 text-primary/70 transition ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 mt-2 w-[340px] md:w-[420px] z-50 glass-card rounded-2xl p-4 border border-primary/20 shadow-2xl">
              <div className="flex items-start gap-3">
                <AvatarCircle size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> Tu avatar de viajero
                    {version != null && <span className="text-[9px] text-muted-foreground tracking-normal normal-case">· v{version}</span>}
                    {conf != null && <span className="text-[9px] text-muted-foreground tracking-normal normal-case">· {conf}%</span>}
                  </p>
                  <h3 className="font-display text-base leading-tight mb-1">
                    {nombre} <span className="italic gold-text font-light">— {estilo}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{resumen}</p>
                  <div className="mt-3">
                    <button
                      onClick={evolucionar}
                      disabled={evolving}
                      className="text-[11px] px-3 py-1 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${evolving ? "animate-spin" : ""}`} />
                      {evolving ? "Evolucionando…" : "Evolucionar avatar"}
                    </button>
                  </div>
                </div>
              </div>
              <DetailPanel />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="glass-card rounded-3xl p-4 md:p-6 mb-4 border border-primary/20">
      <div className="flex items-start gap-4">
        <AvatarCircle />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-2">
            <Sparkles className="w-3 h-3" /> CONCIERGE PRO · Tu avatar de viajero
            {version != null && <span className="text-[9px] text-muted-foreground tracking-normal normal-case">· v{version}</span>}
            {conf != null && <span className="text-[9px] text-muted-foreground tracking-normal normal-case">· {conf}% confianza</span>}
          </p>
          <h2 className="font-display text-lg md:text-xl leading-tight mb-1">
            {nombre} <span className="italic gold-text font-light">— {estilo}</span>
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground leading-relaxed line-clamp-2">{resumen}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={() => setOpen(o => !o)}
              className="text-[11px] text-primary/80 hover:text-primary flex items-center gap-1"
            >
              {open ? "Ocultar perfil" : "Ver perfil completo"}
              <ChevronDown className={`w-3 h-3 transition ${open ? "rotate-180" : ""}`} />
            </button>
            <button
              onClick={evolucionar}
              disabled={evolving}
              className="text-[11px] px-3 py-1 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${evolving ? "animate-spin" : ""}`} />
              {evolving ? "Evolucionando…" : "Evolucionar avatar"}
            </button>
          </div>
        </div>
      </div>
      {open && <DetailPanel />}
    </section>
  );
};
