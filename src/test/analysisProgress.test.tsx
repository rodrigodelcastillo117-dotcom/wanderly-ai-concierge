import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AnalysisProgress, ANALYSIS_STEPS } from "@/components/AnalysisProgress";

const advance = (s: number) => act(() => { vi.advanceTimersByTime(s * 1000); });

describe("AnalysisProgress", () => {
  afterEach(() => vi.useRealTimers());

  it("checks off the search steps as they finish and never reaches 100%", () => {
    vi.useFakeTimers();
    render(<AnalysisProgress destino="Tokio" />);
    expect(screen.getByText("Tokio")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");

    advance(16);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ANALYSIS_STEPS.length);
    // Las tres búsquedas listas (con palomita), el itinerario en curso.
    expect(items.slice(0, 3).every((li) => li.querySelector("svg.lucide-check"))).toBe(true);
    expect(items[3].querySelector("svg.lucide-check")).toBeNull();

    advance(300);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(95);
    expect(screen.getByText(/Ya casi/)).toBeInTheDocument();
  });
});
