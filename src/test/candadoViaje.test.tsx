// CANDADO · fotos de los viajes y total en MXN (29-oct-2026). Lo que Carlo vio roto: "no salen las
// imágenes" en sus viajes de varias ciudades. Falla si:
//  - una tarjeta de viaje (Mis viajes, Inicio) o el encabezado del viaje deja de pedir foto;
//  - un viaje de varias ciudades pide la foto de OTRA ciudad (o de la ruta completa) y no la de la primera;
//  - la portada guardada del viaje deja de mostrarse;
//  - el total del viaje deja de estar en MXN o pierde de dónde sale (estimado / precio consultado).
// Cómo: Pexels simulado regresa una URL que lleva la búsqueda; se lee qué foto quedó pintada en cada tarjeta.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ITALIA_RAW from "./fixtures/italia2230848bCompleto.json";
import { localISODatePlus } from "@/lib/localDate";

const db = { trips: [] as any[], trip: null as any };
const calls: Array<{ fn: string; body: any }> = [];
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = new Proxy({}, {
      get: (_t, k: string) => {
        if (k === "maybeSingle" || k === "single") return async () => ({
          data: table === "trips" ? db.trip : table === "profiles" ? { full_name: "Carlo Prueba", active_trip_id: null, ciudad_origen: "Ciudad de México" } : null,
          error: null,
        });
        if (k === "then") return (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null, count: 0 }).then(res, rej);
        return () => api;
      },
    });
    return api;
  };
  const invoke = async (fn: string, o: any) => {
    calls.push({ fn, body: o?.body });
    if (fn === "pexels-image") return { data: { image: `https://images.pexels.com/photos/1/${encodeURIComponent(String(o?.body?.query ?? ""))}.jpeg`, photographer: "Simulado" }, error: null };
    return { data: null, error: null };
  };
  return {
    supabase: {
      from, functions: { invoke }, rpc: async () => ({ data: null, error: null }),
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

import Trips from "@/pages/Trips";
import DashboardHome from "@/pages/DashboardHome";
import TripDetail from "@/pages/TripDetail";
import { __resetStockPhotos } from "@/lib/stockPhoto";
import { __resetIdleGate } from "@/lib/idleGate";

// Viajes de varias ciudades (los de Carlo) y uno con portada guardada.
const COVER = "https://lh3.googleusercontent.com/places/portada-candado=s1600-w800";
const MULTI = [
  { id: "jp", destino: "Tokio → Kioto → Osaka", pais_destino: "Japón", ciudades: ["Tokio", "Kioto", "Osaka"] },
  { id: "pt", destino: "Lisboa → Sintra → Oporto", pais_destino: "Portugal", ciudades: ["Lisboa", "Sintra", "Oporto"] },
  { id: "it", destino: "Roma → Florencia → Venecia", pais_destino: "Italia", ciudades: ["Roma", "Florencia", "Venecia"] },
  { id: "ny", destino: "Nueva York → París → Madrid", pais_destino: "Estados Unidos", ciudades: ["Nueva York", "París", "Madrid"] },
];
const trips = () => [
  ...MULTI.map((m, i) => ({
    id: m.id, user_id: "u1", destino: m.destino, pais_destino: m.pais_destino, ciudad_origen: "Ciudad de México",
    fecha_salida: localISODatePlus(20 + i * 30), fecha_regreso: localISODatePlus(29 + i * 30), num_viajeros: 2, status: "cotizado",
    created_at: `2026-10-2${i}T10:00:00Z`, itinerario_json: { destinations: m.ciudades },
  })),
  { id: "md", user_id: "u1", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México", fecha_salida: localISODatePlus(200), fecha_regreso: localISODatePlus(205),
    num_viajeros: 2, status: "cotizado", created_at: "2026-10-25T10:00:00Z", cover_image_url: COVER },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** La búsqueda de la foto que quedó pintada (el simulador la mete en la URL). */
const photoQuery = (box: Element) => {
  const src = box.querySelector("img")?.getAttribute("src") ?? "";
  const m = src.match(/images\.pexels\.com\/photos\/1\/(.+)\.jpeg/);
  return m ? norm(decodeURIComponent(m[1])) : null;
};
/** Cada viaje de varias ciudades muestra la foto de SU primera ciudad (nunca otra de la ruta ni la ruta completa). */
async function expectFirstCityPhotos(scope: () => ParentNode, label: string, ids: string[] = MULTI.map((m) => m.id)) {
  for (const m of MULTI.filter((x) => ids.includes(x.id))) {
    await waitFor(() => {
      const boxes = Array.from(scope().querySelectorAll(`a[href="/dashboard/viajes/${m.id}"] [data-testid="smart-image"]`));
      expect(boxes.length, `${label}: la tarjeta de ${m.destino} no tiene foto`).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.getAttribute("data-kind"), `${label}: ${m.destino} sin foto`).toBe("stock");
        const q = photoQuery(b)!;
        expect(q, `${label}: ${m.destino} pidió "${q}"`).toContain(norm(m.ciudades[0]));
        for (const otra of m.ciudades.slice(1)) expect(q, `${label}: ${m.destino} pidió la foto de ${otra}`).not.toContain(norm(otra));
        expect(q).not.toContain("→");
      }
    }, { timeout: 8000 });
  }
}

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  try { localStorage.setItem("iatos_trip_tour_v1", "done"); } catch { /* sin almacenamiento */ }
  __resetStockPhotos();
  __resetIdleGate();
  db.trips = trips();
  db.trip = null;
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollTo ??= (() => {}) as any;
  window.history.replaceState(null, "", "/");
});

