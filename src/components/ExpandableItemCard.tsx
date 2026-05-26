import { useState, ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCityImage } from "@/components/CityCollapsible";

interface ExpandableItemCardProps {
  imageQuery: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  price?: string;
  active?: boolean;
  selectable?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  children: ReactNode; // detalle expandido (por qué, notas, etc.)
}

export const ExpandableItemCard = ({
  imageQuery,
  eyebrow,
  title,
  subtitle,
  price,
  active = false,
  selectable = false,
  onToggle,
  defaultOpen = false,
  children,
}: ExpandableItemCardProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const img = useCityImage(imageQuery);

  return (
    <div
      className={`group relative rounded-2xl overflow-hidden border bg-card transition ${
        active ? "border-primary ring-1 ring-primary/40 gold-glow" : "border-border/60 hover:border-primary/50"
      }`}
    >
      {/* Imagen header (click = seleccionar si selectable) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (selectable && onToggle) onToggle();
          else setOpen((o) => !o);
        }}
        className="relative block w-full h-40 overflow-hidden text-left"
      >
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
          style={{
            backgroundImage: img
              ? `url(${img})`
              : "linear-gradient(135deg, hsl(var(--primary) / 0.25), hsl(var(--surface)))",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />


        {eyebrow && (
          <span className="absolute top-3 left-3 text-[10px] tracking-[0.2em] uppercase text-primary bg-background/70 backdrop-blur-sm px-2 py-0.5 rounded-full border border-primary/30">
            {eyebrow}
          </span>
        )}
        {active && (
          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
            <Check className="w-4 h-4" />
          </div>
        )}
      </button>

      {/* Body */}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg leading-tight truncate">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {price && <span className="text-xs text-primary font-medium whitespace-nowrap pt-1">{price}</span>}
        </div>

        {/* Toggle detalle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="flex items-center gap-1.5 text-[11px] tracking-wider uppercase text-primary/80 hover:text-primary transition pt-1"
        >
          {open ? "Ocultar detalle" : "Ver detalle"}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
            <ChevronDown className="w-3.5 h-3.5" />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="pt-2 border-t border-border/40 text-sm text-muted-foreground space-y-2">
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
