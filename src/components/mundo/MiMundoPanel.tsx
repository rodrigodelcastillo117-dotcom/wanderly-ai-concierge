// Contenido de "Mi mundo" (se importa de forma diferida desde MiMundo.tsx): lee tus viajes, cuenta los
// países (ya fuiste / planeados) y muestra el globo. El globo es otro import diferido: solo baja cuando su
// recuadro está por verse. Datos: solo tus viajes y las tablas de ciudades de la app; nunca se geocodifica
// (cero búsquedas de pago). Sin viajes: un estado vacío con el botón para planear.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useInView } from "@/hooks/useInView";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { localISODate } from "@/lib/localDate";
import { buildMiMundo, paisesTexto, type MiMundo, type MundoTrip } from "@/lib/miMundo";
import { MiMundoSkeleton } from "@/components/mundo/MiMundoSkeleton";
import { GlobeBoundary } from "@/components/mundo/GlobeBoundary";

const WorldGlobe3D = lazyWithRetry(() => import("@/components/mundo/WorldGlobe3D"));

// Los mismos tonos del globo (WorldGlobe3D.MUNDO_COLORES), sin importar el globo aquí.
const DORADO = "#e9cf8f";
const CELESTE = "#7fd4ff";

export default function MiMundoPanel() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<MundoTrip[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        // Solo lo necesario: de itinerario_json, únicamente la lista de ciudades (no los días).
        // (any: el tipo generado no resuelve la ruta JSON "itinerario_json->destinations").
        const trips: any = supabase.from("trips");
        const { data, error: e } = await trips
          .select("id, destino, pais_destino, fecha_salida, fecha_regreso, user_id, destinations:itinerario_json->destinations")
          .eq("user_id", user.id);
        if (e) throw e;
        if (!cancelled) setTrips(((data ?? []) as any[]).filter((t) => !t.user_id || t.user_id === user.id) as MundoTrip[]);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, reload]);

  const mundo = useMemo(() => (trips ? buildMiMundo(trips, localISODate()) : null), [trips]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border p-4 text-sm" role="status" data-testid="mi-mundo-error">
        <p>No pudimos cargar tus viajes para dibujar tu mundo.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setReload((n) => n + 1)}>Intentar de nuevo</Button>
      </div>
    );
  }
  if (!mundo) return <MiMundoSkeleton />;

  if (!mundo.paises.length && !mundo.ciudades.length) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5 text-center space-y-3" data-testid="mi-mundo-vacio">
        <p className="font-display text-xl">Tu mundo empieza con tu primer viaje</p>
        <p className="text-sm text-muted-foreground">
          Cada viaje que planees o hagas se pinta aquí: en dorado los países donde ya estuviste y en celeste los que tienes planeados.
        </p>
        <Button asChild className="bg-gradient-gold text-primary-foreground gold-glow min-h-[44px]">
          <Link to="/dashboard/planear" data-testid="mi-mundo-planear">
            <Plane className="w-4 h-4 mr-2" aria-hidden="true" /> Planear un viaje
          </Link>
        </Button>
      </div>
    );
  }

  const ciudades = mundo.ciudadesHechas + mundo.ciudadesPlaneadas;
  return (
    <div className="space-y-4" data-testid="mi-mundo-contenido">
      <p className="text-sm text-muted-foreground" data-testid="mi-mundo-conteo">
        <span className="text-foreground font-medium">{paisesTexto(mundo.paises.length)}</span> en tus viajes:{" "}
        <span style={{ color: DORADO }}>{mundo.paisesHechos} ya {mundo.paisesHechos === 1 ? "visitado" : "visitados"}</span>
        {" · "}
        <span style={{ color: CELESTE }}>{mundo.paisesPlaneados} {mundo.paisesPlaneados === 1 ? "planeado" : "planeados"}</span>
        {" · "}{ciudades} {ciudades === 1 ? "ciudad" : "ciudades"}
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-3">
          <p className="font-display text-3xl" style={{ color: DORADO }} data-testid="mi-mundo-hechos">{mundo.paisesHechos}</p>
          <p className="text-[11px] text-muted-foreground leading-tight mt-1">{mundo.paisesHechos === 1 ? "país que ya conoces" : "países que ya conoces"}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "rgba(127,212,255,0.3)", background: "rgba(127,212,255,0.05)" }}>
          <p className="font-display text-3xl" style={{ color: CELESTE }} data-testid="mi-mundo-planeados">{mundo.paisesPlaneados}</p>
          <p className="text-[11px] text-muted-foreground leading-tight mt-1">{mundo.paisesPlaneados === 1 ? "país planeado" : "países planeados"}</p>
        </div>
        <div className="rounded-2xl border border-border p-3">
          <p className="font-display text-3xl">{ciudades}</p>
          <p className="text-[11px] text-muted-foreground leading-tight mt-1">{ciudades === 1 ? "ciudad" : "ciudades"}</p>
        </div>
      </div>

      <GlobeSlot mundo={mundo} />

      <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Colores del globo">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: DORADO }} aria-hidden="true" /> Ya fuiste</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: CELESTE }} aria-hidden="true" /> Planeado</span>
        <span className="ml-auto italic">Arrastra para girar</span>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Países de tus viajes" data-testid="mi-mundo-paises">
        {mundo.paises.map((p) => (
          <li key={p.iso2 ?? p.name} data-estado={p.estado}
            className="px-2.5 py-1 rounded-full border text-xs inline-flex items-center gap-1.5"
            style={p.estado === "hecho"
              ? { borderColor: "rgba(201,169,97,0.45)", background: "rgba(201,169,97,0.1)", color: DORADO }
              : { borderColor: "rgba(127,212,255,0.35)", background: "rgba(127,212,255,0.06)", color: "#bff0ff" }}>
            <span aria-hidden="true">{p.flag}</span> {p.name}
            <span className="sr-only">{p.estado === "hecho" ? " (ya fuiste)" : " (planeado)"}</span>
          </li>
        ))}
      </ul>

      {mundo.sinCoordenadas.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="mi-mundo-sin-punto">
          Sin punto en el globo (su país sí cuenta): {mundo.sinCoordenadas.slice(0, 6).join(", ")}{mundo.sinCoordenadas.length > 6 ? "…" : ""}.
        </p>
      )}

      <Link to="/dashboard/viajes" className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
        Ver mis viajes <ArrowRight className="w-3 h-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** El recuadro del globo: el import de three.js (~1.7 MB) solo sale cuando este recuadro está por verse. */
function GlobeSlot({ mundo }: { mundo: MiMundo }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, "100px");
  return (
    <div ref={ref} data-testid="mi-mundo-globo">
      {inView ? (
        <GlobeBoundary height={340}>
          <Suspense fallback={<MiMundoSkeleton label="Cargando el globo…" />}>
            <WorldGlobe3D ciudades={mundo.ciudades} paises={mundo.paises} />
          </Suspense>
        </GlobeBoundary>
      ) : (
        <MiMundoSkeleton label="Cargando el globo…" />
      )}
    </div>
  );
}
