// CANDADO · Planear y el globo (29-oct-2026). Lo que Carlo extrañó: "el mundito" (el globo 3D de la ruta) y
// cotizar directo. Falla si:
//  - la ruta de varias ciudades deja de montar el globo 3D (RouteGlobe3D) con sus ciudades;
//  - escribir un viaje de varias ciudades con todo dicho deja de llevar directo a la ruta con el globo;
//  - escribir un viaje de una ciudad con todo dicho deja de cotizar directo;
//  - vuelve un paso obligatorio (cualquier pantalla que pida un clic antes de llegar).
// Cómo: se escribe el viaje y NO se hace ningún clic; si hace falta un clic para llegar, la prueba falla.
// Datos simulados, sin red ni gasto.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ fn: string; body: any }> = [];
const invoke = vi.fn(async (fn: string, o: any) => {
  calls.push({ fn, body: o?.body });
  if (fn === "analizar-viaje") return { data: { trip: { id: "nuevo-1", itinerario_json: [] } }, error: null };
  return { data: null, error: null };
});
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, update: () => api, insert: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? { ciudad_origen: "Ciudad de México" } : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: (f: string, o: any) => invoke(f, o) }, auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) } };
});
const AUTH = { user: { id: "u1", email: "carlo@example.com" }, loading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
// El globo 3D real usa WebGL (no corre en jsdom): se reemplaza por una marca con las ciudades que recibe.
// Si la ruta deja de importar/montar RouteGlobe3D, la marca no aparece y la prueba falla.
vi.mock("@/components/RouteGlobe3D", () => ({
  RouteGlobe3D: ({ origin, destinations }: any) => <div data-testid="candado-globo" data-origin={origin} data-destinos={destinations.join("|")} />,
}));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p data-testid="candado-analizando" /> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
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

import PlanTrip from "@/pages/PlanTrip";
import MultiDestRoute from "@/pages/MultiDestRoute";

const paid = () => calls.filter((c) => ["analizar-viaje", "logistics-plan", "interpretar-viaje"].includes(c.fn)).map((c) => c.fn);
let loc = "";
const Spy = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
const app = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Spy />
    <Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} />
      <Route path="/dashboard/ruta" element={<MultiDestRoute />} />
      <Route path="/dashboard/viajes/:id" element={<p data-testid="candado-viaje" />} />
    </Routes>
  </MemoryRouter>,
);
const planear = (texto: string) => app(`/dashboard/planear?q=${encodeURIComponent(texto)}`);
const globo = () => screen.findByTestId("candado-globo", {}, { timeout: 8000 });

/** Cuenta los clics: la prueba no hace ninguno; si la app llega a su destino, no hubo paso obligatorio. */
let clicks = 0;
const countClicks = () => { clicks++; };

beforeEach(() => {
  calls.length = 0;
  invoke.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  clicks = 0;
  document.addEventListener("click", countClicks, true);
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { document.removeEventListener("click", countClicks, true); });

describe("CANDADO · el globo de la ruta (multidestino)", () => {
  it("la ruta de varias ciudades monta el globo con el origen y cada ciudad, en orden", async () => {
    app(`/dashboard/ruta?origin=${encodeURIComponent("Ciudad de México")}&destinos=${encodeURIComponent("Tokio|Kioto|Osaka")}`);
    const g = await globo();
    expect(g.getAttribute("data-origin")).toBe("Ciudad de México");
    expect(g.getAttribute("data-destinos")).toBe("Tokio|Kioto|Osaka");
  });

  it.each([
    ["Lisboa → Sintra → Oporto del 3 al 12 de mayo de 2027 desde CDMX", "Lisboa|Sintra|Oporto"],
    ["Roma, Florencia y Venecia del 10 al 20 de mayo de 2027 desde CDMX, 2 personas", "Roma|Florencia|Venecia"],
  ])("«%s» → directo a la ruta con el globo, sin clics y sin gastar", async (texto, destinos) => {
    planear(texto);
    const g = await globo();
    expect(g.getAttribute("data-destinos")).toBe(destinos);
    expect(loc).toMatch(/^\/dashboard\/ruta\?/);
    expect(clicks).toBe(0);
    expect(paid()).toEqual([]); // se cotiza al pulsar en la ruta, no antes
  });
});

describe("CANDADO · cotizar directo (sin paso de revisión)", () => {
  it.each([
    ["Oaxaca del 12 al 16 de diciembre, 2 personas", "Oaxaca"],
    ["Cancún del 5 al 10 de enero de 2027 desde Monterrey, 2 personas", "Cancún"],
  ])("«%s» → cotiza directo y abre el viaje, sin clics", async (texto, destino) => {
    planear(texto);
    expect(await screen.findByTestId("candado-viaje", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(loc).toBe("/dashboard/viajes/nuevo-1");
    expect(clicks).toBe(0);
    expect(paid()).toEqual(["analizar-viaje"]); // una sola cotización
    expect(calls.find((c) => c.fn === "analizar-viaje")!.body).toMatchObject({ destino });
  });

  it("si falta un dato real, solo se pregunta ese dato (no una revisión de todo el viaje)", async () => {
    planear("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    // Aparece el paso corto con UNA pregunta (el día de salida) y nada más.
    const paso = await screen.findByTestId("plan-preguntas", {}, { timeout: 8000 });
    await waitFor(() => expect(paso.querySelectorAll("input[type=date]").length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByTestId("spec-review")).toBeNull();
    expect(paid()).toEqual([]);
  });
});
