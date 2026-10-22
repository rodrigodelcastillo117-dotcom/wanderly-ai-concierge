import React from "react";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi } from "vitest";

// Base de datos mínima en memoria para user_onboarding_state.
const db: any = {
  user_onboarding_state: [{
    user_id: "u1", completed_onboarding: false, current_step: 5, selected_cards: [],
    selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, completed_at: null,
  }],
};
function qb(table: string) {
  const filters: any = {}; let patch: any = null;
  const api: any = {
    select: () => api, eq: (k: string, v: any) => { filters[k] = v; return api; },
    update: (p: any) => { patch = p; return api; },
    upsert: async () => ({ error: null }),
    maybeSingle: async () => {
      const rows = (db[table] || []).filter((r: any) => Object.entries(filters).every(([k, v]) => r[k] === v));
      if (patch) rows.forEach((r: any) => Object.assign(r, patch));
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => qb(t), functions: { invoke: async () => ({}) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OnboardingProvider } from "@/hooks/useOnboardingStatus";
import Onboarding from "@/pages/Onboarding";

const visits: string[] = [];
const Spy = () => { visits.push(useLocation().pathname); return null; };

it("finishing onboarding lands on the dashboard without bouncing (antes: ciclo infinito)", async () => {
  render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <OnboardingProvider>
        <Spy />
        <Routes>
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><p>DASHBOARD</p></ProtectedRoute>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText("Explorar primero"));
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

  expect(db.user_onboarding_state[0].completed_onboarding).toBe(true);
  expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
  expect(visits.filter((v) => v === "/onboarding").length).toBeLessThan(4);
});
