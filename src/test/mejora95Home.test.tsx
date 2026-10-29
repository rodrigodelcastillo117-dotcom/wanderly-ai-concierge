// Mejora 9.5: Inicio con menos ruido al entrar por primera vez (mismos mocks que godtierHome).
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
const recoState = vi.hoisted(() => ({ recos: [] as any[], profileless: false }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: recoState.recos, profileless: recoState.profileless, loading: false }) }));
vi.mock("@/lib/weatherNow", () => ({ fetchWeatherNow: async () => ({ tempC: 21, label: "Despejado", source: "MET Norway" }) }));
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
  db.trips = []; db.fullTrip = null; db.quote = null; db.flights = [];
  recoState.recos = []; recoState.profileless = false;
});

describe("Inicio de una cuenta nueva", () => {
  it("sin viajes no repite la tarjeta vacía «Mis próximos viajes» (la guía de arriba ya dice qué hacer)", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: /Planea tu primer viaje/ })).toBeInTheDocument();
    expect(screen.queryByText("Mis próximos viajes")).toBeNull();
    expect(screen.queryByText("Aún no tienes viajes planeados.")).toBeNull();
    expect(screen.queryByRole("button", { name: /Crear nuevo viaje/ })).toBeNull();
  });

  it("las herramientas muestran 8 y el resto con un toque (ninguna se quita)", async () => {
    renderHome();
    const tools = (await screen.findByRole("heading", { name: "Herramientas" })).closest("section")!;
    // querySelectorAll (no getAllByRole): Inicio es grande y las consultas por rol son lentas.
    const tiles = () => [...tools.querySelectorAll("button")].filter((b) => b.dataset.testid !== "home-tools-toggle");
    const has = (label: string) => tiles().some((b) => b.textContent?.includes(label));
    expect(tiles()).toHaveLength(8);
    expect(has("Vuelos")).toBe(true);
    expect(has("Ferries")).toBe(false);
    const toggle = within(tools).getByTestId("home-tools-toggle");
    expect(toggle).toHaveTextContent("Ver las 16 herramientas");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(tiles()).toHaveLength(16);
    expect(has("Ferries")).toBe(true);
    expect(toggle).toHaveTextContent("Ver menos herramientas");
  });

  it("recomendaciones sin perfil: «para inspirarte» y sin un % afín inventado", async () => {
    recoState.recos = [{ name: "Oaxaca", country: "México", score: 91, reason: "", image_query: "oaxaca" }];
    recoState.profileless = true;
    renderHome();
    expect(await screen.findByRole("heading", { name: "Destinos para inspirarte" })).toBeInTheDocument();
    expect(screen.queryByText(/afín a ti/)).toBeNull();
  });

  it("con perfil sigue igual: «Destinos afines a ti» con su %", async () => {
    recoState.recos = [{ name: "Oaxaca", country: "México", score: 91, reason: "", image_query: "oaxaca" }];
    renderHome();
    expect(await screen.findByRole("heading", { name: "Destinos afines a ti" })).toBeInTheDocument();
    expect(screen.getByText("91% afín a ti")).toBeInTheDocument();
  });
});

describe("Inicio con viajes", () => {
  it("el video «Planea un nuevo viaje» dice que abre el modo emoción (no es otro «Crear nuevo viaje»)", async () => {
    db.trips = [{ id: PUEBLA, user_id: "u1", destino: "Puebla", pais_destino: "México", fecha_salida: localISODatePlus(5), fecha_regreso: localISODatePlus(7), created_at: "2026-01-01" }];
    renderHome();
    expect(await screen.findByTestId("home-hero-texto")).toHaveTextContent(/qué quieres sentir/);
    fireEvent.click(screen.getByRole("button", { name: "Planear por emoción" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/dashboard/planear?mode=emocion");
  });

  it("la tarjeta «Mis próximos viajes» sigue ahí", async () => {
    db.trips = [{ id: PUEBLA, user_id: "u1", destino: "Puebla", pais_destino: "México", fecha_salida: localISODatePlus(5), fecha_regreso: localISODatePlus(7), created_at: "2026-01-01" }];
    renderHome();
    expect(await screen.findByTestId("home-upcoming")).toHaveTextContent("Mis próximos viajes");
  });
});
