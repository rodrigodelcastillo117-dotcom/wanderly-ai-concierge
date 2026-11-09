// Recorrido en producción (9-nov-2026): en el celular, el tipo de viaje (centrado arriba) se encimaba con el «% afín»
// y con el corazón, y «Imagen ilustrativa» con el país. Ahora el tipo va junto al país y arriba solo el «% afín».
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAIRecommendations", () => ({
  useAIRecommendations: () => ({
    recos: [{ name: "Lisboa", country: "Portugal", trip_type: "City break", score: 96, reason: "Mercados y barrios a pie.", best_months: "abr–jun", image_query: "Lisboa" }],
    profileless: false, loading: false, error: null, refresh: () => {},
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const api: any = { select: () => api, eq: () => api, in: () => api, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
  return { supabase: { from: () => api, functions: { invoke: async () => ({ data: null, error: null }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => <div /> }));
vi.mock("@/components/RoadTripIdeas", () => ({ RoadTripIdeas: () => null }));

import Discover from "@/pages/Discover";

describe("tarjeta de Descubre", () => {
  it("el tipo de viaje va junto al país, no arriba con el «% afín» y el corazón", async () => {
    render(<MemoryRouter><Discover /></MemoryRouter>);
    const pais = await screen.findByTestId("discover-country");
    expect(pais).toHaveTextContent("Portugal · City break");
    const arriba = screen.getByTestId("discover-chips");
    expect(within(arriba).getByText("96% afín a ti")).toBeInTheDocument();
    expect(arriba).not.toHaveTextContent(/City break/i);
    expect(screen.getByTestId("illustrative-caption")).toBeInTheDocument();
  });
});
