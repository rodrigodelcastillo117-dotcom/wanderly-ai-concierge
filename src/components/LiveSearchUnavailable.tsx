import { CircleSlash, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export const LIVE_SEARCH_UNAVAILABLE = "Búsqueda en vivo no disponible ahora; intenta más tarde.";

/**
 * Aviso cuando el proveedor en vivo no respondió. Ofrece un link de búsqueda (sin precio) en el
 * sitio del socio; nunca muestra opciones con precio inventado.
 */
export function LiveSearchUnavailable({
  providerLabel,
  onSearch,
}: {
  providerLabel: string;
  onSearch?: () => void;
}) {
  return (
    <div role="status" className="glass-card rounded-xl p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <CircleSlash className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{LIVE_SEARCH_UNAVAILABLE}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            No mostramos precios que no pudimos consultar. Puedes buscar directamente en {providerLabel}.
          </p>
        </div>
      </div>
      {onSearch && (
        <Button size="sm" variant="outline" onClick={onSearch} className="shrink-0">
          Buscar en {providerLabel} <ExternalLink className="w-3 h-3 ml-1" />
        </Button>
      )}
    </div>
  );
}
