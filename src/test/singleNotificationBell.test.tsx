// Pulido UX: la campana se montaba dos veces (barra móvil + esquina de escritorio, una oculta por CSS)
// y cada copia consultaba notificaciones y abría su canal en tiempo real. Debe montarse solo una.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, afterEach } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb } }));
const auth = { user: { id: "u1" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => <span data-testid="campana" /> }));

import { DashboardLayout } from "@/components/DashboardLayout";

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

function withWidth(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes("min-width: 1024px"),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const renderLayout = () => render(
  <MemoryRouter initialEntries={["/dashboard/viajes"]}>
    <DashboardLayout><p>PAGINA</p></DashboardLayout>
  </MemoryRouter>,
);

it("en móvil hay una sola campana (la de la barra superior)", () => {
  withWidth(false);
  renderLayout();
  expect(screen.getAllByTestId("campana")).toHaveLength(1);
});

it("en escritorio hay una sola campana (la de la esquina)", () => {
  withWidth(true);
  renderLayout();
  expect(screen.getAllByTestId("campana")).toHaveLength(1);
});
