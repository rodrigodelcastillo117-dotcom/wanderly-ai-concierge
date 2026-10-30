// "Mi mundo" en el Perfil (pestaña Avatar): el globo con los países y ciudades de todos tus viajes.
// Lo que Carlo extrañó: "el mundito con los países que viajas".
// Esta parte es ligera y va en el Perfil. Los viajes, el conteo y el globo (three.js, ~1.7 MB) se
// cargan de forma diferida solo cuando la sección está por verse: abrir el Perfil no descarga nada de esto.
import { Suspense, useRef } from "react";
import { Globe2 } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { MiMundoSkeleton } from "@/components/mundo/MiMundoSkeleton";
import { GlobeBoundary } from "@/components/mundo/GlobeBoundary";

const MiMundoPanel = lazyWithRetry(() => import("@/components/mundo/MiMundoPanel"));

export const MI_MUNDO_TITULO = "Mi mundo";

export function MiMundo() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, "150px");
  return (
    <section ref={ref} aria-labelledby="mi-mundo-title" data-testid="mi-mundo"
      className="glass-card rounded-3xl p-5 md:p-8 border border-primary/20 space-y-4 scroll-mt-20">
      <div>
        <p className="text-[10px] tracking-[0.3em] text-primary uppercase flex items-center gap-1.5">
          <Globe2 className="w-3.5 h-3.5" aria-hidden="true" /> {MI_MUNDO_TITULO}
        </p>
        <h2 id="mi-mundo-title" className="font-display text-2xl md:text-3xl mt-1">Los países de tus viajes</h2>
      </div>
      {inView ? (
        <GlobeBoundary mensaje="No pudimos mostrar tu mundo. Intenta de nuevo más tarde.">
          <Suspense fallback={<MiMundoSkeleton />}>
            <MiMundoPanel />
          </Suspense>
        </GlobeBoundary>
      ) : (
        <MiMundoSkeleton />
      )}
    </section>
  );
}

export default MiMundo;
