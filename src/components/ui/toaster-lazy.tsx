import { Suspense, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { lazyWithRetry } from "@/lib/lazyRetry";

// El Toaster de Radix (shadcn) solo lo usan Pro y Members Only. Antes iba en App.tsx y metía Radix
// Toast (+ colección, capa descartable, portal) en el paquete inicial de todas las visitas. Ahora se
// descarga la primera vez que alguien llama a toast() de "@/hooks/use-toast": el estado de los avisos
// vive en ese módulo (sin Radix), así que el aviso que llegó mientras se descargaba se muestra igual.
const Toaster = lazyWithRetry(() => import("@/components/ui/toaster").then((m) => ({ default: m.Toaster })));

export function LazyToaster() {
  const { toasts } = useToast();
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    if (toasts.length) setNeeded(true);
  }, [toasts.length]);
  if (!needed && !toasts.length) return null;
  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  );
}
