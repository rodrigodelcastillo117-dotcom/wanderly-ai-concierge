// «Hazme mi video» de Wrapped: plan de 30–60 s con favoritas primero, dibujo en canvas (Ken Burns y
// transición), grabación con MediaRecorder simulado y respaldo de presentación si no se puede grabar.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { computeWrapped, type WrappedInput } from "@/lib/wrapped";
import {
  buildVideoPlan, drawVideoFrame, kenBurns, pickRecorderType, recordSupport, recordVideo, scenesAt, videoFilename, FADE_S, VIDEO_MAX_S, VIDEO_MIN_S,
} from "@/lib/wrappedVideo";
import { WrappedVideoDialog } from "@/components/wrapped/WrappedVideoDialog";

const TODAY = "2026-10-23";
const base: WrappedInput = {
  year: 2026, today: TODAY, firstName: "Rodrigo del Castillo",
  trips: [
    { id: "t1", destino: "Lisboa", pais_destino: "Portugal", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-15" },
    { id: "t2", destino: "Roma", pais_destino: "Italia", fecha_salida: "2026-07-01", fecha_regreso: "2026-07-09" },
  ],
};
const recuerdos = (n: number, favs: number[] = []) => Array.from({ length: n }, (_, i) => ({
  id: `r${String(i).padStart(2, "0")}`, trip_id: "t1", taken_on: `2026-03-${String(10 + (i % 5)).padStart(2, "0")}`, favorite: favs.includes(i), photoUrl: `https://signed/r${i}.jpg`,
}));

describe("Wrapped toma las fotos de Recuerdos del año", () => {
  it("favoritas primero, luego momentos y diario, y el resto; las de otro año no", () => {
    const s = computeWrapped({
      ...base,
      moments: [{ id: "m1", trip_id: "t1", caption: "Alfama", created_at: "2026-03-12T10:00:00Z", photoUrl: "https://signed/m1.jpg" }],
      recuerdos: [...recuerdos(3, [2]), { id: "old", trip_id: null, taken_on: "2025-12-31", favorite: true, photoUrl: "https://signed/old.jpg" }],
    });
    expect(s.photos.map((p) => p.url)).toEqual(["https://signed/r2.jpg", "https://signed/m1.jpg", "https://signed/r0.jpg", "https://signed/r1.jpg"]);
    expect(s.photos[0]).toMatchObject({ favorite: true, place: "Lisboa" });
    expect(s.photoCount).toBe(4);
  });
});

describe("plan del video", () => {
  it("dura entre 30 y 60 s, con portada y cierre, y fotos con Ken Burns distinto", () => {
    for (const n of [0, 1, 4, 14, 40]) {
      const plan = buildVideoPlan(computeWrapped({ ...base, recuerdos: recuerdos(n) }));
      expect(plan.total).toBeGreaterThanOrEqual(VIDEO_MIN_S - 0.01);
      expect(plan.total).toBeLessThanOrEqual(VIDEO_MAX_S + 0.01);
      expect(plan.scenes[0]).toMatchObject({ kind: "text", title: "Tu 2026 en viajes" });
      expect(plan.scenes[plan.scenes.length - 1]).toMatchObject({ kind: "text", title: "Planea tu 2027" });
      // Escenas seguidas, sin huecos.
      plan.scenes.forEach((s, i) => { if (i) expect(s.start).toBeCloseTo(plan.scenes[i - 1].start + plan.scenes[i - 1].dur, 2); });
    }
    const big = buildVideoPlan(computeWrapped({ ...base, recuerdos: recuerdos(40, [33]) }));
    expect(big.photos[0]).toBe("https://signed/r33.jpg"); // la favorita va primero
    expect(big.photos.length).toBeLessThanOrEqual(14);
    expect(kenBurns(0)).not.toEqual(kenBurns(1));
    // Textos de las tarjetas (viajes, países) en el video.
    const texts = big.scenes.filter((s) => s.kind === "text").map((s) => ("kicker" in s ? s.kicker : ""));
    expect(texts).toEqual(expect.arrayContaining(["Tus viajes", "Tu mapa del año"]));
  });

  it("transición suave: al final de una escena entra la siguiente con opacidad creciente", () => {
    const plan = buildVideoPlan(computeWrapped({ ...base, recuerdos: recuerdos(4) }));
    const s0 = plan.scenes[0];
    expect(scenesAt(plan, 0.1)).toHaveLength(1);
    const mid = scenesAt(plan, s0.start + s0.dur - FADE_S / 2);
    expect(mid).toHaveLength(2);
    expect(mid[1].alpha).toBeCloseTo(0.5, 1);
  });
});

/** Contexto 2D simulado: registra lo que se dibuja. */
function fakeCtx() {
  const calls: Array<[string, unknown[]]> = [];
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "measureText") return (s: string) => ({ width: s.length * 20 });
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => grad;
      return (...a: unknown[]) => { calls.push([k, a]); };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("dibujo del cuadro", () => {
  it("la foto se dibuja con Ken Burns (cambia de escala con el tiempo) y lleva la firma", () => {
    const plan = buildVideoPlan(computeWrapped({ ...base, recuerdos: recuerdos(4) }));
    const photo = plan.scenes.find((s) => s.kind === "photo")!;
    const img = { naturalWidth: 1000, naturalHeight: 1500 } as unknown as HTMLImageElement;
    const draws = (t: number) => {
      const f = fakeCtx();
      drawVideoFrame(f.ctx, plan, t, plan.photos.map(() => img));
      return f.calls.filter(([k, a]) => k === "drawImage" && a[0] === img).map(([, a]) => a[3] as number);
    };
    const w0 = draws(photo.start + 0.05)[0];
    const w1 = draws(photo.start + photo.dur * 0.6)[0];
    expect(w0).toBeGreaterThan(0);
    expect(w1).not.toBeCloseTo(w0, 0);
    const f = fakeCtx();
    drawVideoFrame(f.ctx, plan, 1, []);
    expect(f.calls.some(([k, a]) => k === "fillText" && a[0] === "TU 2026 EN VIAJES · IATOS")).toBe(true);
  });
});

describe("grabación", () => {
  it("elige MP4 si el navegador puede y si no WebM; sin MediaRecorder dice por qué", () => {
    expect(pickRecorderType({ isTypeSupported: (t: string) => t.startsWith("video/webm") } as never)).toBe("video/webm;codecs=vp9");
    expect(pickRecorderType({ isTypeSupported: (t: string) => t === "video/mp4" } as never)).toBe("video/mp4");
    expect(recordSupport({ MediaRecorder: undefined, canvasCaptureStream: true })).toEqual({ ok: false, reason: expect.stringMatching(/no permite grabar video/) });
    expect(recordSupport({ MediaRecorder: { isTypeSupported: () => true } as never, canvasCaptureStream: false })).toMatchObject({ ok: false });
    expect(videoFilename(2026, "video/mp4;codecs=avc1")).toBe("iatos-wrapped-2026.mp4");
    expect(videoFilename(2026, "video/webm")).toBe("iatos-wrapped-2026.webm");
  });

  it("graba el plan completo con un reloj simulado y entrega el archivo", async () => {
    const plan = buildVideoPlan(computeWrapped({ ...base, recuerdos: recuerdos(2) }));
    const f = fakeCtx();
    const stop = vi.fn();
    const canvas = { getContext: () => f.ctx, captureStream: vi.fn(() => ({ getTracks: () => [{ stop }] })) } as unknown as HTMLCanvasElement;
    class FakeRecorder {
      static last: FakeRecorder;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public stream: unknown, public opts: { mimeType: string }) { FakeRecorder.last = this; }
      start = vi.fn();
      stop = vi.fn(() => { this.ondataavailable?.({ data: new Blob(["frames"], { type: "video/webm" }) }); this.onstop?.(); });
      static isTypeSupported = () => true;
    }
    let clock = 0;
    const progress: number[] = [];
    const blob = await recordVideo(plan, [], {
      canvas, MediaRecorder: FakeRecorder as never, mime: "video/webm;codecs=vp9",
      now: () => clock, raf: (cb) => { clock += 1000; setTimeout(() => cb(clock), 0); return 1; }, cancelRaf: () => {},
      onProgress: (p) => progress.push(p),
    });
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBeGreaterThan(0);
    expect(FakeRecorder.last.opts.mimeType).toBe("video/webm;codecs=vp9");
    expect(FakeRecorder.last.start).toHaveBeenCalled();
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.length).toBeGreaterThanOrEqual(Math.floor(plan.total));
    expect(stop).toHaveBeenCalled(); // se suelta la captura del canvas
  });
});

