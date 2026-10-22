import { useEffect, useRef, useState } from "react";
import { cachedVideo, getDestinationVideo } from "@/lib/videoSearch";
import { useInView } from "@/hooks/useInView";

interface Props {
  city: string;
  active: boolean;
  onClick: () => void;
}

// Query muy específica por ciudad para evitar resultados duplicados entre ciudades.
const queryFor = (city: string) => `${city} city skyline night aerial landmark cinematic`;

// La caché, la deduplicación y el freno tras un 429 son compartidos (src/lib/videoSearch.ts), y
// solo se pide el video cuando la tarjeta está por verse (N-04). Antes cada tarjeta llamaba por
// su cuenta, con la URL de producción escrita a mano.
export function CityVideoCard({ city, active, onClick }: Props) {
  const initial = cachedVideo(queryFor(city));
  const [src, setSrc] = useState<string | null>(initial?.url ?? null);
  const [poster, setPoster] = useState<string | null>(initial?.poster ?? null);
  const [loading, setLoading] = useState(!initial);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLButtonElement>(null);
  const inView = useInView(cardRef);

  useEffect(() => {
    const q = queryFor(city);
    const cached = cachedVideo(q);
    if (cached) {
      setSrc(cached.url);
      setPoster(cached.poster);
      setLoading(false);
      return;
    }
    if (!inView) return;
    let cancelled = false;
    setLoading(true);
    void getDestinationVideo(q).then((r) => {
      if (cancelled) return;
      setSrc(r.url);
      setPoster(r.poster);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [city, inView]);

  return (
    <button
      ref={cardRef}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border h-36 flex items-end p-3 transition-all duration-300 ${
        active
          ? "border-primary/60 shadow-[0_10px_40px_-12px_rgba(201,169,97,0.45)]"
          : "border-primary/15 hover:border-primary/40"
      }`}
    >
      {/* Video o poster */}
      {src ? (
        <video
          ref={videoRef}
          src={src}
          poster={poster ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : poster ? (
        <img src={poster} alt={city} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br from-primary/20 to-black ${loading ? "animate-pulse" : ""}`} />
      )}

      {/* Overlay oscuro para legibilidad */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />

      <span className="relative font-fraunces text-base text-foreground drop-shadow-lg z-10">
        {city}
      </span>
    </button>
  );
}
