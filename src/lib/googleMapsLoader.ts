// Cargador único de Google Maps JS para todas las pantallas (Cercanos, Mapa del viaje).
//
// Por qué (N-01): con `loading=async`, `window.google.maps` existe en cuanto llega el script, pero
// las clases (Map, Marker…) aparecen hasta que se importan sus librerías. Cercanos veía
// `google.maps`, daba el mapa por listo y tronaba con "google.maps.Map is not a constructor".
// Además cada pantalla insertaba su propio <script>. Aquí hay una sola promesa (single-flight) que
// solo se resuelve cuando `google.maps.Map` y `google.maps.Marker` son constructores reales; si
// algo falla, se rechaza (la pantalla muestra un aviso) y el siguiente intento vuelve a probar.

const SCRIPT_ID = "gmaps-js";
const CALLBACK = "__iatosGmapsReady";
export const GMAPS_TIMEOUT_MS = 15000;

type MapsNS = any;

declare global {
  interface Window {
    google: any;
    [CALLBACK]?: () => void;
  }
}

let loading: Promise<MapsNS> | null = null;

/** Solo para pruebas. */
export function __resetGoogleMapsLoader() {
  loading = null;
}

const isCtor = (v: unknown) => typeof v === "function";
const ready = () => isCtor(window.google?.maps?.Map) && isCtor(window.google?.maps?.Marker);

function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cond()) return resolve();
    const started = Date.now();
    const id = setInterval(() => {
      if (cond()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(id);
        reject(new Error(`Google Maps no respondió (${what})`));
      }
    }, 50);
  });
}

function injectScript(key: string, channel?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Ya hay un script de Maps (de esta u otra pantalla): esperamos a que exponga la API.
    const existing = document.getElementById(SCRIPT_ID) ?? document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      waitFor(() => Boolean(window.google?.maps), GMAPS_TIMEOUT_MS, "script").then(resolve, reject);
      return;
    }
    window[CALLBACK] = () => resolve();
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.async = true;
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=places&language=es&callback=${CALLBACK}${channel ? `&channel=${encodeURIComponent(channel)}` : ""}`;
    document.head.appendChild(s);
  });
}

/**
 * Resuelve con `window.google.maps` cuando Map y Marker ya se pueden construir. Una sola carga
 * aunque la pidan varias pantallas a la vez.
 */
export function loadGoogleMaps(): Promise<MapsNS> {
  if (ready()) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = (async () => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
    if (!window.google?.maps) {
      if (!key) throw new Error("Google Maps no está configurado");
      await injectScript(key, import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined);
    }
    const g = window.google.maps;
    if (isCtor(g.importLibrary)) {
      // Llenan google.maps.* (Map, Marker, LatLngBounds, SymbolPath…).
      await Promise.all([g.importLibrary("core"), g.importLibrary("maps"), g.importLibrary("marker")]);
    }
    // Con la carga clásica (o si importLibrary tarda en poblar el espacio de nombres) esperamos.
    await waitFor(ready, GMAPS_TIMEOUT_MS, "Map");
    return window.google.maps;
  })();
  // Si falló, que el siguiente intento vuelva a probar en lugar de heredar el error.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
