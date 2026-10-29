import { Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useSubscription, type AccessState } from "@/hooks/useSubscription";

/**
 * ¿Hay que avisar antes de confirmar? Solo en el plan gratuito con límites activos, cuando lo que se va a
 * confirmar es el ÚLTIMO análisis disponible (el de cortesía es uno solo). Con PRO, sin datos o con
 * más de uno disponible, no se dice nada.
 */
export function lastFreeAnalysis(access: AccessState | null | undefined): { once: boolean } | null {
  if (!access || access.is_pro || access.limits_enforced === false) return null;
  if (access.trips_remaining !== 1) return null;
  return { once: access.trips_period === "once" || access.trips_limit === 1 };
}

/** Aviso en "Tu viaje, como lo entendimos": que el usuario nuevo no gaste su único análisis sin saberlo. */
export function FreeAnalysisNotice() {
  const { access } = useSubscription();
  const last = lastFreeAnalysis(access);
  if (!last) return null;
  return (
    <p role="note" data-testid="plan-aviso-cortesia"
      className="mb-4 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground/90">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        {last.once
          ? "Plan gratuito: este será tu análisis de viaje de cortesía (es uno solo). Revisa destino y fechas antes de confirmar."
          : "Plan gratuito: este es el último análisis de viaje que te queda este mes. Revisa destino y fechas antes de confirmar."}{" "}
        <Link to="/dashboard/pro" className="text-primary underline underline-offset-2">Ver planes</Link>
      </span>
    </p>
  );
}
