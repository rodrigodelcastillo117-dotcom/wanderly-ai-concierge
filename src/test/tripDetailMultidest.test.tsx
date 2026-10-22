// Puntos 7, 8 y 11 del caso Roma → Florencia → Venecia en la página del viaje (TripDetail) con los
// datos del caso: cada vuelo con su botón de compra precargado, el coche no es un vuelo (va al road
// trip y a la renta de auto), escalas con sus ciudades o "por confirmar".
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
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${CASO_TRIP.id}`]}>
    <Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  db.trip = { ...JSON.parse(JSON.stringify(CASO_TRIP)), user_id: "u1", quote_basis: null, quote_needs_update: false, selections: null };
  db.bookings = [];
  db.updates.length = 0;
  db.updateError = null;
  localStorage.clear();
});

describe("Cómo llegar: comprar desde cada opción (punto 8)", () => {
  it("cada vuelo lleva 'Ver y comprar en Google Flights' con la ruta del viaje, fechas y 2 pasajeros; nada de BUH", async () => {
    renderTrip();
    const buttons = await screen.findAllByTestId("flight-buy-google");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b).toHaveTextContent("Ver y comprar en Google Flights");
      expect(b).toHaveAttribute("target", "_blank");
      const q = parseGoogleFlightsSearch(b.getAttribute("href")!)!;
      expect(q.destination === "FCO" || q.destination === "VCE").toBe(true);
      expect(q.adults).toBe(2);
      // Ninguna aerolínea de una tarifa estimada o imposible como filtro.
      expect(q.airlines).toEqual([]);
    }
    expect(document.body.innerHTML).not.toMatch(/BUH|Volaris/);
  });

  it("el coche no es un vuelo: sin icono de avión, con 'Ver el road trip' y 'Rentar auto'", async () => {
    renderTrip();
    await screen.findAllByTestId("flight-buy-google");
    const cars = Array.from(document.querySelectorAll('[data-testid="arrival-option"][data-mode="coche"]')) as HTMLElement[];
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) {
      expect(c.querySelector(".lucide-plane")).toBeNull();
      expect(c.querySelector('[data-testid="ground-buy-buttons"]')).not.toBeNull();
      expect(c.textContent).toMatch(/Ver el road trip/);
      const rent = Array.from(c.querySelectorAll("a")).find((a) => /Rentar auto/.test(a.textContent ?? ""))!;
      expect(rent.getAttribute("href")).toMatch(/^\/dashboard\/autos\?city=/);
    }
    // La renta "desde Ciudad de México (vía Aeropuerto FCO)" ya no aparece como forma de llegar.
    expect(screen.queryByText(/Retiro de Coche/)).toBeNull();
  });

  it("los vuelos estimados no dicen aerolínea ni 'Directo'", async () => {
    renderTrip();
    await screen.findAllByTestId("flight-buy-google");
    const flights = Array.from(document.querySelectorAll('[data-testid="arrival-option"][data-mode="vuelo"]')) as HTMLElement[];
    expect(flights.length).toBeGreaterThan(0);
    for (const f of flights) {
      expect(f.textContent).not.toMatch(/Directo|Iberia|Aeroméxico/);
      expect(f.textContent).toMatch(/Aerolínea por confirmar/);
    }
  });
});
