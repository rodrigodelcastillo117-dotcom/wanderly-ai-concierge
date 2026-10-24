import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AnalysisProgress, ANALYSIS_STEPS, SLOW_SECONDS } from "@/components/AnalysisProgress";
import { analysisSummaryOf } from "@/lib/planDefaults";

const advance = (s: number) => act(() => { vi.advanceTimersByTime(s * 1000); });
// Cualquier cronómetro o cuenta de segundos: "0:16", "12 s", "40 segundos", "transcurridos".
const TIMER = /\b\d+:\d{2}\b|\b\d+\s?s\b|segundos|transcurrid/i;

describe("AnalysisProgress (sin avance inventado ni cronómetro)", () => {
  afterEach(() => vi.useRealTimers());

  it("no palomea etapas ni muestra un porcentaje: el servidor no reporta avance", () => {
    vi.useFakeTimers();
    render(<AnalysisProgress destino="Tokio" summary="Desde Ciudad de México · 2 viajeros" />);
    expect(screen.getByText("Tokio")).toBeInTheDocument();
    expect(screen.getByText("Desde Ciudad de México · 2 viajeros")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    // Barra indeterminada: sin aria-valuenow.
    expect(bar.getAttribute("aria-valuenow")).toBeNull();

    advance(16);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ANALYSIS_STEPS.length);
    // Antes, a los 16 s las tres búsquedas aparecían "listas" con palomita sin saberlo.
    expect(items.some((li) => li.querySelector("svg.lucide-check"))).toBe(false);
  });

  it("antes de 5 s se ve lo de siempre; a los 5 s el globo IATOS reemplaza la barra, sin contar segundos", () => {
    vi.useFakeTimers();
    const { container } = render(<AnalysisProgress destino="Lima" />);
    expect(screen.queryByTestId("globe-loader")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("Suele tardar alrededor de un minuto")).toBeInTheDocument();
    advance(4.9);
    expect(screen.queryByTestId("globe-loader")).toBeNull();
    advance(0.2);
    expect(screen.getByTestId("globe-loader")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    // Los pasos honestos siguen a la vista.
    expect(screen.getAllByRole("listitem")).toHaveLength(ANALYSIS_STEPS.length);
    advance(30);
    expect(container.textContent).not.toMatch(TIMER);
  });

  it("si tarda más de lo normal, lo dice (sin cronómetro)", () => {
    vi.useFakeTimers();
    const { container } = render(<AnalysisProgress destino="Lima" />);
    advance(SLOW_SECONDS + 1);
    expect(screen.getByText("Está tardando más de lo normal")).toBeInTheDocument();
    expect(screen.getByText(/no cierres esta pantalla/)).toBeInTheDocument();
    expect(screen.getByTestId("globe-loader")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(TIMER);
  });

  it("resume el viaje que se analiza", () => {
    expect(analysisSummaryOf({ ciudad_origen: "Monterrey", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-16", num_viajeros: 1 }))
      .toMatch(/^Desde Monterrey · 12 dic.* – 16 dic.* · 1 viajero$/);
    expect(analysisSummaryOf({ ciudad_origen: "Monterrey", num_viajeros: 2 })).toBe("Desde Monterrey · fechas sugeridas por IATOS · 2 viajeros");
  });
});
