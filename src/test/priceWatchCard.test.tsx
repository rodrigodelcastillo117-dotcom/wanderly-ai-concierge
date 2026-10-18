import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let watchRow: Record<string, unknown> | null = null;
const checkRows = [
  { price_mxn: 21000, checked_at: "2026-10-15T00:00:00Z", approximate_dates: false, source: "travelpayouts" },
  { price_mxn: 18500, checked_at: "2026-10-16T00:00:00Z", approximate_dates: false, source: "travelpayouts" },
];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.limit = async () => ({ data: [...checkRows].reverse() });
    q.maybeSingle = async () => ({ data: table === "price_watches" ? watchRow : null });
    return q;
  };
  return { supabase: { from: chain, functions: { invoke: vi.fn() } } };
});

import { PriceWatchCard } from "@/components/PriceWatchCard";

const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

describe("PriceWatchCard", () => {
  beforeEach(() => { watchRow = null; });

  it("offers to start watching an upcoming trip", async () => {
    render(<PriceWatchCard tripId="t1" departureDate={future} />);
    expect(await screen.findByText("Vigila el precio de tus vuelos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar alerta" })).toBeInTheDocument();
  });

  it("shows baseline, current, lowest and the drop when watching", async () => {
    watchRow = {
      id: "w1", trip_id: "t1", active: true, origin_iata: "MEX", destination_iata: "NRT",
      baseline_price_mxn: 21000, baseline_approximate: false, baseline_source: "travelpayouts", last_price_mxn: 18500, lowest_price_mxn: 18500,
      booking_link: "https://www.aviasales.com/x?marker=533299", last_checked_at: new Date().toISOString(),
      departure_date: future,
    };
    render(<PriceWatchCard tripId="t1" departureDate={future} />);
    expect(await screen.findByText("Vigilando tu vuelo MEX → NRT")).toBeInTheDocument();
    expect(screen.getByText("$21,000")).toBeInTheDocument();
    expect(screen.getAllByText("$18,500")).toHaveLength(2);
    expect(screen.getByText(/Bajó \$2,500 por persona/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reservar a este precio" })).toBeInTheDocument();
  });

  it("renders nothing for a trip that already departed", () => {
    const { container } = render(<PriceWatchCard tripId="t1" departureDate="2020-01-01" />);
    expect(container).toBeEmptyDOMElement();
  });
});
