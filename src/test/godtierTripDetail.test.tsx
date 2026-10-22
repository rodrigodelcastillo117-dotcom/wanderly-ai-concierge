// Detalle del viaje (grupo godtier): el total y "qué sigue" van antes que las herramientas, la
// acción principal también está abajo en móvil y un viaje inexistente ofrece salidas claras.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const TRIP = "11111111-1111-4111-8111-111111111111";
const db = {
  trip: null as any,
  bookings: [] as any[],
  updates: [] as any[],
  updateError: null as any,
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    let payload: any = null;
    const api: any = {
      // .not: TripBookingIntents filtra con .not("state", "in", …); sin él el componente reventaba en cada
      // render (7 "Unhandled Rejection") y la corrida terminaba con exit 1 (P3-QA-1).
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: (p: any) => { kind = "update"; payload = p; db.updates.push({ table, payload: p }); return api; },
      insert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "update") {
          const r = db.updateError ? { data: null, error: db.updateError }
            : { data: [{ selections: payload.selections, quote_basis: db.trip.quote_basis, quote_needs_update: true }], error: null };
          return Promise.resolve(r).then(res, rej);
        }
        return Promise.resolve({ data: table === "bookings" ? db.bookings : [], error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: ({ tripId }: any) => <section data-testid="docs">{tripId}</section> }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";

const baseTrip = () => ({
  id: TRIP, user_id: "u1", destino: "Madrid", pais_destino: "España", ciudad_origen: "CDMX",
  fecha_salida: "2099-11-10", fecha_regreso: "2099-11-15", num_viajeros: 2, created_at: "2026-10-22T00:00:00Z",
  total_estimado: 50000, status: "listo",
  desglose_presupuesto: { vuelos: 18000, hospedaje: 20000, comida: 12000 },
  vuelos_json: [{ aerolinea: "Iberia", tier: "equilibrio", precio_por_persona: 9000, duracion: "11h", escalas: "Directo" }],
  hospedaje_json: [{ nombre: "Hotel Indigo", precio_por_noche: 4000, ciudad: "Madrid" }],
  restaurantes_json: [{ nombre: "Botín", ciudad: "Madrid" }], tours_json: [], itinerario_json: [{ dia: 1 }],
  quote_basis: { num_viajeros: 2, fecha_salida: "2099-11-10", fecha_regreso: "2099-11-15", selections: null },
  quote_needs_update: false,
  selections: null as any,
});

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = baseTrip();
  db.bookings = [];
  db.updates.length = 0;
  db.updateError = null;
  localStorage.clear();
});

describe("TripDetail · lectura de un vistazo", () => {
  it("total → qué sigue → herramientas, en ese orden; y la barra móvil repite total y acción", async () => {
    renderTrip();
    const total = await screen.findByText(/Total de tu viaje · 2 personas/);
    const next = screen.getByRole("heading", { name: "Elige y reserva" });
    const tools = screen.getByRole("group", { name: "Herramientas del viaje" });
    expect(total.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Guardado en Mis viajes")).toBeInTheDocument();
    const bar = screen.getByTestId("trip-next-bar");
    expect(bar).toHaveTextContent("Total $50,000 MXN");
    expect(bar).toHaveTextContent("Elegir vuelo y hotel");
  });

  it("un viaje que no existe ofrece ir a Mis viajes o planear uno (no un texto suelto)", async () => {
    db.trip = null;
    renderTrip();
    expect(await screen.findByRole("heading", { name: "No encontramos este viaje" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir a Mis viajes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planear un viaje" })).toBeInTheDocument();
  });
});
