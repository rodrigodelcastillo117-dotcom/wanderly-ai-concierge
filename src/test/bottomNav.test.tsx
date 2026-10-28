import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb } }));
const auth = { user: { id: "u1" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import { DashboardLayout } from "@/components/DashboardLayout";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardLayout><div className="h-[calc(100vh-4rem)]">PAGINA</div></DashboardLayout>
    </MemoryRouter>,
  );

it("la barra inferior tiene máx. 5 elementos, etiquetas ≥12px y áreas táctiles ≥44px", () => {
  renderAt("/dashboard/viajes");
  const nav = screen.getByRole("navigation", { name: "Navegación principal" });
  const items = within(nav).getAllByRole("link").concat(within(nav).getAllByRole("button"));
  expect(items.length).toBeLessThanOrEqual(5);
  for (const el of items) {
    expect(el.className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
    expect(el.querySelector("span:last-child")!.className).toContain("text-xs"); // 12px
    expect(el.className).not.toMatch(/-top-7|absolute/); // el + ya no flota sobre otra pestaña
  }
  expect(within(nav).getByRole("link", { name: "Planear un viaje nuevo" })).toHaveAttribute("href", "/dashboard/planear");
});

it("'Más' da acceso a todos los destinos que salieron de la barra (Favoritos, Cercanos, Social, Gastos…)", () => {
  renderAt("/dashboard");
  fireEvent.click(screen.getByRole("button", { name: "Más" }));
  const dialog = screen.getByRole("dialog");
  for (const [name, href] of [
    ["Favoritos", "/dashboard/favoritos"], ["Cercanos", "/dashboard/cercanos"], ["Social", "/dashboard/social"],
    ["Gastos y ahorro", "/dashboard/gastos"], ["Mis reservas", "/dashboard/reservas"], ["Mi perfil", "/dashboard/perfil"],
    ["Documentos y tarjetas", "/dashboard/beneficios"],
  ]) {
    expect(within(dialog).getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(within(dialog).getByRole("button", { name: /Cerrar sesión/ })).toBeInTheDocument();
});

it("en el Concierge la página ocupa el alto restante sobre la barra (el compositor no queda oculto)", () => {
  renderAt("/dashboard/concierge");
  const vp = screen.getByTestId("chat-viewport");
  expect(vp.className).toContain("[&>*]:!h-full");
  expect(vp.parentElement!.className).toMatch(/pb-\[calc\(76px\+env\(safe-area-inset-bottom\)\)\]/);
});
