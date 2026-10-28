// "¿No entendimos bien tu viaje?" en el detalle del viaje (caso Diego): aparece en todo viaje generado,
// muestra texto original → interpretación → pendientes, deja corregir y NO gasta hasta confirmar; al
// confirmar, el caso de Diego (crucero, Cape Town y regreso por Londres) se arma como multidestino y el
// viaje anterior se conserva.
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { DIEGO_AI, DIEGO_TEXT } from "./fixtures/viajeComplejo";
import { validateTripSpec } from "../../supabase/functions/_shared/tripSpec";

const TRIP = "11111111-1111-4111-8111-111111111111";
const db = vi.hoisted(() => ({ trip: null as any, updates: [] as any[], inserts: [] as any[], invokes: [] as any[], deletes: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let kind = "select";
    const api: any = {
      select: () => api, eq: () => api, not: () => api, order: () => api, limit: () => api, in: () => api,
      update: (p: any) => { kind = "update"; db.updates.push({ table, payload: p }); return api; },
      insert: (row: any) => { db.inserts.push({ table, row }); return api; },
      delete: () => { db.deletes++; return api; },
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      single: async () => ({ data: table === "trips" ? { id: "trip-nuevo" } : null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(kind === "update" ? { data: [{}], error: null } : { data: [], error: null }).then(res, rej),
    };
    return api;
  };
  const invoke = vi.fn(async (fn: string, o: any) => {
    db.invokes.push({ fn, body: o?.body });
    if (fn === "interpretar-viaje") {
      const v: any = validateTripSpec(JSON.stringify(DIEGO_AI), o.body.texto);
      return { data: { ok: true, spec: v.spec }, error: null };
    }
    if (fn === "logistics-plan" && o?.body?.action === "snapshot") return { data: { ok: true }, error: null };
    if (fn === "logistics-plan") return { data: { logistics: { destinations: o.body.destinations, days: [], total_estimado_mxn: 1, sea_legs: o.body.sea_legs } }, error: null };
    return { data: null, error: null };
  });
  return { supabase: { from, functions: { invoke }, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/PriceWatchCard", () => ({ PriceWatchCard: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import TripDetail from "@/pages/TripDetail";

// El viaje que generó la app para Diego: un solo destino, sin su texto.
const diegoTrip = () => ({
  id: TRIP, user_id: "u1", destino: "Arabia Saudita", pais_destino: "Arabia Saudita", ciudad_origen: "Ciudad de México",
  fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", num_viajeros: 2, created_at: new Date().toISOString(),
  total_estimado: 250000, status: "listo", desglose_presupuesto: { vuelos: 90000, hospedaje: 160000 },
  vuelos_json: [], hospedaje_json: [], restaurantes_json: [], tours_json: [], itinerario_json: [{ dia: 1, titulo: "Riad" }],
  quote_basis: null, quote_needs_update: false, selections: null,
});
const multiTrip = () => ({
  ...diegoTrip(), destino: "Roma → Florencia", itinerario_json: {
    multi: true, destinations: ["Roma", "Florencia"], days: [],
    logistics: { per_destination: [], internal_transport: [], sea_legs: [{ index: 0, tipo: "crucero", from: "Roma", to: "Florencia", puerto_salida: "Civitavecchia", puerto_llegada: "Livorno", fecha_salida: "2027-11-20", fecha_llegada: "2027-11-22", noches: 2, naviera: null, precio: null }] },
    consulta: { version: 1, consulta_original: "Roma y crucero a Florencia", interpretacion: null, guardado_at: "2026-10-28T10:00:00Z" },
  },
});

const renderTrip = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}`]}>
    <Routes>
      <Route path="/dashboard/viajes/:id" element={<TripDetail />} />
    </Routes>
  </MemoryRouter>,
);
const paid = () => db.invokes.filter((c) => c.fn === "logistics-plan" || c.fn === "analizar-viaje");

beforeEach(() => {
  db.trip = diegoTrip();
  db.updates.length = 0; db.inserts.length = 0; db.invokes.length = 0; db.deletes = 0;
  localStorage.clear(); sessionStorage.clear();
});

describe("¿No entendimos bien tu viaje?", () => {
  it("aparece en un viaje de destino único y en uno multidestino (con su crucero sin precio)", async () => {
    renderTrip();
    expect(await screen.findByTestId("no-entendimos")).toHaveTextContent("¿No entendimos bien tu viaje?");
    db.trip = multiTrip();
    renderTrip();
    await waitFor(() => expect(screen.getAllByTestId("no-entendimos")).toHaveLength(2));
    const card = await screen.findByTestId("tramo-crucero");
    expect(within(card).getByTestId("tramo-crucero-linea")).toHaveTextContent("Crucero: Civitavecchia → Livorno · 20 nov 2027 – 22 nov 2027");
    expect(within(card).getByTestId("tramo-crucero-precio")).toHaveTextContent("Precio por cotizar con la naviera · no suma al total");
    expect(card.textContent).not.toMatch(/\$\s?\d/);
  });

  it("caso Diego: viaje viejo sin texto → lo describe, corrige (Arabia, crucero, Cape Town, regreso por Londres) y se arma multidestino solo tras confirmar", async () => {
    renderTrip();
    fireEvent.click(await screen.findByTestId("no-entendimos"));
    const dlg = await screen.findByTestId("no-entendimos-dialog");
    expect(within(dlg).getByTestId("ne-sin-texto")).toBeInTheDocument();
    // Lo entendido hoy: un solo lugar.
    expect(within(dlg).getByTestId("spec-entendi")).toHaveTextContent("Ciudad de México → Arabia Saudita → Ciudad de México");

    fireEvent.change(within(dlg).getByTestId("ne-textarea"), { target: { value: DIEGO_TEXT } });
    fireEvent.click(within(dlg).getByTestId("ne-interpretar"));
    await waitFor(() => expect(within(dlg).getByTestId("spec-entendi")).toHaveTextContent("crucero (Yeda → Ciudad del Cabo)"));
    expect(paid()).toHaveLength(0);

    // Pendientes: ciudades de Arabia, crucero y ¿escala o estancia en Londres?
    const tipos = () => within(dlg).queryAllByTestId("spec-pregunta").map((q) => q.getAttribute("data-tipo"));
    expect(tipos().sort()).toEqual(["ciudades_de_pais", "conexion_o_estancia", "crucero"]);
    expect(within(dlg).getByTestId("spec-confirmar")).toBeDisabled();
    const preg = (t: string) => within(dlg).getAllByTestId("spec-pregunta").find((q) => q.getAttribute("data-tipo") === t)!;
    fireEvent.click(within(preg("ciudades_de_pais")).getByTestId("spec-aceptar"));
    const cru = preg("crucero");
    fireEvent.change(within(cru).getByLabelText("Puerto de salida"), { target: { value: "Yeda" } });
    fireEvent.change(within(cru).getByLabelText("Noches a bordo"), { target: { value: "14" } });
    fireEvent.click(within(preg("conexion_o_estancia")).getByTestId("spec-estancia"));
    await waitFor(() => expect(tipos()).toEqual([]));
    expect(within(dlg).getByTestId("spec-entendi")).toHaveTextContent(/Ciudad del Cabo → Londres → Ciudad de México/);

    // Aviso de costo ANTES de gastar.
    fireEvent.click(within(dlg).getByTestId("spec-confirmar"));
    expect(within(dlg).getByTestId("ne-costo")).toHaveTextContent("Armar tu viaje usa una búsqueda de tu plan. Tu viaje actual se conserva");
    expect(paid()).toHaveLength(0);
    fireEvent.click(within(dlg).getByTestId("ne-confirmar-armar"));

    await waitFor(() => expect(db.inserts.some((i) => i.table === "trips")).toBe(true));
    const plan = paid().find((c) => c.fn === "logistics-plan" && !c.body.action)!;
    expect(plan.body.destinations).toEqual(["Riad", "AlUla", "Yeda", "Ciudad del Cabo", "Londres"]);
    expect(plan.body.sea_legs).toEqual([expect.objectContaining({ index: 2, tipo: "crucero", puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", noches: 14 })]);
    expect(paid().some((c) => c.fn === "analizar-viaje")).toBe(false);
    const row = db.inserts.find((i) => i.table === "trips")!.row;
    expect(row.itinerario_json.consulta.consulta_original).toBe(DIEGO_TEXT);
    expect(row.itinerario_json.consulta.revision_de).toBe(TRIP);
    // El viaje anterior se conserva: no se borra, solo se anota la revisión.
    expect(db.deletes).toBe(0);
    const old = db.updates.find((u) => u.table === "trips" && u.payload.itinerario_json?.consulta?.revisiones);
    expect(old!.payload.itinerario_json.days).toEqual([{ dia: 1, titulo: "Riad" }]);
  });

  it("un viaje con texto guardado lo muestra tal cual; cancelar no gasta nada", async () => {
    db.trip = multiTrip();
    renderTrip();
    fireEvent.click(await screen.findByTestId("no-entendimos"));
    const dlg = await screen.findByTestId("no-entendimos-dialog");
    expect(within(dlg).getByTestId("ne-texto-original")).toHaveTextContent("Roma y crucero a Florencia");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(paid()).toHaveLength(0);
  });
});
