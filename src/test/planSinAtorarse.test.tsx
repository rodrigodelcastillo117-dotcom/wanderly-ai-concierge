// Aviso de Lovable (4-nov-2026): "Cancún, todo incluido" o "Madrid, en Semana Santa" dejaban el «Continuar» del
// planeador en gris y sin pregunta a la vista: lo extra se leía como un lugar por confirmar, y esa pregunta solo
// se muestra en rutas de 2+ ciudades. Ahora lo que no es lugar no se pregunta y nunca hay un botón gris sin motivo.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ inserts: [] as any[], invokes: [] as any[] }));

const LOGISTICS = {
  fx_usd_mxn: 18,
  selected_tier: "equilibrio",
  total_estimado_mxn: 98000,
  desglose_presupuesto: { vuelos: 30000, hospedaje: 50000, comida: 10000, tours: 5000, transporte_local: 2000, extras: 1000 },
  resumen: "Ruta por tres capitales.",
  flights: [{ tier: "equilibrio", from: "Ciudad de México", to: "París", airline_suggested: "Aerolínea por confirmar", duration: "11h", price_per_person_usd: 900, fuente_precio: "estimado" }],
  internal_transport: [
    { from: "París", to: "Roma", mode: "vuelo_interno", provider: "Aerolínea por confirmar", duration: "2h 10m", price_per_person_usd: 90 },
    { from: "Roma", to: "Atenas", mode: "vuelo_interno", provider: "Aerolínea por confirmar", duration: "2h 20m", price_per_person_usd: 110 },
  ],
  per_destination: [
    { city: "París", nights: 4, checkin: "2026-11-06", checkout: "2026-11-10", arrival_options: [{ mode: "tren", from: "CDG", provider: "RER B", duration: "35 min", price_per_person_usd: 12 }],
      hospedaje: [{ tier: "equilibrio", nombre: "Hôtel des Grands Boulevards", price_per_night_usd: 260, fuente_precio: "serpapi" }], restaurantes: [], experiencias: [] },
    { city: "Roma", nights: 3, checkin: "2026-11-10", checkout: "2026-11-13", arrival_options: [{ mode: "vuelo", from: "París", provider: "Aerolínea por confirmar", duration: "2h 10m", price_per_person_usd: 90 }],
      hospedaje: [{ tier: "equilibrio", nombre: "Hotel Artemide", price_per_night_usd: 210, fuente_precio: "serpapi" }], restaurantes: [], experiencias: [] },
    { city: "Atenas", nights: 2, checkin: "2026-11-13", checkout: "2026-11-15", arrival_options: [{ mode: "vuelo", from: "Roma", provider: "Aerolínea por confirmar", duration: "2h 20m", price_per_person_usd: 110 }],
      hospedaje: [{ tier: "equilibrio", nombre: "Electra Palace", price_per_night_usd: 190, fuente_precio: "serpapi" }], restaurantes: [], experiencias: [] },
  ],
  days: [],
};

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api, in: () => api, not: () => api,
      insert: (row: any) => { db.inserts.push({ table, row }); return api; },
      maybeSingle: async () => ({ data: table === "profiles" ? { ciudad_origen: "Ciudad de México" } : null, error: null }),
      single: async () => ({ data: { id: "trip-ruta-1" }, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  const invoke = async (fn: string, opts: any) => {
    db.invokes.push({ fn, body: opts?.body });
    if (fn === "logistics-plan" && opts?.body?.action === "snapshot") return { data: { ok: true }, error: null };
    if (fn === "logistics-plan") return { data: { logistics: LOGISTICS }, error: null };
    return { data: null, error: null };
  };
  return { supabase: { from, functions: { invoke }, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: ({ destino }: any) => <p>ANALIZANDO {destino}</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: ({ destinations }: any) => <p data-testid="preview">{(destinations ?? []).join(" | ")}</p> }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: any) => <span data-testid="origen">{value}</span> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, layout, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import PlanTrip from "@/pages/PlanTrip";
import { parseMultiCityText } from "@/lib/multiCityText";
import { detectRouteIntent } from "@/lib/detectRouteIntent";
import { stripTripExtras } from "@/lib/tripExtras";

const renderPlan = () => render(
  <MemoryRouter initialEntries={["/dashboard/planear"]}>
    <Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} />
      <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      <Route path="/dashboard/ruta" element={<p>RUTA</p>} />
    </Routes>
  </MemoryRouter>,
);

// El Slider (Radix) mide con ResizeObserver, que jsdom no trae.
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => { db.inserts.length = 0; db.invokes.length = 0; sessionStorage.clear(); });

const FRASES = ["Cancún, todo incluido", "Madrid, en Semana Santa", "Oaxaca, con niños", "Tokio, luna de miel", "Cancún todo incluido 5 noches", "Los Cabos, all inclusive en verano"];

describe("Lo que acompaña al destino no es otro lugar", () => {
  it.each(FRASES)("«%s»: una sola ciudad, nada por confirmar, no es ruta", (frase) => {
    const p = parseMultiCityText(frase);
    expect(p.items.filter((i) => i.kind !== "city")).toEqual([]);
    expect(p.cities).toHaveLength(1);
    expect(detectRouteIntent(frase)).toEqual({ mode: "single", destinations: [frase] });
  });

  it("los lugares de verdad se siguen leyendo (Isla de Pascua, Playa del Carmen, rutas)", () => {
    expect(stripTripExtras("Isla de Pascua")).toBe("Isla de Pascua");
    expect(parseMultiCityText("Roma, Florencia y Venecia en Semana Santa").cities).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(detectRouteIntent("Roma → Florencia, con niños")).toEqual({ mode: "multi", destinations: ["Roma", "Florencia"] });
    expect(parseMultiCityText("Playa del Carmen, todo incluido").cities).toEqual(["Playa del Carmen"]);
  });
});

describe("Planeador: nunca un «Continuar» gris sin explicación", () => {
  it.each(FRASES)("«%s» deja continuar", (frase) => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: frase } });
    expect(screen.getByRole("button", { name: /Continuar/ })).not.toBeDisabled();
  });

  it("algo extra que no conocemos («con vista al mar») tampoco atora: Iato lee la frase completa", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Madrid, con vista al mar" } });
    expect(screen.getByRole("button", { name: /Continuar/ })).not.toBeDisabled();
  });

  it("un lugar desconocido en una ruta sí se pregunta, y la pregunta se ve", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Roma, Florencia y Zzyzxlandia" } });
    const next = screen.getByRole("button", { name: /Continuar/ });
    if (next.hasAttribute("disabled")) expect(screen.getByTestId("plan-multicity-pendientes")).toBeVisible();
  });
});
