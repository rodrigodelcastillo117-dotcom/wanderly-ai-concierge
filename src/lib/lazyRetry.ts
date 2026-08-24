import { lazy, type ComponentType } from "react";

/**
 * React.lazy() wrapper that survives a redeploy.
 *
 * Con code-splitting, cada página se pide como un archivo con hash (ej. TripDetail-C_1wWrmE.js).
 * Si publicamos una nueva versión mientras alguien tiene la app abierta (o con el HTML cacheado),
 * ese hash ya no existe en el servidor y el import() truena con
 * "Failed to fetch dynamically imported module" — sin manejo, eso tumba TODO el árbol de React
 * (no hay Error Boundary) y deja la pantalla en negro.
 *
 * Este wrapper detecta ese error puntual y recarga la página UNA sola vez (banderita en
 * sessionStorage para no hacer loop infinito si el problema es otro). El reload trae el
 * index.html nuevo con los hashes correctos y el usuario ni se entera.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    const key = `chunk-retry:${factory.toString()}`;
    try {
      const mod = await factory();
      sessionStorage.removeItem(key);
      return mod;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isChunkError =
        /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
          message,
        );
      const alreadyRetried = sessionStorage.getItem(key) === "1";
      if (isChunkError && !alreadyRetried) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        // Cuelga la promesa a propósito: la página se está recargando, no hay nada más que hacer.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
