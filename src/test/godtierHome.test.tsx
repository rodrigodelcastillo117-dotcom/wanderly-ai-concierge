// Inicio como centro de mando (grupo godtier): viaje activo con cuenta regresiva, estado de la
// cotización, vuelo seguido y UNA acción; guía del primer viaje; estados vacíos útiles.
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { localISODatePlus } from "@/lib/localDate";

const PUEBLA = "11111111-1111-4111-8111-111111111111";
const db = {
  trips: [] as any[],
  fullTrip: null as any,
  quote: null as any,
  flights: [] as any[],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols = "";
    const api: any = {
      select: (c: string) => { cols = c; return api; },
      eq: () => api, gte: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => {
        if (table === "profiles") {
          if (cols.includes("active_trip_id")) return { data: { active_trip_id: null }, error: null };
          return { data: { full_name: "Ana Pérez" }, error: null };
        }
        if (table === "trips") return { data: db.fullTrip, error: null };
        if (table === "trip_quotes") return { data: db.quote, error: null };
        return { data: null, error: null };
      },
      update: () => api,
      then: (res: any, rej: any) => Promise.resolve({
        data: table === "trips" ? db.trips : table === "tracked_flights" ? db.flights : [],
        error: null,
      }).then(res, rej),
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
vi.mock("@/lib/weatherNow", () => ({ fetchWeatherNow: async () => ({ tempC: 21, label: "Despejado", source: "Open-Meteo" }) }));
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
  localStorage.clear();
  db.trips = [];
  db.fullTrip = null;
  db.quote = null;
  db.flights = [];
});

describe("Inicio sin viajes: guía del primer viaje", () => {
  it("explica los 3 pasos, sin video duplicado, y los ejemplos solo llenan el campo", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: /Planea tu primer viaje/ })).toBeInTheDocument();
    expect(screen.queryByText(/Planea un/)).toBeNull(); // el hero de video no se repite
    expect(screen.getByText("Ves el total en pesos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "“Oaxaca un fin de semana, 2 personas”" }));
    expect(screen.getByLabelText("Platícame tu viaje")).toHaveValue("Oaxaca un fin de semana, 2 personas");
    // No navegó ni analizó nada.
    expect(screen.queryByTestId("where")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Planear mi primer viaje/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/planear"));
  });

  it("recomendaciones vacías y gastos vacíos explican qué hacer (sin $0.00 gigante)", async () => {
    renderHome();
    expect(await screen.findByRole("link", { name: /Explorar destinos/ })).toHaveAttribute("href", "/dashboard/descubre");
    expect(await screen.findByText("Aún no registras gastos este mes")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByRole("button", { name: "Registrar un gasto" })).toBeInTheDocument();
  });
});

describe("Inicio con viaje: centro de mando", () => {
  beforeEach(() => {
    db.trips = [{ id: PUEBLA, user_id: "u1", destino: "Puebla", pais_destino: "México", fecha_salida: localISODatePlus(5), fecha_regreso: localISODatePlus(7), created_at: "2026-01-01" }];
  });

  it("cuenta regresiva, cotización vigente, vuelo seguido, clima y UNA acción principal", async () => {
    db.fullTrip = { ...db.trips[0], total_estimado: 23560, num_viajeros: 2, current_quote_id: "q1" };
    db.quote = { id: "q1", created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), valid_until: new Date(Date.now() + 20 * 3600_000).toISOString() };
    db.flights = [{ flight: "Y4 123", flight_date: localISODatePlus(5), last_status: "a tiempo", last_checked_at: new Date(Date.now() - 3600_000).toISOString() }];
    renderHome();
    const cc = await screen.findByRole("region", { name: /Puebla/ });
    expect(within(cc).getByText("Próximo viaje")).toBeInTheDocument();
    expect(within(cc).getByText("Faltan 5 días")).toBeInTheDocument();
    expect(await within(cc).findByText(/Total cotizado \$23,560 MXN/)).toBeInTheDocument();
    expect(within(cc).getByText(/Cotizado hace 2 h/)).toBeInTheDocument();
    expect(await within(cc).findByText(/Vuelo Y4 123 · a tiempo · revisado hace 1 h/)).toBeInTheDocument();
    expect(await within(cc).findByText(/21° · Despejado/)).toBeInTheDocument();
    expect(within(cc).getByText("Elige y reserva")).toBeInTheDocument();
    fireEvent.click(within(cc).getByRole("button", { name: /Elegir vuelo y hotel/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/dashboard/viajes/${PUEBLA}`));
  });

  it("un borrador sin cotización pide cotizar; mientras carga no muestra una acción equivocada", async () => {
    db.fullTrip = { ...db.trips[0], total_estimado: 0 };
    renderHome();
    const cc = await screen.findByRole("region", { name: /Puebla/ });
    expect(await within(cc).findByText("Cotiza tu viaje")).toBeInTheDocument();
    expect(within(cc).getByText("Aún sin cotización")).toBeInTheDocument();
    expect(within(cc).getByRole("link", { name: "Equipaje" })).toHaveAttribute("href", `/dashboard/viajes/${PUEBLA}/packing`);
  });

  it("las herramientas ocupan todo el ancho (ya no quedan dentro de la rejilla de 2 columnas)", async () => {
    renderHome();
    const tools = await screen.findByRole("heading", { name: "Herramientas" });
    expect(tools.closest(".lg\\:grid-cols-2")).toBeNull();
  });
});
