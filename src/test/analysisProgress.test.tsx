import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AnalysisProgress, ANALYSIS_STEPS, SLOW_SECONDS, formatElapsed } from "@/components/AnalysisProgress";
import { analysisSummaryOf } from "@/lib/planDefaults";

const advance = (s: number) => act(() => { vi.advanceTimersByTime(s * 1000); });

describe("AnalysisProgress (sin avance inventado)", () => {
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
    expect(screen.getByText("0:16")).toBeInTheDocument();
    expect(bar.getAttribute("aria-valuetext")).toBe("En curso, 0:16 transcurridos");
  });

  it("si tarda más de lo normal, lo dice", () => {
    vi.useFakeTimers();
    render(<AnalysisProgress destino="Lima" />);
    expect(screen.getByText("Suele tardar alrededor de un minuto")).toBeInTheDocument();
    advance(SLOW_SECONDS + 1);
    expect(screen.getByText("Está tardando más de lo normal")).toBeInTheDocument();
    expect(screen.getByText(/no cierres esta pantalla/)).toBeInTheDocument();
  });

  it("formatea el tiempo y resume el viaje que se analiza", () => {
    expect(formatElapsed(75)).toBe("1:15");
    expect(analysisSummaryOf({ ciudad_origen: "Monterrey", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-16", num_viajeros: 1 }))
      .toMatch(/^Desde Monterrey · 12 dic.* – 16 dic.* · 1 viajero$/);
    expect(analysisSummaryOf({ ciudad_origen: "Monterrey", num_viajeros: 2 })).toBe("Desde Monterrey · fechas sugeridas por IATOS · 2 viajeros");
  });
});
