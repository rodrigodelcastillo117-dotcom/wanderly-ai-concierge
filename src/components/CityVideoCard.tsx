import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  city: string;
  active: boolean;
  onClick: () => void;
}

// Cache simple en memoria por sesión para no re-fetchar
const cache = new Map<string, { url: string | null; poster: string | null }>();

export function CityVideoCard({ city, active, onClick }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cache.has(city)) {
        const c = cache.get(city)!;
        setSrc(c.url);
        setPoster(c.poster);
        setLoading(false);
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const url = `https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/buscar-video?q=${encodeURIComponent(
          `${city} city night skyline cinematic`,
        )}`;
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        const json = await r.json();
        if (cancelled) return;
        cache.set(city, { url: json.url ?? null, poster: json.poster ?? null });
        setSrc(json.url ?? null);
        setPoster(json.poster ?? null);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [city]);

  return (
    <button
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
