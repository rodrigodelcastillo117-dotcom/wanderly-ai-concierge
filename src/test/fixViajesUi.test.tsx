// Auditoría de Inicio, Planear y Viajes (28-oct-2026), claude/fix-viajes: pantallas. Sin red.
import React from "react";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  trips: [] as any[], trip: null as any, profile: { ciudad_origen: "Ciudad de México" } as any,
  quotesPending: false, collab: [] as any[],
}));
const invoke = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ data: null, error: null })));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, not: () => api, order: () => api, limit: () => api, gte: () => api,
      update: () => api, insert: () => api, delete: () => api,
      maybeSingle: async () => ({ data: table === "trips" ? db.trip : table === "profiles" ? db.profile : null, error: null }),
      single: async () => ({ data: table === "trips" ? db.trip : null, error: null }),
      then: (res: any, rej: any) => {
        if (table === "trip_quotes" && db.quotesPending) return new Promise(() => {}).then(res, rej);
        const data = table === "trips" ? db.trips : table === "trip_collaborators" ? db.collab : [];
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: { message: "sin rpc" } }), functions: { invoke: (...a: unknown[]) => invoke(...a) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/DestinationVideo", () => ({ DestinationVideo: () => null }));
vi.mock("@/components/AnalysisProgress", async (orig) => orig());
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/components/CityCollapsible", () => ({ CityCollapsible: ({ children, city }: any) => <div data-testid="city">{city}{children}</div>, useCityImage: () => null }));
vi.mock("@/components/EditWithAIDialog", () => ({ EditWithAIDialog: () => null }));
vi.mock("@/components/InviteFriendDialog", async (orig) => orig());
vi.mock("@/components/TripDocuments", () => ({ TripDocuments: () => null }));
vi.mock("@/components/media/SmartImage", () => ({ SmartImage: ({ alt }: { alt: string }) => <span>{alt}</span>, IllustrativeCaption: () => null }));
vi.mock("@/lib/tripPdf", () => ({ generateTripPDF: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/lib/weatherNow", () => ({ fetchWeatherNow: async () => ({ tempC: 21, label: "Lluvia", source: "MET Norway" }) }));
const subState = vi.hoisted(() => ({ isPro: true }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, error: null, isPro: subState.isPro }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, whileHover, whileTap, layout, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

import PlanTrip from "@/pages/PlanTrip";
import Trips from "@/pages/Trips";
import TripDetail from "@/pages/TripDetail";
import Trenes from "@/pages/Trenes";
import TripESIM from "@/pages/TripESIM";
import { RealTripTotal } from "@/components/RealTripTotal";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { AvatarCircle } from "@/components/avatar/AvatarCircle";
import { InviteFriendDialog } from "@/components/InviteFriendDialog";
import { TripExperiencias } from "@/components/trip/TripExperiencias";
import { noteLiveSearchState } from "@/lib/livePause";
import { TripCommandCenter } from "@/components/TripCommandCenter";
import { BroughtTripForm } from "@/components/plan/BroughtTripForm";
import { localISODatePlus } from "@/lib/localDate";

const at = (url: string, path: string, el: React.ReactNode) => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={el} /></Routes></MemoryRouter>,
);

beforeEach(() => {
  invoke.mockClear();
  sessionStorage.clear();
  try { localStorage.clear(); } catch { /* */ }
  db.trips = []; db.trip = null; db.collab = []; db.quotesPending = false; db.profile = { ciudad_origen: "Ciudad de México" };
});

// ─── P0-1 ───
describe("P0-1 · una recomendación de Inicio NO genera el viaje", () => {
  for (const qs of ["destino=Budapest&pais=Hungr%C3%ADa&sugerencia=1", "destino=Budapest&autoCheapest=1"]) {
    it(`?${qs}: destino y fechas sugeridas visibles y editables; nada se cotiza hasta «Armar mi viaje»`, async () => {
      at(`/dashboard/planear?${qs}`, "/dashboard/planear", <PlanTrip />);
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(/Fechas sugeridas para Budapest/);
      expect(status).toHaveTextContent(/Armar mi viaje/);
      const salida = screen.getByLabelText("Salida") as HTMLInputElement;
      expect(salida.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Editable: la persona puede cambiarla.
      const next = new Date(Date.parse(`${salida.value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      fireEvent.change(salida, { target: { value: next } });
      expect(salida.value).toBe(next);
      await new Promise((r) => setTimeout(r, 50));
      expect(invoke).not.toHaveBeenCalled();
      // Solo al pulsar «Armar mi viaje» (último paso) corre el análisis.
      fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
      const armar = await screen.findByRole("button", { name: /Armar mi viaje/ });
      expect(invoke).not.toHaveBeenCalled();
      fireEvent.click(armar);
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("analizar-viaje", expect.anything()));
      expect((invoke.mock.calls[0] as any)[1].body).toMatchObject({ destino: "Budapest", fecha_salida: next });
    });
  }
});

// ─── P1-4 ───
it("P1-4 · 'Toscana 5 días en abril 2027, 2 personas' en Planear: días, mes y ciudades de la región", async () => {
  at("/dashboard/planear", "/dashboard/planear", <PlanTrip />);
  fireEvent.change(screen.getByLabelText("¿A dónde quieres ir?"), { target: { value: "Toscana 5 días en abril 2027, 2 personas" } });
  const ent = await screen.findByTestId("plan-multicity-entendimos");
  expect(ent).toHaveTextContent("Toscana · 4 noches · abril de 2027");
  expect(ent).toHaveTextContent(/Florencia \(2\) → Siena \(2\)/);
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  const st = await screen.findByRole("status");
  expect(st).toHaveTextContent(/5 días/);
  expect(st).toHaveTextContent(/abril de 2027/);
  expect(invoke).not.toHaveBeenCalled();
});

// ─── P0-2 · pantalla ───
const budapest = {
  id: "056689e6-128c-4f0b-b6c3-54ccc8fb33af", user_id: "u1", destino: "Budapest", pais_destino: "Hungría", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-29", fecha_regreso: "2027-01-05", num_viajeros: 2, status: "listo", total_estimado: 7, created_at: "2026-10-28T20:00:00Z",
  desglose_presupuesto: { 0: 5, 1: 0, 2: 2 },
  vuelos_json: [{ tier: "equilibrio", aerolinea: "Lufthansa", precio_por_persona: 18000, fuente_precio: "estimado" }],
  hospedaje_json: [{ tier: "equilibrio", nombre: "Hotel Gellért", precio_por_noche: 2500, fuente_precio: "estimado" }],
  itinerario_json: [{ dia: 1, titulo: "Llegada" }], tours_json: [], restaurantes_json: [{ nombre: "x" }],
};

describe("P0-2 · un viaje viejo con desglose inválido se ve 'Por recotizar', no '$7 MXN'", () => {
  it("Mis viajes", async () => {
    db.trips = [budapest];
    render(<MemoryRouter><Trips /></MemoryRouter>);
    const card = await screen.findByTestId("trip-card-recotizar");
    expect(card).toHaveTextContent("Por recotizar");
    expect(screen.queryByText(/\$7 MXN/)).toBeNull();
  });
  it("Detalle del viaje", async () => {
    db.trip = budapest;
    at(`/dashboard/viajes/${budapest.id}`, "/dashboard/viajes/:id", <TripDetail />);
    const box = await screen.findByTestId("trip-total-recotizar");
    expect(box).toHaveTextContent("Por recotizar");
    expect(screen.queryByText(/\$7 MXN/)).toBeNull();
    expect(screen.queryByText(/\$4 MXN por persona/)).toBeNull();
  });
});

// ─── P1-13 · Mis viajes no espera en cascada ───
it("P1-13 · Mis viajes pinta los viajes sin esperar las cotizaciones ni las reservas", async () => {
  db.trips = [{ ...budapest, id: "t2", destino: "Madrid", total_estimado: 117184, desglose_presupuesto: { vuelos: 32380, hospedaje: 44604 }, current_quote_id: "q1" }];
  db.quotesPending = true; // la consulta de trip_quotes no responde
  render(<MemoryRouter><Trips /></MemoryRouter>);
  expect((await screen.findAllByText("Madrid")).length).toBeGreaterThan(0);
});

// ─── P1-5 · pantalla ───
it("P1-5 · Destinos: cada día con su fecha y el día faltante como pendiente", async () => {
  db.trip = { ...budapest, id: "m1", destino: "Madrid", pais_destino: "España", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-12", total_estimado: 50000,
    desglose_presupuesto: { vuelos: 30000, hospedaje: 20000 }, itinerario_json: [{ dia: 1, titulo: "Llegada", "mañana": "a", tarde: "b", noche: "c" }, { dia: 2, titulo: "Prado", "mañana": "a", tarde: "b", noche: "c" }] };
  at("/dashboard/viajes/m1#destinos", "/dashboard/viajes/:id", <TripDetail />);
  const panel = await screen.findByText("Llegada");
  const root = panel.closest("[data-trip-panel='destinos']") as HTMLElement;
  expect(within(root).getByText("mié 10 mar")).toBeInTheDocument();
  expect(within(root).getByText("jue 11 mar")).toBeInTheDocument();
  const p = within(root).getByTestId("itinerario-dia-pendiente");
  expect(p).toHaveTextContent("vie 12 mar");
  expect(p).toHaveTextContent(/Día de regreso/);
});

// ─── P1-11 · pantalla ───
describe("P1-11 · Trenes con el viaje puesto", () => {
  it("?trip=: primer tramo, su fecha y los viajeros del viaje; los botones se activan", async () => {
    db.trip = { id: "aaaaaaaa-1111-4111-8111-111111111111", destino: "Roma → Florencia → Venecia", pais_destino: "Italia", fecha_salida: "2027-05-10", fecha_regreso: "2027-05-21", num_viajeros: 2, ciudad_origen: "Ciudad de México" };
    at("/dashboard/trenes?trip=aaaaaaaa-1111-4111-8111-111111111111", "/dashboard/trenes", <Trenes />);
    await waitFor(() => expect(screen.getByLabelText("Origen")).toHaveValue("Roma"));
    expect(screen.getByLabelText("Destino")).toHaveValue("Florencia");
    expect(screen.getByLabelText("Pasajeros")).toHaveValue(2);
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value > "2027-05-10").toBe(true);
    expect(screen.getAllByRole("button", { name: /Buscar/ })[0]).not.toBeDisabled();
  });
  it("?date=20270514 (formato de buyFlow) llena la fecha", () => {
    at("/dashboard/trenes?origin=Roma&dest=Florencia&date=20270514", "/dashboard/trenes", <Trenes />);
    expect(screen.getByLabelText("Fecha")).toHaveValue("2027-05-14");
  });
});

// ─── P1-7 ───
describe("P1-7 · sin '$0' falso ni 'en vivo' que no lo es", () => {
  it("sin ningún precio real no dice 'Total con precios reales: $0 MXN'", () => {
    const trip = { total_estimado: 68478, desglose_presupuesto: { vuelos: 19078, hospedaje: 22400, comida: 14000, tours: 6000, transporte_local: 3000, extras: 4000 } };
    render(<MemoryRouter><RealTripTotal trip={trip} noches={4} viajeros={2} split={{ real: 0, estimado: 68478, realParts: [], estParts: ["vuelo", "hotel"] } as any} /></MemoryRouter>);
    expect(screen.queryByText(/Total con precios reales/)).toBeNull();
    expect(screen.getByTestId("trip-total-sin-reales")).toHaveTextContent(/todo el total es estimado/);
  });
  afterEach(() => vi.useRealTimers());
  it("con las búsquedas en vivo en pausa la pantalla de carga no dice 'en vivo'", () => {
    vi.useFakeTimers();
    noteLiveSearchState({ busquedas_en_pausa: true });
    render(<AnalysisProgress destino="Bogotá" />);
    act(() => { vi.advanceTimersByTime(6000); });
    const st = screen.getByTestId("analysis-status");
    expect(st.textContent).toMatch(/en pausa/);
    expect(st.textContent).not.toMatch(/Consultando proveedores en vivo/);
  });
  it("sin saber si están en pausa tampoco promete 'en vivo'", () => {
    vi.useFakeTimers();
    render(<AnalysisProgress destino="Bogotá" />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByTestId("analysis-status").textContent).not.toMatch(/en vivo/);
  });
});

// ─── P2-14 ───
it("P2-14 · mientras carga el nombre, el avatar no muestra la 'V' de 'Viajero'", () => {
  render(<AvatarCircle url={null} name="" size="sm" />);
  expect(screen.getByTestId("avatar-circle").textContent).toBe("");
  render(<AvatarCircle url={null} name="Sofía" size="sm" />);
  expect(screen.getAllByTestId("avatar-circle")[1].textContent).toBe("S");
});

// ─── P2-19 ───
it("P2-19 · Experiencias: 'No tenemos museos…' una sola vez y sin nota de TheFork sin botón", async () => {
  const trip = { id: "b1", destino: "Bogotá", fecha_salida: "2026-12-04", fecha_regreso: "2026-12-08", hospedaje_json: [], itinerario_json: [] };
  const cities = [{ label: "Bogotá", key: "Bogotá", checkin: "2026-12-04", checkout: "2026-12-08" }];
  const resp = { ok: true, ciudad: "Bogotá", consultado_at: "2026-10-28T18:00:00Z", avisos: [], ancla: null,
    restaurantes: { ok: true, items: [{ place_id: "P1", nombre: "Galenos", rating: 4.8, resenas: 1736, reserva: { actions: [{ kind: "website", provider: "Sitio", url: "https://galenos.example.com/" }] } }], aviso: "", consulta: "mejores restaurantes en Bogotá", consultado_at: "2026-10-28T18:00:00Z" },
    museos: { ok: true, items: [], aviso: "No tenemos museos de esta ciudad en la tabla de taquillas oficiales." },
    tours: { ok: true, results: [], aviso: "" }, wow: { ok: true, results: [], aviso: "" }, eventos: { ok: true, results: [] } };
  const exp = vi.fn(async () => ({ data: resp, error: null }));
  const marks: any = { marks: new Map(), rows: [], mark: async () => ({ ok: true }), unmark: async () => ({ ok: true }) };
  render(<MemoryRouter><TripExperiencias trip={trip} cities={cities} multi={false} marks={marks} userId="u1" invoke={exp as any} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("exp-buscar"));
  await waitFor(() => expect(screen.getByTestId("exp-rest-fuente")).toBeInTheDocument());
  // R4 P2-6: sin «tabla de taquillas oficiales»; el estado vacío sale una sola vez.
  expect(screen.getAllByText(/Aún no tenemos los museos de Bogotá/)).toHaveLength(1);
  expect(document.body.textContent).not.toMatch(/tabla de taquillas/);
  expect(screen.getByTestId("exp-rest-fuente").textContent).not.toMatch(/TheFork/);
});

// ─── P2-21 ───
it("P2-21 · Compartir viaje dice con honestidad que no hay enlace público (no lo inventa)", async () => {
  render(<MemoryRouter><InviteFriendDialog tripId="t1" isOwner /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Compartir viaje" }));
  const p = await screen.findByTestId("compartir-sin-enlace");
  expect(p).toHaveTextContent(/todavía no hay un enlace/);
  expect(p).toHaveTextContent(/Compartir PDF/);
  expect(screen.queryByRole("link", { name: /copiar enlace/i })).toBeNull();
});

// ─── P2-24 ───
it("P2-24 · eSIM sin precio 'desde' desactualizado", () => {
  render(<MemoryRouter><TripESIM /></MemoryRouter>);
  expect(document.body.textContent).not.toMatch(/desde \$\d/);
  expect(document.body.textContent).toMatch(/Airalo/);
});

// ─── P2-14 · la línea del clima no se parte en dos columnas ───
it("P2-14 · 'Ahora en …: 21° · Lluvia (Datos: MET Norway)' es un solo bloque de texto", async () => {
  const trip = { id: "c1", destino: "Oaxaca", pais_destino: "México", fecha_salida: localISODatePlus(2), fecha_regreso: localISODatePlus(5) };
  render(<MemoryRouter><TripCommandCenter trip={trip} today={localISODatePlus(0)} /></MemoryRouter>);
  const txt = await screen.findByText(/Ahora en Oaxaca/);
  expect(txt.tagName).toBe("SPAN");
  expect(txt.textContent).toMatch(/Ahora en Oaxaca: 21° · Lluvia \(Datos: MET Norway\)/);
});

// ─── P2-14 · cada recomendación con su propia foto (no la de Santorini en las 4) ───
it("P2-14 · sin video ni respaldo, DestinationVideo no pinta una foto genérica encima", async () => {
  const { DestinationVideo: Real } = await vi.importActual<typeof import("@/components/DestinationVideo")>("@/components/DestinationVideo");
  const { container } = render(<Real query="budapest hungary cinematic" alt="Budapest" className="x" />);
  expect(container.querySelector("img")).toBeNull();
});

// ─── P2-22 · "plan gratuito" no se le dice a una cuenta PRO ───
it("P2-22 · 'Ya tengo vuelos y hotel' no le dice 'plan gratuito' a una cuenta PRO", () => {
  subState.isPro = true;
  render(<MemoryRouter><BroughtTripForm onDone={() => {}} /></MemoryRouter>);
  const t = screen.getByTestId("brought-vuelo-plan");
  expect(t.textContent).not.toMatch(/plan gratuito/);
  expect(t.textContent).toMatch(/PRO/);
});
