import { useNavigate } from "react-router-dom";
import { ArrowRight, MapPin, Search, Receipt } from "lucide-react";
import { EXAMPLE_PROMPTS } from "@/lib/planDefaults";

/**
 * Estado vacío de Inicio para quien aún no tiene viajes: en vez de una lista vacía ("Aún no tienes
 * viajes planeados") explica en tres pasos qué va a pasar y ofrece ejemplos para empezar con un
 * toque. Los ejemplos solo llenan el campo de texto; nada se analiza sin que el usuario lo pida.
 */
export function FirstTripGuide({ onPickExample }: { onPickExample: (text: string) => void }) {
  const navigate = useNavigate();
  const steps = [
    { icon: MapPin, title: "Dinos a dónde y cuándo", text: "Escríbelo como se lo dirías a un amigo, o elige destino y fechas." },
    { icon: Search, title: "IATOS busca y arma el plan", text: "Consulta vuelos y hoteles con los proveedores y propone un itinerario." },
    { icon: Receipt, title: "Ves el total en pesos", text: "Cada precio dice si se consultó en vivo o es una estimación." },
  ];
  return (
    <section aria-labelledby="first-trip-title" className="animate-fade-up relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.1] via-white/[0.02] to-transparent p-5 md:p-9">
      <p className="text-[11px] uppercase tracking-[0.25em] text-primary font-semibold">Tu primer viaje</p>
      <h2 id="first-trip-title" className="font-display text-3xl md:text-5xl leading-[1.05] mt-2">
        Planea tu primer viaje <span className="italic gold-text">en un minuto</span>
      </h2>
      <ol className="mt-6 grid gap-3 md:grid-cols-3 md:gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-black/25 p-4">
            <span aria-hidden className="w-9 h-9 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center font-display">{i + 1}</span>
            <div className="min-w-0">
              <p className="font-medium text-sm flex items-center gap-1.5"><s.icon className="w-3.5 h-3.5 text-primary" aria-hidden />{s.title}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col md:flex-row md:items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/dashboard/planear")}
          className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-primary-foreground font-medium px-6 hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Planear mi primer viaje <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
        <div className="flex flex-wrap gap-2" aria-label="Ejemplos para empezar">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onPickExample(ex)}
              className="min-h-[40px] rounded-full border border-white/[0.1] bg-white/[0.03] px-3.5 text-xs text-foreground/85 hover:border-primary/50 hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              “{ex}”
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
