// Mejora 9.5 (resto de la app): primer uso. Un usuario nuevo entiende en 10 segundos qué hace IATOS y qué tocar.
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";

const row: any = {};
const reset = (step: number) => Object.assign(row, {
  user_id: "u1", completed_onboarding: false, current_step: step, selected_cards: [],
  selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, completed_at: null,
});
function qb() {
  let patch: any = null;
  const api: any = {
    select: () => api, eq: () => api,
    update: (p: any) => { patch = p; return api; },
    upsert: async () => ({ error: null }),
    maybeSingle: async () => { if (patch) Object.assign(row, patch); return { data: { ...row }, error: null }; },
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb(), functions: { invoke: async () => ({}) } } }));
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));

import { OnboardingProvider } from "@/hooks/useOnboardingStatus";
import Onboarding from "@/pages/Onboarding";
import { FirstTripGuide, FIRST_TRIP_STEPS } from "@/components/FirstTripGuide";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; };
const renderOnb = () => render(
  <MemoryRouter initialEntries={["/onboarding"]}>
    <OnboardingProvider>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </OnboardingProvider>
  </MemoryRouter>,
);

beforeEach(() => reset(1));

describe("Bienvenida (onboarding, paso 1)", () => {
  it("dice qué hace IATOS en 3 pasos (no solo que hay 3 preguntas)", async () => {
    renderOnb();
    const pasos = await screen.findByTestId("onb-como-funciona");
    const items = within(pasos).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/a dónde y cuándo/);
    expect(items[1]).toMatch(/vuelos y hoteles/);
    expect(items[2]).toMatch(/total en pesos/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Planea tu viaje/);
  });

  it("la acción principal lleva directo a planear y termina el onboarding (las preguntas son opcionales)", async () => {
    renderOnb();
    fireEvent.click(await screen.findByRole("button", { name: /Planear mi primer viaje/ }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/dashboard/planear");
    expect(row.completed_onboarding).toBe(true);
  });

  it("personalizar primero sigue a las preguntas (no se quitó ninguna)", async () => {
    renderOnb();
    fireEvent.click(await screen.findByRole("button", { name: /personalizar con 3 preguntas/ }));
    expect(await screen.findByText("¿Qué tarjetas premium tienes?")).toBeInTheDocument();
    expect(row.completed_onboarding).toBe(false);
  });
});

describe("Inicio sin viajes: guía del primer viaje", () => {
  it("explica cómo funciona en 3 pasos cortos y mantiene los ejemplos", () => {
    const pick = vi.fn();
    render(<MemoryRouter><FirstTripGuide onPickExample={pick} /></MemoryRouter>);
    const pasos = screen.getByTestId("first-trip-steps");
    expect(within(pasos).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d/, ""))).toEqual([...FIRST_TRIP_STEPS]);
    fireEvent.click(screen.getByRole("button", { name: "“Oaxaca un fin de semana, 2 personas”" }));
    expect(pick).toHaveBeenCalledWith("Oaxaca un fin de semana, 2 personas");
  });
});
