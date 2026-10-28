// Defecto 8 (E2E 28-oct-2026): "Ver ofertas reales" mostraba "Booking.com $1,030 USD" bajo un hotel de
// "$21,651 MXN". En "Comprar" se muestra en MXN con el tipo de cambio de la cotización (o el de la app), con
// su fuente, y la cifra original en USD en pequeño.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HotelOffersButton } from "@/components/booking/RealPriceButtons";
import type { Invoke } from "@/lib/realFares";

vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => ({ rates: { USD: 1, MXN: 20 }, source: "open.er-api.com", asOf: "2026-10-28T00:00:00Z", isFallback: false, kind: "live" }) };
});

const data = {
  ok: true, consulted_at: "2026-10-28T15:00:00Z",
  results: [{ source: "Booking.com", total_usd: 1030, label: "Ver en Booking", url: "https://www.booking.com/hotel/es/dear.html", consultado_at: "2026-10-28T15:00:00Z" }],
};
const query = { property_token: "TOK", checkin: "2027-03-10", checkout: "2027-03-17", adults: 2, name: "Dear Hotel Madrid" };

describe("ofertas de hotel en MXN", () => {
  it("con el tipo de cambio de la cotización: $19,189 MXN y abajo $1,030 USD, con la fuente", async () => {
    const invoke = vi.fn(async () => ({ data, error: null }));
    render(<HotelOffersButton query={query} invoke={invoke as unknown as Invoke} currency="MXN"
      fx={{ rate: 18.63, label: "1 USD = 18.63 MXN · tipo de cambio de la cotización (frankfurter, 27 oct 2026)" }} />);
    fireEvent.click(screen.getByTestId("hotel-ofertas-ver"));
    const row = await screen.findByTestId("hotel-oferta");
    expect(within(row).getByTestId("hotel-oferta-precio").textContent).toBe("$19,189 MXN");
    expect(row.textContent).toContain("$1,030 USD");
    expect(screen.getByTestId("hotel-ofertas-tc").textContent).toBe("En MXN · 1 USD = 18.63 MXN · tipo de cambio de la cotización (frankfurter, 27 oct 2026)");
  });

  it("sin tipo de cambio de la cotización: el de la app, con su fuente", async () => {
    const invoke = vi.fn(async () => ({ data, error: null }));
    render(<HotelOffersButton query={query} invoke={invoke as unknown as Invoke} currency="MXN" />);
    fireEvent.click(screen.getByTestId("hotel-ofertas-ver"));
    const row = await screen.findByTestId("hotel-oferta");
    expect(within(row).getByTestId("hotel-oferta-precio").textContent).toBe("$20,600 MXN");
    expect(screen.getByTestId("hotel-ofertas-tc").textContent).toMatch(/1 USD = 20\.00 MXN · Tipo de cambio de open\.er-api\.com/);
  });

  it("donde la tarjeta es en USD (Hoteles) sigue en USD", async () => {
    const invoke = vi.fn(async () => ({ data, error: null }));
    render(<HotelOffersButton query={query} invoke={invoke as unknown as Invoke} />);
    fireEvent.click(screen.getByTestId("hotel-ofertas-ver"));
    const row = await screen.findByTestId("hotel-oferta");
    expect(within(row).getByTestId("hotel-oferta-precio").textContent).toBe("$1,030 USD");
    expect(screen.queryByTestId("hotel-ofertas-tc")).toBeNull();
  });
});
