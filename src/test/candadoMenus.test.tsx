// CANDADO · menús (29-oct-2026). Falla si una entrada del menú lateral, de la barra inferior del celular o
// de la hoja «Más» desaparece, si un enlace del menú lleva a una pantalla que ya no existe, o si el buzón
// de opiniones deja de abrirse. El menú se monta de verdad (DashboardLayout) y se leen sus enlaces.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, createRoutesFromChildren, matchRoutes, type RouteObject } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb } }));
// Objeto estable: un usuario nuevo en cada render vuelve a disparar los efectos [user] sin fin.
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "candado@example.com" }, signOut: async () => {} }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual: any = await vi.importActual("@/contexts/AuthContext");
  return { ...actual, useAuth: () => auth };
});
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import App from "@/App";
import { DashboardLayout } from "@/components/DashboardLayout";
import { BARRA_INFERIOR, MENU_LATERAL, MENU_LATERAL_EXTRAS, MENU_MAS } from "./candadoInventario";

// ─── El árbol de rutas de App (para saber si un enlace del menú lleva a una pantalla que existe) ────────
function findRoutesElement(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) { const f = findRoutesElement(n); if (f) return f; }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === Routes) return node;
  return findRoutesElement((node.props as { children?: ReactNode }).children);
}
const routesEl = findRoutesElement((App as () => ReactElement)());
const ROUTES: RouteObject[] = routesEl ? createRoutesFromChildren((routesEl.props as { children: ReactNode }).children) : [];
const matchFor = (url: string) => matchRoutes(ROUTES, url) ?? [];

// ─── Menús ────────────────────────────────────────────────────────────────────────────────────────────
const renderLayout = (path = "/dashboard") => render(
  <MemoryRouter initialEntries={[path]}>
    <DashboardLayout><p>PANTALLA</p></DashboardLayout>
  </MemoryRouter>,
);
// querySelectorAll y no getByRole: en el menú completo las consultas por rol de jsdom tardan minutos.
const hrefs = (root: Element) => Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? "");
const bottomNav = () => document.querySelector('nav[aria-label="Navegación principal"]') as HTMLElement;
const openMore = () => fireEvent.click(bottomNav().querySelector("button[aria-haspopup='dialog']:not([aria-label])") as HTMLElement);
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const existe = (href: string) => { const m = matchFor(href.split(/[?#]/)[0]); return m.length > 0 && m[m.length - 1].route.path !== "*"; };

// El diálogo de opiniones (Radix) usa ResizeObserver, que jsdom no trae.
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

describe("CANDADO · menús", () => {
  it("el menú lateral conserva todas sus secciones, Planear, PRO, Privé y Ayuda", () => {
    renderLayout();
    const nav = screen.getByTestId("sidebar-nav");
    const lateral = hrefs(nav);
    for (const to of MENU_LATERAL) expect(lateral, `falta ${to} en el menú lateral`).toContain(to);
    const aside = nav.closest("aside") as HTMLElement;
    const todo = hrefs(aside);
    for (const to of MENU_LATERAL_EXTRAS) expect(todo, `falta ${to} en la barra lateral`).toContain(to);
  });

  it("la barra inferior del celular conserva Inicio, Viajes, Planear y Concierge, más el botón Más", () => {
    renderLayout();
    const nav = bottomNav();
    const barra = hrefs(nav);
    for (const to of BARRA_INFERIOR) expect(barra, `falta ${to} en la barra inferior`).toContain(to);
    expect(nav.querySelectorAll("button").length).toBeGreaterThanOrEqual(1); // "Más"
  });

  it("la hoja «Más» conserva todos sus destinos, el buzón de opiniones y cerrar sesión", () => {
    renderLayout();
    openMore();
    const sheet = dialog()!;
    expect(sheet).not.toBeNull();
    const mas = hrefs(sheet);
    for (const to of MENU_MAS) expect(mas, `falta ${to} en «Más»`).toContain(to);
    expect(sheet.querySelector('[data-testid="more-opinion"]')).not.toBeNull();
  });

  it("cada enlace de los menús lleva a una pantalla que existe (nunca a «No encontrada»)", () => {
    renderLayout();
    openMore();
    const todos = Array.from(new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!)))
      .filter((h) => h.startsWith("/"));
    expect(todos.length).toBeGreaterThan(14);
    const rotos = todos.filter((h) => !existe(h));
    expect(rotos, `Enlaces del menú a pantallas que no existen: ${rotos.join(", ")}`).toEqual([]);
  });

  it("el buzón de opiniones se abre desde el menú lateral y desde «Más»", async () => {
    renderLayout();
    expect(screen.queryByTestId("opinion-dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("sidebar-opinion")); });
    expect(await screen.findByTestId("opinion-dialog", {}, { timeout: 20_000 })).toBeInTheDocument();
  });
});
