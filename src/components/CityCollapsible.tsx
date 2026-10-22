import { useEffect, useState, ReactNode } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

// Tiny in-memory cache so we don't re-fetch Pexels for the same city
const imgCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

type PexelsResult = { image: string | null; failed: boolean; rateLimited: boolean };

// Tras un 429 no se pide nada más por un minuto: el detalle de un viaje tiene decenas de tarjetas
// y, con los dos reintentos por tarjeta, una sola carga llegaba a 42 llamadas (límite: 30/min),
// todas rechazadas.
let blockedUntil = 0;
export const __resetCityImageBlock = () => { blockedUntil = 0; imgCache.clear(); inflight.clear(); };

const fetchPexels = async (q: string): Promise<PexelsResult> => {
  if (Date.now() < blockedUntil) return { image: null, failed: true, rateLimited: true };
  try {
    const { data, error } = await supabase.functions.invoke("pexels-image", {
      body: { query: q },
    });
    if (error) {
      const status = (error as { context?: { status?: number } })?.context?.status;
      if (status === 429) blockedUntil = Date.now() + 60_000;
      return { image: null, failed: true, rateLimited: status === 429 };
    }
    return { image: (data?.image as string) ?? null, failed: false, rateLimited: false };
  } catch {
    return { image: null, failed: true, rateLimited: false };
  }
};

/**
 * Busca la foto de una consulta. Las consultas más cortas solo se intentan cuando el servidor
 * contestó bien pero sin foto; si la llamada falló (límite, red, servidor), reintentar con otra
 * consulta solo triplicaba el tráfico.
 */
export async function resolveCityImage(query: string, fetcher: (q: string) => Promise<PexelsResult> = fetchPexels): Promise<string | null> {
  const first = await fetcher(query);
  if (first.image || first.failed) return first.image;
  const short = query.split(/\s+/).slice(0, 2).join(" ").trim();
  if (short && short !== query) {
    const r = await fetcher(short);
    if (r.image || r.failed) return r.image;
  }
  const word = query.split(/\s+/)[0]?.trim();
  if (word && word !== query && word !== short) return (await fetcher(word)).image;
  return null;
}

export const useCityImage = (query: string): string | null => {
  const [url, setUrl] = useState<string | null>(imgCache.get(query) ?? null);

  useEffect(() => {
    let alive = true;
    if (imgCache.has(query)) {
      setUrl(imgCache.get(query) ?? null);
      return;
    }
    const existing = inflight.get(query);
    const p =
      existing ??
      resolveCityImage(query);
    inflight.set(query, p);
    p.then((result) => {
      imgCache.set(query, result);
      inflight.delete(query);
      if (alive) setUrl(result);
    });
    return () => { alive = false; };
  }, [query]);

  return url;
};

interface CityCollapsibleProps {
  city: string;
  subtitle?: string;
  imageQuery?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  count?: number;
  children: ReactNode;
}

export const CityCollapsible = ({
  city,
  subtitle,
  imageQuery,
  defaultOpen = false,
  open: openProp,
  onToggle,
  count,
  children,
}: CityCollapsibleProps) => {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? (openProp as boolean) : openLocal;
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setOpenLocal((o) => !o);
  };
  const img = useCityImage(imageQuery || `${city} landmark travel`);

  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card scroll-mt-24 max-w-full">
      <button
        type="button"
        onClick={toggle}
        className="relative w-full h-32 md:h-36 group text-left overflow-hidden"
      >
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
          style={{
            backgroundImage: img
              ? `url(${img})`
              : "linear-gradient(135deg, hsl(var(--primary) / 0.25), hsl(var(--surface)))",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/55 to-background/25" />

        <div className="relative h-full flex items-center justify-between gap-3 px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center backdrop-blur-sm shrink-0">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-1">Destino</p>
              <h3 className="font-display text-xl min-[380px]:text-2xl md:text-3xl leading-tight break-words">{city}</h3>
              {subtitle && <p className="text-xs text-muted-foreground mt-1 break-words">{subtitle}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {count != null && (
              <span className="hidden md:inline-flex text-xs px-2.5 py-1 rounded-full bg-background/60 border border-border backdrop-blur-sm">
                {count} {count === 1 ? "opción" : "opciones"}
              </span>
            )}
            <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3 }}>
              <ChevronDown className="w-5 h-5 text-primary" />
            </motion.div>
          </div>
        </div>
      </button>

      {/* Smooth animated expand/collapse — children stay mounted to preserve state */}
      <motion.div
        initial={false}
        animate={{
          height: open ? "auto" : 0,
          opacity: open ? 1 : 0,
        }}
        transition={{
          height: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
          opacity: { duration: open ? 0.45 : 0.25, ease: "easeOut", delay: open ? 0.1 : 0 },
        }}
        style={{ overflow: "hidden", willChange: "height, opacity" }}
      >
        <div className="p-4 md:p-6 border-t border-border/60 max-w-full overflow-hidden">{children}</div>
      </motion.div>
    </div>
  );
};
