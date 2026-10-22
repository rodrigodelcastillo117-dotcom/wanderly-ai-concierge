import "@testing-library/jest-dom";

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
