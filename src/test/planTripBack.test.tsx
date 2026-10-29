import React from "react";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { vi, beforeEach } from "vitest";

// Intérprete de viaje completo (28-oct-2026): la frase se interpreta (sin IA si son solo ciudades
// conocidas; con interpretar-viaje si trae crucero, tramos o regreso) y la persona CONFIRMA "Entendí…"
// antes de gastar. Estas pruebas conservan las garantías de siempre: una sola interpretación por frase,
// la URL sin ?q al tomarla, y "Atrás" o un remontaje nunca repiten el análisis.
const specFor = (ciudad: string, texto: string) => ({
  version: 1, consulta_original: texto, intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [{ id: "p1", ciudad, pais: null, de_region: null, es_puerto: true, rol: "estancia", noches: null, llegada_por: "tren", crucero: null, sugerida: false, texto: ciudad }],
  regreso: { a: "Ciudad de México", via: null, modo: "por_definir" }, fecha_salida: "2027-03-01", fecha_regreso: "2027-03-06", fechas_expresas: true,
  noches_total: 5, viajeros: 2, preferencias: [], reservas: [], menciones: [{ texto: ciudad, tipo: "ciudad", estado: "parada", ref: "p1" }],
  preguntas: [], sugerencias: [], fuente: "ia",
});
const invoke = vi.fn(async (fn: string, _opts: any) => {
  if (fn === "analizar-viaje") return { data: { trip: { id: `trip-${invoke.mock.calls.filter((c) => c[0] === "analizar-viaje").length}` } }, error: null };
  return { data: null, error: null };
});
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ciudad_origen: "Ciudad de México" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (f: string, o: any) => invoke(f, o) } } }));
const user = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import PlanTrip from "@/pages/PlanTrip";

let nav: ReturnType<typeof useNavigate>;
let loc = "";
const Spy = () => { nav = useNavigate(); const l = useLocation(); loc = l.pathname + l.search; return null; };

const analyzeCalls = () => invoke.mock.calls.filter((c) => c[0] === "analizar-viaje").length;
/**
 * Como antes del 28-oct (Carlo, 29-oct-2026): sin fechas, el paso corto las pide y se sigue directo; con
 * todo dicho no hay paso intermedio. Si el resumen completo está en pantalla, se confirma ahí.
 */
const confirmReview = async () => {
  const paso = await screen.findByTestId(/^(plan-preguntas|spec-review)$/);
  if (paso.getAttribute("data-testid") === "plan-preguntas") {
    expect(analyzeCalls()).toBe(0); // nada se cotiza antes de contestar
    fireEvent.change(screen.getByLabelText("Salida"), { target: { value: "2027-03-01" } });
    fireEvent.change(screen.getByLabelText("Regreso"), { target: { value: "2027-03-06" } });
    fireEvent.click(screen.getByTestId("plan-continuar"));
    return;
  }
  const salida = screen.getAllByLabelText("Salida")[0] as HTMLInputElement;
  if (!salida.value) fireEvent.change(salida, { target: { value: "2027-03-01" } });
  const regreso = screen.getAllByLabelText("Regreso")[0] as HTMLInputElement;
  if (!regreso.value) fireEvent.change(regreso, { target: { value: "2027-03-06" } });
  expect(analyzeCalls()).toBe(0); // nada se cotiza antes de confirmar
  fireEvent.click(screen.getByTestId("spec-confirmar"));
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockClear();
});

it("Atrás desde el viaje generado no vuelve a analizar ni crea un duplicado (antes: back trap)", async () => {
  render(
    <MemoryRouter initialEntries={["/dashboard", "/dashboard/planear?q=Roma%205%20d%C3%ADas"]} initialIndex={1}>
      <Spy />
      <Routes>
        <Route path="/dashboard" element={<p>HOME</p>} />
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await confirmReview();
  await screen.findByText("VIAJE");
  expect(analyzeCalls()).toBe(1);
  expect(loc).toBe("/dashboard/viajes/trip-1");

  // El usuario pulsa "Atrás" (BackButton usa navigate(-1)).
  await act(async () => { nav(-1); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  // El viaje reemplazó al asistente en el historial: regresamos al Inicio.
  expect(screen.getByText("HOME")).toBeInTheDocument();
  expect(analyzeCalls()).toBe(1);
});

it("si la misma intención vuelve a montarse (p. ej. historial viejo con ?q), lleva al viaje ya creado sin re-analizar", async () => {
  const tree = (
    <MemoryRouter initialEntries={["/dashboard/planear?q=Roma"]}>
      <Spy />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>
  );
  const first = render(tree);
  await confirmReview();
  await screen.findByText("VIAJE");
  first.unmount();
  render(tree);
  await waitFor(() => expect(loc).toBe("/dashboard/viajes/trip-1"));
  expect(analyzeCalls()).toBe(1);
});

it("la URL deja de tener ?q en cuanto un montaje vivo toma la interpretación", async () => {
  let resolveParse: (v: any) => void = () => {};
  invoke.mockImplementationOnce(async () => new Promise((r) => { resolveParse = r; })); // interpretar-viaje pendiente
  render(
    <MemoryRouter initialEntries={["/dashboard/planear?q=Lima%20en%20tren&mode=x"]}>
      <Spy />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("interpretar-viaje", expect.anything()));
  // Mientras se interpreta, la frase sigue en la URL: un remontaje puede retomarla (N-09).
  expect(loc).toBe("/dashboard/planear?q=Lima%20en%20tren&mode=x");
  await act(async () => { resolveParse({ data: { ok: true, spec: specFor("Lima", "Lima en tren") }, error: null }); });
  await screen.findByTestId("spec-review");
  expect(loc).toBe("/dashboard/planear?mode=x");
  await confirmReview();
  await screen.findByText("VIAJE");
  expect(loc).toBe("/dashboard/viajes/trip-1");
});

it("N-09: si la página se desmonta y remonta mientras interpreta, retoma la misma interpretación (una sola llamada) y sí analiza", async () => {
  let resolveParse: (v: any) => void = () => {};
  invoke.mockImplementationOnce(async () => new Promise((r) => { resolveParse = r; }));
  const tree = (
    <MemoryRouter initialEntries={["/dashboard/planear?q=Lisboa%20en%20tren"]}>
      <Spy />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>
  );
  const first = render(tree);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("interpretar-viaje", expect.anything()));
  first.unmount(); // p. ej. la guardia de rutas mostró su spinner un instante
  render(tree);
  await act(async () => { resolveParse({ data: { ok: true, spec: specFor("Lisboa", "Lisboa en tren") }, error: null }); });
  await confirmReview();
  await screen.findByText("VIAJE");
  expect(invoke.mock.calls.filter((c) => c[0] === "interpretar-viaje").length).toBe(1);
  expect(analyzeCalls()).toBe(1);
});
