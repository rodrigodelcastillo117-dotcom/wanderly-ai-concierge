import { Navigation2 } from "lucide-react";
import { isMobileDevice, takeMeThereUrl, type TakeMeThereTarget, type TravelMode } from "@/lib/takeMeThere";

/**
 * Botón "Llévame": abre Google Maps (URL oficial) con la ruta al lugar. Solo aparece si el lugar trae
 * place_id de Google o coordenadas. El origen lo pone Google Maps desde el dispositivo.
 */
export function TakeMeThereButton({ target, mode = "driving", origin, onOpen, className = "" }: {
  target: TakeMeThereTarget;
  mode?: TravelMode;
  /** Solo si el usuario escribió una dirección de salida. */
  origin?: string | null;
  onOpen?: (url: string) => void;
  className?: string;
}) {
  const url = takeMeThereUrl(target, { mode, origin, mobile: isMobileDevice() });
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="take-me-there"
      aria-label={target.name ? `Llévame a ${target.name} con Google Maps` : "Llévame con Google Maps"}
      onClick={() => onOpen?.(url)}
      className={`inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/20 transition min-h-[32px] ${className}`}>
      <Navigation2 className="w-3.5 h-3.5" aria-hidden="true" /> Llévame
    </a>
  );
}
