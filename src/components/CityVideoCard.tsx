import { useEffect, useRef, useState } from "react";
import { getDestinationVideo } from "@/lib/videoSearch";
import { claimVideo, cityVideoQueries, videoKey } from "@/lib/cityVisuals";
import { useInView } from "@/hooks/useInView";

interface Props {
  city: string;
  active: boolean;
  onClick: () => void;
  /** Línea chica bajo el nombre (p. ej. "12 lugares"). */
  subtitle?: string;
  className?: string;
}

type Visual = { url: string | null; poster: string | null };

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tarjeta de ciudad con su propio clip (de día, de su lugar emblemático) y nunca el de otra ciudad:
 * ver src/lib/cityVisuals.ts. La caché, la deduplicación y el freno tras un 429 son compartidos
 * (src/lib/videoSearch.ts) y solo se pide el video cuando la tarjeta está por verse (N-04).
 */
export function CityVideoCard({ city, active, onClick, subtitle, className = "h-36" }: Props) {
  const [visual, setVisual] = useState<Visual | null>(null);
  const [done, setDone] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const inView = useInView(cardRef);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    setDone(false);
    (async () => {
      let posterOnly: Visual | null = null;
      for (const q of cityVideoQueries(city)) {
        const r = await getDestinationVideo(q);
        if (cancelled) return;
        const key = videoKey(r.url, r.poster);
        // Un clip que ya es de otra ciudad no se repite: se prueba la consulta de respaldo.
        if (!key || !claimVideo(city, key)) continue;
        if (r.url) { setVisual(r); setDone(true); return; }
        if (r.poster && !posterOnly) posterOnly = { url: null, poster: r.poster };
      }
      setVisual(posterOnly);
      setDone(true);
    })();
    return () => { cancelled = true; };
  }, [city, inView]);

  const playVideo = !!visual?.url && !reducedMotion();
  const initial = city.trim().charAt(0).toUpperCase();

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={subtitle ? `${city}, ${subtitle}` : city}
      className={`group relative overflow-hidden rounded-2xl border flex items-end p-3 text-left transition-all duration-300 ${className} ${
        active
          ? "border-primary ring-1 ring-primary/70 shadow-[0_10px_40px_-12px_rgba(201,169,97,0.55)]"
          : "border-primary/15 hover:border-primary/45"
      }`}
    >
      {playVideo ? (
        <video
          src={visual!.url!}
          poster={visual!.poster ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : visual?.poster ? (
        <img src={visual.poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      ) : (
        // Sin clip propio: fondo sobrio con la inicial (mejor que repetir el video de otra ciudad).
        <div className={`absolute inset-0 bg-gradient-to-br from-primary/25 via-primary/[0.06] to-black ${done ? "" : "animate-pulse"}`}>
          <span aria-hidden="true" className="absolute right-3 top-1 font-fraunces text-6xl text-primary/25 select-none">{initial}</span>
        </div>
      )}

      {/* Velo para leer el nombre, sin oscurecer toda la toma. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />

      <span className="relative z-10 min-w-0">
        {/* Dos líneas en vez de "Ciudad de M…" (N9, 390 px). */}
        <span className="block font-fraunces text-base leading-tight text-white drop-shadow-lg line-clamp-2 break-words">{city}</span>
        {subtitle && <span className="block text-[10px] tracking-wide text-white/80 drop-shadow">{subtitle}</span>}
      </span>
    </button>
  );
}
