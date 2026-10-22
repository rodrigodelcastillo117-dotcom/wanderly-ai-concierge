import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { EXAMPLE_PROMPTS } from "@/lib/planDefaults";

/**
 * Estado vacío de Inicio para quien aún no tiene viajes: una franja compacta (no una pantalla
 * completa) que dice qué pasa en una línea y ofrece ejemplos para empezar con un toque. Los
 * ejemplos solo llenan el campo de texto; nada se analiza sin que el usuario lo pida.
 */
export function FirstTripGuide({ onPickExample }: { onPickExample: (text: string) => void }) {
  const navigate = useNavigate();
  return (
    <section aria-labelledby="first-trip-title" className="animate-fade-up rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.08] to-transparent px-4 py-3.5 md:px-5 md:py-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
        <div className="min-w-0 flex-1">
          <h2 id="first-trip-title" className="font-display text-lg md:text-xl leading-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0" aria-hidden />
            Planea tu primer viaje <span className="italic gold-text">en un minuto</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Dinos a dónde y cuándo; IATOS busca vuelos y hoteles y te da el total en pesos, marcando qué es en vivo y qué es estimado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard/planear")}
          className="min-h-[44px] shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-gold text-primary-foreground text-sm font-medium px-5 hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Planear mi primer viaje <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-nowrap overflow-x-auto gap-2 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap" aria-label="Ejemplos para empezar">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPickExample(ex)}
            className="min-h-[36px] shrink-0 whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.03] px-3 text-[11px] text-foreground/80 hover:border-primary/50 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            “{ex}”
          </button>
        ))}
      </div>
    </section>
  );
}
