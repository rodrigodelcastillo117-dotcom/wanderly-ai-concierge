import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const db = { tables: {} as Record<string, any[]>, deletes: [] as any[], updates: [] as any[] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const f: Record<string, unknown> = {};
    const rows = () => (db.tables[table] ?? []).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
    const api: any = {
      select: () => api, order: () => api, limit: () => api,
      eq: (k: string, v: unknown) => { f[k] = v; return api; },
      delete: () => { kind = "delete"; return api; },
      update: (p: any) => { kind = "update"; db.updates.push({ table, p }); return api; },
      insert: () => api,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: any, rej: any) => {
        if (kind === "delete") db.deletes.push({ table, ...f });
        return Promise.resolve({ data: kind === "select" ? rows() : null, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/hooks/useFxTable", async () => {
  const fx: any = await vi.importActual("@/lib/fx");
  return { useFxTable: () => fx.FX_FALLBACK_TABLE };
});
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));

import TripSplit from "@/pages/TripSplit";
import LiveTrip from "@/pages/LiveTrip";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; };

beforeEach(() => {
  db.tables = {
    trips: [
      { id: TRIP, user_id: "u1", destino: "Roma", pais_destino: "Italia", fecha_salida: "2099-11-01", fecha_regreso: "2099-11-08" },
      { id: OTHER, user_id: "u1", destino: "Lima", pais_destino: "Perú", fecha_salida: "2099-12-01", fecha_regreso: "2099-12-04" },
    ],
    trip_split_people: [{ id: "a", trip_id: TRIP, name: "Ana" }, { id: "b", trip_id: TRIP, name: "Luis" }],
    trip_split_expenses: [
      { id: "e1", trip_id: TRIP, payer_id: "a", amount: 100, currency: "EUR", description: "Museo" },
      { id: "e2", trip_id: TRIP, payer_id: "b", amount: 1000, currency: "MXN", description: "Cena" },
    ],
    profiles: [{ id: "u1", active_trip_id: OTHER }],
  };
  db.deletes.length = 0;
  db.updates.length = 0;
  toastSpy.error.mockClear();
  localStorage.clear();
});

describe("TripSplit por moneda (D-18)", () => {
  it("salda euros en euros y pesos en pesos, con el total convertido y su fuente", async () => {
    render(<MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/split`]}><Routes><Route path="/dashboard/viajes/:id/split" element={<TripSplit />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("€50")).toBeInTheDocument();
    expect(screen.getByText("$500 MXN")).toBeInTheDocument();
    expect(screen.getByText(/Tipo de cambio de respaldo aproximado/)).toBeInTheDocument();
    expect(screen.getByText("€100")).toBeInTheDocument();
  });

  it("no quita a quien tiene pagos (antes se borraban en cascada y cambiaban los saldos)", async () => {
    render(<MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/split`]}><Routes><Route path="/dashboard/viajes/:id/split" element={<TripSplit />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Quitar a Ana" }));
    expect(toastSpy.error).toHaveBeenCalledWith("Ana tiene pagos registrados", expect.anything());
    expect(db.deletes).toHaveLength(0);
  });
});

describe("Modo viaje: el Concierge habla de este viaje", () => {
  it("abrir el Concierge fija este viaje como activo", async () => {
    render(
      <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/live`]}>
        <Routes>
          <Route path="/dashboard/viajes/:id/live" element={<LiveTrip />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "Usar como viaje activo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pedir al Concierge/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/concierge"));
    expect(db.updates).toContainEqual({ table: "profiles", p: { active_trip_id: TRIP } });
    expect(localStorage.getItem("iatos_concierge_trip")).toBe(TRIP);
  });
});
