// Propuesta «Inicio sencillo» (30-oct-2026, pedido del dueño tras «confusa, no tan intuitiva» de Álvaro):
// arriba «Tu próximo viaje» + UNA acción principal «Planear un viaje»; herramientas agrupadas por momento del
// viaje (Antes / Durante / Después), TODAS a un toque desde Inicio; nada se pierde. Estas pruebas tocan cada
// herramienta de verdad (clic → pantalla) y comprueban que la pantalla existe en App.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, createRoutesFromChildren, matchRoutes, type RouteObject } from "react-router-dom";
import { vi, it, expect, beforeEach, describe } from "vitest";
import { __resetActiveTripColumn } from "@/lib/profileActiveTrip";
import { localISODatePlus } from "@/lib/localDate";

const PUEBLA = "11111111-1111-4111-8111-111111111111";
const db = { trips: [] as any[], fullTrip: null as any };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols = "";
    const api: any = {
      select: (c: string) => { cols = c; return api; },
      eq: () => api, gte: () => api, lte: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => {
        if (table === "profiles") {
          if (cols.includes("active_trip_id")) return { data: { active_trip_id: null }, error: null };
          return { data: { full_name: "Ana Pérez" }, error: null };
        }
        if (table === "trips") return { data: db.fullTrip, error: null };
        return { data: null, error: null };
      },
      update: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? db.trips : [], error: null }).then(res, rej),
    };
    return api;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: null })) } } };
});
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual: any = await vi.importActual("@/contexts/AuthContext");
  return { ...actual, useAuth: () => ({ user: authUser, loading: false }) };
});
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

