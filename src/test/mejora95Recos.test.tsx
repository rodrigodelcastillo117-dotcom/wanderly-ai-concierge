// Mejora 9.5: nada inventado para una cuenta nueva (sin "% afín" sin datos), aviso del análisis de
// cortesía antes de gastarlo y "Cerca de ti" con salida cuando no hay ubicación.
import React from "react";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { recoProfileIsEmpty } from "../../supabase/functions/_shared/recoProfile.ts";
import { buildTasteProfile } from "../../supabase/functions/_shared/tasteProfile.ts";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, is: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke }, auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } };
});
// Objeto estable: las pantallas recargan cuando cambia `user`.
const authUser = vi.hoisted(() => ({ id: "u-nuevo", email: "nuevo@example.test", user_metadata: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock("@/lib/idleGate", () => ({ afterCritical: (fn: () => void) => { fn(); return () => {}; }, beginCritical: () => () => {} }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/roadtrip/RoadTripIdeas", () => ({ RoadTripIdeas: () => null }));
vi.mock("@/components/RoutesPanel", () => ({ RoutesPanel: () => null }));
vi.mock("@/lib/insights", () => ({ logInsight: vi.fn(async () => {}) }));
vi.mock("@/hooks/useSavedDestinations", () => ({ useSavedDestinations: () => ({ saved: new Set(), pending: new Set(), toggle: () => {} }) }));
vi.mock("@/hooks/useActiveTrip", () => ({
  useActiveTrip: () => ({ trip: null, trips: [], resolved: { reason: "none" }, pinnedId: null, pin: async () => {} }),
}));
const sub = vi.hoisted(() => ({ access: null as any }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ access: sub.access }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  return { motion: new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) }), AnimatePresence: ({ children }: any) => <>{children}</> };
});

import { useAIRecommendations, __resetRecommendationsCache } from "@/hooks/useAIRecommendations";
import Discover from "@/pages/Discover";
import Cercanos from "@/pages/Cercanos";
import { FreeAnalysisNotice, lastFreeAnalysis } from "@/components/plan/FreeAnalysisNotice";

const RECO = { name: "Oaxaca", country: "México", score: 91, reason: "Gastronomía", image_query: "oaxaca" };
beforeEach(() => { invoke.mockReset(); __resetRecommendationsCache(); sub.access = null; });

describe("¿Hay perfil con qué personalizar?", () => {
  const ME = "11111111-1111-1111-1111-111111111111";
  it("cuenta nueva: sin gustos, favoritos, viajes ni preferencias → vacío", () => {
    const taste = buildTasteProfile({ userId: ME, todayISO: "2026-10-29" });
    expect(recoProfileIsEmpty({ taste, travelProfile: null, aiPrefs: null })).toBe(true);
    expect(recoProfileIsEmpty({ taste: null, travelProfile: { intereses: [], estilo_viaje: [] }, aiPrefs: { ritmo_viaje: null } })).toBe(true);
  });
  it("con cualquier señal real ya no está vacío", () => {
    expect(recoProfileIsEmpty({ taste: null, travelProfile: { intereses: ["gastronomía"] } })).toBe(false);
    expect(recoProfileIsEmpty({ taste: null, aiPrefs: { ritmo_viaje: "relajado" } })).toBe(false);
    const conMomento = buildTasteProfile({ userId: ME, todayISO: "2026-10-29", moments: [{ user_id: ME, destino: "Mykonos", created_at: "2026-07-10T10:00:00Z" }] as any });
    expect(recoProfileIsEmpty({ taste: conMomento })).toBe(false);
  });
  it("la función manda la marca en las dos respuestas (caché y nueva)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/recomendar-destinos/index.ts", "utf8");
    expect(src).toMatch(/sin_perfil: sinPerfil,\n\s+\}\),/);
    expect(src).toMatch(/JSON\.stringify\(\{ destinations, cached: false, sin_perfil: sinPerfil \}\)/);
  });
});

