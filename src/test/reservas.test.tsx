import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";
import { isConfirmedBooking } from "@/lib/bookingKinds";

const rows = [
  { id: "1", category: "train", provider: "Trainline", title: "Madrid → Sevilla", subtitle: null, booking_url: "https://x", city: null, start_at: null, status: "pending", created_at: "2026-10-01T10:00:00Z" },
  { id: "2", category: "hotel", provider: "Booking", title: "Hotel Roma", subtitle: null, booking_url: null, city: "Roma", start_at: "2026-11-03", status: "confirmed", confirmation_code: "ABC123", created_at: "2026-10-02T10:00:00Z" },
];
const qb: any = { select: () => qb, eq: () => qb, order: async () => ({ data: rows, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));

import Reservas from "@/pages/Reservas";

it("separa reservas confirmadas de las visitas/clics a socios (antes: todo era 'reserva')", async () => {
  render(<MemoryRouter><Reservas /></MemoryRouter>);
  const confirmed = (await screen.findByRole("heading", { name: "Reservas confirmadas" })).closest("section")!;
  const visits = screen.getByRole("heading", { name: /Búsquedas\/visitas a socios/ }).closest("section")!;
  expect(within(confirmed).getByText("Hotel Roma")).toBeInTheDocument();
  expect(within(confirmed).queryByText("Madrid → Sevilla")).toBeNull();
  expect(within(visits).getByText("Madrid → Sevilla")).toBeInTheDocument();
  expect(within(visits).getByText(/no significa que la reserva se haya hecho/)).toBeInTheDocument();
  // Fecha solo-día sin corrimiento por zona horaria (3 de noviembre, no 2).
  expect(within(confirmed).getByText("3 nov 2026")).toBeInTheDocument();
});

it("isConfirmedBooking: un clic 'pending' nunca cuenta como reserva", () => {
  expect(isConfirmedBooking({ status: "pending" })).toBe(false);
  expect(isConfirmedBooking({ status: "pending", confirmation_code: "X1" })).toBe(true);
  expect(isConfirmedBooking({ status: "Confirmed" })).toBe(true);
});
