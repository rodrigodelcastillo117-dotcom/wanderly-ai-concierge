import { useRef, useState, ReactNode } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

// Tiny in-memory cache so we don't re-fetch Pexels for the same city
const imgCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const fetchPexels = async (q: string): Promise<string | null> => {
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/pexels-image?query=${encodeURIComponent(q)}`,
      { headers: { apikey: anonKey } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.image as string) ?? null;
  } catch {
    return null;
  }
};

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
      (async () => {
        // Primary query
        let result = await fetchPexels(query);
        // Fallback 1: first two words (usually the place name)
        if (!result) {
          const short = query.split(/\s+/).slice(0, 2).join(" ").trim();
          if (short && short !== query) result = await fetchPexels(short);
        }
        // Fallback 2: just the first word
        if (!result) {
          const first = query.split(/\s+/)[0]?.trim();
          if (first && first !== query) result = await fetchPexels(first);
        }
        return result;
      })();
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
  wrapperRef?: (el: HTMLDivElement | null) => void;
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
  wrapperRef,
  children,
}: CityCollapsibleProps) => {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? (openProp as boolean) : openLocal;
  const innerRef = useRef<HTMLDivElement | null>(null);
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setOpenLocal((o) => !o);
  };
  const img = useCityImage(imageQuery || `${city} landmark travel`);

  return (
    <div
      ref={(el) => {
        innerRef.current = el;
        wrapperRef?.(el);
      }}
      className="rounded-2xl overflow-hidden border border-border/60 bg-card scroll-mt-24"
    >
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

        <div className="relative h-full flex items-center justify-between px-5 md:px-7">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center backdrop-blur-sm">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] tracking-[0.3em] uppercase text-primary mb-1">Destino</p>
              <h3 className="font-display text-2xl md:text-3xl leading-tight">{city}</h3>
              {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
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
        <div className="p-5 md:p-6 border-t border-border/60">{children}</div>
      </motion.div>
    </div>
  );
};