describe("Recomendaciones de una cuenta nueva", () => {
  it("el hook expone `profileless` desde la respuesta del servidor", async () => {
    invoke.mockResolvedValue({ data: { destinations: [RECO], sin_perfil: true }, error: null });
    const { result } = renderHook(() => useAIRecommendations());
    await waitFor(() => expect(result.current.recos).toHaveLength(1));
    expect(result.current.profileless).toBe(true);
  });

  it("Descubre no promete «para tu perfil» ni muestra el % afín sin datos", async () => {
    invoke.mockResolvedValue({ data: { destinations: [RECO], sin_perfil: true }, error: null });
    render(<MemoryRouter><Discover /></MemoryRouter>);
    expect(await screen.findByTestId("descubre-sin-perfil")).toHaveTextContent(/Aún no conocemos tus gustos/);
    expect(screen.getByRole("link", { name: "cuentas tus gustos" })).toHaveAttribute("href", "/onboarding/deep");
    expect(screen.queryByText(/afín a ti/)).toBeNull();
    expect(screen.queryByText(/100% personalizado/)).toBeNull();
  });

  it("con perfil (o un servidor aún sin la marca) se ve igual que antes", async () => {
    invoke.mockResolvedValue({ data: { destinations: [RECO] }, error: null });
    render(<MemoryRouter><Discover /></MemoryRouter>);
    expect(await screen.findByText("91% afín a ti")).toBeInTheDocument();
    expect(screen.queryByTestId("descubre-sin-perfil")).toBeNull();
  });
});

describe("Aviso del análisis de cortesía (plan gratuito)", () => {
  const free = { is_pro: false, plan: "free", limits_enforced: true, concierge_used: 0, concierge_limit: 3, concierge_remaining: 3, trips_used: 0, trips_limit: 1, trips_remaining: 1, trips_period: "once" };
  it("solo cuando lo que se confirma es el último análisis disponible", () => {
    expect(lastFreeAnalysis(free as any)).toEqual({ once: true });
    expect(lastFreeAnalysis({ ...free, trips_period: "month", trips_limit: 3 } as any)).toEqual({ once: false });
    expect(lastFreeAnalysis({ ...free, trips_remaining: 2 } as any)).toBeNull();
    expect(lastFreeAnalysis({ ...free, is_pro: true } as any)).toBeNull();
    expect(lastFreeAnalysis(null)).toBeNull();
  });
  it("dice que es uno solo y enlaza a los planes", () => {
    sub.access = free;
    render(<MemoryRouter><FreeAnalysisNotice /></MemoryRouter>);
    expect(screen.getByTestId("plan-aviso-cortesia")).toHaveTextContent(/análisis de viaje de cortesía \(es uno solo\)/);
    expect(screen.getByRole("link", { name: "Ver planes" })).toHaveAttribute("href", "/dashboard/pro");
  });
  it("PRO no ve el aviso", () => {
    sub.access = { ...free, is_pro: true };
    const { container } = render(<MemoryRouter><FreeAnalysisNotice /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Cerca de ti sin ubicación", () => {
  it("explica qué hacer y «Reintentar» vuelve a pedir la ubicación", async () => {
    let calls = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: any, fail: any) => { calls++; if (calls === 1) fail({ code: 1, message: "User denied Geolocation" }); else ok({ coords: { latitude: 19.43, longitude: -99.19 } }); } },
    });
    invoke.mockResolvedValue({ data: { results: [] }, error: null });
    render(<MemoryRouter><Cercanos /></MemoryRouter>);
    const box = await screen.findByTestId("cercanos-sin-ubicacion");
    expect(box).toHaveTextContent("No tenemos tu ubicación");
    expect(document.body.textContent).not.toMatch(/User denied/);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(calls).toBe(2);
    await waitFor(() => expect(screen.queryByTestId("cercanos-sin-ubicacion")).toBeNull());
  });
});
