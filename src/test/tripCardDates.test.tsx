// "Mis viajes": la tarjeta dice cuándo empieza y cuándo termina el viaje (antes solo "22/10/2026").
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";
import { formatTripDateRange } from "@/lib/localDate";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";

const tables: Record<string, any[]> = { trips: [], trip_collaborators: [] };
function qb(table: string) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api,
    then: (res: any, rej: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej),
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => qb(t), functions: { invoke: async () => ({ data: null }) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Trips from "@/pages/Trips";

describe("formatTripDateRange", () => {
  it("caso Roma → Florencia → Venecia: '22 oct – 1 nov 2026 · 10 noches'", () => {
    expect(formatTripDateRange("2026-10-22", "2026-11-01")).toBe("22 oct – 1 nov 2026 · 10 noches");
  });
  it("mismo mes, años distintos, una noche y mismo día", () => {
    expect(formatTripDateRange("2026-11-10", "2026-11-15")).toBe("10 – 15 nov 2026 · 5 noches");
    expect(formatTripDateRange("2026-12-28", "2027-01-03")).toBe("28 dic 2026 – 3 ene 2027 · 6 noches");
    expect(formatTripDateRange("2026-11-10", "2026-11-11")).toBe("10 – 11 nov 2026 · 1 noche");
    expect(formatTripDateRange("2026-11-10", "2026-11-10")).toBe("10 nov 2026");
  });
  it("si falta una fecha muestra solo la que hay, sin inventar la otra", () => {
    expect(formatTripDateRange("2026-10-22", null)).toBe("Desde 22 oct 2026 · sin fecha de regreso");
    expect(formatTripDateRange(null, "2026-11-01")).toBe("Hasta 1 nov 2026 · sin fecha de salida");
    expect(formatTripDateRange(null, null)).toBeNull();
    expect(formatTripDateRange("no-es-fecha", "")).toBeNull();
  });
  it("no corre la fecha un día (fecha de calendario local, no UTC)", () => {
    expect(formatTripDateRange("2026-10-01", "2026-10-05")).toMatch(/^1 – 5 oct 2026/);
  });
});

describe("Mis viajes · tarjeta con fechas de inicio y fin", () => {
  beforeEach(() => { tables.trips = []; tables.trip_collaborators = []; });

  it("muestra el rango y las noches del viaje del caso", async () => {
    tables.trips = [CASO_TRIP];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    const dates = await screen.findByTestId("trip-card-dates");
    expect(dates).toHaveTextContent("22 oct – 1 nov 2026 · 10 noches");
    expect(screen.queryByText("22/10/2026")).toBeNull();
  });

  it("sin fecha de regreso dice solo la salida; sin fechas, 'Sin fechas'", async () => {
    tables.trips = [
      { ...CASO_TRIP, id: "a", destino: "Lima", fecha_regreso: null, created_at: "2026-10-02" },
      { ...CASO_TRIP, id: "b", destino: "Oaxaca", fecha_salida: null, fecha_regreso: null, created_at: "2026-10-01" },
    ];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    await screen.findByText("Lima");
    const all = screen.getAllByTestId("trip-card-dates").map((n) => n.textContent);
    expect(all).toContain("Desde 22 oct 2026 · sin fecha de regreso");
    expect(all).toContain("Sin fechas");
    expect(all.join(" ")).not.toMatch(/1 nov/);
  });
});
