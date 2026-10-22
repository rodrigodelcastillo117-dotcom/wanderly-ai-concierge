// N-09 (causa raíz): al llegar la sesión, la guardia montaba la página antes de cargar el estado
// de onboarding, la desmontaba al empezar la carga y la volvía a montar. Una página que arranca
// trabajo al montarse (PlanTrip con ?q=) perdía ese trabajo.
import React, { useEffect } from "react";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const row = {
  user_id: "u1", completed_onboarding: true, current_step: 5, selected_cards: [],
  selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null, completed_at: null,
};
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ...row }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: async () => ({}) } } }));
let auth: { user: { id: string } | null; loading: boolean } = { user: null, loading: true };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OnboardingProvider } from "@/hooks/useOnboardingStatus";

let mounts = 0;
const Page = () => {
  useEffect(() => { mounts += 1; }, []);
  return <p>PAGINA</p>;
};

it("la página protegida se monta una sola vez cuando llega la sesión", async () => {
  const tree = () => (
    <MemoryRouter>
      <OnboardingProvider>
        <ProtectedRoute><Page /></ProtectedRoute>
      </OnboardingProvider>
    </MemoryRouter>
  );
  const r = render(tree());
  await act(async () => { await new Promise((res) => setTimeout(res, 10)); });
  // Llega la sesión (AuthContext termina de hidratar).
  auth = { user: { id: "u1" }, loading: false };
  r.rerender(tree());
  await screen.findByText("PAGINA");
  await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
  expect(mounts).toBe(1);
});