import DashboardHome from "@/pages/DashboardHome";
import App from "@/App";
import { onOpenIncident } from "@/lib/incidentBus";
import { onOpenPlanWindow } from "@/lib/planBus";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; };
const renderHome = () => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes>
      <Route path="/dashboard" element={<DashboardHome />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

// ─── El árbol de rutas real de App: cada herramienta debe llevar a una pantalla que existe ───────────────
function findRoutesElement(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) { for (const n of node) { const f = findRoutesElement(n); if (f) return f; } return null; }
  if (!isValidElement(node)) return null;
  if (node.type === Routes) return node;
  return findRoutesElement((node.props as { children?: ReactNode }).children);
}
const routesEl = findRoutesElement((App as () => ReactElement)());
const ROUTES: RouteObject[] = routesEl ? createRoutesFromChildren((routesEl.props as { children: ReactNode }).children) : [];
const existe = (href: string) => { const m = matchRoutes(ROUTES, href.split(/[?#]/)[0]) ?? []; return m.length > 0 && m[m.length - 1].route.path !== "*"; };

/** Herramienta → grupo → a dónde lleva (con un viaje próximo, Puebla). */
const T = `/dashboard/viajes/${PUEBLA}`;
const ESPERADO: Array<[grupo: "antes" | "durante" | "despues", label: string, destino: string]> = [
  ["antes", "Vuelos", "/dashboard/vuelos"], ["antes", "Hoteles", "/dashboard/hoteles"], ["antes", "Autos", "/dashboard/autos"],
  ["antes", "Cruceros", "/dashboard/cruceros"], ["antes", "Seguros", "/dashboard/seguros"], ["antes", "eSIM", "/dashboard/esim"],
  ["antes", "Documentos y tarjetas", "/dashboard/beneficios"], ["antes", "Equipaje", `${T}/packing`], ["antes", "Clima", `${T}/clima`],
  ["antes", "Convertidor de moneda", "/dashboard/convertidor"], ["antes", "Comparar destinos", "/dashboard/comparar"],
  ["antes", "Mis reservas", "/dashboard/reservas"],
  ["durante", "En vivo", `${T}/live`], ["durante", "Cerca de ti", "/dashboard/cercanos"], ["durante", "Mapa", `${T}/mapa`],
  ["durante", "Restaurantes", "/dashboard/restaurantes"], ["durante", "Actividades", "/dashboard/actividades"],
  ["durante", "Trenes", "/dashboard/trenes"], ["durante", "Ferries", "/dashboard/ferries"], ["durante", "Traductor", `${T}/traductor`],
  ["durante", "Concierge", "/dashboard/concierge"],
  ["despues", "Diario", `${T}/diario`], ["despues", "Recuerdos", "/dashboard/recuerdos"], ["despues", "Tu resumen del año", "/wrapped"],
];

beforeEach(() => {
  __resetActiveTripColumn();
  localStorage.clear();
  db.trips = [];
  db.fullTrip = null;
});

describe("Inicio sencillo · herramientas por momento del viaje", () => {
  beforeEach(() => {
    db.trips = [{ id: PUEBLA, user_id: "u1", destino: "Puebla", pais_destino: "México", fecha_salida: localISODatePlus(20), fecha_regreso: localISODatePlus(23), created_at: "2026-01-01" }];
    db.fullTrip = { ...db.trips[0] };
  });

  it("cada herramienta está a UN toque desde Inicio, en su grupo, y lleva a una pantalla que existe", async () => {
    for (const [grupo, label, destino] of ESPERADO) {
      renderHome();
      const g = await screen.findByTestId(`home-tools-${grupo}`, {}, { timeout: 5000 });
      // Las del viaje aparecen cuando el viaje ya cargó.
      const btn = await within(g).findByRole("button", { name: label });
      fireEvent.click(btn);
      const where = await screen.findByTestId("where");
      expect(where.textContent, `${label} no llevó a ${destino}`).toMatch(new RegExp(`^${destino.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`));
      expect(existe(where.textContent!), `${label} lleva a una pantalla que no existe: ${where.textContent}`).toBe(true);
      cleanup();
    }
  }, 120_000);

  it("las de reservar reciben el viaje (?trip=), como antes", async () => {
    renderHome();
    fireEvent.click(await within(await screen.findByTestId("home-tools-antes")).findByRole("button", { name: "Vuelos" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(`/dashboard/vuelos?trip=${PUEBLA}`);
  });

  it("«Tengo un problema» abre el mismo diálogo de incidentes, con el viaje", async () => {
    const calls: unknown[] = [];
    const off = onOpenIncident((o) => calls.push(o));
    renderHome();
    fireEvent.click(await within(await screen.findByTestId("home-tools-durante")).findByRole("button", { name: "Tengo un problema" }));
    expect(calls).toEqual([{ tripId: PUEBLA }]);
    expect(screen.queryByTestId("where")).toBeNull();
    off();
  });

  it("los accesos del viaje no se repiten: la tarjeta del viaje ya no los trae y cada herramienta sale UNA vez", async () => {
    renderHome();
    const cc = await screen.findByRole("region", { name: /Puebla/ });
    expect(within(cc).queryByRole("navigation")).toBeNull();
    const tools = screen.getByTestId("home-tools");
    await within(tools).findByRole("button", { name: "Equipaje" });
    const labels = [...tools.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(ESPERADO.length + 1); // + «Tengo un problema»
    expect(screen.getByTestId("home-tools-viaje")).toHaveTextContent("son de tu viaje a Puebla");
  });

  it("el viaje sigue a un toque desde «Mis próximos viajes» (con su foto) y sin «Crear nuevo viaje» repetido", async () => {
    renderHome();
    const list = await screen.findByTestId("home-upcoming");
    expect(await within(list).findByRole("link", { name: /Puebla/ })).toHaveAttribute("href", `/dashboard/viajes/${PUEBLA}`);
    expect(screen.queryByRole("button", { name: /Crear nuevo viaje/ })).toBeNull();
  });

  it("orden: tu próximo viaje → Planear un viaje → herramientas → tus viajes y gastos → destinos → ¿Aún sin destino?", async () => {
    renderHome();
    await screen.findByRole("region", { name: /Puebla/ });
    const order = [
      screen.getByRole("region", { name: /Puebla/ }),
      screen.getByTestId("home-plan"),
      screen.getByTestId("home-tools"),
      screen.getByTestId("home-upcoming"),
      screen.getByRole("heading", { name: /Destinos (afines a ti|para inspirarte)/ }),
      screen.getByTestId("home-hero-texto"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `orden ${i}`).toBeTruthy();
    }
    // «Inspiración para ti» repetía «Ver todos» de Destinos (mismo /dashboard/descubre): ya no está; Descubre sigue a un toque.
    expect(screen.queryByText("Inspiración para ti")).toBeNull();
    expect(screen.getAllByRole("link", { name: /Ver todos/ }).some((a) => a.getAttribute("href") === "/dashboard/descubre")).toBe(true);
  });
});

describe("Inicio sencillo · una sola forma de planear", () => {
  it("sin texto, «Planear un viaje» abre la MISMA ventana que el «+» (si está montada) y no navega", async () => {
    let abierta = 0;
    const off = onOpenPlanWindow(() => { abierta++; });
    renderHome();
    fireEvent.click(await screen.findByTestId("home-plan-cta"));
    expect(abierta).toBe(1);
    expect(screen.queryByTestId("where")).toBeNull();
    off();
  });

  it("sin ventana montada lleva a /dashboard/planear (la misma ruta del «+»)", async () => {
    renderHome();
    fireEvent.click(await screen.findByTestId("home-plan-cta"));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/dashboard\/planear$/);
  });

  it("con texto va directo al plan con esa idea (como la página Planear); Enter hace lo mismo", async () => {
    renderHome();
    const box = await screen.findByLabelText("Platícame tu viaje");
    fireEvent.change(box, { target: { value: "Roma 5 días en mayo" } });
    expect(screen.getByTestId("home-plan-ayuda")).toHaveTextContent(/si falta un dato, solo te preguntamos ese/);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByTestId("where")).toHaveTextContent(`/dashboard/planear?q=${encodeURIComponent("Roma 5 días en mayo")}`);
  });

  it("con menos de 5 letras pide un poco más y no manda nada", async () => {
    let abierta = 0;
    const off = onOpenPlanWindow(() => { abierta++; });
    renderHome();
    fireEvent.change(await screen.findByLabelText("Platícame tu viaje"), { target: { value: "Rom" } });
    fireEvent.click(screen.getByTestId("home-plan-cta"));
    expect(screen.getByTestId("home-plan-ayuda")).toHaveTextContent(/mínimo 5 letras/);
    expect(abierta).toBe(0);
    expect(screen.queryByTestId("where")).toBeNull();
    off();
  });

  it("Inicio tiene UNA acción principal «Planear un viaje» (sin «Analizar», «Crear nuevo viaje» ni «Planear mi primer viaje»)", async () => {
    renderHome();
    await screen.findByTestId("home-plan-cta");
    expect(screen.getAllByRole("button", { name: "Planear un viaje" })).toHaveLength(1);
    for (const n of [/^Analizar$/, /Crear nuevo viaje/, /Planear mi primer viaje/]) expect(screen.queryByRole("button", { name: n })).toBeNull();
  });
});
