import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

// Entradas discretas a IATOS Privé sin romper la navegación existente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generador encadenable simulado
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, rpc: async () => ({ data: [], error: null }) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: async () => {} }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import { DashboardLayout } from "@/components/DashboardLayout";
import { MembersTeaser } from "@/components/MembersTeaser";

it("el menú lateral y 'Más' llevan a /prive", () => {
  render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardLayout><p>x</p></DashboardLayout></MemoryRouter>);
  const links = screen.getAllByRole("link", { name: /IATOS Privé/ });
  expect(links.some((l) => l.getAttribute("href") === "/prive")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Más" }));
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "IATOS Privé" })).toHaveAttribute("href", "/prive");
  // Lo demás sigue igual.
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Mi perfil" })).toHaveAttribute("href", "/dashboard/perfil");
});

it("Members Only (adelanto) muestra la entrada a Privé y conserva su CTA de PRO", () => {
  render(<MemoryRouter><MembersTeaser passwordGate={false} onUnlocked={() => {}} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /IATOS Privé/ })).toHaveAttribute("href", "/prive");
  expect(screen.getByRole("link", { name: "Conocer IATOS PRO" })).toHaveAttribute("href", "/dashboard/pro");
});
