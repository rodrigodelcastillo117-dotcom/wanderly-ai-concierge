import { useEffect, useState } from "react";

/** A partir de cuántos ms una carga se considera "lenta" y se muestra el GlobeLoader. */
export const SLOW_LOADING_MS = 5000;

/**
 * true cuando `active` lleva más de `ms` (5 s por omisión) seguido en true. Vuelve a false en cuanto
 * la carga termina, y el conteo reinicia si vuelve a empezar. Sin intervalos ni cronómetro: un solo
 * setTimeout por carga.
 */
export function useSlowLoading(active: boolean, ms: number = SLOW_LOADING_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return active && slow;
}
