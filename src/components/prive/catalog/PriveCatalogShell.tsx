import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PriveErrorCode } from "@/lib/priveApi";
import { LOAD_ERROR } from "./usePriveLoad";
import { PriveLocked } from "./PriveLocked";
import { usePriveT } from "@/components/prive/PriveLang";
import { usePriveBack } from "@/components/prive/shell/PriveBack";

/**
 * Marco de las páginas del catálogo, dentro de PriveRoot (fondo, fuente y barra del grupo ui).
 * `back`/`backLabel` ya no dibujan un enlace aquí: se pasan al único botón de regresar de la barra.
 */
export function PriveCatalogShell({ loading, locked, error, back = "/prive", backLabel = "IATOS Privé", children }: {
  loading: boolean; locked: PriveErrorCode | null; error: string | null; back?: string; backLabel?: string; children: ReactNode;
}) {
  const t = usePriveT();
  // Con candado no se sube a otra área también bloqueada (antes "Regresar" llevaba de un candado a otro):
  // el botón de la barra sale de Privé.
  usePriveBack(locked ? null : back, locked ? null : backLabel);
  if (locked) return <PriveLocked code={locked} />;
  return (
    <div className="px-4 sm:px-8 pb-24 pt-2">
      <div className="mx-auto max-w-5xl space-y-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label={t.common.loading}>
            <Skeleton className="h-10 w-2/3 bg-[color:var(--pv-surface)]" /><Skeleton className="h-48 w-full bg-[color:var(--pv-surface)]" />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-amber-300">{error === LOAD_ERROR ? t.catalog.loadError : error}</p>
        ) : children}
      </div>
    </div>
  );
}
