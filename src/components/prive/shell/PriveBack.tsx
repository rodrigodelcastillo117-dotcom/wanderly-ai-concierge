// Un solo botón de regresar en todo Privé, arriba a la izquierda (en la barra de PriveRoot).
// En la portada y en las áreas principales sale de Privé ("← IATOS"); una página interna (destino,
// universo, experiencia, nota del Insider, artículo de la revista) le dice a la barra a dónde subir
// con usePriveBack. Ninguna página dibuja su propio "← …": antes salían dos botones a la vez.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PriveBackTarget = { to: string; label: string } | null;

const Ctx = createContext<{ target: PriveBackTarget; set: (t: PriveBackTarget) => void } | null>(null);

export function PriveBackProvider({ children }: { children: ReactNode }) {
  const [target, set] = useState<PriveBackTarget>(null);
  return <Ctx.Provider value={{ target, set }}>{children}</Ctx.Provider>;
}

/** Destino del botón de la barra; null = salir de Privé. */
export function usePriveBackTarget(): PriveBackTarget {
  return useContext(Ctx)?.target ?? null;
}

/**
 * Una página interna declara a dónde regresa. Sin destino, o con "/prive" (la portada, que siempre
 * está en la barra de abajo), el botón de la barra sale de Privé.
 */
export function usePriveBack(to?: string | null, label?: string | null) {
  const set = useContext(Ctx)?.set;
  const target = to && label && to !== "/prive" && to !== "/prive/" ? { to, label } : null;
  const key = target ? `${target.to}\u0000${target.label}` : "";
  useEffect(() => {
    if (!set) return;
    set(target);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, key]);
}
