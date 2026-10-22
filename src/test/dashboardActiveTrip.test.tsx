// Inicio usa el viaje activo único (resolveActiveTrip + profiles.active_trip_id). Antes tomaba
// "los 2 últimos viajes creados" y buscaba ahí el que estaba en curso.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { localISODatePlus } from "@/lib/localDate";

const ROMA = "11111111-1111-4111-8111-111111111111";
const PARIS = "22222222-2222-4222-8222-222222222222";
const LIMA = "33333333-3333-4333-8333-333333333333";
const db = { trips: [] as any[], pinned: null as string | null, profileError: null as any };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols = "";
    const api: any = {
      select: (c: string) => { cols = c; return api; },
      eq: () => api, gte: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => {
        if (table !== "profiles") return { data: null, error: null };
        if (cols.includes("active_trip_id")) return db.profileError ? { data: null, error: db.profileError } : { data: { active_trip_id: db.pinned }, error: null };
        return { data: { full_name: "Ana Pérez" }, error: null };
      },
      update: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/TripFileUpload", () => ({ TripFileUpload: () => null }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: [], loading: false }) }));
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});

import DashboardHome from "@/pages/DashboardHome";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; };
const renderHome = () => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes>
      <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  __resetActiveTripColumn();
  // Roma está en curso pero es el viaje creado hace más tiempo: con limit(2) por fecha de creación no aparecía.
  db.trips = [
    { id: ROMA, user_id: "u1", destino: "Roma", fecha_salida: localISODatePlus(-1), fecha_regreso: localISODatePlus(3), created_at: "2026-01-01" },
    { id: PARIS, user_id: "u1", destino: "París", fecha_salida: localISODatePlus(30), fecha_regreso: localISODatePlus(35), created_at: "2026-09-01" },
    { id: LIMA, user_id: "u1", destino: "Lima", fecha_salida: localISODatePlus(60), fecha_regreso: localISODatePlus(65), created_at: "2026-10-01" },
  ];
  db.pinned = null;
  db.profileError = null;
  localStorage.clear();
});

describe("Inicio: viaje activo único", () => {
  it("muestra 'En vivo' el viaje en curso aunque sea el más viejo", async () => {
    renderHome();
    expect(await screen.findByText(/Tu viaje está en curso/)).toBeInTheDocument();
    expect(screen.getAllByText("Roma").length).toBeGreaterThan(0);
  });

  it("el viaje fijado manda (mismo que Iato); las herramientas reciben ?trip=", async () => {
    db.pinned = LIMA;
    renderHome();
    expect(await screen.findByText("Próximo viaje")).toBeInTheDocument();
    expect(screen.queryByText(/Tu viaje está en curso/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Vuelos/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/dashboard/vuelos?trip=${LIMA}`));
  });

  it("sin la columna en producción usa la elección local, y lista los próximos (no solo 2)", async () => {
    db.profileError = { code: "42703", message: "column does not exist" };
    db.trips[0] = { ...db.trips[0], fecha_salida: localISODatePlus(10), fecha_regreso: localISODatePlus(12) };
    localStorage.setItem("iatos_concierge_trip", PARIS);
    renderHome();
    expect(await screen.findByText("Próximo viaje")).toBeInTheDocument();
    expect(screen.getAllByText("París").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText(/^EN \d+D$/)).toHaveLength(3));
  });
});
