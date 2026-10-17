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
