import { useCallback, useEffect, useState } from "react";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import type { PriveErrorCode } from "@/lib/priveApi";

/** Marca de error genérico: el marco lo muestra en el idioma de la persona. */
export const LOAD_ERROR = "No se pudo cargar esta selección. Intenta de nuevo en un momento.";

/** Carga con estados honestos: cargando, bloqueado (PRIVE_*), error, listo. */
export function usePriveLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState<PriveErrorCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    load().then((d) => { if (alive) setData(d); })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof PriveLockedError) setLocked(e.code);
        else setError(LOAD_ERROR);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, loading, locked, setLocked, error, reload };
}
