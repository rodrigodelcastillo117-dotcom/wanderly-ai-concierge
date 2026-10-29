/**
 * Chunks de las pantallas con las que más se abre la app (Rendimiento, cierre 2026-10).
 *
 * El chunk de la pantalla de la URL inicial se pide en cuanto arranca el JS (main.tsx), en paralelo
 * con la sesión y el estado de onboarding; antes se pedía hasta que ProtectedRoute terminaba esas
 * consultas (en 3G: ~1–2 s de espera en serie). App.tsx usa los mismos import() para sus lazy(), así
 * que no se descarga dos veces. vite.routePreload.ts tiene la misma tabla para el HTML (una prueba
 * en src/test/rendimientoApp.test.tsx comprueba que coinciden).
 */
export const loadDashboardHome = () => import("@/pages/DashboardHome");
export const loadTrips = () => import("@/pages/Trips");
export const loadTripDetail = () => import("@/pages/TripDetail");
export const loadConcierge = () => import("@/pages/Concierge");
export const loadAuth = () => import("@/pages/Auth");
// Ayuda y páginas legales (ronda 2, P2-4: /ayuda tenía LCP móvil de 4.0 s por la cascada index → Legal).
export const loadLegal = () => import("@/pages/Legal");

export const INITIAL_ROUTE_CHUNKS: [RegExp, () => Promise<unknown>][] = [
  [/^\/dashboard\/?$/, loadDashboardHome],
  [/^\/dashboard\/viajes\/?$/, loadTrips],
  [/^\/dashboard\/viajes\/[^/]+\/?$/, loadTripDetail],
  [/^\/dashboard\/concierge\/?$/, loadConcierge],
  [/^\/auth\/?$/, loadAuth],
  [/^\/(ayuda|terminos|privacidad|cookies|reembolsos)\/?$/, loadLegal],
];

export function preloadInitialRoute(pathname: string): boolean {
  const hit = INITIAL_ROUTE_CHUNKS.find(([re]) => re.test(pathname));
  if (!hit) return false;
  // Si falla, el lazy() de la ruta lo vuelve a intentar (y recarga una vez si el hash ya no existe).
  void hit[1]().catch(() => {});
  return true;
}
