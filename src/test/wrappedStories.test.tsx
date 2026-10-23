// IATOS Wrapped: navegación de las stories (toque izquierda/derecha, mantener para pausar, teclado,
// avance automático, reducir movimiento) e interruptor «Incluir mis fotos» al compartir.
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WrappedStories, STORY_MS, type ShareFn } from "@/components/wrapped/WrappedStories";
import { buildWrappedCards, computeWrapped, type WrappedStats } from "@/lib/wrapped";

beforeAll(() => {
  // jsdom 20 no trae PointerEvent: sin esto clientX se pierde.
  if (!("PointerEvent" in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

const stats: WrappedStats = computeWrapped({
  year: 2026, today: "2026-10-22", firstName: "Rodrigo", avatarUrl: "https://cdn.example/avatar.png",
  trips: [
    { id: "t1", destino: "Lisboa", pais_destino: "Portugal", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-15" },
    { id: "t2", destino: "Roma", fecha_salida: "2026-07-01", fecha_regreso: "2026-07-09" },
  ],
  moments: [{ id: "m1", trip_id: "t1", caption: "Alfama al atardecer", destino: "Lisboa", created_at: "2026-03-12T10:00:00Z", tags: [], photoUrl: "https://signed/m1" }],
});
const cards = buildWrappedCards(stats);

function setup(props: Partial<React.ComponentProps<typeof WrappedStories>> = {}) {
  const onClose = vi.fn();
  const onShare = vi.fn<ShareFn>(async () => "downloaded");
  render(<MemoryRouter><WrappedStories stats={stats} cards={cards} onClose={onClose} onShare={onShare} autoplay={false} {...props} /></MemoryRouter>);
  const region = screen.getByRole("region", { name: "Tu 2026 en viajes" });
  vi.spyOn(region, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  return { onClose, onShare, region };
}
const tap = (el: HTMLElement, x: number) => { fireEvent.pointerDown(el, { clientX: x, button: 0 }); fireEvent.pointerUp(el, { clientX: x, button: 0 }); };
const current = () => screen.getByRole("article").getAttribute("data-testid");

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("stories", () => {
  it("botones visibles: Anterior, Pausa y Siguiente", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    setup({ autoplay: true });
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(current()).toBe("wrapped-card-trips");
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(current()).toBe("wrapped-card-cover");
    fireEvent.click(screen.getByRole("button", { name: "Pausa" }));
    expect(screen.getByRole("button", { name: "Seguir" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Seguir" }));
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
  });

  it("ritmo cómodo: más de 6 s por tarjeta", () => { expect(STORY_MS).toBeGreaterThanOrEqual(6000); });

  it("empieza en la portada; tocar a la derecha avanza y a la izquierda regresa", () => {
    const { region } = setup();
    expect(cards.slice(0, 3)).toEqual(["cover", "trips", "places"]);
    expect(current()).toBe("wrapped-card-cover");
    tap(region, 300);
    expect(current()).toBe("wrapped-card-trips");
    tap(region, 300);
    expect(current()).toBe("wrapped-card-places");
    tap(region, 40);
    expect(current()).toBe("wrapped-card-trips");
    tap(region, 40); tap(region, 40);
    expect(current()).toBe("wrapped-card-cover");
  });

  it("teclado: → ← y Esc para salir", () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(current()).toBe("wrapped-card-trips");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(current()).toBe("wrapped-card-cover");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("no se sale de la última tarjeta", () => {
    setup({ initialIndex: cards.length - 1 });
    expect(current()).toBe("wrapped-card-outro");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(current()).toBe("wrapped-card-outro");
    expect(screen.getByRole("link", { name: "Crear viaje" })).toHaveAttribute("href", "/dashboard/planear");
  });

  it("mantener presionado pausa y no cambia de tarjeta", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { region } = setup({ autoplay: true });
    fireEvent.pointerDown(region, { clientX: 300, button: 0 });
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole("button", { name: "Seguir" })).toBeInTheDocument();
    fireEvent.pointerUp(region, { clientX: 300, button: 0 });
    expect(current()).toBe("wrapped-card-cover");
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
  });

  it("avanza sola con la barra de progreso", () => {
    let t = 0;
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockImplementation(() => t);
    setup({ autoplay: true });
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
    act(() => { t += STORY_MS / 2; queue.shift()?.(t); });
    expect(screen.getByTestId("wrapped-progress-0").style.width).toBe("50%");
    act(() => { t += STORY_MS; queue.shift()?.(t); });
    expect(current()).toBe("wrapped-card-trips");
    expect(screen.getByTestId("wrapped-progress-0").style.width).toBe("100%");
  });

  it("con «reducir movimiento» no avanza sola", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: q.includes("reduce") })) as typeof window.matchMedia;
    try {
      render(<MemoryRouter><WrappedStories stats={stats} cards={cards} onClose={() => {}} /></MemoryRouter>);
      expect(screen.queryByRole("button", { name: "Pausa" })).toBeNull();
      expect(screen.getByText(`1 / ${cards.length}`)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
    } finally {
      window.matchMedia = mm;
    }
  });
});

describe("compartir", () => {
  beforeEach(() => { vi.useRealTimers(); });

  it("por defecto la imagen va sin fotos; «Incluir mis fotos» las agrega", async () => {
    const { onShare } = setup({ initialIndex: cards.indexOf("photos") });
    expect(current()).toBe("wrapped-card-photos");
    fireEvent.click(screen.getByRole("button", { name: /Compartir/ }));
    const sw = screen.getByRole("switch", { name: "Incluir mis fotos" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("wrapped-photos-note")).toHaveTextContent("no se incluyen");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Descargar imagen/ })); });
    expect(onShare).toHaveBeenLastCalledWith({ kind: "photos", index: cards.indexOf("photos"), includePhotos: false, download: true });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Descargar imagen/ })); });
    expect(onShare).toHaveBeenLastCalledWith({ kind: "photos", index: cards.indexOf("photos"), includePhotos: true, download: true });
  });

  it("una tarjeta sin fotos no ofrece el interruptor y nunca manda fotos", async () => {
    const { onShare } = setup({ initialIndex: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Compartir/ }));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Esta tarjeta no lleva fotos.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Descargar imagen/ })); });
    expect(onShare).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "trips", includePhotos: false }));
  });

  it("en pantalla la persona ve sus fotos; el botón de compartir no cambia de tarjeta", () => {
    setup({ initialIndex: cards.indexOf("photos") });
    expect(screen.getByRole("img", { name: "Alfama al atardecer" })).toHaveAttribute("src", "https://signed/m1");
    fireEvent.pointerDown(screen.getByRole("button", { name: /Compartir/ }), { clientX: 300, button: 0 });
    fireEvent.pointerUp(screen.getByRole("button", { name: /Compartir/ }), { clientX: 300, button: 0 });
    expect(current()).toBe("wrapped-card-photos");
  });
});
