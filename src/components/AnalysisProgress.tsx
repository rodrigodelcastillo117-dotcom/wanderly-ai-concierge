import { useEffect, useState } from "react";
import { Plane, Hotel, MapPin, CalendarRange, Sparkles } from "lucide-react";
import { GlobeLoader } from "@/components/brand/GlobeLoader";
import { useSlowLoading } from "@/hooks/useSlowLoading";

// Qué hace analizar-viaje: las tres búsquedas corren en paralelo (~10–15 s) y luego la IA arma el
// viaje con esos datos (~40 s). El servidor NO reporta avance por etapa, así que esta pantalla no
// finge uno: antes palomeaba "Buscar vuelos" a los 9 s y llenaba una barra al 95 % aunque nada
// hubiera terminado. Ahora muestra lo que hace el análisis y una barra indeterminada; a los 5 s el
// globo IATOS reemplaza la barra (sin cronómetro: pedido del dueño) y si tarda más de lo normal, lo dice.
export const ANALYSIS_STEPS = [
  { icon: Plane, label: "Consultar vuelos (Google Flights / Aviasales, si responden)" },
  { icon: Hotel, label: "Consultar hoteles para tu estilo" },
  { icon: MapPin, label: "Buscar lugares y experiencias con reseñas" },
  { icon: CalendarRange, label: "Armar el itinerario día por día y el presupuesto en MXN" },
] as const;

export const SLOW_SECONDS = 90;

export function AnalysisProgress({ destino, summary }: { destino: string; summary?: string | null }) {
  const globe = useSlowLoading(true);
  // "Tarda más de lo normal": un solo aviso a los 90 s (sin contar segundos en pantalla).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_SECONDS * 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4 py-10 text-center">
      {!globe && (
        <div className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow motion-safe:animate-pulse" aria-hidden>
          <Sparkles className="w-7 h-7 text-primary-foreground" />
        </div>
      )}
      {globe && <GlobeLoader size="lg" className="mb-6" />}
      <h2 className="font-display text-3xl md:text-5xl mb-3">
        Preparando tu viaje a <span className="gold-text italic">{destino}</span>
      </h2>
      {summary && <p className="text-sm text-muted-foreground mb-6">{summary}</p>}

      <div className="w-full max-w-md mt-2">
        {!globe && (
          /* Barra indeterminada: sin aria-valuenow porque no sabemos el avance real. */
          <div className="h-1.5 rounded-full bg-surface overflow-hidden relative" role="progressbar" aria-label="Análisis en curso" aria-valuetext="En curso">
            <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-gold motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:opacity-50" />
          </div>
        )}
        <p className={`${globe ? "" : "mt-3 "}text-xs text-muted-foreground`} aria-live="polite" data-testid="analysis-status">
          {slow ? "Está tardando más de lo normal" : globe ? "Consultando proveedores en vivo y armando tu itinerario…" : "Suele tardar alrededor de un minuto"}
        </p>
      </div>

      <p className="w-full max-w-md text-left text-xs uppercase tracking-[0.2em] text-muted-foreground mt-10 mb-3">Qué incluye este análisis</p>
      <ul className="w-full max-w-md space-y-3 text-left">
        {ANALYSIS_STEPS.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm text-foreground/90">
            <span className="w-8 h-8 shrink-0 rounded-full border border-primary/30 bg-primary/[0.06] flex items-center justify-center" aria-hidden>
              <s.icon className="w-4 h-4 text-primary" />
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>

      <p className="w-full max-w-md text-left text-xs text-muted-foreground mt-6 leading-relaxed">
        {slow
          ? "Puede pasar cuando un proveedor responde lento. Seguimos esperando su respuesta; no cierres esta pantalla."
          : "Si un proveedor no responde, te lo indicamos en el viaje y ese precio aparece como no disponible o estimado."}
      </p>
    </div>
  );
}
