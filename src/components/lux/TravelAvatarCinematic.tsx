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
import { useMemberCard, tierText } from "@/lib/memberCard";
import { MemberCardButton } from "@/components/membercard/MemberCardButton";
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
  // Credencial junto al avatar: la misma tarjeta de rango del menú (my_member_card).
  const { card, loading: cardLoading } = useMemberCard(user?.id ?? null);
  const [lastTrip, setLastTrip] = useState<LastTrip | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  // Avatar por capas: aquí va el cuerpo completo (avatar_profiles.cuerpo_url); los círculos usan el
  // recorte de la cara (profiles.avatar_url).
  const [cuerpoUrl, setCuerpoUrl] = useState<string | null>(null);
  const [capas, setCapas] = useState(false);

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
        (supabase as any).from("avatar_profiles").select("version, cuerpo_url, capas").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const t = trips?.[0] ?? null;
      setLastTrip(t ? { destino: t.destino, pais_destino: (t as any).pais_destino ?? null } : null);
      setVersion(ap?.error ? null : (ap?.data?.version ?? null));
      const cu = ap?.error ? null : ap?.data?.cuerpo_url;
      setCuerpoUrl(typeof cu === "string" && /^https:\/\//.test(cu) ? cu : null);
      setCapas(!ap?.error && ap?.data?.capas === true);
    })();
    return () => { cancelled = true; };
  }, [user, dna?.tripCount, avatarUrl]);

  const culture = useMemo(() => detectCulture(lastTrip?.destino, lastTrip?.pais_destino), [lastTrip]);
  const archetype = dna?.dominant ? DNA_ARCHETYPES[dna.dominant] : null;
  // Con capas los recuerdos ya están dibujados en la imagen (en la mano y a los pies): sin insignias.
  const badges = capas ? [] : rows.filter((r) => r.visible && r.status === "aplicado").map((r) => ({ key: r.id, emoji: r.emoji, nombre: r.nombre }));

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

      {/* Avatar circular dentro del anillo decorativo y, a su lado, su credencial (tarjeta de rango). */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-14 py-10 md:py-12">
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
          {cuerpoUrl ? (
            <figure className="relative w-56 md:w-64 aspect-[4/5] rounded-3xl overflow-hidden avatar-ring p-[3px] shadow-[0_0_28px_-6px_rgba(212,175,55,0.55)]" data-testid="avatar-cuerpo">
              <img src={cuerpoUrl} alt="Tu Travel Avatar de cuerpo completo" className="w-full h-full object-cover rounded-[1.35rem]" loading="lazy" decoding="async" />
            </figure>
          ) : (
            <AvatarCircle url={avatarUrl} name={user?.user_metadata?.full_name ?? null} size="lg" prive={prive} badges={badges} />
          )}
        </div>
        {card || cardLoading ? (
          <figure className="w-[188px] sm:w-[204px] shrink-0" data-testid="avatar-member-card">
            <div className="sm:-rotate-[3deg] motion-reduce:rotate-0 drop-shadow-[0_24px_30px_rgba(0,0,0,0.55)]">
              <MemberCardButton card={card} loading={cardLoading} testId="avatar-card" />
            </div>
            {card ? (
              <figcaption className="mt-3 text-center text-[10px] tracking-[0.24em] uppercase text-foreground/70">
                Credencial · <span style={{ color: culture.palette.accent }}>{tierText(card.tier).name}</span>
              </figcaption>
            ) : null}
          </figure>
        ) : null}
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
          <AvatarEvolutionTimeline rows={rows} hasAvatar={!!avatarUrl} capas={capas} />
        </div>
      </div>
    </div>
  );
};
