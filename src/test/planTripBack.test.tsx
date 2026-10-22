import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { vi, beforeEach } from "vitest";

const invoke = vi.fn(async (fn: string, _opts: any) => {
  if (fn === "parsear-viaje") return { data: { destino: "Roma", fecha_salida: "2027-03-01", fecha_regreso: "2027-03-06", num_viajeros: 2 }, error: null };
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

beforeEach(() => {
  sessionStorage.clear();
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
  await screen.findByText("VIAJE");
  first.unmount();
  render(tree);
  await waitFor(() => expect(loc).toBe("/dashboard/viajes/trip-1"));
  expect(analyzeCalls()).toBe(1);
});

it("la URL deja de tener ?q en cuanto un montaje vivo toma la interpretación", async () => {
  let resolveParse: (v: any) => void = () => {};
  invoke.mockImplementationOnce(async () => new Promise((r) => { resolveParse = r; })); // parsear-viaje pendiente
  render(
    <MemoryRouter initialEntries={["/dashboard/planear?q=Lima&mode=x"]}>
      <Spy />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("parsear-viaje", expect.anything()));
  // Mientras se interpreta, la frase sigue en la URL: un remontaje puede retomarla (N-09).
  expect(loc).toBe("/dashboard/planear?q=Lima&mode=x");
  await act(async () => { resolveParse({ data: { destino: "Lima" }, error: null }); });
  await screen.findByText("VIAJE");
  expect(loc).toBe("/dashboard/viajes/trip-1");
});

it("N-09: si la página se desmonta y remonta mientras interpreta, retoma la misma interpretación (una sola llamada) y sí analiza", async () => {
  let resolveParse: (v: any) => void = () => {};
  invoke.mockImplementationOnce(async () => new Promise((r) => { resolveParse = r; }));
  const tree = (
    <MemoryRouter initialEntries={["/dashboard/planear?q=Lisboa"]}>
      <Spy />
      <Routes>
        <Route path="/dashboard/planear" element={<PlanTrip />} />
        <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
      </Routes>
    </MemoryRouter>
  );
  const first = render(tree);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("parsear-viaje", expect.anything()));
  first.unmount(); // p. ej. la guardia de rutas mostró su spinner un instante
  render(tree);
  await act(async () => { resolveParse({ data: { destino: "Lisboa" }, error: null }); });
  await screen.findByText("VIAJE");
  expect(invoke.mock.calls.filter((c) => c[0] === "parsear-viaje").length).toBe(1);
  expect(analyzeCalls()).toBe(1);
});
