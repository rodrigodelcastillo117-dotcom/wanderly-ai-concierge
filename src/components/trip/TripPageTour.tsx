import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TripSection } from "@/components/TripSectionNav";
import { markTripTourSeen, tripTourSeen, type TripTourStep } from "@/lib/tripSectionHelp";

/** Una línea bajo las pestañas: para qué sirve la sección y qué hacer ahí. */
export function SectionIntro({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground" data-testid="trip-seccion-ayuda">{text}</p>;
}

/**
 * Recorrido de primer uso de la página del viaje (máximo 3 pasos). Se puede saltar en cualquier momento
 * y no vuelve a salir (localStorage; sin almacenamiento no se muestra). Al avanzar, ilumina la pestaña
 * de la que habla (onHighlight) sin cambiar de sección.
 */
export function TripPageTour({ steps, onHighlight }: { steps: TripTourStep[]; onHighlight?: (s: TripSection | null) => void }) {
  const [open, setOpen] = useState(() => !tripTourSeen());
  const [i, setI] = useState(0);
  const current = open && steps.length ? steps[Math.min(i, steps.length - 1)].section : null;
  useEffect(() => { onHighlight?.(current); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || steps.length === 0) return null;
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const close = () => {
    markTripTourSeen();
    setOpen(false);
  };
  const next = () => {
    if (last) return close();
    setI(i + 1);
  };
  return (
    <section role="dialog" aria-modal="false" aria-labelledby="trip-tour-title" data-testid="trip-tour"
      className="relative rounded-2xl border border-primary/40 bg-primary/[0.07] p-4 pr-11">
      <button type="button" onClick={close} aria-label="Cerrar recorrido"
        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cómo usar esta página · {i + 1} de {steps.length}</p>
      <h2 id="trip-tour-title" className="mt-1 font-display text-lg text-primary">{step.title}</h2>
      <p className="mt-1 text-sm text-foreground/90" data-testid="trip-tour-texto">{step.text}</p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={next} data-testid="trip-tour-siguiente"
          className="min-h-[40px] rounded-xl border border-primary/60 px-4 text-sm font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {last ? "Entendido" : "Siguiente"}
        </button>
        {!last && (
          <button type="button" onClick={close} data-testid="trip-tour-saltar" className="min-h-[40px] text-xs text-muted-foreground underline-offset-2 hover:underline">
            Saltar
          </button>
        )}
      </div>
    </section>
  );
}
