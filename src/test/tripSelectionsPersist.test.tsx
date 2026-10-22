// E-12: la selección de vuelo/hotel/tours en TripDetail sobrevive a recargar la página, recalcula
// el total y marca la cotización "por actualizar". También: estado reservado/cotizado y la sección
// de documentos presentes en el expediente.
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

describe("TripDetail: selecciones guardadas (E-12)", () => {
  it("al recargar restaura la selección, recalcula el total y pide actualizar la cotización", async () => {
    db.trip.selections = { v: 1, vuelo: { i: -2, key: null }, hospedaje: { i: -1, key: null }, noches_hospedaje: null, tours: [] };
    renderTrip();
    // Sin vuelo ("ya lo tengo"): 0 + hospedaje 20,000 + comida 12,000.
    expect(await screen.findByText(/Cambiaste tu selección de vuelo, hotel o experiencias/)).toBeInTheDocument();
    // Total del viaje (RealTripTotal) y el desglose dicen lo mismo.
    expect(screen.getAllByText("$32,000 MXN").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("$50,000 MXN")).toBeNull();
    expect(screen.getByText(/Total con tu selección/)).toBeInTheDocument();
    // Restaurar no vuelve a escribir.
    await new Promise((r) => setTimeout(r, 700));
    expect(db.updates.filter((u) => u.table === "trips")).toHaveLength(0);
  });

  it("cambiar la selección la guarda en trips.selections", async () => {
    renderTrip();
    fireEvent.click(await screen.findByText("Ya tengo vuelo"));
    await waitFor(() => expect(db.updates.find((u) => u.table === "trips")).toBeTruthy(), { timeout: 2000 });
    expect(db.updates.find((u) => u.table === "trips")!.payload.selections).toMatchObject({ v: 1, vuelo: { i: -2 } });
    expect(await screen.findByText(/Cambiaste tu selección/)).toBeInTheDocument();
  });

  it("sin la columna (migración pendiente) la guarda en este dispositivo y la restaura", async () => {
    delete db.trip.selections;
    db.updateError = { code: "PGRST204", message: "Could not find the 'selections' column" };
    const { unmount } = renderTrip();
    fireEvent.click(await screen.findByText("Ya tengo vuelo"));
    await waitFor(() => expect(localStorage.getItem(`iatos_trip_selections_${TRIP}`)).toContain('"i":-2'), { timeout: 2000 });
    unmount();
    renderTrip();
    expect((await screen.findAllByText("$32,000 MXN")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("TripDetail: expediente", () => {
  it("muestra 'Cotizado · sin reservar' y por tipo, y la sección de documentos del viaje", async () => {
    db.bookings = [{ trip_id: TRIP, category: "flight", status: "pending", title: "clic" }];
    renderTrip();
    expect(await screen.findByText("Cotizado · sin reservar")).toBeInTheDocument();
    expect(screen.getByText("Vuelo: Cotizado · no reservado")).toBeInTheDocument();
    expect(screen.getByTestId("docs")).toHaveTextContent(TRIP);
  });

  it("con reserva confirmada de vuelo y hotel dice 'Reservado'", async () => {
    db.bookings = [
      { trip_id: TRIP, category: "flight", status: "confirmed", title: "Iberia" },
      { trip_id: TRIP, category: "hotel", status: "confirmed", title: "Hotel Indigo" },
    ];
    renderTrip();
    await waitFor(() => expect(screen.getByTestId("trip-booking-state")).toHaveAttribute("data-state", "reservado"));
    expect(screen.getByText("Hospedaje: Reservado")).toBeInTheDocument();
  });
});
