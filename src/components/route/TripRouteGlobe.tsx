// El globo de la ruta ("el mundito") dentro de la página de un viaje de varias ciudades (pestaña
// Itinerario): el mismo RouteGlobe3D de /dashboard/ruta, con el origen y cada ciudad en orden.
// Rendimiento: el globo (three.js, ~1.7 MB) se importa de forma diferida y SOLO cuando su recuadro está
// en la pestaña visible y por entrar en pantalla; al cambiar de pestaña se desmonta (no gira a escondidas).
import { Suspense, useMemo, useRef } from "react";
import { Globe2 } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { GlobeBoundary } from "@/components/mundo/GlobeBoundary";

const RouteGlobe3D = lazyWithRetry(() =>
  import("@/components/RouteGlobe3D").then((m) => ({ default: m.RouteGlobe3D }))
);

const GLOBE_HEIGHT = 300;

function Placeholder() {
  return (
    <div className="rounded-3xl border border-primary/20 bg-card p-4 animate-pulse" style={{ minHeight: GLOBE_HEIGHT + 72 }} role="status" aria-label="Cargando el globo de tu ruta…">
      <div className="flex items-center gap-2 text-primary/60"><Globe2 className="w-4 h-4" aria-hidden="true" /><span className="text-[10px] tracking-[0.25em] uppercase">Ruta 3D</span></div>
      <div className="mt-3 rounded-2xl bg-black/60" style={{ height: GLOBE_HEIGHT }} />
    </div>
  );
}

type Props = { origin?: string | null; destinations: string[]; /** La pestaña que lo contiene está a la vista. */ active: boolean };

export function TripRouteGlobe({ origin, destinations, active }: Props) {
  // La misma lista en cada render (el globo vuelve a trazar la ruta si cambia la referencia).
  const key = destinations.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dests = useMemo(() => destinations, [key]);
  if (dests.length < 2) return null;
  return <GlobeSlot origin={origin} destinations={dests} active={active} />;
}

/** El recuadro del globo: se monta junto con su observador (useInView mira el elemento al montarse). */
function GlobeSlot({ origin, destinations, active }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, "100px");
  return (
    <div ref={ref} data-testid="viaje-globo">
      {active && inView ? (
        <GlobeBoundary height={GLOBE_HEIGHT}>
          <Suspense fallback={<Placeholder />}>
            <RouteGlobe3D origin={origin ?? undefined} destinations={destinations} height={GLOBE_HEIGHT} />
          </Suspense>
        </GlobeBoundary>
      ) : (
        <Placeholder />
      )}
    </div>
  );
}

export default TripRouteGlobe;
