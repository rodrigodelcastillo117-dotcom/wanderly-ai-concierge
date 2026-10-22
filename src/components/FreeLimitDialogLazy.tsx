// Montaje perezoso del diálogo de límite del plan. App solo escucha el estado (freeLimitStore, sin
// dependencias); el diálogo, sus textos (functionErrors) y el Dialog de la UI se descargan la
// primera vez que hay que mostrarlo. Así la primera carga de la landing pesa menos (E-23).
import { Suspense, useState, useSyncExternalStore } from "react";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { getFreeLimitDialog, subscribeFreeLimitDialog } from "@/lib/freeLimitStore";

const Host = lazyWithRetry(() => import("./FreeLimitDialog").then((m) => ({ default: m.FreeLimitDialogHost })));

export function FreeLimitDialogLazyHost() {
  const info = useSyncExternalStore(subscribeFreeLimitDialog, getFreeLimitDialog, getFreeLimitDialog);
  // Una vez cargado se queda montado: cerrar conserva la animación de salida del diálogo.
  const [needed, setNeeded] = useState(false);
  if (info && !needed) setNeeded(true);
  if (!needed && !info) return null;
  return (
    <Suspense fallback={null}>
      <Host />
    </Suspense>
  );
}
