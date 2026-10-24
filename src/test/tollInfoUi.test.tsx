// Casetas en pantalla: nunca se consultan al abrir; solo al pulsar. Monto real "en vivo"; sin monto,
// se dice por qué y no se suma.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/lib/bookingBridgeApi", () => ({ bridge: vi.fn(), newIdempotencyKey: () => "k" }));

import { TollInfo, roadLegTolls } from "@/components/roadtrip/TollInfo";
import { RoadTripPanel } from "@/components/roadtrip/RoadTripPanel";
import { buildRoadTripPlan, type TollQuote } from "@/lib/roadtrip";

const quote: TollQuote = { estado: "CON_MONTO", montos: [{ moneda: "MXN", monto: 412 }], monto_mxn: 412, fx: [], fuente: "google_routes", consultado_at: "2026-10-24T18:05:00Z", pase: null, from_cache: false };

beforeEach(() => invoke.mockReset());

describe("TollInfo", () => {
  it("no consulta al abrir; al pulsar pide SOLO el modo coche y muestra el monto en vivo", async () => {
    invoke.mockResolvedValue({ data: { routes: [{ mode: "DRIVE", available: true, tolls: quote }] }, error: null });
    render(<TollInfo from="Ciudad de México" to="Puebla" consultable />);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("casetas-consultar"));
    await waitFor(() => expect(screen.getByText(/Casetas: \$412 MXN · Google Maps · consultado \d{2}:\d{2}/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("get-routes", { body: { origin: { address: "Ciudad de México" }, destination: { address: "Puebla" }, modes: ["DRIVE"] } });
    expect(screen.getByText("en vivo")).toBeInTheDocument();
  });

  it("sin tollInfo: 'no disponible', nunca 'sin casetas', y no se suma", async () => {
    invoke.mockResolvedValue({ data: { routes: [{ mode: "DRIVE", available: true, tolls: { ...quote, estado: "NO_DISPONIBLE", montos: [], monto_mxn: null } }] }, error: null });
    render(<TollInfo from="A" to="B" consultable />);
    fireEvent.click(screen.getByTestId("casetas-consultar"));
    await waitFor(() => expect(screen.getByText("Información de casetas no disponible para esta ruta")).toBeInTheDocument());
    expect(screen.getByText("No se suma al total.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sin casetas/i);
  });

  it("roadLegTolls toma las casetas del plan guardado del viaje", () => {
    const trip = { itinerario_json: { logistics: { road_trip: { legs: [{ from: "Ciudad de México", to: "Puebla", tolls: quote }] } } } };
    expect(roadLegTolls(trip, "ciudad de mexico", "Puebla")).toEqual(quote);
    expect(roadLegTolls(trip, "Puebla", "Oaxaca")).toBeNull();
  });
});

describe("RoadTripPanel con casetas", () => {
  it("vista previa: no consulta; generado: monto en vivo sumado al total y la gasolina con su fórmula", () => {
    const preview = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"] })!;
    const { unmount } = render(<MemoryRouter><RoadTripPanel plan={preview} preview /></MemoryRouter>);
    expect(screen.getByText("Casetas: se consultan a Google Maps al generar el viaje.")).toBeInTheDocument();
    expect(screen.getByText(/Fórmula: \d+ km × 7 L\/100 km \(supuesto\)/)).toBeInTheDocument();
    unmount();
    const plan = buildRoadTripPlan({
      stops: ["Florencia", "Siena"], legModes: ["coche"],
      live: [{ ok: true, distance_meters: 76000, duration_seconds: 4320, consultado_at: quote.consultado_at, tolls: { ...quote } }],
    })!;
    render(<MemoryRouter><RoadTripPanel plan={plan} /></MemoryRouter>);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("casetas-total").textContent).toMatch(/Casetas en vivo \(Google Maps\): \$412 MXN, sumadas al total del viaje/);
    expect(document.querySelector('[data-cost="casetas-0"] [data-estado="CONSULTADO"]')).not.toBeNull();
  });
});
