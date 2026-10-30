// Propuesta «Inicio sencillo»: «Planear un viaje» de Inicio abre la MISMA ventana «Planear viaje» que el «+» de
// la barra inferior y el botón dorado del menú lateral (una sola forma de planear; las 3 entradas siguen).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, describe } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, order: () => qb, limit: () => qb, maybeSingle: async () => ({ data: { full_name: "Ana" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: async () => ({ data: { ok: true, disponible: false, sin_cache: true, results: [] }, error: null }) } } }));
const auth = { user: { id: "u1" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/lib/googleMapsLoader", () => ({ loadGoogleMaps: vi.fn(async () => { throw new Error("sin mapas en pruebas"); }) }));

import { DashboardLayout } from "@/components/DashboardLayout";
import { openPlanWindow } from "@/lib/planBus";

const renderLayout = () => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <DashboardLayout><p>INICIO</p></DashboardLayout>
  </MemoryRouter>,
);

describe("una sola forma de planear", () => {
  it("openPlanWindow (botón de Inicio) abre la ventana «Planear viaje» del menú; sin menú montado devuelve false", async () => {
    expect(openPlanWindow()).toBe(false);
    const { unmount } = renderLayout();
    expect(screen.queryByTestId("plan-dialog")).toBeNull();
    let ok = false;
    await act(async () => { ok = openPlanWindow(); });
    expect(ok).toBe(true);
    const d = await screen.findByTestId("plan-dialog", {}, { timeout: 20_000 });
    expect(within(d).getByRole("heading", { name: "Planear viaje" })).toBeInTheDocument();
    unmount();
    expect(openPlanWindow()).toBe(false);
  });

  it("el «+» de la barra y el botón del menú lateral siguen abriendo la misma ventana (las 3 entradas viven)", async () => {
    renderLayout();
    const plus = within(document.querySelector('nav[aria-label="Navegación principal"]') as HTMLElement).getByRole("link", { name: "Planear un viaje nuevo" });
    expect(plus).toHaveAttribute("href", "/dashboard/planear");
    fireEvent.click(plus);
    expect(await screen.findByTestId("plan-dialog", {}, { timeout: 20_000 })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("plan-dialog")).toBeNull());
    const side = within(document.querySelector("aside") as HTMLElement).getByRole("link", { name: "Planear viaje" });
    expect(side).toHaveAttribute("href", "/dashboard/planear");
    fireEvent.click(side);
    expect(await screen.findByTestId("plan-dialog")).toBeInTheDocument();
  });
});
