// R2 viajes P2-5: el Modo en vivo de Valle de Bravo (viaje por carretera) mostraba «Vuelos · 2 opciones»
// (contaba el coche y el autobús de vuelos_json como vuelos).
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const TRIP = "77777777-7777-4777-8777-777777777777";
const db = vi.hoisted(() => ({ trip: null as any }));
vi.mock("@/integrations/supabase/client", () => {
  const api: any = {
    select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api, update: () => api,
    maybeSingle: async () => ({ data: db.trip, error: null }),
    single: async () => ({ data: db.trip, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: db.trip ? [db.trip] : [], error: null }).then(res, rej),
  };
  return { supabase: { from: () => api, rpc: async () => ({ data: null, error: null }), functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1", email: "u1@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import LiveTrip from "@/pages/LiveTrip";

const TRIP_FN = (extra: any) => ({ id: TRIP, user_id: "u1", destino: "Valle de Bravo", pais_destino: "México", ciudad_origen: "Ciudad de México",
  fecha_salida: localISODatePlus(2), fecha_regreso: localISODatePlus(4), itinerario_json: [], ...extra });
const renderLive = () => render(<MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/live`]}><Routes><Route path="/dashboard/viajes/:id/live" element={<LiveTrip />} /></Routes></MemoryRouter>);

describe("Modo en vivo sin «Vuelos» en un viaje por carretera", () => {
  it("Valle de Bravo en coche: «Cómo llegar · 2», sin «Vuelos»", async () => {
    db.trip = TRIP_FN({ vuelos_json: [{ mode: "coche", aerolinea: "En tu coche" }, { mode: "autobus", aerolinea: "Autobús" }] });
    renderLive();
    expect(await screen.findByText("Cómo llegar")).toBeInTheDocument();
    expect(screen.queryByText("Vuelos")).toBeNull();
  });

  it("un viaje con vuelo sigue diciendo «Vuelos»", async () => {
    db.trip = TRIP_FN({ destino: "Madrid", pais_destino: "España", vuelos_json: [{ aerolinea: "Iberia", precio_por_persona: 15000 }] });
    renderLive();
    expect(await screen.findByText("Vuelos")).toBeInTheDocument();
  });
});
