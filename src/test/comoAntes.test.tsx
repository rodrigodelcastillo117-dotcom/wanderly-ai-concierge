// "Como antes" (Carlo, socio, 29-oct-2026): planea sobre todo viajes de varias ciudades y dijo que odia
// la versión actual: 1) no salen las imágenes; 2) está más complejo; 3) no sale el mundito con los
// países; 4) te manda 2 veces para hacer cotización. Datos simulados (sus destinos), sin red ni gasto.
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const db = { trips: [] as any[] };
const calls: Array<{ fn: string; body: any }> = [];
const pexels = { delayMs: 0 };
const invoke = vi.fn(async (fn: string, o: any) => {
  calls.push({ fn, body: o?.body });
  if (fn === "pexels-image") {
    if (pexels.delayMs) await new Promise((r) => setTimeout(r, pexels.delayMs));
    const q = String(o?.body?.query ?? "");
    return { data: { image: `https://images.pexels.com/photos/1/${encodeURIComponent(q)}.jpeg`, photographer: "Simulado" }, error: null };
  }
  if (fn === "analizar-viaje") return { data: { trip: { id: "nuevo-1", itinerario_json: [] } }, error: null };
  return { data: null, error: null };
});
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, update: () => api, insert: () => api,
      maybeSingle: async () => ({ data: table === "profiles" ? { ciudad_origen: "Ciudad de México" } : null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null, count: 0 }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: (f: string, o: any) => invoke(f, o) }, auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "carlo@example.com" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
// El globo 3D (WebGL) no corre en jsdom: se reemplaza por una marca que dice qué ruta pinta.
vi.mock("@/components/RouteGlobe3D", () => ({
  RouteGlobe3D: ({ origin, destinations }: any) => <div data-testid="ruta-globo">{[origin, ...destinations].join(" · ")}</div>,
}));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: ({ value }: any) => <span data-testid="origen">{value}</span> }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, layout, whileHover, whileTap, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</>, useReducedMotion: () => true };
});

import Trips from "@/pages/Trips";
import PlanTrip from "@/pages/PlanTrip";
import MultiDestRoute from "@/pages/MultiDestRoute";
import { SmartImage, IMAGE_STEP_TIMEOUT_MS } from "@/components/media/SmartImage";
import { __resetStockPhotos } from "@/lib/stockPhoto";

const pexelsQueries = () => calls.filter((c) => c.fn === "pexels-image").map((c) => String(c.body?.query));
const paid = () => calls.filter((c) => ["analizar-viaje", "logistics-plan", "interpretar-viaje"].includes(c.fn)).map((c) => c.fn);

// Destinos de Carlo (simulados): rutas de varias ciudades y un viaje con su portada de Google guardada.
const GOOGLE_COVER = "https://lh3.googleusercontent.com/places/ANXAkqCarlo=s1600-w800";
const carloTrips = () => [
  { id: "jp", user_id: "u1", destino: "Tokio → Kioto → Osaka", pais_destino: "Japón", fecha_salida: localISODatePlus(150), fecha_regreso: localISODatePlus(159),
    created_at: "2026-10-20T10:00:00Z", itinerario_json: { destinations: ["Tokio", "Kioto", "Osaka"] } },
  { id: "pt", user_id: "u1", destino: "Lisboa → Sintra → Oporto", pais_destino: "Portugal", fecha_salida: localISODatePlus(190), fecha_regreso: localISODatePlus(198),
    created_at: "2026-10-21T10:00:00Z", itinerario_json: { destinations: ["Lisboa", "Sintra", "Oporto"] } },
  { id: "ny", user_id: "u1", destino: "Nueva York → París → Madrid", pais_destino: "Estados Unidos", fecha_salida: localISODatePlus(220), fecha_regreso: localISODatePlus(232),
    created_at: "2026-10-22T10:00:00Z" },
  { id: "md", user_id: "u1", destino: "Madrid", pais_destino: "España", fecha_salida: localISODatePlus(100), fecha_regreso: localISODatePlus(105),
    created_at: "2026-10-23T10:00:00Z", cover_image_url: GOOGLE_COVER },
];

beforeEach(() => {
  calls.length = 0;
  invoke.mockClear();
  pexels.delayMs = 0;
  sessionStorage.clear();
  localStorage.clear();
  __resetStockPhotos();
  db.trips = carloTrips();
});
afterEach(() => { vi.useRealTimers(); });

describe("1 · imágenes de los viajes de varias ciudades", () => {
  it("Mis viajes pide la foto de la PRIMERA ciudad (nunca la ruta completa) y vuelve a mostrar la portada guardada", async () => {
    render(<MemoryRouter><Trips /></MemoryRouter>);
    const card = (name: string) => screen.getByRole("heading", { name }).closest("a")!;
    await screen.findByRole("heading", { name: "Tokio → Kioto → Osaka" });
    await waitFor(() => expect(pexelsQueries()).toEqual(expect.arrayContaining(["tokio japón travel", "lisboa portugal travel", "nueva york estados unidos travel"])));
    expect(pexelsQueries().filter((q) => q.includes("→"))).toEqual([]);
    // Cada tarjeta multiciudad termina con su foto (no con el ícono del pin).
    for (const name of ["Tokio → Kioto → Osaka", "Lisboa → Sintra → Oporto", "Nueva York → París → Madrid"]) {
      await waitFor(() => expect(within(card(name)).getByTestId("smart-image")).toHaveAttribute("data-kind", "stock"));
    }
    // La portada de Google guardada (ronda 4 la escondía) se muestra como antes.
    const madrid = within(card("Madrid")).getByTestId("smart-image");
    expect(madrid).toHaveAttribute("data-kind", "real");
    expect(madrid.querySelector("img")?.getAttribute("src")).toContain("lh3.googleusercontent.com/places/ANXAkqCarlo");
  });

  it("una foto que tarda más que el tope (fila de varias tarjetas) se pinta al llegar, no se queda el ícono", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pexels.delayMs = IMAGE_STEP_TIMEOUT_MS + 3000;
    render(<SmartImage alt="Tokio" stockQuery="tokio japón travel" eager className="h-40" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(IMAGE_STEP_TIMEOUT_MS + 500); });
    expect(screen.getByTestId("smart-image")).toHaveAttribute("data-kind", "none");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByTestId("smart-image")).toHaveAttribute("data-kind", "stock");
    expect(pexelsQueries()).toEqual(["tokio japón travel"]); // una sola búsqueda
  });
});

