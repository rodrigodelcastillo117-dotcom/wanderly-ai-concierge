import { useEffect, useRef, useState, type RefObject } from "react";
import { cachedVideo, getDestinationVideo, type VideoResult } from "@/lib/videoSearch";
import { useInView } from "@/hooks/useInView";
import { afterCritical } from "@/lib/idleGate";

interface DestinationVideoProps {
  query: string;
  fallbackImage?: string;
  /** Variantes de la imagen de respaldo (srcset con anchos "w") para no bajar 1920 px en el móvil. */
  fallbackSrcSet?: string;
  sizes?: string;
  /** Arriba del todo (candidata a LCP): se pide de inmediato y con prioridad alta, sin lazy. */
  priority?: boolean;
  /** Abajo del pliegue: prioridad baja para no competir con la imagen principal en red lenta. */
  lowPriority?: boolean;
  alt?: string;
  className?: string;
}

// Caché, deduplicación, presupuesto por minuto y pausa tras 429 viven en src/lib/videoSearch.ts
// (compartidos con CityVideoCard). Solo se pide el video cuando la tarjeta está por verse (N-04).
export const DestinationVideo = ({ query, fallbackImage, fallbackSrcSet, sizes, priority = false, lowPriority = false, alt, className }: DestinationVideoProps) => {
  const [data, setData] = useState<VideoResult | null>(() => cachedVideo(query) ?? null);
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);

  useEffect(() => {
    const cached = cachedVideo(query);
    setData(cached ?? null);
    if (cached || !inView) return;
    let alive = true;
    // El video es un extra: primero se pinta la imagen (LCP) y los datos de la pantalla; la búsqueda
    // del video va después (idleGate).
    const cancel = afterCritical(() => {
      void getDestinationVideo(query).then((result) => {
        if (alive) setData(result);
      });
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [query, inView]);

  if (data?.url) {
    return (
      <video
        ref={ref as RefObject<HTMLVideoElement>}
        src={data.url}
        poster={data.poster ?? fallbackImage}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label={alt}
        className={className}
      />
    );
  }

  return (
    <img
      ref={ref as RefObject<HTMLImageElement>}
      src={data?.poster ?? fallbackImage}
      srcSet={data?.poster ? undefined : fallbackSrcSet}
      sizes={data?.poster || !fallbackSrcSet ? undefined : sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchpriority: "high" } : lowPriority ? { fetchpriority: "low" } : {})}
      className={className}
    />
  );
};

export default DestinationVideo;
