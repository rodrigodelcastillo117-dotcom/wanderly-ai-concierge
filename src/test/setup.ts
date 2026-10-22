import "@testing-library/jest-dom";
import { afterEach } from "vitest";

// Pruebas herméticas (P3-QA-2): ninguna prueba sale a la red. Antes una corrida mandaba unas 35
// peticiones reales (30 al VITE_SUPABASE_URL del .env, que apunta a producción, y otras a open.er-api y
// open-meteo) y las pruebas pasaban aunque la red fallara. Una prueba que necesite red la simula
// (vi.spyOn(globalThis, "fetch") / vi.stubGlobal("fetch", …) o un mock del módulo). Si algo llega a este
// fetch, la petición se rechaza y la prueba en curso FALLA con la URL, para que se vea y se corrija.
const blockedRequests: string[] = [];
const blockedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const msg = `[pruebas herméticas] petición de red bloqueada: ${init?.method ?? "GET"} ${url}`;
  blockedRequests.push(msg);
  return Promise.reject(new TypeError(msg));
};
globalThis.fetch = blockedFetch as typeof fetch;
if (typeof window !== "undefined") window.fetch = blockedFetch as typeof fetch;
afterEach(() => {
  if (blockedRequests.length === 0) return;
  const msgs = blockedRequests.splice(0);
  throw new Error(`La prueba intentó salir a la red (${msgs.length}):\n${msgs.join("\n")}`);
});

// jsdom's AbortSignal shadows Node's and doesn't implement the static
// .timeout() helper that Deno (where edge functions actually run) supports
// natively. Polyfill it here so edge-function code under test doesn't need
// to special-case the jsdom environment.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
    return controller.signal;
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom dice "en-US"; la mayoría de los usuarios de IATOS usan español de México. IATOS Privé elige su
// idioma con navigator.languages (priveI18n.ts): las pruebas lo fijan en es-MX y las que prueban
// inglés lo cambian a propósito (src/test/priveUx.test.tsx).
Object.defineProperty(window.navigator, "languages", { configurable: true, get: () => ["es-MX", "es"] });
Object.defineProperty(window.navigator, "language", { configurable: true, get: () => "es-MX" });