let loc = "";
const Spy = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
const renderPlan = (text: string) => render(
  <MemoryRouter initialEntries={[`/dashboard/planear?q=${encodeURIComponent(text)}`]}>
    <Spy />
    <Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} />
      <Route path="/dashboard/ruta" element={<MultiDestRoute />} />
      <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
    </Routes>
  </MemoryRouter>,
);
const stopValues = () => screen.getAllByLabelText(/^Parada \d+$/).map((i) => (i as HTMLInputElement).value);

describe("3 y 4 · Planear directo: sin la pantalla de revisión y con el globo en varias ciudades", () => {
  beforeEach(() => { (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });

  it("'Tokio, Kioto y Osaka 10 días en abril desde CDMX': solo pregunta el día de salida y llega a la ruta con el globo", async () => {
    renderPlan("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    const paso = await screen.findByTestId("plan-preguntas");
    expect(screen.queryByTestId("spec-review")).toBeNull();
    expect(screen.queryByText("Tu viaje, como lo entendimos")).toBeNull();
    expect(within(paso).getByTestId("plan-preguntas-ruta")).toHaveTextContent("Tokio → Kioto → Osaka");
    // Nada inventado: el día de salida lo elige la persona (dentro de abril); el regreso sale de "10 días".
    expect(within(paso).getByText(/Escribiste 10 días en abril de \d{4}: elige el día de salida\./)).toBeInTheDocument();
    const salida = within(paso).getByLabelText("Salida") as HTMLInputElement;
    expect(salida.min).toMatch(/^\d{4}-04-01$/);
    expect(screen.getByTestId("plan-continuar")).toBeDisabled();
    const year = salida.min.slice(0, 4);
    fireEvent.change(salida, { target: { value: `${year}-04-03` } });
    expect((within(paso).getByLabelText("Regreso") as HTMLInputElement).value).toBe(`${year}-04-12`);
    fireEvent.click(screen.getByTestId("plan-continuar"));

    // La ruta multidestino, como antes: el globo con Tokio, Kioto y Osaka, y sus fechas.
    expect(await screen.findByTestId("ruta-globo", {}, { timeout: 5000 })).toHaveTextContent("Ciudad de México · Tokio · Kioto · Osaka");
    expect(loc).toMatch(/^\/dashboard\/ruta\?/);
    expect(stopValues()).toEqual(["Tokio", "Kioto", "Osaka"]);
    expect(screen.getByTestId("ruta-fechas-confirmacion")).toHaveTextContent("9 noches");
    expect(paid()).toEqual([]); // nada se cotizó ni se interpretó con IA: se genera al pulsar en la ruta
  });

  it("'Lisboa → Sintra → Oporto' con fechas y origen: directo a la ruta con el globo, sin preguntas", async () => {
    renderPlan("Lisboa → Sintra → Oporto del 3 al 12 de mayo de 2027 desde CDMX");
    expect(await screen.findByTestId("ruta-globo", {}, { timeout: 5000 })).toHaveTextContent("Lisboa · Sintra · Oporto");
    expect(screen.queryByTestId("spec-review")).toBeNull();
    expect(screen.queryByTestId("plan-preguntas")).toBeNull();
    expect(stopValues()).toEqual(["Lisboa", "Sintra", "Oporto"]);
    expect(screen.getByTestId("ruta-fechas-confirmacion")).toHaveTextContent("Se cotiza del 3 may al 12 may");
    expect(paid()).toEqual([]);
  });

  it("una ciudad con todo dicho ('Oaxaca del 12 al 16 de diciembre, 2 personas'): cotización directa, sin revisión", async () => {
    renderPlan("Oaxaca del 12 al 16 de diciembre, 2 personas");
    expect(await screen.findByText("VIAJE", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(paid()).toEqual(["analizar-viaje"]);
    const body = calls.find((c) => c.fn === "analizar-viaje")!.body;
    expect(body).toMatchObject({ destino: "Oaxaca", ciudad_origen: "Ciudad de México", num_viajeros: 2 });
    expect(body.consulta?.consulta_original).toBe("Oaxaca del 12 al 16 de diciembre, 2 personas"); // "¿No entendimos bien?" sigue teniendo el texto
    expect(loc).toBe("/dashboard/viajes/nuevo-1");
  });

  it("'Ver todo lo que entendimos' sigue disponible desde el paso corto (la revisión ya no es obligatoria)", async () => {
    renderPlan("Nueva York, París y Madrid");
    await screen.findByTestId("plan-preguntas");
    fireEvent.click(screen.getByTestId("plan-ver-todo"));
    expect(screen.getByTestId("spec-review")).toBeInTheDocument();
    expect(screen.getByTestId("spec-entendi")).toHaveTextContent("Nueva York → París → Madrid");
  });
});
