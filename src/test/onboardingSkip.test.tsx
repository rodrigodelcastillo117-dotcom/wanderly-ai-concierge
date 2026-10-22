import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach } from "vitest";

// user_onboarding_state en memoria; `failUpdate` simula un error de red al guardar.
let failUpdate = false;
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
    maybeSingle: async () => {
      if (patch && failUpdate) return { data: null, error: { message: "network" } };
      if (patch) Object.assign(row, patch);
      return { data: { ...row }, error: null };
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb(), functions: { invoke: async () => ({}) } } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
const toastSpy = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastSpy }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import { OnboardingProvider } from "@/hooks/useOnboardingStatus";
import Onboarding from "@/pages/Onboarding";

const renderOnb = () =>
  render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <OnboardingProvider>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<p>DASHBOARD</p>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  );

beforeEach(() => { failUpdate = false; toastSpy.error.mockClear(); });

for (const step of [1, 2, 3, 4, 5]) {
  it(`paso ${step}: 'Saltar por ahora' completa el onboarding con valores por defecto y lleva al inicio`, async () => {
    reset(step);
    renderOnb();
    fireEvent.click(await screen.findByRole("button", { name: "Saltar por ahora" }));
    expect(await screen.findByText("DASHBOARD")).toBeInTheDocument();
    expect(row.completed_onboarding).toBe(true);
    expect(row.selected_cards).toEqual([]);
  });
}

it("si guardar falla, avisa y NO navega (antes navegaba y el guard lo regresaba)", async () => {
  reset(2);
  failUpdate = true;
  renderOnb();
  fireEvent.click(await screen.findByRole("button", { name: "Saltar por ahora" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(screen.queryByText("DASHBOARD")).toBeNull();
  expect(toastSpy.error).toHaveBeenCalled();
});
