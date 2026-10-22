import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Sparkles } from "lucide-react";

// Etapas reales de analizar-viaje: las tres búsquedas corren en paralelo (~10–15 s) y luego la
// IA arma el viaje con esos datos (~40 s). Los tiempos marcan cuándo suele terminar cada una.
export const ANALYSIS_STEPS = [
  { label: "Vuelos en vivo de Google Flights y Aviasales", doneAt: 9 },
  { label: "Hoteles mejor calificados para tu estilo", doneAt: 12 },
  { label: "Lugares y experiencias con reseñas reales", doneAt: 15 },
  { label: "Itinerario día por día y presupuesto en MXN", doneAt: Infinity },
] as const;

const TYPICAL_SECONDS = 55;

export function AnalysisProgress({ destino }: { destino: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  // Avanza rápido al inicio y se frena cerca del final: nunca llega a 100 antes de la respuesta.
  const pct = Math.round(95 * (1 - Math.exp(-elapsed / (TYPICAL_SECONDS / 2.5))));
  const current = ANALYSIS_STEPS.findIndex((s) => elapsed < s.doneAt);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <motion.div
        animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2.4, repeat: Infinity }}
        className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
      >
        <Sparkles className="w-7 h-7 text-primary-foreground" />
      </motion.div>
      <h2 className="font-display text-3xl md:text-5xl mb-8">
        Analizando tu viaje a <span className="gold-text italic">{destino}</span>
      </h2>

      <ol className="w-full max-w-md space-y-3 text-left" aria-live="polite">
        {ANALYSIS_STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className="flex items-center gap-3">
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border ${
                  done ? "bg-primary border-primary text-primary-foreground" : "border-border"
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : null}
              </span>
              <span className={done || active ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="w-full max-w-md mt-8">
        <div
          className="h-1.5 rounded-full bg-surface overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Avance del análisis"
        >
          <div className="h-full bg-gradient-gold transition-all duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {elapsed < TYPICAL_SECONDS
            ? "Suele tardar menos de un minuto: estamos consultando precios reales de hoy."
            : "Ya casi: estamos terminando de armar tu itinerario."}
        </p>
      </div>
    </div>
  );
}
