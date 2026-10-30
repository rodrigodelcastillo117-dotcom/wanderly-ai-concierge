// Una sola forma de planear (propuesta «Inicio sencillo», 30-oct-2026): el botón «Planear un viaje» de Inicio
// abre la MISMA ventana que el «+» de la barra inferior y el botón dorado del menú lateral (PlanTripDialog, que
// monta DashboardLayout). Vive aparte para que Inicio no cargue la ventana hasta que se pide.
// Si no hay ventana montada (pantallas sin el menú), quien llama recibe `false` y lleva a /dashboard/planear,
// la misma ruta que usa el «+» con Ctrl/⌘ o "abrir en otra pestaña".
type Listener = () => void;
const listeners: Listener[] = [];

/** Nombre de la acción principal de Inicio (la ventana que abre se llama «Planear viaje», como el menú lateral). */
export const PLAN_CTA = "Planear un viaje";

/** Abre la ventana «Planear viaje». Devuelve false si no hay ninguna montada. */
export function openPlanWindow(): boolean {
  const l = listeners[listeners.length - 1];
  if (!l) return false;
  l();
  return true;
}

export function onOpenPlanWindow(l: Listener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.lastIndexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}
