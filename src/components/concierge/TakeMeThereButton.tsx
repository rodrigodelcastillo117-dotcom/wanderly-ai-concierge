import { createContext, useContext } from "react";
import { Navigation2 } from "lucide-react";
import { chooseTravelMode, isMobileDevice, takeMeThereUrl, type TakeMeThereTarget, type TravelMode } from "@/lib/takeMeThere";

/** Dónde está la persona (la pantalla que ya la conoce: el chat de Iato, Cercanos). Sin pedir permisos nuevos. */
export type TakeMeFrom = { coords: { lat: number; lng: number } | null; city?: string | null };
export const TakeMeFromContext = createContext<TakeMeFrom | null>(null);

const MODE_HINT: Partial<Record<TravelMode, string>> = { walking: "a pie", transit: "en transporte" };

/**
 * Botón "Llévame": abre Google Maps (URL oficial) con la ruta al lugar. Solo aparece si el lugar trae
 * place_id de Google o coordenadas. El origen lo pone Google Maps desde el dispositivo. Sin `mode`, se
 * elige según la distancia (chooseTravelMode): a pie si está cerca, transporte público en distancia media
 * en ciudades con buen transporte, coche si es lejos o no se sabe dónde está la persona.
 */
export function TakeMeThereButton({ target, mode, origin, from, onOpen, className = "" }: {
  target: TakeMeThereTarget;
  mode?: TravelMode;
  /** Solo si el usuario escribió una dirección de salida. */
  origin?: string | null;
  /** Dónde está la persona (si no, la del contexto de la pantalla). */
  from?: TakeMeFrom | null;
  onOpen?: (url: string) => void;
  className?: string;
}) {
  const ctx = useContext(TakeMeFromContext);
  const here = from ?? ctx;
  const chosen: TravelMode = mode ?? chooseTravelMode({ from: here?.coords ?? null, to: target, city: here?.city ?? null });
  const url = takeMeThereUrl(target, { mode: chosen, origin, mobile: isMobileDevice() });
  if (!url) return null;
  const hint = MODE_HINT[chosen];
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="take-me-there" data-mode={chosen}
      aria-label={`${target.name ? `Llévame a ${target.name}` : "Llévame"}${hint ? ` ${hint}` : ""} con Google Maps`}
      onClick={() => onOpen?.(url)}
      className={`inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/20 transition min-h-[32px] ${className}`}>
      <Navigation2 className="w-3.5 h-3.5" aria-hidden="true" /> Llévame{hint ? <span className="text-primary/80"> · {hint}</span> : null}
    </a>
  );
}