describe("diálogo «Hazme mi video»", () => {
  const stats = computeWrapped({ ...base, recuerdos: recuerdos(3, [1]) });

  it("sin soporte de grabación: explica por qué y ofrece la presentación a pantalla completa", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const gc = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeCtx().ctx as never);
    render(<WrappedVideoDialog open onOpenChange={() => {}} stats={stats}
      env={{ support: { ok: false, reason: "Tu navegador no permite grabar video desde la página." }, loadImg: async () => null }} />);
    expect(screen.getByText(/no permite grabar video desde la página\. Puedes ver la presentación aquí, pero no descargarla/)).toBeInTheDocument();
    expect(screen.getByText(/Sin música/)).toBeInTheDocument();
    expect(screen.getByText(/Empieza con tus 1 favorita/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver presentación/ }));
    const show = await screen.findByTestId("wrapped-slideshow");
    expect(show).toHaveTextContent("Por eso no se puede descargar");
    raf.mockRestore(); gc.mockRestore();
  });

  it("con soporte: graba y ofrece Descargar", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeCtx().ctx as never);
    (HTMLCanvasElement.prototype as unknown as { captureStream: () => unknown }).captureStream = () => ({ getTracks: () => [] });
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { clock += 5000; setTimeout(() => cb(clock), 0); return 1; });
    const url = vi.fn(() => "blob:video");
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = url;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
    class Rec {
      ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
      start() {} stop() { this.ondataavailable?.({ data: new Blob(["v"], { type: "video/mp4" }) }); this.onstop?.(); }
    }
    render(<WrappedVideoDialog open onOpenChange={() => {}} stats={stats} env={{ support: { ok: true, mime: "video/mp4" }, MediaRecorder: Rec, loadImg: async () => null }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Crear mi video/ })); });
    expect(await screen.findByTestId("wrapped-video-result", {}, { timeout: 4000 })).toHaveAttribute("src", "blob:video");
    expect(screen.getByRole("button", { name: /Descargar/ })).toBeInTheDocument();
    await waitFor(() => expect(url).toHaveBeenCalled());
    getContext.mockRestore(); nowSpy.mockRestore(); raf.mockRestore();
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
  });
});
