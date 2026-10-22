import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import type { PriveErrorCode } from "@/lib/priveApi";
import { PriveLocked } from "./PriveLocked";
import { PRIVE } from "./theme";

/** Marco de las páginas del catálogo, dentro de PriveRoot (fondo, fuente y barra del grupo ui). */
export function PriveCatalogShell({ loading, locked, error, back = "/prive", backLabel = "IATOS Privé", children }: {
  loading: boolean; locked: PriveErrorCode | null; error: string | null; back?: string; backLabel?: string; children: ReactNode;
}) {
  if (locked) return <PriveLocked code={locked} />;
  return (
    <div className="px-4 sm:px-8 pb-24 pt-2">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link to={back} className={`inline-flex items-center gap-1 text-sm ${PRIVE.muted} hover:text-[color:var(--pv-champagne)]`}><ArrowLeft className="h-4 w-4" />{backLabel}</Link>
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Cargando">
            <Skeleton className="h-10 w-2/3 bg-[color:var(--pv-surface)]" /><Skeleton className="h-48 w-full bg-[color:var(--pv-surface)]" />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-amber-300">{error}</p>
        ) : children}
      </div>
    </div>
  );
}
