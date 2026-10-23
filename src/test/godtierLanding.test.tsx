// Landing y navegación (grupo godtier): qué gana el usuario en 10 segundos, sin promesas que no
// se cumplen; acción "Planear viaje" también en escritorio y enlace para saltar al contenido.
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, rpc: async () => ({ data: { trial_no_card_enabled: false }, error: null }) } }));
// La landing es para quien no ha iniciado sesión (con sesión redirige a /dashboard); el layout, con sesión.
const authState = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authState.user, signOut: async () => {} }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import Landing from "@/pages/Landing";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PRO_PRICE_MXN } from "@/lib/planCopy";

it("el hero dice qué hace la app y los 3 beneficios concretos están justo debajo", async () => {
  authState.user = null;
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Planea tu viaje.Conoce el costo antes de decidir.");
  for (const t of ["Un total claro en pesos", "Sabes qué precio es real", "Todo tu viaje en un lugar"]) {
    expect(screen.getByText(t)).toBeInTheDocument();
  }
  expect(screen.getByText(/se consultó en vivo con el proveedor o si es una estimación/)).toBeInTheDocument();
  // Precio desde planCopy y nombre del plan consistente.
  expect(screen.getByText(`$${PRO_PRICE_MXN}`)).toBeInTheDocument();
  expect(screen.getAllByText("IATOS PRO").length).toBeGreaterThan(0);
  const text = document.body.textContent ?? "";
  // Reglas de honestidad: nada de "ilimitado", "24/7", "VIP", ni prueba sin tarjeta (está apagada).
  expect(text).not.toMatch(/ilimitad|24\/7|\bVIP\b|sin tarjeta|Sin límites|números reales/i);
});

it("la navegación ofrece saltar al contenido y 'Planear viaje' también en escritorio", () => {
  authState.user = { id: "u1" };
  render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardLayout><p>PAGINA</p></DashboardLayout></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Saltar al contenido" })).toHaveAttribute("href", "#contenido");
  expect(document.getElementById("contenido")?.tagName).toBe("MAIN");
  expect(screen.getByRole("link", { name: "Planear viaje" })).toHaveAttribute("href", "/dashboard/planear");
});

import { act } from "@testing-library/react";
import { FreeLimitDialogLazyHost } from "@/components/FreeLimitDialogLazy";
import { openFreeLimitDialog, closeFreeLimitDialog } from "@/lib/freeLimitStore";

it("el diálogo de límite ya no viaja en la carga inicial, pero aparece al necesitarse", async () => {
  const { container } = render(<MemoryRouter><FreeLimitDialogLazyHost /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
  act(() => openFreeLimitDialog({ quota: "trip_analysis_once", limit: 1, used: 1, renewsAt: null, upgradeAvailable: true }));
  expect(await screen.findByText("Usaste tu análisis gratuito")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Conocer IATOS PRO" })).toBeInTheDocument();
  act(() => closeFreeLimitDialog());
});

it("iPhone: la barra de arriba deja la franja de la hora y la Isla Dinámica (los botones se pueden tocar)", () => {
  authState.user = null;
  render(<MemoryRouter><Landing /></MemoryRouter>);
  const nav = screen.getByTestId("landing-nav");
  // index.html usa viewport-fit=cover y barra translúcida: la barra fija debe sumar el área segura.
  expect(nav.className).toContain("pt-[env(safe-area-inset-top)]");
  expect(nav).toContainElement(screen.getByRole("button", { name: "Iniciar sesión" }));
});
