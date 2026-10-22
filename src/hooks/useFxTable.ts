import { useEffect, useState } from "react";
import { fetchFxTable, type FxTable } from "@/lib/fx";

/** Tipo de cambio para la pantalla (null mientras carga). Ver src/lib/fx.ts. */
export function useFxTable(): FxTable | null {
  const [table, setTable] = useState<FxTable | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFxTable().then((t) => { if (!cancelled) setTable(t); });
    return () => { cancelled = true; };
  }, []);
  return table;
}
