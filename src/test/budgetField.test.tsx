// El presupuesto objetivo es el TOTAL del viaje para todos (no diario ni por persona) y la pantalla lo dice.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

import { BudgetField, budgetHint, budgetStep, nightsBetween, BUDGET_MAX } from "@/components/BudgetField";

describe("presupuesto del viaje", () => {
  it("noches entre fechas (o null si faltan o están al revés)", () => {
    expect(nightsBetween("2026-10-22", "2026-11-01")).toBe(10);
    expect(nightsBetween("2026-10-22", null)).toBeNull();
    expect(nightsBetween("2026-11-01", "2026-10-22")).toBeNull();
  });

  it("resume por persona y por persona por día", () => {
    expect(budgetHint(600_000, 2, 10)).toBe("≈ $300,000 por persona · $27,273 por persona por día");
    expect(budgetHint(38_000, 1, 4)).toBe("$7,600 por día");
    expect(budgetHint(38_000, 2, null)).toBe("≈ $19,000 por persona");
  });

  it("alcanza viajes grandes y el paso crece con el monto", () => {
    expect(BUDGET_MAX).toBeGreaterThanOrEqual(1_000_000);
    expect(budgetStep(30_000)).toBe(1_000);
    expect(budgetStep(120_000)).toBe(5_000);
    expect(budgetStep(600_000)).toBe(10_000);
  });

  it("la pantalla dice que es el total para todos, todo incluido", () => {
    render(<BudgetField value={38_000} onChange={() => {}} travelers={2} nights={4} />);
    expect(screen.getByText("Total del viaje · 2 personas")).toBeInTheDocument();
    expect(screen.getByText(/Todo incluido: vuelos, hoteles, comida y experiencias · ≈ \$19,000 por persona/)).toBeInTheDocument();
  });

  it("se puede quitar y volver a poner", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BudgetField value={38_000} onChange={onChange} travelers={2} nights={4} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar presupuesto fijo" }));
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(<BudgetField value={null} onChange={onChange} travelers={2} nights={4} />);
    expect(screen.getByText("Sin presupuesto fijo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Establecer un presupuesto" }));
    expect(onChange).toHaveBeenLastCalledWith(30_000);
  });
});
