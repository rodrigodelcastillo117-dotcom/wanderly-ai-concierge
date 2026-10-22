import { useNavigate } from "react-router-dom";
import { ArrowRight, BookmarkCheck, Users } from "lucide-react";
import { localISODate } from "@/lib/localDate";
import { nextTripAction, quoteFreshness, tripTiming, type NextActionInput } from "@/lib/tripCommand";

type QuoteLike = { created_at?: string | null; valid_until?: string | null } | null;

/** A qué sección de esta misma página lleva cada acción que no cambia de pantalla. */
const IN_PAGE_TARGET: Record<string, string> = {
  cotizar: "trip-total",
  revisar_precios: "trip-total",
  reservar: "trip-destinos",
};

export function scrollToSection(id: string) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (!el) return;
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // Lleva el foco al destino para lectores de pantalla y teclado.
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  (el as HTMLElement).focus({ preventScroll: true });
}

type Props = {
  trip: NextActionInput & { user_id?: string | null };
  quote: QuoteLike;
  isOwner: boolean;
  /** "fixed" = barra inferior en móvil (encima de la navegación), "card" = tarjeta en la página. */
  variant?: "card" | "bar";
  totalLabel?: string | null;
  now?: Date;
};

/**
 * "¿Qué sigue?" del viaje: confirma que quedó guardado, dice cuánto falta y da UNA acción
 * principal (la misma regla que el centro de mando de Inicio). Antes, al terminar el análisis el
 * usuario llegaba a una página larguísima sin saber si su cotización estaba guardada ni qué hacer.
 */
export function TripNextStep({ trip, quote, isOwner, variant = "card", totalLabel, now }: Props) {
  const navigate = useNavigate();
  const today = localISODate(now ?? new Date());
  const action = nextTripAction(trip, { today, quote, now });
  const timing = tripTiming(trip, today);
  const fresh = quoteFreshness(trip, quote, now);
  const base = `/dashboard/viajes/${trip.id}`;
  const go = () => {
    const target = action.to === base ? IN_PAGE_TARGET[action.key] : null;
    if (target) scrollToSection(target);
    else navigate(action.to);
  };

  if (variant === "bar") {
    return (
      <div className="lg:hidden fixed inset-x-2 z-40 bottom-[calc(76px+max(env(safe-area-inset-bottom),0.5rem))]" data-testid="trip-next-bar">
        <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-black/85 backdrop-blur-xl px-3 py-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground truncate">{timing.label}</p>
            {totalLabel && <p className="text-sm font-medium truncate">{totalLabel}</p>}
          </div>
          <button type="button" onClick={go}
            className="shrink-0 min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-gradient-gold px-4 text-sm font-medium text-primary-foreground active:scale-[0.98] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {action.cta} <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="trip-next-title" className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.09] to-transparent p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground mb-3">
        {isOwner ? (
          <span className="inline-flex items-center gap-1.5 text-primary"><BookmarkCheck className="w-4 h-4" aria-hidden /> Guardado en Mis viajes</span>
        ) : (
          <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" aria-hidden /> Viaje compartido contigo</span>
        )}
        <span>{timing.label}</span>
        {fresh.status !== "sin_cotizacion" && (
          <span className={fresh.status === "vigente" ? "" : "text-amber-400"}>{fresh.label}</span>
        )}
      </div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Qué sigue</p>
      <div className="mt-1 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        <div className="min-w-0 flex-1">
          <h2 id="trip-next-title" className="font-display text-2xl">{action.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{action.detail}</p>
        </div>
        <button type="button" onClick={go}
          className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-gold px-6 text-sm font-medium text-primary-foreground hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          {action.cta} <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
