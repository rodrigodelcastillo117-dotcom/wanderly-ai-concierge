// CANDADO · el globo de la ruta, ARRIBA en el celular (30-oct-2026, aprobado por el dueño). En el celular el
// globo quedaba hasta abajo de /dashboard/ruta y Carlo no lo veía. Falla si:
//  - en el celular el globo deja de ser lo primero después del título (antes de armar la ruta);
//  - se monta más de un globo (dos lienzos WebGL);
//  - en computadora deja de ir en la columna derecha.
// El flujo de cotizar directo lo cuida candadoPlanear.test.tsx (sin cambios).
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, update: () => api, insert: () => api,
      maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: async () => ({ data: null, error: null }) }, auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "carlo@example.com" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/RouteGlobe3D", () => ({
  RouteGlobe3D: ({ destinations }: any) => <div data-testid="candado-globo" data-destinos={destinations.join("|")} />,
}));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => <div data-testid="candado-preview" /> }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: any) => <span>{value}</span> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, layout, whileHover, whileTap, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</>, useReducedMotion: () => true };
});

import MultiDestRoute from "@/pages/MultiDestRoute";

const origMatchMedia = window.matchMedia;
const pantalla = (ancho: "celular" | "computadora") => {
  window.matchMedia = ((q: string) => ({
    matches: ancho === "computadora" && /min-width:\s*1024px/.test(q), media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as any;
};
const abrirRuta = () => render(
  <MemoryRouter initialEntries={[`/dashboard/ruta?origin=${encodeURIComponent("Ciudad de México")}&destinos=${encodeURIComponent("Tokio|Kioto|Osaka")}`]}>
    <Routes><Route path="/dashboard/ruta" element={<MultiDestRoute />} /></Routes>
  </MemoryRouter>,
);
const antes = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { window.matchMedia = origMatchMedia; });

describe("CANDADO · el globo de la ruta arriba en el celular", () => {
  it("celular: el globo va justo después del título, antes de la ciudad de origen y los destinos; uno solo", async () => {
    pantalla("celular");
    abrirRuta();
    const g = await screen.findByTestId("candado-globo", {}, { timeout: 8000 });
    expect(g.getAttribute("data-destinos")).toBe("Tokio|Kioto|Osaka");
    expect(g.closest('[data-testid="ruta-globo-arriba"]'), "el globo no está arriba").not.toBeNull();
    const titulo = screen.getByRole("heading", { level: 1 });
    const origen = screen.getByText("Ciudad de origen");
    expect(antes(titulo, g)).toBe(true);
    expect(antes(g, origen), "el globo quedó debajo de la ciudad de origen").toBe(true);
    expect(antes(g, screen.getByTestId("candado-preview"))).toBe(true);
    expect(screen.getAllByTestId("candado-globo")).toHaveLength(1);
  });

  it("computadora: el globo sigue en la columna derecha (después del resumen del viaje); uno solo", async () => {
    pantalla("computadora");
    abrirRuta();
    const g = await screen.findByTestId("candado-globo", {}, { timeout: 8000 });
    expect(screen.queryByTestId("ruta-globo-arriba")).toBeNull();
    expect(antes(screen.getByTestId("candado-preview"), g)).toBe(true);
    expect(antes(screen.getByText("Ciudad de origen"), g)).toBe(true);
    expect(screen.getAllByTestId("candado-globo")).toHaveLength(1);
  });
});
