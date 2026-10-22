import { useEffect, useMemo, useState } from "react";
import { Sparkles, MapPin, Upload, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { detectCulture } from "@/lib/cultureProfiles";
import { DNA_ARCHETYPES } from "@/lib/travelDna";
import { useMyAvatar } from "@/hooks/useMyAvatar";
import { usePriveSeal } from "@/hooks/usePriveSeal";
import { AvatarCircle } from "@/components/avatar/AvatarCircle";
import { AvatarEvolutionTimeline } from "@/components/avatar/AvatarEvolutionTimeline";
import { useAvatarSouvenirs } from "@/components/avatar/useAvatarSouvenirs";
import type { DNAResult } from "./TravelDNAStats";

type Props = {
  dna: DNAResult | null;
  /** Abre el creador del avatar (selfie). Sin selfie no se regenera: antes se inventaba otra persona. */
  onEditAvatar?: () => void;
};

type LastTrip = { destino: string | null; pais_destino: string | null };

/**
 * Tarjeta del Travel Avatar en el Travel DNA: avatar CIRCULAR dentro del anillo dorado, recuerdos
 * de viaje orbitando el anillo (nunca sobre la cara), arquetipo en español y la "Evolución" (qué
 * viaje desbloqueó qué detalle). La imagen sale de la misma fuente que el resto de la app.
 */
export const TravelAvatarCinematic = ({ dna, onEditAvatar }: Props) => {
  const { user } = useAuth();
  const { url: avatarUrl } = useMyAvatar();
  const prive = usePriveSeal();
  const { rows } = useAvatarSouvenirs();
  const [lastTrip, setLastTrip] = useState<LastTrip | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: trips }, ap] = await Promise.all([
        // El ambiente lo da el último viaje HECHO (antes era el último creado, aunque fuera a futuro).
        supabase.from("trips").select("destino, pais_destino, fecha_salida, fecha_regreso")
          .eq("user_id", user.id).lt("fecha_salida", today)
          .order("fecha_salida", { ascending: false }).limit(1),
        (supabase as any).from("avatar_profiles").select("version").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const t = trips?.[0] ?? null;
      setLastTrip(t ? { destino: t.destino, pais_destino: (t as any).pais_destino ?? null } : null);
      setVersion(ap?.error ? null : (ap?.data?.version ?? null));
    })();
    return () => { cancelled = true; };
  }, [user, dna?.tripCount, avatarUrl]);

  const culture = useMemo(() => detectCulture(lastTrip?.destino, lastTrip?.pais_destino), [lastTrip]);
  const archetype = dna?.dominant ? DNA_ARCHETYPES[dna.dominant] : null;
  const badges = rows.filter((r) => r.visible && r.status === "aplicado").map((r) => ({ key: r.id, emoji: r.emoji, nombre: r.nombre }));

  const bg = `radial-gradient(ellipse at 30% 20%, ${culture.palette.accent}33 0%, transparent 50%),
              radial-gradient(ellipse at 70% 80%, ${culture.palette.via} 0%, transparent 60%),
              linear-gradient(160deg, ${culture.palette.from} 0%, ${culture.palette.via} 50%, ${culture.palette.to} 100%)`;

  return (
    <div className="relative rounded-3xl overflow-hidden border border-primary/20 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" data-testid="travel-avatar-card">
      <div className="absolute inset-0" style={{ background: bg }} />

      {/* Barra superior */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-5 pt-5">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: culture.palette.accent }} />
          <span className="text-[10px] tracking-[0.14em] sm:tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: culture.palette.accent }}>{culture.label}</span>
        </div>
        {version ? (
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase text-foreground/80 shrink-0">
            Evolución v{version}
          </div>
        ) : null}
      </div>

      {/* Avatar circular dentro del anillo decorativo */}
      <div className="relative z-10 flex items-center justify-center py-8 md:py-10">
        <div className="relative flex items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute rounded-full w-[calc(100%+44px)] h-[calc(100%+44px)] border opacity-40"
            style={{ borderColor: culture.palette.accent }}
          />
          <div
            aria-hidden="true"
            className="absolute rounded-full w-[calc(100%+90px)] h-[calc(100%+90px)] opacity-30 motion-safe:animate-[spin_60s_linear_infinite]"
            style={{ background: `conic-gradient(from 0deg, transparent, ${culture.palette.accent}40, transparent, ${culture.palette.accent}20, transparent)` }}
          />
          <AvatarCircle url={avatarUrl} name={user?.user_metadata?.full_name ?? null} size="lg" prive={prive} badges={badges} />
        </div>
      </div>

      {/* Información */}
      <div className="relative z-10 px-5 pb-5 pt-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: culture.palette.accent }}>
              {archetype ? archetype.tag : "Tu identidad de viaje"}
            </p>
            <h3 className="font-display text-2xl md:text-3xl leading-tight">
              {archetype ? archetype.label : "Por descubrir"}
            </h3>
            {lastTrip?.destino && (
              <p className="text-xs text-foreground/70 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" aria-hidden="true" /> Último viaje: {lastTrip.destino}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onEditAvatar}
              className="px-4 py-2.5 rounded-full border border-white/15 text-xs tracking-[0.12em] uppercase font-medium bg-white/5 hover:bg-white/10 text-foreground/90 inline-flex items-center gap-2"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Subir selfie
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={onEditAvatar}
                className="px-4 py-2.5 rounded-full border text-xs tracking-[0.12em] uppercase font-medium inline-flex items-center gap-2"
                style={{ borderColor: culture.palette.accent, color: culture.palette.accent, background: `linear-gradient(135deg, ${culture.palette.accent}15, transparent)` }}
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Volver a generar
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-white/10">
          <p className="text-[10px] tracking-[0.3em] uppercase text-foreground/60 mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" aria-hidden="true" /> Evolución
          </p>
          <AvatarEvolutionTimeline rows={rows} hasAvatar={!!avatarUrl} />
        </div>
      </div>
    </div>
  );
};
