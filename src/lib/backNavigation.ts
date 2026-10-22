// "Volver" sin salir de la app (E-26).
//
// BackButton hacía navigate(-1) si window.history.length > 1, pero ese contador incluye las
// páginas de OTROS sitios: quien abría un enlace directo (correo, WhatsApp, Google) y tocaba
// "Volver" salía de IATOS. Ahora solo se regresa en el historial si la entrada anterior es de la
// app; si no, se va a la pantalla "padre" dentro de la app.

/** Pantallas raíz de la navegación (barra inferior, menú lateral y "Más"): no llevan "Volver". */
export const TAB_ROOTS = new Set([
  "/",
  "/dashboard",
  "/dashboard/viajes",
  "/dashboard/planear",
  "/dashboard/concierge",
  "/dashboard/cercanos",
  "/dashboard/favoritos",
  "/dashboard/social",
  "/dashboard/gastos",
  "/dashboard/reservas",
  "/dashboard/pro",
  "/dashboard/perfil",
]);

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export const isTabRoot = (pathname: string) => TAB_ROOTS.has(trimSlash(pathname));

/** A dónde lleva "Volver" cuando no hay una pantalla anterior de la app. */
export function backFallback(pathname: string): string {
  const p = trimSlash(pathname);
  const trip = /^\/dashboard\/viajes\/([^/]+)(\/.+)?$/.exec(p);
  if (trip) return trip[2] ? `/dashboard/viajes/${trip[1]}` : "/dashboard/viajes";
  if (p.startsWith("/onboarding/")) return "/dashboard/perfil";
  if (p.startsWith("/dashboard/social/")) return "/dashboard/social";
  return "/dashboard";
}

/**
 * ¿La entrada anterior del historial es de la app? React Router guarda en history.state el
 * índice `idx` de la entrada (0 = la primera de esta pestaña). Sin ese dato (p. ej. en pruebas),
 * la primera entrada tiene location.key === "default".
 */
export function hasInAppHistory(locationKey: string, historyState: unknown = safeHistoryState()): boolean {
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  if (typeof idx === "number") return idx > 0;
  return locationKey !== "default";
}

function safeHistoryState(): unknown {
  try {
    return typeof window !== "undefined" ? window.history.state : null;
  } catch {
    return null;
  }
}
