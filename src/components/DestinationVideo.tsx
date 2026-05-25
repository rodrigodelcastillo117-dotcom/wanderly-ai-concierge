import { useEffect, useRef, useState } from "react";


interface DestinationVideoProps {
  query: string;
  fallbackImage?: string;
  alt?: string;
  className?: string;
}

// Tiny in-memory cache so the same destination doesn't re-fetch across mounts
const cache = new Map<string, { url: string | null; poster: string | null }>();
const inflight = new Map<string, Promise<{ url: string | null; poster: string | null }>>();

export const DestinationVideo = ({ query, fallbackImage, alt, className }: DestinationVideoProps) => {
  const [data, setData] = useState<{ url: string | null; poster: string | null } | null>(
    cache.get(query) ?? null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let alive = true;
    const cached = cache.get(query);
    if (cached) {
      setData(cached);
      return;
    }
    const existing = inflight.get(query);
    const p =
      existing ??
      (async () => {
        const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/buscar-video?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        });
        if (!res.ok) return { url: null, poster: null };
        return (await res.json()) as { url: string | null; poster: string | null };
      })();


    inflight.set(query, p);
    p.then((result) => {
      cache.set(query, result);
      inflight.delete(query);
      if (alive) setData(result);
    });

    return () => {
      alive = false;
    };
  }, [query]);

  if (data?.url) {
    return (
      <video
        ref={videoRef}
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
      src={data?.poster ?? fallbackImage}
      alt={alt}
      loading="lazy"
      className={className}
    />
  );
};

export default DestinationVideo;
