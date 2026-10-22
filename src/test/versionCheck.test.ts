// Una pestaña abierta antes de publicar seguía con la versión vieja (guía del primer viaje sin video).
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainBundleOf, watchForNewVersion } from "@/lib/versionCheck";

afterEach(() => { document.head.innerHTML = ""; vi.useRealTimers(); });

const html = (bundle: string) => `<html><head><script type="module" crossorigin src="${bundle}"></script></head></html>`;

describe("aviso de versión nueva", () => {
  it("lee el bundle principal del index.html", () => {
    expect(mainBundleOf(html("/assets/index-BKRotXIW.js"))).toBe("/assets/index-BKRotXIW.js");
    expect(mainBundleOf("<html></html>")).toBeNull();
  });

  it("avisa una sola vez cuando el bundle publicado cambió, y no avisa si es el mismo", async () => {
    vi.useFakeTimers();
    const s = document.createElement("script");
    s.setAttribute("src", "/assets/index-OLD12345.js");
    document.head.appendChild(s);
    let served = "/assets/index-OLD12345.js";
    const fetcher = vi.fn(async () => new Response(html(served))) as unknown as typeof fetch;
    const onNew = vi.fn();
    const stop = watchForNewVersion(onNew, { intervalMs: 1000, fetcher });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNew).not.toHaveBeenCalled();
    served = "/assets/index-NEW67890.js";
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNew).toHaveBeenCalledTimes(1);
    stop();
  });

  it("en desarrollo (sin bundle con hash) no hace nada", () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const stop = watchForNewVersion(vi.fn(), { fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    stop();
  });
});
