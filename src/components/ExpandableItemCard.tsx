import { useState, ReactNode } from "react";
import { ChevronDown, Check, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCityImage } from "@/components/CityCollapsible";

export interface ExpandableItemCardAction {
  label: string;
  href: string;
  primary?: boolean;
}

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
  actions?: ExpandableItemCardAction[];
  children?: ReactNode; // detalle expandido (por qué, notas, etc.)
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
  actions,
  children,
}: ExpandableItemCardProps) => {

  const [open, setOpen] = useState(defaultOpen);
  const img = useCityImage(imageQuery);

  return (
    <div
      className={`group relative max-w-full rounded-2xl overflow-hidden border bg-card transition ${
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
          <span className="absolute left-3 right-3 top-3 w-fit max-w-[calc(100%-1.5rem)] break-words rounded-full border border-primary/30 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary backdrop-blur-sm">
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
        <div className="space-y-1">
          <p className="font-display text-base sm:text-lg leading-tight break-words" title={title}>{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {price && <p className="text-xs text-primary font-medium break-words">{price}</p>}
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
              <div className="pt-2 border-t border-border/40 text-sm text-muted-foreground space-y-3 break-words">
                {children}
                {actions && actions.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {actions.map((a) => (
                      <a
                        key={a.label + a.href}
                        href={a.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                          a.primary
                            ? "bg-primary/15 hover:bg-primary/25 text-primary border-primary/40"
                            : "border-border/60 hover:border-primary/40 hover:text-primary text-foreground/80"
                        }`}
                      >
                        {a.label}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
