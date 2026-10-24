// Loader del mundo IATOS: tras 5 s de carga, el GlobeLoader reemplaza cronómetros y estimaciones de
// tiempo; antes de 5 s se ve lo de siempre. Sin contador de segundos, accesible y con reducir movimiento.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, act, fireEvent, renderHook } from "@testing-library/react";

const invokeMock = vi.fn((..._args: unknown[]) => new Promise(() => {}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } } }));

import { GlobeLoader } from "@/components/brand/GlobeLoader";
import { SlowLoading } from "@/components/brand/SlowLoading";
import { useSlowLoading, SLOW_LOADING_MS } from "@/hooks/useSlowLoading";
import { HotelOffersButton, MultiCityFareButton } from "@/components/booking/RealPriceButtons";
import { EditWithAIDialog } from "@/components/EditWithAIDialog";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const TIMER = /\b\d+:\d{2}\b|\b\d+\s?s\b|segundos|transcurrid|\blleva\b/i;
const never = () => new Promise<{ data: any; error: any }>(() => {});

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => { vi.useRealTimers(); setReducedMotion(false); invokeMock.mockClear(); });

describe("useSlowLoading", () => {
  it("false los primeros 5 s, true después y vuelve a false al terminar", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useSlowLoading(on), { initialProps: { on: true } });
    expect(SLOW_LOADING_MS).toBe(5000);
    expect(result.current).toBe(false);
    advance(4999);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
    // Una carga nueva vuelve a esperar sus 5 s.
    rerender({ on: true });
    expect(result.current).toBe(false);
    advance(5000);
    expect(result.current).toBe(true);
  });

  it("respeta un umbral distinto", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSlowLoading(true, 1000));
    advance(1000);
    expect(result.current).toBe(true);
  });
});

describe("SlowLoading", () => {
  it("antes de 5 s muestra lo de hoy; después, el globo con el estado honesto como texto", () => {
    vi.useFakeTimers();
    render(<SlowLoading active label="Consultando Google Flights…"><span>spinner de hoy</span></SlowLoading>);
    expect(screen.getByText("spinner de hoy")).toBeInTheDocument();
    expect(screen.queryByTestId("globe-loader")).toBeNull();
    advance(5000);
    expect(screen.queryByText("spinner de hoy")).toBeNull();
    expect(screen.getByTestId("globe-loader")).toBeInTheDocument();
    expect(screen.getByText("Consultando Google Flights…")).toBeInTheDocument();
  });

  it("inactivo no muestra nada", () => {
    vi.useFakeTimers();
    const { container } = render(<SlowLoading active={false} label="x"><span>hoy</span></SlowLoading>);
    advance(10_000);
    expect(container.innerHTML).toBe("");
  });

  it("a pantalla completa (fallback de rutas lazy) ocupa la pantalla con el fondo negro", () => {
    vi.useFakeTimers();
    render(<SlowLoading active fullScreen label="Cargando…" />);
    advance(5000);
    const wrap = screen.getByTestId("slow-loading");
    expect(wrap.className).toMatch(/min-h-screen/);
    expect(wrap.className).toMatch(/bg-background/);
    expect(screen.getByTestId("globe-loader").getAttribute("data-size")).toBe("lg");
  });
});

