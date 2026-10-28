// Pendiente E2E 28-oct-2026: en Destinos de un viaje por tierra, la tarjeta del autobús repetía su aviso
// ("Llega con… El precio y la compra son en ADO; IATOS no lo cotiza.") dos veces.
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const db = { trip: null as any };
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: () => api, insert: () => api, upsert: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children, city }: any) => <div data-testid={`ciudad-${city}`}>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";
import { TEPOZ_GUARDADO } from "./fixtures/casoTepoztlan";

it("Destinos (viaje por tierra CDMX → Tepoztlán): el aviso del autobús sale una sola vez en su tarjeta", async () => {
  db.trip = { ...JSON.parse(JSON.stringify(TEPOZ_GUARDADO)), user_id: "u1" };
  render(<MemoryRouter initialEntries={[`/dashboard/viajes/${db.trip.id}`]}><Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes></MemoryRouter>);
  const cards = await screen.findAllByTestId("arrival-option");
  const bus = cards.find((c) => c.getAttribute("data-mode") === "bus")!;
  expect(bus).toBeTruthy();
  const txt = bus.textContent ?? "";
  expect(txt.match(/IATOS no lo cotiza/g) ?? []).toHaveLength(1);
  expect(txt.match(/Llega con:/g) ?? []).toHaveLength(1);
  // Los botones (ADO y horarios) siguen.
  expect(within(bus).getByTestId("ground-operator")).toHaveTextContent(/ADO/);
  expect(within(bus).getByTestId("ground-schedule")).toBeInTheDocument();
});
