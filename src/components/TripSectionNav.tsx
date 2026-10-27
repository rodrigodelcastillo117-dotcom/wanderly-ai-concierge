// Pestañas fijas de la página del viaje: "Resumen · Comprar · Ruta · Destinos · Experiencias · Documentos". Se quedan
// arriba al bajar y en móvil se deslizan. Con teclado: flechas izquierda/derecha, Inicio y Fin.
// No se usa `position: sticky`: el <main> de DashboardLayout tiene overflow-x oculto (es el contenedor
// de desplazamiento para sticky y no se desplaza), así que la barra se fija con `fixed` al pasarla.
import { useEffect, useRef, useState } from "react";

export type TripSection = "resumen" | "comprar" | "ruta" | "destinos" | "experiencias" | "documentos";
const ALL: TripSection[] = ["resumen", "comprar", "ruta", "destinos", "experiencias", "documentos"];
export const isTripSection = (v: unknown): v is TripSection => typeof v === "string" && (ALL as string[]).includes(v);
/** Evento con que otra parte de la página pide mostrar una sección (detail = id de la sección). */
export const TRIP_SECTION_EVENT = "iatos:trip-section";

export function sectionFromHash(): TripSection {
  if (typeof window === "undefined") return "resumen";
  const h = window.location.hash.replace(/^#/, "");
  return isTripSection(h) ? h : "resumen";
}

export function TripSectionNav({ sections, active, onChange }: { sections: Array<{ id: TripSection; label: string }>; active: TripSection; onChange: (id: TripSection) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number | "first" | "last") => {
    const i = sections.findIndex((s) => s.id === active);
    const j = delta === "first" ? 0 : delta === "last" ? sections.length - 1 : (i + delta + sections.length) % sections.length;
    const next = sections[j].id;
    onChange(next);
    refs.current[next]?.focus();
  };
  const anchor = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => setStuck(!!anchor.current && anchor.current.getBoundingClientRect().top < 0);
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  return (
    <div ref={anchor} id="trip-secciones" className="relative h-12 scroll-mt-0">
    <nav aria-label="Secciones del viaje" data-stuck={stuck ? "1" : "0"}
      className={`${stuck ? "fixed top-0 left-0 right-0 lg:left-[200px]" : "absolute inset-x-0 top-0"} z-30 border-b border-border/60 bg-background/90 backdrop-blur-xl`} data-testid="trip-secciones">
      <div role="tablist" aria-label="Secciones del viaje" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto no-scrollbar px-3 sm:px-6 md:px-12"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
          else if (e.key === "Home") { e.preventDefault(); move("first"); }
          else if (e.key === "End") { e.preventDefault(); move("last"); }
        }}>
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <button key={s.id} ref={(el) => { refs.current[s.id] = el; }} type="button" role="tab" id={`tab-${s.id}`} aria-selected={on} aria-controls={`panel-${s.id}`}
              tabIndex={on ? 0 : -1} data-testid={`tab-${s.id}`} onClick={() => onChange(s.id)}
              className={`relative shrink-0 min-h-[48px] px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {s.label}
              <span aria-hidden="true" className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${on ? "bg-primary" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </nav>
    </div>
  );
}
