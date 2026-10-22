import { useEffect, useRef, useState, type RefObject } from "react";
import { cachedVideo, getDestinationVideo, type VideoResult } from "@/lib/videoSearch";
import { useInView } from "@/hooks/useInView";

interface DestinationVideoProps {
  query: string;
  fallbackImage?: string;
  alt?: string;
  className?: string;
}

// Caché, deduplicación, presupuesto por minuto y pausa tras 429 viven en src/lib/videoSearch.ts
// (compartidos con CityVideoCard). Solo se pide el video cuando la tarjeta está por verse (N-04).
export const DestinationVideo = ({ query, fallbackImage, alt, className }: DestinationVideoProps) => {
  const [data, setData] = useState<VideoResult | null>(() => cachedVideo(query) ?? null);
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);

  useEffect(() => {
    const cached = cachedVideo(query);
    setData(cached ?? null);
    if (cached || !inView) return;
    let alive = true;
    void getDestinationVideo(query).then((result) => {
      if (alive) setData(result);
    });
    return () => {
      alive = false;
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
      alt={alt}
      loading="lazy"
      className={className}
    />
  );
};

export default DestinationVideo;
