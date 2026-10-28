// Caso del dueño (23-oct-2026): en el planeador escribió "paris roma y atenas 10 dias", 1 viajero, desde
// Ciudad de México, 6–15 nov 2026. Antes: viaje de un destino con ese texto (un vuelo y un hotel en París).
// Ahora: "Entendimos: París → Roma → Atenas · 10 días", orden y noches por ciudad, y al generar el mismo
// plan que "Ruta multi-destino" (logistics-plan): vuelo de ida y regreso, traslados y un hotel por ciudad.
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
import { buildBuyFlow } from "@/lib/buyFlow";
import { parseGoogleFlightsSearch } from "../../supabase/functions/_shared/booking/links";

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

describe("Planeador: 'paris roma y atenas 10 dias'", () => {
  it("dice lo que entendió, deja ajustar orden y noches, y genera la ruta como multi-destino", async () => {
    renderPlan();
    const input = screen.getByLabelText("¿A dónde quieres ir?");
    fireEvent.change(input, { target: { value: "paris roma y atenas 10 dias" } });

    // Reproducción del caso: antes salía "No reconocimos el destino en tu frase…" y se seguía como un solo destino.
    expect(screen.getByTestId("plan-multicity-entendimos")).toHaveTextContent("Entendimos: París → Roma → Atenas · 10 días · ¿lo armamos como ruta de 3 ciudades?");
    expect(screen.queryByText(/No reconocimos el destino/)).toBeNull();
    expect(screen.getByTestId("plan-multicity-si")).toHaveAttribute("aria-checked", "true");
    // 10 días = 9 noches repartidas 3 · 3 · 3 antes de elegir fechas.
    expect(screen.getAllByTestId("city-nights-value").map((n) => n.textContent)).toEqual(["3 noches", "3 noches", "3 noches"]);
    // Reordenar: Atenas sube y baja (vuelve al orden de la frase).
    fireEvent.click(screen.getByRole("button", { name: "Subir Atenas" }));
    expect(screen.getAllByTestId("city-nights-row").map((r) => r.textContent)).toEqual([expect.stringContaining("París"), expect.stringContaining("Atenas"), expect.stringContaining("Roma")]);
    fireEvent.click(screen.getByRole("button", { name: "Bajar Atenas" }));
    expect(screen.getByTestId("preview")).toHaveTextContent("París | Roma | Atenas");

    const next = screen.getByRole("button", { name: /Continuar/ });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);

    // Paso 2: salida 6 nov → regreso propuesto 15 nov (10 días); noches por ciudad con +1 en París.
    expect(screen.getByRole("status")).toHaveTextContent("Entendimos: París → Roma → Atenas · 10 días");
    await waitFor(() => expect(screen.getByTestId("origen")).toHaveTextContent("Ciudad de México"));
    fireEvent.change(screen.getByLabelText("Salida"), { target: { value: "2026-11-06" } });
    await waitFor(() => expect(screen.getByLabelText("Regreso")).toHaveValue("2026-11-15"));
    // 1 viajero (como el dueño): el control de viajeros con el teclado (2 → 1).
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText(/Número de viajeros/)).toHaveTextContent("Número de viajeros: 1"));
    const noches = screen.getByTestId("plan-multicity-noches");
    fireEvent.click(within(noches).getByRole("button", { name: "Una noche más en París" }));
    expect(within(noches).getAllByTestId("city-nights-value").map((n) => n.textContent)).toEqual(["4 noches", "3 noches", "2 noches"]);
    expect(within(noches).getByTestId("city-nights-total")).toHaveTextContent("9 noches en 3 ciudades");
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));

    const gen = screen.getByRole("button", { name: /Generar ruta de 3 ciudades/ });
    fireEvent.click(gen);
    await screen.findByText("VIAJE");

    const plan = db.invokes.find((c) => c.fn === "logistics-plan" && !c.body.action)!;
    expect(plan.body).toMatchObject({ origin: "Ciudad de México", destinations: ["París", "Roma", "Atenas"], fecha_salida: "2026-11-06", fecha_regreso: "2026-11-15", nights_per_city: [4, 3, 2], num_viajeros: 1 });
    expect(db.invokes.some((c) => c.fn === "analizar-viaje")).toBe(false);
    expect(db.invokes.some((c) => c.fn === "logistics-plan" && c.body.action === "snapshot")).toBe(true);

    const row = db.inserts.find((i) => i.table === "trips")!.row;
    expect(row.destino).toBe("París → Roma → Atenas");
    expect(row.pais_destino).toBe("Francia");
    expect(row.itinerario_json).toMatchObject({ multi: true, destinations: ["París", "Roma", "Atenas"] });
    // Vuelos: ida (MEX → París) y los internos París → Roma y Roma → Atenas; el tren del aeropuerto no es un vuelo.
    expect(row.vuelos_json.map((v: any) => `${v.from} → ${v.to}`)).toEqual(["Ciudad de México → París", "París → Roma", "Roma → Atenas"]);
    // Un hotel por ciudad con sus noches.
    expect(row.hospedaje_json.map((h: any) => [h.ciudad, h.nombre, h.noches])).toEqual([
      ["París", "Hôtel des Grands Boulevards", 4], ["Roma", "Hotel Artemide", 3], ["Atenas", "Electra Palace", 2]]);

    // "Comprar" del viaje generado: vuelo de ida y regreso (MEX→CDG, regreso ATH→MEX), traslados y un hotel por ciudad.
    const trip = { ...row, id: "trip-ruta-1", created_at: "2026-10-23T10:00:00Z" };
    const flow = buildBuyFlow(trip, { selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    expect(flow.steps.map((s) => s.title)).toEqual(["Vuelo de ida y regreso", "Hotel en París", "París → Roma", "Hotel en Roma", "Roma → Atenas", "Hotel en Atenas", "Auto (opcional)"]);
    const vuelo = flow.steps[0];
    expect(parseGoogleFlightsSearch(vuelo.item!.url!)).toMatchObject({ origin: "MEX", destination: "CDG", return_from: "ATH", adults: 1, depart: "2026-11-06", ret: "2026-11-15" });
    const leg = flow.steps.find((s) => s.kind === "traslado" && s.from === "París")!;
    expect(parseGoogleFlightsSearch(leg.item!.url!)).toMatchObject({ origin: "CDG", destination: "FCO", depart: "2026-11-10", adults: 1 });
    expect(leg.kind === "traslado" && leg.options.map((o) => o.mode)).toEqual(["vuelo"]);
    const leg2 = flow.steps.find((s) => s.kind === "traslado" && s.from === "Roma")!;
    expect(parseGoogleFlightsSearch(leg2.item!.url!)).toMatchObject({ origin: "FCO", destination: "ATH", depart: "2026-11-13" });
    const hoteles = flow.steps.filter((s) => s.kind === "hospedaje");
    expect(hoteles.map((h) => h.kind === "hospedaje" && [h.city, h.nights])).toEqual([["París", 4], ["Roma", 3], ["Atenas", 2]]);
  });

  it("'No, solo París': un destino (París) con lo demás de la frase", async () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "paris roma y atenas 10 dias" } });
    fireEvent.click(screen.getByTestId("plan-multicity-no"));
    expect(screen.queryByTestId("city-nights-editor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Entendimos: París · 10 días");
  });

  it("países en vez de ciudades: propone su ciudad principal en orden y pregunta (nada se descarta ni se arma solo)", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Francia, Italia y Grecia" } });
    expect(screen.getByTestId("plan-multicity-entendimos")).toHaveTextContent("París (Francia) → Roma (Italia) → Atenas (Grecia)");
    expect(screen.getAllByTestId("plan-multicity-pendiente")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("caso del dueño 'Hungría, atenas y paris': Hungría no desaparece (Budapest propuesta, se confirma antes de seguir)", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Hungría, atenas y paris" } });
    expect(screen.getByTestId("plan-multicity-entendimos")).toHaveTextContent("Entendimos: Budapest (Hungría) → Atenas → París · ¿lo armamos como ruta de 3 ciudades?");
    const pend = screen.getByTestId("plan-multicity-pendiente");
    expect(pend).toHaveTextContent("«Hungría»: te proponemos Budapest");
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
    fireEvent.click(within(pend).getByTestId("plan-pendiente-si"));
    expect(screen.queryByTestId("plan-multicity-pendiente")).toBeNull();
    expect(screen.getAllByTestId("city-nights-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Budapest"), expect.stringContaining("Atenas"), expect.stringContaining("París")]);
    expect(screen.getByRole("button", { name: /Continuar/ })).not.toBeDisabled();
  });

  it("un lugar que no reconocemos se pregunta; quitarlo es explícito y se puede deshacer", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Zorbalandia, Roma y Venecia" } });
    expect(screen.getByTestId("plan-multicity-pendiente")).toHaveTextContent("No reconocimos «Zorbalandia»: ¿qué ciudad es?");
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-pendiente-quitar"));
    expect(screen.getByTestId("plan-multicity-excluidos")).toHaveTextContent("Quitaste «Zorbalandia»");
    expect(screen.getByRole("button", { name: /Continuar/ })).not.toBeDisabled();
  });

  it.each(["Nueva York", "San Miguel de Allende", "Roma 5 días"])("'%s' sigue siendo un solo destino", (text) => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: text } });
    expect(screen.queryByTestId("plan-multicity")).toBeNull();
  });

  it("fechas que no alcanzan para las ciudades: lo explica y no deja seguir", async () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Roma, Florencia y Venecia" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.change(screen.getByLabelText("Salida"), { target: { value: "2026-11-06" } });
    fireEvent.change(screen.getByLabelText("Regreso"), { target: { value: "2026-11-08" } });
    expect(await screen.findByTestId("plan-multicity-corto")).toHaveTextContent("Tus fechas dan 2 noches: no alcanzan para 3 ciudades");
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
  });
});
