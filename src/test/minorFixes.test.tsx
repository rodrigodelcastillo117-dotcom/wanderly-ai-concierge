import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";

// E-28: detalles menores (origen de vuelos y viaje inexistente en el traductor).
const state = vi.hoisted(() => ({ profile: null as any, trip: null as any }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? state.profile : state.trip, error: null }),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: async () => ({ data: null, error: null }) } } };
});
const user = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/hooks/useTooltipShown", () => ({ useTooltipShown: () => ({ shouldShow: false, dismiss: () => {} }) }));
vi.mock("framer-motion", () => {
  const cache: Record<string, any> = {};
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import TripFlights from "@/pages/TripFlights";
import TripTranslator from "@/pages/TripTranslator";

describe("Vuelos: origen por defecto", () => {
  beforeEach(() => { state.profile = null; });
  it("usa la ciudad de origen del perfil (antes siempre 'Mexico City')", async () => {
    state.profile = { ciudad_origen: "Guadalajara" };
    render(<MemoryRouter><TripFlights /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText(/origen/i)).toHaveValue("Guadalajara"));
  });
  it("sin ciudad en el perfil: CDMX; con ?origin= en la URL, respeta la URL", async () => {
    render(<MemoryRouter><TripFlights /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText(/origen/i)).toHaveValue("CDMX"));
  });
  it("con ?origin= en la URL no lo pisa el perfil", async () => {
    state.profile = { ciudad_origen: "Guadalajara" };
    render(<MemoryRouter initialEntries={["/x?origin=Monterrey"]}><TripFlights /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText(/origen/i)).toHaveValue("Monterrey");
  });
});

it("Traductor: un viaje que no existe muestra 'No encontramos este viaje' (antes, pantalla vacía)", async () => {
  state.trip = null;
  render(
    <MemoryRouter initialEntries={["/dashboard/viajes/nada/traductor"]}>
      <Routes><Route path="/dashboard/viajes/:id/traductor" element={<TripTranslator />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "No encontramos este viaje" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a Mis viajes" })).toHaveAttribute("href", "/dashboard/viajes");
});
