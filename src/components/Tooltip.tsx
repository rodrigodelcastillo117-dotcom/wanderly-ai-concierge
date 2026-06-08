import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type TooltipProps = {
  id: string;
  text: string;
  icon?: string;
  onDismiss: () => void;
  position?: "top" | "bottom" | "inline";
  autoHideMs?: number;
  delayMs?: number;
};

/**
 * Contextual one-time tooltip. Dismissable, auto-hides after 8s, ESC to close.
 * - position="bottom": fixed banner at bottom of screen (mobile-friendly)
 * - position="top":    fixed banner near top
 * - position="inline": rendered in normal flow (anchor it yourself)
 */
export function Tooltip({
  id,
  text,
  icon,
  onDismiss,
  position = "bottom",
  autoHideMs = 8000,
  delayMs = 500,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);

  // Delayed mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  // Auto-hide + ESC
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => onDismiss(), autoHideMs);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, autoHideMs, onDismiss]);

  const containerClass =
    position === "inline"
      ? "w-full"
      : position === "top"
      ? "fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,520px)] pointer-events-none"
      : "fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,520px)] pb-[env(safe-area-inset-bottom)] pointer-events-none";

  return (
    <AnimatePresence>
      {visible && (
        <div className={containerClass} data-tooltip-id={id}>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "pointer-events-auto glass-card rounded-xl px-4 py-3 flex items-start gap-3",
              "border border-primary/30 shadow-xl",
              "[box-shadow:0_10px_40px_-10px_hsl(var(--primary)/0.35)]"
            )}
            role="status"
            aria-live="polite"
          >
            {icon && <span className="text-base leading-tight shrink-0">{icon}</span>}
            <p className="flex-1 text-[13px] leading-snug text-foreground font-sans">{text}</p>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar"
              className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-muted-foreground hover:text-primary transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Convenience wrapper: pair with useTooltipShown in one line.
 * Renders nothing if the tooltip was already dismissed.
 */
export function FeatureTooltip(props: {
  id: string;
  text: string;
  icon?: string;
  shouldShow: boolean;
  onDismiss: () => void;
  position?: TooltipProps["position"];
}) {
  if (!props.shouldShow) return null;
  return (
    <Tooltip
      id={props.id}
      text={props.text}
      icon={props.icon}
      position={props.position}
      onDismiss={props.onDismiss}
    />
  );
}
