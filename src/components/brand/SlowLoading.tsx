// Carga que pasa de 5 s: los primeros segundos se ve lo de siempre (`children`: spinner, esqueleto o
// texto); después, el GlobeLoader con el estado honesto como `label`. Sirve en línea (bajo un botón),
// como sección o a pantalla completa (fallback de Suspense / rutas lazy).
import type { ReactNode } from "react";
import { GlobeLoader, type GlobeLoaderSize } from "./GlobeLoader";
import { useSlowLoading, SLOW_LOADING_MS } from "@/hooks/useSlowLoading";

export interface SlowLoadingProps {
  active: boolean;
  label?: string;
  srLabel?: string;
  size?: GlobeLoaderSize;
  /** Ocupa la pantalla (fondo negro del sistema), para el fallback de una ruta. */
  fullScreen?: boolean;
  /** Lo que se ve mientras no pasan los `ms` (por omisión, nada). */
  children?: ReactNode;
  ms?: number;
  className?: string;
}

export function SlowLoading({ active, label, srLabel, size, fullScreen = false, children = null, ms = SLOW_LOADING_MS, className = "" }: SlowLoadingProps) {
  const slow = useSlowLoading(active, ms);
  if (!active) return null;
  if (!slow) return <>{children}</>;
  const globe = <GlobeLoader size={size ?? (fullScreen ? "lg" : "md")} label={label} srLabel={srLabel} />;
  if (fullScreen) {
    return <div className={`min-h-screen flex items-center justify-center bg-background px-4 ${className}`} data-testid="slow-loading">{globe}</div>;
  }
  return <div className={`flex justify-center py-4 ${className}`} data-testid="slow-loading">{globe}</div>;
}

export default SlowLoading;
