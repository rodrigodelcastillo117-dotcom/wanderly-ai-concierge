import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePriveT } from "@/components/prive/PriveLang";

/** Carril horizontal con deslizamiento (móvil) y botones anterior/siguiente (escritorio). */
export function Rail({ label, heading, actions, large = false, children, testId }: {
  label: string; heading?: ReactNode; actions?: ReactNode; large?: boolean; children: ReactNode; testId?: string;
}) {
  const t = usePriveT();
  const ref = useRef<HTMLUListElement>(null);
  const move = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">{heading}</div>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <button type="button" className="prive-rail-btn hidden sm:inline-flex" onClick={() => move(-1)} aria-label={`${t.browse.prev}: ${label}`}><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
          <button type="button" className="prive-rail-btn hidden sm:inline-flex" onClick={() => move(1)} aria-label={`${t.browse.next}: ${label}`}><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
        </div>
      </div>
      <ul ref={ref} className={`prive-rail ${large ? "prive-rail-lg" : ""}`} aria-label={label} data-testid={testId}>
        {children}
      </ul>
    </div>
  );
}

