import { useEffect, useState, type ReactNode } from "react";
import { usePriveT } from "@/components/prive/PriveLang";

export const PRIVE_PAGE = 9;

/**
 * Lista con "Ver más": nunca una lista infinita (dueño, 2026-10-22). Muestra `page` elementos y suma
 * otros tantos por toque; vuelve al inicio cuando cambia la lista (filtro, destino).
 */
export function ShowMore<T>({ items, render, page = PRIVE_PAGE, resetKey, className = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" }: {
  items: T[]; render: (item: T) => ReactNode; page?: number; resetKey?: string; className?: string;
}) {
  const t = usePriveT();
  const [n, setN] = useState(page);
  useEffect(() => { setN(page); }, [resetKey, page]);
  const shown = items.slice(0, n);
  const rest = items.length - shown.length;
  return (
    <div className="space-y-5">
      <div className={className} data-testid="prive-paged-list">{shown.map(render)}</div>
      {items.length > page && (
        <div className="flex flex-wrap items-center justify-center gap-4">
          <p className="text-xs prive-muted" aria-live="polite">{t.catalog.shown(shown.length, items.length)}</p>
          {rest > 0
            ? <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setN((v) => v + page)}>{t.common.showMore(rest)}</button>
            : <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setN(page)}>{t.common.showLess}</button>}
        </div>
      )}
    </div>
  );
}
