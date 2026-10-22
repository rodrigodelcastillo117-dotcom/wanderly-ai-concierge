import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceSourceBadge, isLivePrice } from "@/components/PriceSourceBadge";

const now = new Date("2026-10-22T12:00:00Z");

describe("PriceSourceBadge", () => {
  it("muestra 'Sin fuente' cuando falta la fuente", () => {
    render(<PriceSourceBadge now={now} />);
    expect(screen.getByText("Sin fuente")).toBeInTheDocument();
  });
  it("Travelpayouts no dice 'verificado en vivo'", () => {
    const { container } = render(<PriceSourceBadge source="travelpayouts" consultadoAt="2026-10-22T10:00:00Z" now={now} />);
    expect(screen.getByText("Precio de referencia (caché ≤48 h) · puede variar")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/verificado|en vivo/i);
  });
  it("precio viejo: OBSOLETO con la antigüedad", () => {
    render(<PriceSourceBadge source="google_hotels" consultadoAt="2026-10-20T12:00:00Z" now={now} />);
    expect(screen.getByText("Precio de hace 2 días; verifica antes de reservar")).toHaveAttribute("data-estado", "OBSOLETO");
  });
  it("isLivePrice solo para precios en vivo vigentes", () => {
    expect(isLivePrice("serpapi", new Date())).toBe(true);
    expect(isLivePrice("serpapi")).toBe(false);
    expect(isLivePrice("estimado", new Date())).toBe(false);
  });
});