describe("CANDADO · fotos de los viajes", () => {
  it("Mis viajes: cada viaje de varias ciudades con la foto de su primera ciudad; la portada guardada se ve", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    await expectFirstCityPhotos(() => document, "Mis viajes");
    const md = document.querySelector('a[href="/dashboard/viajes/md"] [data-testid="smart-image"]')!;
    await waitFor(() => expect(md.getAttribute("data-kind")).toBe("real"));
    expect(md.querySelector("img")!.getAttribute("src")).toContain("lh3.googleusercontent.com/places/portada-candado");
  });

  it("Inicio: los próximos viajes con la foto de su primera ciudad", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<DashboardHome />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('a[href="/dashboard/viajes/jp"]')).not.toBeNull(), { timeout: 8000 });
    // Inicio muestra los 2 viajes más próximos (homeTrips): Tokio y Lisboa.
    await expectFirstCityPhotos(() => document, "Inicio", ["jp", "pt"]);
  });

  it("encabezado del viaje (Roma → Florencia → Venecia): la foto de Roma; con portada guardada, la portada", async () => {
    const italia = { ...JSON.parse(JSON.stringify(ITALIA_RAW)), user_id: "u1", cover_image_url: null, total_estimado: 153166, current_quote_id: null };
    db.trip = italia;
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/dashboard/viajes/${italia.id}`]}><Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes></MemoryRouter>,
    );
    await waitFor(() => {
      const hero = Array.from(document.querySelectorAll('[data-testid="smart-image"]')).find((b) => b.querySelector("img")?.getAttribute("alt") === italia.destino);
      expect(hero, "el encabezado del viaje no pide foto").toBeTruthy();
      expect(hero!.getAttribute("data-kind")).toBe("stock");
      const q = photoQuery(hero!)!;
      expect(q).toContain("roma");
      expect(q).not.toMatch(/florencia|venecia/);
    }, { timeout: 8000 });

    // Total del viaje: en MXN y con su procedencia (estimado o precio consultado).
    const amount = await screen.findByTestId("trip-total-amount");
    expect(amount.textContent).toMatch(/^\$[\d,]+ MXN$/);
    const card = screen.getByTestId("trip-total-card");
    expect(card.getAttribute("data-state")).toMatch(/\w+/);
    // De dónde sale la cifra: «Total estimado» (aproximado, del plan) o «Total de tu selección» (precios elegidos).
    expect(screen.getByTestId("trip-total-title").textContent ?? "", "el total no dice de dónde sale").toMatch(/estimado|selecci/i);
    unmount();

    db.trip = { ...italia, cover_image_url: COVER };
    render(<MemoryRouter initialEntries={[`/dashboard/viajes/${italia.id}`]}><Routes><Route path="/dashboard/viajes/:id" element={<TripDetail />} /></Routes></MemoryRouter>);
    await waitFor(() => {
      const hero = Array.from(document.querySelectorAll('[data-testid="smart-image"]')).find((b) => b.querySelector("img")?.getAttribute("alt") === italia.destino);
      expect(hero?.querySelector("img")?.getAttribute("src")).toContain("lh3.googleusercontent.com/places/portada-candado");
    }, { timeout: 8000 });
  });
});
