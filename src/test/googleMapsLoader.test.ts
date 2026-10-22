// N-01: Cercanos tronaba con "window.google.maps.Map is not a constructor": el script ya había
// creado google.maps, pero la clase Map todavía no existía (carrera con loading=async).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadGoogleMaps, __resetGoogleMapsLoader } from "@/lib/googleMapsLoader";

const w = window as any;

beforeEach(() => {
  __resetGoogleMapsLoader();
  delete w.google;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY", "browser-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function Map() {}
function Marker() {}

describe("loadGoogleMaps", () => {
  it("con google.maps a medias (sin Map aún) espera a importLibrary y comparte una sola carga", async () => {
    const importLibrary = vi.fn(async (lib: string) => {
      await new Promise((r) => setTimeout(r, 30));
      if (lib === "maps") w.google.maps.Map = Map;
      if (lib === "marker") w.google.maps.Marker = Marker;
      return {};
    });
    w.google = { maps: { importLibrary } }; // así lo deja el script con loading=async
    const a = loadGoogleMaps();
    const b = loadGoogleMaps(); // otra pantalla al mismo tiempo
    expect(a).toBe(b);
    const g = await a;
    expect(typeof g.Map).toBe("function");
    expect(() => new g.Map()).not.toThrow();
    expect(importLibrary.mock.calls.filter((c) => c[0] === "maps")).toHaveLength(1);
  });

  it("carga clásica: si Map aparece tarde, espera (sondeo) en lugar de tronar", async () => {
    w.google = { maps: {} };
    setTimeout(() => { w.google.maps.Map = Map; w.google.maps.Marker = Marker; }, 120);
    const g = await loadGoogleMaps();
    expect(typeof g.Map).toBe("function");
  });

  it("sin google: inserta un solo <script> aunque lo pidan dos pantallas, y resuelve con el callback", async () => {
    const p1 = loadGoogleMaps();
    const p2 = loadGoogleMaps();
    await Promise.resolve();
    const scripts = document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]');
    expect(scripts).toHaveLength(1);
    const src = (scripts[0] as HTMLScriptElement).src;
    expect(src).toContain("key=browser-key");
    const cb = new URL(src).searchParams.get("callback")!;
    w.google = { maps: { Map, Marker } };
    w[cb]();
    await expect(p1).resolves.toBe(w.google.maps);
    await expect(p2).resolves.toBe(w.google.maps);
  });

  it("si el script falla, rechaza (la pantalla muestra un aviso) y el siguiente intento vuelve a probar", async () => {
    const p = loadGoogleMaps();
    await Promise.resolve();
    const s = document.querySelector('script[src*="maps.googleapis.com"]') as HTMLScriptElement;
    s.onerror!(new Event("error"));
    await expect(p).rejects.toThrow(/No se pudo cargar Google Maps/);
    s.remove();
    const again = loadGoogleMaps();
    expect(again).not.toBe(p);
    again.catch(() => {});
  });

  it("si Map nunca llega, se rinde con error en vez de colgar", async () => {
    vi.useFakeTimers();
    w.google = { maps: {} };
    const p = loadGoogleMaps();
    const assertion = expect(p).rejects.toThrow(/no respondió/);
    await vi.advanceTimersByTimeAsync(16000);
    await assertion;
  });
});
