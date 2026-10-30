// CANDADO · el globo en la página de un viaje de varias ciudades (30-oct-2026). Falla si:
//  - la pestaña Itinerario de un viaje de varias ciudades (Tokio → Kioto → Osaka, Lisboa → Sintra → Oporto)
//    deja de mostrar el globo 3D con el origen y cada ciudad en orden;
//  - el globo (three.js, ~1.7 MB) se carga sin verse: con otra pestaña abierta o antes de llegar a él;
//  - aparece en un viaje de una sola ciudad.
// El globo real usa WebGL (no corre en jsdom): se reemplaza por una marca con lo que recibe.
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const db = vi.hoisted(() => ({ trip: null as any, invokes: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = new Proxy({}, {
      get: (_t, k: string) => {
        if (k === "maybeSingle" || k === "single") return async () => ({
          data: table === "trips" ? db.trip : table === "profiles" ? { full_name: "Carlo Prueba", active_trip_id: null, ciudad_origen: "Ciudad de México" } : null,
          error: null,
        });
        if (k === "then") return (res: any, rej: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej);
        return () => api;
      },
    });
    return api;
  };
  return {
    supabase: {
      from, functions: { invoke: async (fn: string) => { db.invokes.push(fn); return { data: null, error: null }; } }, rpc: async () => ({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {},
    },
  };
});
const AUTH = { user: { id: "u1", email: "carlo@example.com" }, loading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/TripFileUpload", () => ({ TripFileUpload: () => null }));
vi.mock("@/hooks/useAIRecommendations", () => ({ useAIRecommendations: () => ({ recos: [], loading: false }) }));
vi.mock("@/lib/weatherNow", () => ({ fetchWeatherNow: async () => null }));
vi.mock("@/lib/fx", async () => {
  const actual: any = await vi.importActual("@/lib/fx");
  return { ...actual, fetchFxTable: async () => actual.FX_FALLBACK_TABLE };
});
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children }: any) => <div>{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/LiveTripQuote", () => ({ LiveTripQuote: () => null }));
vi.mock("@/components/InviteFriendDialog", () => ({ InviteFriendDialog: () => null }));
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/components/trip/BeforeYouTravelCard", () => ({ BeforeYouTravelCard: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("@/components/RouteGlobe3D", () => {
  return {
    RouteGlobe3D: ({ origin, destinations }: any) => require("react").createElement("div", {
      "data-testid": "candado-viaje-globo", "data-origin": origin, "data-destinos": destinations.join("|"),
    }),
  };
});

// IntersectionObserver controlable: nada "se ve" hasta que la prueba lo dice.
const io = vi.hoisted(() => ({ list: [] as Array<{ cb: (e: any[]) => void; els: Set<Element> }> }));
class FakeIO {
  rec: { cb: (e: any[]) => void; els: Set<Element> };
  constructor(cb: (e: any[]) => void) { this.rec = { cb, els: new Set() }; io.list.push(this.rec); }
  observe(el: Element) { this.rec.els.add(el); }
  unobserve(el: Element) { this.rec.els.delete(el); }
  disconnect() { this.rec.els.clear(); }
  takeRecords() { return []; }
}
const verGlobo = () => act(() => {
  for (const r of io.list) {
    const els = [...r.els].filter((el) => el.getAttribute("data-testid") === "viaje-globo");
    if (els.length) r.cb(els.map((target) => ({ isIntersecting: true, target })));
  }
});

import TripDetail from "@/pages/TripDetail";

const trip = (id: string, destino: string, pais: string, ciudades: string[] | null) => ({
  id, user_id: "u1", destino, pais_destino: pais, ciudad_origen: "Ciudad de México",
  fecha_salida: localISODatePlus(40), fecha_regreso: localISODatePlus(49), num_viajeros: 2, status: "cotizado",
  created_at: "2026-10-20T10:00:00Z", total_estimado: 90000, desglose_presupuesto: { vuelos: 50000, hospedaje: 40000 },
  itinerario_json: ciudades ? { multi: true, destinations: ciudades, days: [] } : [{ dia: 1, titulo: "Llegada", "mañana": "a", tarde: "b", noche: "c" }],
});
const abrir = (id: string, hash: string) => {
  window.history.replaceState(null, "", `/dashboard/viajes/${id}${hash}`);
  return render(
    <MemoryRouter initialEntries={[`/dashboard/viajes/${id}${hash}`]}><Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes></MemoryRouter>,
  );
};

beforeEach(() => {
  db.invokes.length = 0;
  io.list.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  try { localStorage.setItem("iatos_trip_tour_v1", "done"); } catch { /* sin almacenamiento */ }
  vi.stubGlobal("IntersectionObserver", FakeIO);
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollTo ??= (() => {}) as any;
  Element.prototype.scrollIntoView ??= (() => {}) as any;
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("CANDADO · el globo en la página del viaje", () => {
  it.each([
    ["jp", "Tokio → Kioto → Osaka", "Japón", ["Tokio", "Kioto", "Osaka"]],
    ["pt", "Lisboa → Sintra → Oporto", "Portugal", ["Lisboa", "Sintra", "Oporto"]],
  ])("Itinerario de %s (%s): el globo con el origen y cada ciudad en orden, solo al verse", async (id, destino, pais, ciudades) => {
    db.trip = trip(id, destino, pais, ciudades);
    abrir(id, "#destinos");
    const caja = await screen.findByTestId("viaje-globo", {}, { timeout: 8000 });
    expect(caja.closest("[data-trip-panel='destinos']")).not.toBeNull();
    // Aún no se ve: no se baja el globo.
    expect(screen.queryByTestId("candado-viaje-globo")).toBeNull();
    verGlobo();
    const g = await screen.findByTestId("candado-viaje-globo", {}, { timeout: 8000 });
    expect(g.getAttribute("data-origin")).toBe("Ciudad de México");
    expect(g.getAttribute("data-destinos")).toBe(ciudades.join("|"));
  });

  it("con el Resumen abierto, el globo del Itinerario no se carga aunque el observador lo marque", async () => {
    db.trip = trip("jp", "Tokio → Kioto → Osaka", "Japón", ["Tokio", "Kioto", "Osaka"]);
    abrir("jp", "");
    await screen.findByTestId("viaje-globo", {}, { timeout: 8000 });
    verGlobo();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("candado-viaje-globo"), "montó el globo con la pestaña cerrada").toBeNull();
  });

  it("un viaje de una sola ciudad no lleva globo", async () => {
    db.trip = trip("md", "Madrid", "España", null);
    abrir("md", "#destinos");
    await waitFor(() => expect(document.querySelector("[data-trip-panel='destinos']")).not.toBeNull(), { timeout: 8000 });
    expect(screen.queryByTestId("viaje-globo")).toBeNull();
  });
});
