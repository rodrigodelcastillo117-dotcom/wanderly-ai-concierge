import { useState, ReactNode } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { SmartImage } from "@/components/media/SmartImage";

// La foto del encabezado es ilustrativa (Pexels) y va marcada: SmartImage la pide una sola vez por
// sesión (memoria + sessionStorage) dentro del presupuesto por minuto de src/lib/stockPhoto.ts.
// Antes cada tarjeta del viaje pedía su foto con hasta dos reintentos y sin caché entre cargas.

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

  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card scroll-mt-24 max-w-full">
      <button
        type="button"
        onClick={toggle}
        className="relative w-full h-32 md:h-36 group text-left overflow-hidden"
      >
        <SmartImage
          alt=""
          stockQuery={imageQuery || `${city} landmark travel`}
          eager
          icon={MapPin}
          className="!absolute inset-0"
          imgClassName="group-hover:scale-105"
          captionPosition="bottom-right"
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