describe("GlobeLoader", () => {
  it("accesible: role=status, aria-live=polite y 'Cargando…' oculto; el SVG no se anuncia", () => {
    render(<GlobeLoader label="Buscando vuelos reales…" />);
    const s = screen.getByRole("status");
    expect(s.getAttribute("aria-live")).toBe("polite");
    expect(s.querySelector(".sr-only")?.textContent).toBe("Cargando…");
    expect(s.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Buscando vuelos reales…")).toBeInTheDocument();
  });

  it("sin contador de segundos", () => {
    const { container } = render(<GlobeLoader size="lg" label="Consultando Google Flights…" />);
    expect(container.textContent).not.toMatch(TIMER);
  });

  it("tamaños sm / md / lg", () => {
    const { rerender } = render(<GlobeLoader size="sm" />);
    const px = () => Number(screen.getByTestId("globe-loader").querySelector("svg")!.getAttribute("width"));
    const sm = px();
    rerender(<GlobeLoader size="md" />);
    const md = px();
    rerender(<GlobeLoader size="lg" />);
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(px());
  });

  it("globo (meridianos y paralelos) y avión con estela en dorado del sistema, sin colores inventados", () => {
    const { container } = render(<GlobeLoader />);
    expect(container.querySelectorAll(".gl-meridian").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".gl-orbit .gl-plane")).not.toBeNull();
    const html = container.innerHTML;
    expect(html).toMatch(/var\(--primary\)/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(html).not.toMatch(/rgb\(/);
  });

  it("con reducir movimiento: marca el modo y el CSS quita el giro (solo un pulso suave)", () => {
    setReducedMotion(true);
    render(<GlobeLoader />);
    expect(screen.getByTestId("globe-loader").getAttribute("data-reduced-motion")).toBe("true");
    const css = readFileSync(path.resolve(__dirname, "../components/brand/globeLoader.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = css.slice(css.indexOf('[data-reduced-motion="true"]'));
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/iatos-gl-pulse/);
    // La vuelta del avión dura 2.4 s.
    expect(css).toMatch(/iatos-gl-orbit 2\.4s linear infinite/);
  });

  it("sin reducir movimiento gira", () => {
    render(<GlobeLoader />);
    expect(screen.getByTestId("globe-loader").getAttribute("data-reduced-motion")).toBe("false");
  });
});

describe("los flujos lo usan", () => {
  it("Comprar → Actualizar precio del recorrido: spinner los primeros 5 s, luego el globo", () => {
    vi.useFakeTimers();
    render(<MultiCityFareButton trip={CASO_TRIP} interLegs={[]} invoke={never} />);
    fireEvent.click(screen.getByTestId("multi-precio-consultar"));
    expect(screen.queryByTestId("globe-loader")).toBeNull();
    advance(5000);
    expect(screen.getByTestId("globe-loader")).toBeInTheDocument();
    expect(screen.getByText("Consultando Google Flights…")).toBeInTheDocument();
  });

  it("ofertas reales de un hotel: globo pasados 5 s", () => {
    vi.useFakeTimers();
    render(<HotelOffersButton query={{ property_token: "tok", checkin: "2026-11-01", checkout: "2026-11-04", adults: 2 } as any} invoke={never} />);
    fireEvent.click(screen.getByTestId("hotel-ofertas-ver"));
    advance(4000);
    expect(screen.queryByTestId("globe-loader")).toBeNull();
    advance(1000);
    expect(screen.getByText("Consultando Google Hotels…")).toBeInTheDocument();
  });

  it("Editar con IA: el aviso '20-40 segundos' se cambia por el globo a los 5 s", () => {
    vi.useFakeTimers();
    render(<EditWithAIDialog tripId="t1" onUpdated={() => {}} />);
    fireEvent.click(screen.getByLabelText("Editar viaje con IA"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Quita Florencia" } });
    fireEvent.click(screen.getByText("Aplicar cambios"));
    expect(invokeMock).toHaveBeenCalled();
    expect(screen.getByText(/Puede tardar 20-40 segundos/)).toBeInTheDocument();
    advance(5000);
    expect(screen.queryByText(/segundos/)).toBeNull();
    expect(screen.getByTestId("globe-loader")).toBeInTheDocument();
    expect(screen.getByText("IATOS AI está reorganizando rutas y recotizando precios…")).toBeInTheDocument();
  });

  it("cada carga larga y las rutas lazy usan SlowLoading / GlobeLoader", () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
    const flows: Record<string, RegExp> = {
      "App.tsx": /<SlowLoading active fullScreen/, // fallback de las rutas lazy
      "pages/prive/PriveRoot.tsx": /<SlowLoading active/,
      "pages/prive/PriveExplorePage.tsx": /<SlowLoading active/,
      "components/AnalysisProgress.tsx": /useSlowLoading\(true\)/, // generar / analizar viaje (PlanTrip)
      "pages/PlanTrip.tsx": /<SlowLoading active/,
      "pages/MultiDestRoute.tsx": /<SlowLoading active=\{generating\}/,
      "pages/EditTrip.tsx": /useSlowLoading\(reanalyzing\)/,
      "pages/Concierge.tsx": /useSlowLoading\(!!streaming && !hasText\)/, // Iato esperando respuesta
      "components/AvatarCreator.tsx": /<SlowLoading active/,
      "components/prive/key/PriveKeyStudio.tsx": /<SlowLoading active=\{loading/,
      "pages/TripFlights.tsx": /<SlowLoading active=\{loading\}/,
      "pages/TripHotels.tsx": /<SlowLoading active=\{loading\}/,
      "components/booking/BookingSheet.tsx": /<SlowLoading active=\{checking\}/,
      "components/booking/BookingActions.tsx": /<SlowLoading active=\{checking\}/,
      "components/LiveTripQuote.tsx": /<SlowLoading active/,
      "components/booking/ViatorTours.tsx": /<SlowLoading active/,
    };
    for (const [f, re] of Object.entries(flows)) expect(src(f), f).toMatch(re);
    // Ningún cronómetro de carga sobrevive.
    expect(src("components/AnalysisProgress.tsx")).not.toMatch(/setInterval|formatElapsed|transcurrid/);
  });
});
