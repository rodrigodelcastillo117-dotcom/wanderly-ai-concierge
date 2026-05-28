import { useEffect, useMemo, useState } from "react";
import { Sparkles, MapPin, Wand2, Camera, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CULTURE_PROFILES, detectCulture, PERSONALITY_LABELS } from "@/lib/cultureProfiles";
import type { DNAResult } from "./TravelDNAStats";

type Props = { dna: DNAResult | null };

type LastTrip = { destino: string | null; pais_destino: string | null };

export const TravelAvatarCinematic = ({ dna }: Props) => {
  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarMeta, setAvatarMeta] = useState<any>(null);
  const [lastTrip, setLastTrip] = useState<LastTrip | null>(null);
  const [tripsTimeline, setTripsTimeline] = useState<Array<{ destino: string; pais: string | null }>>([]);

  // Load avatar + last trip
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: prefs }, { data: trips }] = await Promise.all([
        supabase.from("ai_user_preferences").select("perfil_ia").eq("user_id", user.id).maybeSingle(),
        supabase.from("trips").select("destino, pais_destino").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6),
      ]);
      if (cancelled) return;
      const p: any = prefs?.perfil_ia ?? {};
      setAvatarUrl(p.avatar_url ?? null);
      setAvatarMeta(p.avatar_meta ?? null);
      const t = trips?.[0] ?? null;
      setLastTrip(t ? { destino: t.destino, pais_destino: (t as any).pais_destino ?? null } : null);
      setTripsTimeline((trips ?? []).map((x: any) => ({ destino: x.destino, pais: x.pais_destino })));
    })();
    return () => { cancelled = true; };
  }, [user]);

  const culture = useMemo(
    () => detectCulture(lastTrip?.destino, lastTrip?.pais_destino),
    [lastTrip],
  );

  const dominant = dna?.dominant ?? "luxury";
  const personality = PERSONALITY_LABELS[dominant] ?? PERSONALITY_LABELS.luxury;

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-avatar", {
        body: { style: dominant, destino: lastTrip?.destino ?? null },
      });
      if (error) throw error;
      if (data?.url) {
        setAvatarUrl(data.url);
        setAvatarMeta(data.meta);
        toast.success("Tu avatar ha evolucionado");
      } else {
        throw new Error(data?.error ?? "No se generó la imagen");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar el avatar");
    } finally {
      setGenerating(false);
    }
  };

  const bg = `radial-gradient(ellipse at 30% 20%, ${culture.palette.accent}33 0%, transparent 50%),
              radial-gradient(ellipse at 70% 80%, ${culture.palette.via} 0%, transparent 60%),
              linear-gradient(160deg, ${culture.palette.from} 0%, ${culture.palette.via} 50%, ${culture.palette.to} 100%)`;

  return (
    <div className="relative rounded-3xl overflow-hidden border border-primary/20 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
      {/* Cinematic background */}
      <div className="absolute inset-0" style={{ background: bg }} />

      {/* Animated aura rings */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] aspect-square rounded-full opacity-40 animate-[spin_40s_linear_infinite]"
          style={{ background: `conic-gradient(from 0deg, transparent, ${culture.palette.accent}40, transparent, ${culture.palette.accent}20, transparent)` }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] aspect-square rounded-full border opacity-30 animate-[pulse_4s_ease-in-out_infinite]"
          style={{ borderColor: culture.palette.accent }}
        />
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: culture.palette.accent }} />
          <span className="text-[10px] tracking-[0.3em] uppercase" style={{ color: culture.palette.accent }}>
            {culture.label}
          </span>
        </div>
        {avatarMeta?.version && (
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 text-[10px] tracking-[0.25em] uppercase text-foreground/80">
            Evolución v{avatarMeta.version}
          </div>
        )}
      </div>

      {/* Avatar canvas */}
      <div className="relative z-10 h-[420px] md:h-[540px] flex items-end justify-center pt-4">
        {avatarUrl ? (
          <div className="relative w-[280px] md:w-[340px] aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_30px_60px_-15px_rgba(0,0,0,0.9)] border border-white/10">
            <img
              src={avatarUrl}
              alt="Tu Travel Avatar"
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {/* Cinematic vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />
            {/* Cultural accent emojis */}
            <div className="absolute bottom-3 left-3 flex gap-2 text-2xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {culture.emojis.map((e, i) => <span key={i}>{e}</span>)}
            </div>
          </div>
        ) : (
          <EmptyAvatar accent={culture.palette.accent} emojis={culture.emojis} />
        )}
      </div>

      {/* Bottom info */}
      <div className="relative z-10 px-5 pb-5 pt-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: culture.palette.accent }}>
              {personality.tag}
            </p>
            <h3 className="font-display text-2xl md:text-3xl leading-tight">{personality.label}</h3>
            {lastTrip?.destino && (
              <p className="text-xs text-foreground/70 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Inspirado en {lastTrip.destino}
              </p>
            )}
          </div>

          <button
            onClick={generate}
            disabled={generating}
            className="group relative px-5 py-2.5 rounded-full border text-xs tracking-[0.15em] uppercase font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
            style={{
              borderColor: culture.palette.accent,
              color: culture.palette.accent,
              background: `linear-gradient(135deg, ${culture.palette.accent}15, transparent)`,
            }}
          >
            <span className="relative z-10 flex items-center gap-2">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {generating ? "Evolucionando..." : avatarUrl ? "Re-generar" : "Generar avatar"}
            </span>
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(135deg, ${culture.palette.accent}30, transparent)` }} />
          </button>
        </div>

        {/* Timeline */}
        {tripsTimeline.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/10">
            <p className="text-[9px] tracking-[0.3em] uppercase text-foreground/50 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Evolución
            </p>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {tripsTimeline.slice().reverse().map((t, i) => {
                const c = detectCulture(t.destino, t.pais);
                const isLast = i === tripsTimeline.length - 1;
                return (
                  <div
                    key={i}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] border ${isLast ? "ring-1" : ""}`}
                    style={{
                      borderColor: `${c.palette.accent}50`,
                      color: c.palette.accent,
                      background: `${c.palette.accent}10`,
                    }}
                    title={t.destino}
                  >
                    {t.destino?.split(",")[0]?.slice(0, 14)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyAvatar = ({ accent, emojis }: { accent: string; emojis: string[] }) => (
  <div className="relative w-[280px] md:w-[340px] aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 flex flex-col items-center justify-center backdrop-blur-sm" style={{ background: `linear-gradient(180deg, ${accent}10, transparent)` }}>
    <div className="relative">
      <div
        className="w-32 h-32 rounded-full flex items-center justify-center"
        style={{ background: `radial-gradient(circle, ${accent}40 0%, transparent 70%)` }}
      >
        <Camera className="w-12 h-12" style={{ color: accent }} />
      </div>
    </div>
    <p className="mt-6 text-xs tracking-[0.25em] uppercase text-center px-6" style={{ color: accent }}>
      Tu identidad de viaje<br />aún no se ha materializado
    </p>
    <p className="mt-2 text-[10px] text-foreground/50 text-center px-6">
      Pulsa <span style={{ color: accent }}>Generar avatar</span> para crear tu primera evolución
    </p>
    <div className="mt-4 flex gap-2 text-xl opacity-60">
      {emojis.map((e, i) => <span key={i}>{e}</span>)}
    </div>
  </div>
);
